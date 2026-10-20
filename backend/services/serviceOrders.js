// services/serviceOrders.js — طلبات الديلفري والدراي كلين عبر الـ Adapters + متابعة الحالة وإبلاغ النزيل
const { ServiceOrder } = require('../models');
const dryClean = require('../adapters/dryClean');
const delivery = require('../adapters/delivery');
const messenger = require('./messenger');
const audit = require('./audit');
const realtime = require('./realtime');
const { shortRef } = require('../utils/helpers');

const FINAL = ['delivered', 'completed', 'failed', 'cancelled'];
const STATUS_AR = {
  created: 'تم الإنشاء', sent: 'تم الإرسال', accepted: 'تم القبول', in_progress: 'قيد التنفيذ',
  delivered: 'تم التوصيل', completed: 'مكتمل', failed: 'تعذر التنفيذ', cancelled: 'ملغي',
};

function emit(o) {
  realtime.emit('service_order_updated', o.toObject ? o.toObject() : o);
}

async function sendViaWhatsapp(order, number, title) {
  const text =
    `${title} — طلب ${order.ref}\n${order.roomNumber ? `غرفة: ${order.roomNumber}\n` : ''}` +
    `${order.guestName ? `النزيل: ${order.guestName}${order.guestPhone ? ` (+${order.guestPhone})` : ''}\n` : ''}${order.details}`;
  await messenger.notifyStaff([number], text, {
    kind: 'task',
    buttons: [
      { id: `svc:ack:${order._id}`, title: '👍 استلمت' },
      { id: `svc:done:${order._id}`, title: '✅ تم التسليم' },
    ],
  });
  order.channel = 'whatsapp';
  order.status = 'sent';
  order.statusText = `أُرسل عبر واتساب إلى ${number}`;
}

async function orderDryClean({ roomNumber, items = {}, notes = '', guestPhone, guestName, requestedBy }) {
  const details = [dryClean.describeItems(items), notes].filter(Boolean).join(' — ') || notes;
  const order = await ServiceOrder.create({ ref: shortRef('DC'), provider: 'dryclean', guestPhone, guestName, roomNumber, items, details, requestedBy, history: [{ status: 'created' }] });
  let sent = false;
  if (dryClean.enabled()) {
    try {
      const r = await dryClean.createOrder({ roomNumber, items, notes, customer: guestName || '' });
      Object.assign(order, { channel: 'api', externalId: r.externalId, status: r.status, statusText: r.statusText });
      sent = true;
    } catch (err) {
      console.error('⚠️ فشل Adapter الدراي كلين، التحويل لواتساب:', err.message);
      order.history.push({ status: 'api_failed', note: err.message });
    }
  }
  if (!sent) {
    const number = dryClean.whatsappFallback();
    if (number) await sendViaWhatsapp(order, number, '🧺 طلب دراي كلين');
    else {
      const hk = await messenger.staffByRole(['housekeeping']);
      if (hk.length) await sendViaWhatsapp(order, hk[0].phone, '🧺 طلب دراي كلين');
      else order.statusText = 'لا توجد جهة مستلمة — راجع الإعدادات';
    }
  }
  order.history.push({ status: order.status, note: order.statusText });
  await order.save();
  await audit.log({ actorType: requestedBy === guestPhone ? 'guest' : 'staff', actorPhone: requestedBy, action: 'service.dryclean', target: order.ref, details: { roomNumber, items } });
  emit(order);
  return order;
}

