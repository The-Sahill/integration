// services/approvals.js — تأكيد الموظف قبل العمليات المغيِّرة + موافقة المدير على الأسعار تحت الحد الأدنى
const { PendingAction, Negotiation, Conversation, Staff } = require('../models');
const messenger = require('./messenger');
const audit = require('./audit');
const bookings = require('./bookings');
const config = require('../config');

const CONFIRM_TTL_MIN = 30;

/** الموظف طلب عملية مغيِّرة ← نعيد صياغتها ونطلب "نعم/لا" */
async function requestStaffConfirmation(staff, tool, args, summary) {
  // إلغاء أي تأكيد سابق معلّق لنفس الموظف
  await PendingAction.updateMany({ type: 'staff_confirm', requestedBy: staff.phone, status: 'pending' }, { $set: { status: 'expired' } });
  const action = await PendingAction.create({
    type: 'staff_confirm', requestedBy: staff.phone, requestedByName: staff.name, targetPhones: [staff.phone],
    tool, args, summary, expiresAt: new Date(Date.now() + CONFIRM_TTL_MIN * 60000),
  });
  await messenger.notifyStaff([staff.phone], `${summary}\n\nهل أنفّذ؟`, {
    kind: 'decision',
    buttons: [
      { id: `act:yes:${action._id}`, title: '✅ نعم، نفّذ' },
      { id: `act:no:${action._id}`, title: '❌ لا' },
    ],
  });
  return action;
}

/** تنفيذ/إلغاء بعد ضغط الزر */
async function resolveStaffConfirmation(actionId, yes, staffPhone) {
  const action = await PendingAction.findById(actionId);
  if (!action || action.type !== 'staff_confirm') return { ok: false, message: 'العملية غير موجودة' };
  if (action.status !== 'pending') return { ok: false, message: 'تم التعامل مع هذا الطلب مسبقاً' };
  if (!action.targetPhones.includes(staffPhone)) return { ok: false, message: 'غير مصرح لك بتأكيد هذه العملية' };
  if (action.expiresAt && action.expiresAt < new Date()) {
    action.status = 'expired';
    await action.save();
    return { ok: false, message: '⌛ انتهت صلاحية طلب التأكيد — أعد الطلب من جديد' };
  }
  action.decidedBy = staffPhone;
  action.decidedAt = new Date();
  if (!yes) {
    action.status = 'rejected';
    await action.save();
    return { ok: true, message: 'تم الإلغاء، لم يُنفَّذ شيء 👍' };
  }
  const staff = await Staff.findOne({ phone: staffPhone }).lean();
  const tools = require('./tools'); // تحميل متأخر لتجنب الدوران
  try {
    const result = await tools.execute(action.tool, action.args, { actor: staff, isStaff: true, confirmed: true });
    action.status = 'executed';
    action.result = result;
    await action.save();
    return { ok: true, message: tools.formatResultForStaff(action.tool, result) };
  } catch (err) {
    action.status = 'failed';
    action.result = { error: err.message };
    await action.save();
    await audit.log({ actorType: 'staff', actorName: staff?.name, actorPhone: staffPhone, action: `${action.tool}.failed`, details: { error: err.message, args: action.args }, success: false });
    return { ok: false, message: `❌ فشل التنفيذ: ${err.message}` };
  }
}

