// services/tickets.js — دورة التذاكر: إنشاء ← تحويل ← استلمت ← تم ← تأكيد النزيل (وتصعيد عند التأخير)
const { Ticket, Staff, Counter, Conversation } = require('../models');
const messenger = require('./messenger');
const settings = require('./settings');
const realtime = require('./realtime');
const audit = require('./audit');
const media = require('./media');
const wa = require('./whatsapp');

const CATEGORY_LABELS = {
  towels: 'مناشف', cleaning: 'تنظيف', amenities: 'مستلزمات', linen: 'شراشف/بياضات', plumbing: 'سباكة', electric: 'كهرباء',
  ac: 'تكييف', appliance: 'أجهزة', internet: 'إنترنت', furniture: 'أثاث', checkin: 'دخول', checkout: 'خروج', other: 'أخرى',
};
const PRIORITY_LABELS = { low: 'منخفضة', normal: 'عادية', high: 'عالية', urgent: '🚨 عاجلة' };

function label(t) {
  const kind = t.kind === 'maintenance' ? '🔧 صيانة' : '🛎️ طلب';
  return `${kind} #${t.number} — ${CATEGORY_LABELS[t.category] || t.category}${t.roomNumber ? ` — غرفة ${t.roomNumber}` : ''}`;
}

function emitTicket(t) {
  realtime.emit('ticket_updated', t.toObject ? t.toObject() : t);
}

async function pickAssignee(role) {
  const candidates = await Staff.find({ role, active: true }).lean();
  if (!candidates.length) return null;
  // الأقل تذاكر مفتوحة
  const loads = await Promise.all(
    candidates.map(async (s) => ({ s, n: await Ticket.countDocuments({ assignedTo: s._id, status: { $in: ['assigned', 'acknowledged', 'reopened'] } }) }))
  );
  loads.sort((a, b) => a.n - b.n);
  return loads[0].s;
}

async function sendTicketToStaff(ticket, staff, prefix = '') {
  const text =
    `${prefix}${label(ticket)}\nالأولوية: ${PRIORITY_LABELS[ticket.priority] || ticket.priority}\n` +
    `${ticket.description || ''}${ticket.guestName ? `\nالنزيل: ${ticket.guestName}` : ''}`;
  await messenger.notifyStaff([staff.phone], text, {
    kind: 'task',
    buttons: [
      { id: `tk:ack:${ticket._id}`, title: '👍 استلمت' },
      { id: `tk:done:${ticket._id}`, title: '✅ تم' },
    ],
  });
  // صور العطل
  for (const file of ticket.media || []) {
    try {
      const buf = media.read(file);
      const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const id = await wa.uploadMedia(buf, mime, file);
      await wa.sendImage(staff.phone, { mediaId: id }, `صورة التذكرة #${ticket.number}`);
    } catch (err) {
      console.error('⚠️ تعذر إرسال صورة التذكرة:', err.message);
    }
  }
}

async function create({ kind = 'request', category = 'other', priority = 'normal', title, description, roomNumber, guestPhone, guestName, mediaFiles = [], createdBy }) {
  const number = await Counter.next('ticket');
  const routing = settings.get('ticketRouting') || {};
  const role = kind === 'maintenance' ? routing[category] || 'maintenance' : routing[category] || 'housekeeping';
  const staff = await pickAssignee(role);

  const ticket = await Ticket.create({
    number, kind, category, priority, title, description, roomNumber, guestPhone, guestName,
    media: mediaFiles, createdBy,
    status: staff ? 'assigned' : 'open',
    assignedTo: staff?._id, assignedName: staff?.name, assignedPhone: staff?.phone, assignedAt: staff ? new Date() : undefined,
    history: [{ by: createdBy || 'system', action: 'created', note: description }],
  });

  if (staff) {
    await sendTicketToStaff(ticket, staff);
  } else {
    await messenger.alertManagers(`⚠️ لا يوجد موظف نشط بدور "${role}" لاستلام ${label(ticket)}\n${description || ''}`);
  }
  if (priority === 'urgent') {
    await messenger.alertManagers(`🚨 تذكرة عاجلة: ${label(ticket)}\n${description || ''}`);
  }
  await audit.log({ actorType: guestPhone && createdBy === guestPhone ? 'guest' : 'staff', actorPhone: createdBy, action: 'ticket.create', target: `#${number}`, details: { kind, category, priority, roomNumber } });
  emitTicket(ticket);
  return ticket;
}