async function orderDelivery({ details, roomNumber, guestPhone, guestName, requestedBy }) {
  const order = await ServiceOrder.create({ ref: shortRef('DL'), provider: 'delivery', guestPhone, guestName, roomNumber, details, requestedBy, history: [{ status: 'created' }] });
  let sent = false;
  if (delivery.mode() === 'http') {
    try {
      const r = await delivery.createOrder({ ref: order.ref, roomNumber, guestName, guestPhone, details });
      Object.assign(order, { channel: 'api', externalId: r.externalId, status: r.status, statusText: r.statusText });
      sent = true;
    } catch (err) {
      console.error('⚠️ فشل Adapter التوصيل، التحويل لواتساب:', err.message);
      order.history.push({ status: 'api_failed', note: err.message });
    }
  }
  if (!sent) {
    const number = delivery.whatsappNumber();
    if (number) await sendViaWhatsapp(order, number, '🛵 طلب توصيل');
    else {
      const d = await messenger.staffByRole(['delivery', 'reception']);
      if (d.length) await sendViaWhatsapp(order, d[0].phone, '🛵 طلب توصيل');
      else order.statusText = 'لا توجد جهة توصيل — راجع الإعدادات';
    }
  }
  order.history.push({ status: order.status, note: order.statusText });
  await order.save();
  await audit.log({ actorType: requestedBy === guestPhone ? 'guest' : 'staff', actorPhone: requestedBy, action: 'service.delivery', target: order.ref, details: { roomNumber, details } });
  emit(order);
  return order;
}

async function setStatus(order, status, statusText) {
  if (order.status === status) return false;
  order.status = status;
  order.statusText = statusText || STATUS_AR[status] || status;
  order.history.push({ status, note: order.statusText });
  await order.save();
  emit(order);
  if (order.guestPhone) {
    const name = order.provider === 'delivery' ? 'طلب التوصيل' : 'طلب الدراي كلين';
    await messenger.send(order.guestPhone, { text: `تحديث ${name} (${order.ref}): ${STATUS_AR[status] || status} ${status === 'delivered' || status === 'completed' ? '✅' : ''}`, sender: 'system' });
  }
  return true;
}

/** أزرار الجهة المستلمة في وضع واتساب */
async function handleButton(orderId, action, phone) {
  const order = await ServiceOrder.findById(orderId);
  if (!order) return { ok: false, message: 'الطلب غير موجود' };
  if (FINAL.includes(order.status)) return { ok: false, message: 'هذا الطلب مغلق' };
  if (action === 'ack') await setStatus(order, 'accepted', 'تم استلام الطلب من الجهة');
  if (action === 'done') await setStatus(order, order.provider === 'delivery' ? 'delivered' : 'completed');
  await audit.log({ actorType: 'staff', actorPhone: phone, action: `service.${action}`, target: order.ref });
  return { ok: true, message: action === 'ack' ? `👍 تم تسجيل استلام ${order.ref}` : `✅ تم إغلاق ${order.ref} وإبلاغ النزيل` };
}

async function pollStatuses() {
  const open = await ServiceOrder.find({ channel: 'api', status: { $nin: FINAL }, createdAt: { $gt: new Date(Date.now() - 7 * 86400000) } });
  for (const o of open) {
    try {
      const r = o.provider === 'dryclean' ? await dryClean.getStatus(o.externalId) : await delivery.getStatus(o.externalId);
      o.lastCheckedAt = new Date();
      if (r.status !== o.status) await setStatus(o, r.status, r.statusText);
      else await o.save();
    } catch (err) {
      console.error(`⚠️ تعذر جلب حالة ${o.ref}:`, err.message);
    }
  }
}

async function statusOf(ref) {
  const o = await ServiceOrder.findOne({ ref });
  if (!o) return null;
  if (o.channel === 'api' && !FINAL.includes(o.status)) {
    try {
      const r = o.provider === 'dryclean' ? await dryClean.getStatus(o.externalId) : await delivery.getStatus(o.externalId);
      if (r.status !== o.status) await setStatus(o, r.status, r.statusText);
    } catch (_) { /* نعيد آخر حالة معروفة */ }
  }
  return { ref: o.ref, provider: o.provider, status: STATUS_AR[o.status] || o.status, details: o.statusText, room: o.roomNumber };
}

module.exports = { orderDryClean, orderDelivery, handleButton, pollStatuses, statusOf, STATUS_AR };