/** طلب موافقة المدير على سعر أقل من الحد الأدنى */
async function requestPriceApproval(conversation, { requestedPrice, note }) {
  const negId = conversation.state?.negotiationId;
  const neg = negId ? await Negotiation.findById(negId) : null;
  if (!neg) throw new Error('لا يوجد تفاوض مفتوح — استخدم get_price_quote أولاً');
  if (neg.status === 'approval_pending') return { status: 'already_pending' };
  const price = Number(requestedPrice || neg.offers.filter((o) => o.by === 'guest').pop()?.amount || 0);
  if (!price) throw new Error('حدد السعر الذي يطلبه العميل');
  neg.status = 'approval_pending';
  neg.offers.push({ by: 'guest', amount: price, note: 'طلب موافقة المدير' });
  await neg.save();

  const managers = await messenger.staffByRole('manager');
  const action = await PendingAction.create({
    type: 'manager_approval', requestedBy: conversation.customerPhone, requestedByName: conversation.customerName,
    targetPhones: managers.map((m) => m.phone), tool: 'price_approval', args: { price, negotiationId: String(neg._id), conversationId: String(conversation._id) },
    relatedId: String(neg._id), summary: `طلب سعر خاص`, expiresAt: new Date(Date.now() + 24 * 3600000),
  });
  const text =
    `💰 طلب موافقة على سعر\nالعميل: ${conversation.customerName} (+${conversation.customerPhone})\n` +
    `${neg.unitName}: ${neg.checkIn} ← ${neg.checkOut} (${neg.nights} ليالٍ)\n` +
    `السعر الأساسي: ${neg.listPrice} | الحد الأدنى: ${neg.floorPrice} | آخر عرض: ${neg.currentOffer}\n` +
    `العميل يطلب: ${price}${note ? `\nملاحظة: ${note}` : ''}\n(للموافقة بسعر مختلف اكتب: وافق ${action._id.toString().slice(-6)} بسعر 100)`;
  await messenger.notifyStaff(managers.map((m) => m.phone), text, {
    kind: 'decision',
    buttons: [
      { id: `appr:ok:${action._id}`, title: `✅ موافق ${price}` },
      { id: `appr:no:${action._id}`, title: '❌ رفض' },
    ],
  });
  await audit.log({ actorType: 'ai', actorPhone: conversation.customerPhone, action: 'price.approval_requested', target: String(neg._id), details: { price, floor: neg.floorPrice } });
  return { status: 'sent_to_manager', message: 'أخبر العميل بلطف أنك رفعت طلبه للإدارة وستعود له خلال وقت قصير' };
}

/** قرار المدير (زر أو أمر نصي) — يُنفَّذ تلقائياً ويُبلَّغ العميل */
async function decidePriceApproval(actionRef, approve, managerPhone, counterPrice) {
  let action = /^[a-f0-9]{24}$/i.test(String(actionRef)) ? await PendingAction.findById(actionRef) : null;
  if (!action && actionRef) {
    const pend = await PendingAction.find({ type: 'manager_approval', status: 'pending' }).lean();
    const match = pend.find((p) => String(p._id).endsWith(String(actionRef)));
    if (match) action = await PendingAction.findById(match._id);
  }
  if (!action) action = await PendingAction.findOne({ type: 'manager_approval', status: 'pending' }).sort({ createdAt: -1 });
  if (!action || action.type !== 'manager_approval') return { ok: false, message: 'لا يوجد طلب موافقة معلّق' };
  if (action.status !== 'pending') return { ok: false, message: 'تم اتخاذ قرار بهذا الطلب مسبقاً' };
  const manager = await Staff.findOne({ phone: managerPhone, role: { $in: ['manager', 'owner'] }, active: true }).lean();
  if (!manager) return { ok: false, message: 'الموافقة للمدير أو المالك فقط' };

  const neg = await Negotiation.findById(action.args.negotiationId);
  const conv = await Conversation.findById(action.args.conversationId);
  const price = Number(counterPrice || action.args.price);
  action.status = approve ? 'approved' : 'rejected';
  action.decidedBy = managerPhone;
  action.decidedAt = new Date();
  action.result = { price };
  await action.save();

  if (approve) {
    neg.status = 'approved';
    neg.finalPrice = price;
    neg.currentOffer = price;
    neg.offers.push({ by: 'manager', amount: price, note: 'موافقة المدير' });
    await neg.save();
    await bookings.setStage(conv._id, 'negotiating', { agreedPrice: price, quotedPrice: price });
    await messenger.send(conv.customerPhone, {
      text: `خبر حلو 🌟 الإدارة وافقت على سعر ${price} ${config.zaaer.currency} لإقامتك من ${neg.checkIn} إلى ${neg.checkOut} (${neg.unitName}). أثبّت لك الحجز؟`,
      sender: 'system',
    });
  } else {
    neg.status = 'open';
    neg.currentOffer = neg.floorPrice;
    await neg.save();
    await messenger.send(conv.customerPhone, {
      text: `نعتذر منك 🙏 راجعنا طلبك مع الإدارة، وأفضل سعر نقدر نقدمه هو ${neg.floorPrice} ${config.zaaer.currency} لكامل الإقامة. يسعدنا نثبّت لك الحجز إذا ناسبك.`,
      sender: 'system',
    });
  }
  await audit.log({ actorType: 'staff', actorName: manager.name, actorPhone: managerPhone, action: approve ? 'price.approved' : 'price.rejected', target: String(neg._id), details: { price } });
  return { ok: true, message: approve ? `✅ تمت الموافقة على ${price} وأُبلغ العميل` : '❌ تم الرفض وأُبلغ العميل بآخر سعر' };
}

module.exports = { requestStaffConfirmation, resolveStaffConfirmation, requestPriceApproval, decidePriceApproval };