async function acknowledge(ticketId, staffPhone) {
  const t = await Ticket.findById(ticketId);
  if (!t) return { ok: false, message: 'التذكرة غير موجودة' };
  if (['done', 'closed'].includes(t.status)) return { ok: false, message: `التذكرة #${t.number} مغلقة مسبقاً` };
  const staff = await Staff.findOne({ phone: staffPhone });
  if (!t.assignedTo && staff) Object.assign(t, { assignedTo: staff._id, assignedName: staff.name, assignedPhone: staff.phone });
  t.status = 'acknowledged';
  t.ackAt = new Date();
  t.history.push({ by: staffPhone, action: 'acknowledged' });
  await t.save();
  await audit.log({ actorType: 'staff', actorPhone: staffPhone, action: 'ticket.ack', target: `#${t.number}` });
  emitTicket(t);
  if (t.guestPhone && t.kind === 'maintenance') {
    await messenger.send(t.guestPhone, { text: `تم استلام طلبك رقم #${t.number} وفريقنا في الطريق 🙏`, sender: 'system' });
  }
  return { ok: true, message: `👍 تم تسجيل استلامك للتذكرة #${t.number}`, ticket: t };
}

async function markDone(ticketId, staffPhone, note = '') {
  const t = await Ticket.findById(ticketId);
  if (!t) return { ok: false, message: 'التذكرة غير موجودة' };
  if (['done', 'closed'].includes(t.status)) return { ok: false, message: `التذكرة #${t.number} منجزة مسبقاً` };
  t.status = 'done';
  t.doneAt = new Date();
  if (!t.ackAt) t.ackAt = new Date();
  t.history.push({ by: staffPhone, action: 'done', note });
  await t.save();
  await audit.log({ actorType: 'staff', actorPhone: staffPhone, action: 'ticket.done', target: `#${t.number}`, details: { note } });

  // سؤال النزيل إن وصله الطلب
  if (t.guestPhone) {
    const tpl = settings.get('templates');
    const text = `تم تنفيذ طلبك #${t.number} (${CATEGORY_LABELS[t.category] || t.category}). هل وصلك وأنت راضٍ عن الخدمة؟`;
    await messenger.send(t.guestPhone, {
      text,
      buttons: [
        { id: `fb:yes:${t._id}`, title: 'نعم، شكراً ✅' },
        { id: `fb:no:${t._id}`, title: 'لا ❌' },
      ],
      template: { name: tpl.requestFeedback, params: [String(t.number)], payloads: [`fb:yes:${t._id}`, `fb:no:${t._id}`] },
      sender: 'system',
    });
    t.feedbackAskedAt = new Date();
    await t.save();
  } else {
    t.status = 'closed';
    t.closedAt = new Date();
    await t.save();
  }
  emitTicket(t);
  return { ok: true, message: `✅ تم إغلاق التذكرة #${t.number}${t.guestPhone ? ' وسيُسأل النزيل للتأكيد' : ''}`, ticket: t };
}

async function guestFeedback(ticketId, satisfied, guestPhone) {
  const t = await Ticket.findById(ticketId);
  if (!t) return { ok: false };
  if (satisfied) {
    t.status = 'closed';
    t.closedAt = new Date();
    t.satisfied = true;
    t.history.push({ by: guestPhone, action: 'guest_confirmed' });
    await t.save();
    emitTicket(t);
    await messenger.send(guestPhone, { text: 'شكراً لك 🌿 سعداء بخدمتك، وإذا احتجت أي شيء نحن هنا.', sender: 'system' });
    return { ok: true };
  }
  t.status = 'reopened';
  t.satisfied = false;
  t.ackAt = undefined;
  t.reminderCount = 0;
  t.escalated = false; // دورة جديدة: تذكير ثم تصعيد من جديد إن لم يستلمها أحد
  t.assignedAt = new Date();
  t.history.push({ by: guestPhone, action: 'reopened', note: 'النزيل أفاد أن الطلب لم يصل / غير راضٍ' });
  await t.save();
  emitTicket(t);
  await messenger.send(guestPhone, { text: 'نعتذر منك 🙏 أعدنا فتح الطلب وسيتابعه الفريق فوراً.', sender: 'system' });
  if (t.assignedPhone) {
    const staff = await Staff.findOne({ phone: t.assignedPhone }).lean();
    if (staff) await sendTicketToStaff(t, staff, '🔁 أُعيد فتح التذكرة (النزيل غير راضٍ)\n');
  }
  const supervisors = await Staff.find({ active: true, $or: [{ isSupervisor: true }, { role: 'manager' }] }).lean();
  await messenger.notifyStaff(supervisors.map((s) => s.phone), `🔁 أُعيد فتح ${label(t)} — النزيل غير راضٍ.`, { kind: 'alert' });
  return { ok: true };
}

/** تحديث من الموظف (أداة update_ticket أو اللوحة) */
async function update(ticketRef, { status, note, assignToPhone, priority }, actorPhone) {
  const t = /^\d+$/.test(String(ticketRef)) ? await Ticket.findOne({ number: Number(ticketRef) }) : await Ticket.findById(ticketRef);
  if (!t) return { ok: false, message: 'التذكرة غير موجودة' };
  if (status === 'acknowledged') return acknowledge(t._id, actorPhone);
  if (status === 'done') return markDone(t._id, actorPhone, note);
  if (assignToPhone) {
    const staff = await Staff.findOne({ phone: assignToPhone, active: true });
    if (!staff) return { ok: false, message: 'الموظف غير موجود' };
    Object.assign(t, { assignedTo: staff._id, assignedName: staff.name, assignedPhone: staff.phone, assignedAt: new Date(), status: 'assigned', ackAt: undefined, reminderCount: 0, escalated: false });
    t.history.push({ by: actorPhone, action: 'reassigned', note: staff.name });
    await t.save();
    await sendTicketToStaff(t, staff, '📌 تم تحويل تذكرة لك\n');
  }
  if (priority) t.priority = priority;
  if (status === 'cancelled' || status === 'closed') {
    t.status = status;
    t.closedAt = new Date();
  }
  if (note) t.history.push({ by: actorPhone, action: 'note', note });
  await t.save();
  await audit.log({ actorType: 'staff', actorPhone, action: 'ticket.update', target: `#${t.number}`, details: { status, note, assignToPhone, priority } });
  emitTicket(t);
  return { ok: true, message: `تم تحديث التذكرة #${t.number}`, ticket: t };
}

/** المتابعة الدورية: تذكير ثم تصعيد للمشرف + إغلاق تلقائي إذا لم يرد النزيل */
async function sweep() {
  const s = settings.all();
  const now = Date.now();
  // 'open' = لم يوجد موظف بالدور عند الإنشاء ← تُصعَّد أيضاً حتى لا تبقى بلا متابعة
  const pending = await Ticket.find({ status: { $in: ['open', 'assigned', 'reopened'] }, ackAt: { $exists: false } });
  for (const t of pending) {
    const since = (now - new Date(t.assignedAt || t.createdAt).getTime()) / 60000;
    if (since >= s.ticketEscalateMinutes && !t.escalated) {
      const supervisors = await Staff.find({ active: true, $or: [{ isSupervisor: true }, { role: 'manager' }] }).lean();
      await messenger.notifyStaff(
        supervisors.map((x) => x.phone),
        `⏫ تصعيد: ${label(t)} لم يستلمها ${t.assignedName || 'أحد'} منذ ${Math.round(since)} دقيقة.\n${t.description || ''}`,
        { kind: 'task', buttons: [{ id: `tk:ack:${t._id}`, title: '👍 أتابعها' }, { id: `tk:done:${t._id}`, title: '✅ تم' }] }
      );
      t.escalated = true;
      t.escalatedAt = new Date();
      t.history.push({ by: 'system', action: 'escalated' });
      await t.save();
      emitTicket(t);
      await audit.log({ action: 'ticket.escalate', target: `#${t.number}` });
    } else if (since >= s.ticketAckMinutes * (t.reminderCount + 1) && t.reminderCount < s.ticketMaxReminders && t.assignedPhone) {
      const staff = await Staff.findOne({ phone: t.assignedPhone }).lean();
      if (staff) await sendTicketToStaff(t, staff, `⏰ تذكير (${t.reminderCount + 1}) — لم تؤكد الاستلام بعد\n`);
      t.reminderCount += 1;
      t.lastReminderAt = new Date();
      await t.save();
    }
  }
  // تذاكر منجزة ولم يرد النزيل خلال 12 ساعة → إغلاق تلقائي
  const stale = await Ticket.find({ status: 'done', doneAt: { $lt: new Date(now - 12 * 3600000) } });
  for (const t of stale) {
    t.status = 'closed';
    t.closedAt = new Date();
    t.history.push({ by: 'system', action: 'auto_closed' });
    await t.save();
    emitTicket(t);
  }
}

/** تقرير الأعطال المتكررة لكل وحدة */
async function recurringFaults(days = 90, minCount = 2) {
  const since = new Date(Date.now() - days * 86400000);
  return Ticket.aggregate([
    { $match: { kind: 'maintenance', createdAt: { $gte: since }, roomNumber: { $nin: [null, ''] } } },
    { $group: { _id: { room: '$roomNumber', category: '$category' }, count: { $sum: 1 }, last: { $max: '$createdAt' }, numbers: { $push: '$number' } } },
    { $match: { count: { $gte: minCount } } },
    { $sort: { count: -1 } },
  ]);
}

async function guestRoom(phone) {
  const conv = await Conversation.findOne({ customerPhone: phone }).lean();
  return conv?.state?.roomNumber || '';
}

module.exports = { create, acknowledge, markDone, guestFeedback, update, sweep, recurringFaults, guestRoom, label, CATEGORY_LABELS };
