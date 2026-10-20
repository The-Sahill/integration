// routes/api.js — REST API للوحة التحكم (محمي بتسجيل الدخول)
const express = require('express');
const fs = require('fs');
const models = require('../models');
const { requireAuth, requireManager, sign } = require('../middleware/auth');
const messenger = require('../services/messenger');
const settings = require('../services/settings');
const tickets = require('../services/tickets');
const inventory = require('../services/inventory');
const payments = require('../services/payments');
const bookings = require('../services/bookings');
const reports = require('../services/reports');
const scheduler = require('../services/scheduler');
const zaaer = require('../services/zaaer');
const media = require('../services/media');
const audit = require('../services/audit');
const realtime = require('../services/realtime');
const config = require('../config');
const { checkPassword, hashPassword, normalizePhone } = require('../utils/helpers');

const { Conversation, Message, User, Staff, Booking, Payment, Ticket, PricingRule, Negotiation, InventoryItem, ServiceOrder, AuditLog } = models;
const router = express.Router();

const dashActor = (req) => ({ actorType: 'dashboard', actorName: req.user?.name || req.user?.username });

// ------------------------------------------------------------------ المصادقة
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await User.findOne({ username });
  if (!user || !checkPassword(password, user.passwordHash)) return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  await audit.log({ actorType: 'dashboard', actorName: user.name || user.username, action: 'dashboard.login' });
  res.json({ token: sign(user), user: { username: user.username, name: user.name, role: user.role } });
});

router.use(requireAuth);

router.get('/auth/me', (req, res) => res.json({ user: req.user }));

router.put('/auth/password', async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || !checkPassword(req.body.current, user.passwordHash)) return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });
  if (!req.body.next || req.body.next.length < 6) return res.status(400).json({ message: 'كلمة المرور الجديدة قصيرة' });
  user.passwordHash = hashPassword(req.body.next);
  await user.save();
  res.json({ ok: true });
});

router.get('/users', requireManager, async (req, res) => res.json(await User.find({}, { passwordHash: 0 }).lean()));
router.post('/users', requireManager, async (req, res) => {
  const { username, name, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'اسم المستخدم وكلمة المرور مطلوبان' });
  const u = await User.create({ username, name, role: role || 'reception', passwordHash: hashPassword(password) });
  await audit.log({ ...dashActor(req), action: 'user.create', target: username });
  res.json({ _id: u._id, username, name, role: u.role });
});
router.delete('/users/:id', requireManager, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ message: 'لا يمكنك حذف نفسك' });
  await User.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ الإحصائيات
router.get('/stats', async (req, res) => {
  const [conversations, handoffs, awaiting, pendingReceipts, openTickets, lowStock] = await Promise.all([
    Conversation.countDocuments({ isStaff: false, lastMessageAt: { $gt: new Date(Date.now() - 86400000) } }),
    Conversation.countDocuments({ 'handoff.active': true, aiEnabled: false }),
    Booking.countDocuments({ status: 'awaiting_payment' }),
    Payment.countDocuments({ status: 'pending', method: 'receipt' }),
    Ticket.countDocuments({ status: { $in: ['open', 'assigned', 'acknowledged', 'reopened'] } }),
    InventoryItem.countDocuments({ $expr: { $and: [{ $gt: ['$minQuantity', 0] }, { $lte: ['$quantity', '$minQuantity'] }] } }),
  ]);
  res.json({ conversations, handoffs, awaiting, pendingReceipts, openTickets, lowStock });
});

// ------------------------------------------------------------------ المحادثات
router.get('/conversations', async (req, res) => {
  const q = {};
  if (req.query.type === 'staff') q.isStaff = true;
  else if (req.query.type !== 'all') q.isStaff = { $ne: true };
  if (req.query.stage) q.stage = req.query.stage;
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ customerName: rx }, { customerPhone: rx }];
  }
  res.json(await Conversation.find(q).sort({ lastMessageAt: -1 }).limit(Number(req.query.limit) || 200).lean());
});

router.get('/conversations/:id/messages', async (req, res) => {
  const q = { conversationId: req.params.id };
  if (req.query.before) q.createdAt = { $lt: new Date(req.query.before) };
  const msgs = await Message.find(q).sort({ createdAt: -1 }).limit(Number(req.query.limit) || 60).lean();
  res.json(msgs.reverse());
});

router.patch('/conversations/:id', async (req, res) => {
  const set = {};
  if (typeof req.body.aiEnabled === 'boolean') {
    set.aiEnabled = req.body.aiEnabled;
    if (req.body.aiEnabled) set['handoff.active'] = false;
  }
  if (req.body.stage && Conversation.STAGES.includes(req.body.stage)) Object.assign(set, { stage: req.body.stage, stageUpdatedAt: new Date() });
  if (req.body.customerName) set.customerName = req.body.customerName;
  const conv = await Conversation.findByIdAndUpdate(req.params.id, { $set: set }, { returnDocument: 'after' }).lean();
  await audit.log({ ...dashActor(req), action: 'conversation.update', target: conv?.customerPhone, details: set });
  realtime.emit('conversation_updated', conv);
  res.json(conv);
});

// توافق مع الواجهة القديمة
router.patch('/conversations/:id/toggle-ai', async (req, res) => {
  const conv = await Conversation.findByIdAndUpdate(req.params.id, { $set: { aiEnabled: !!req.body.aiEnabled, ...(req.body.aiEnabled ? { 'handoff.active': false } : {}) } }, { returnDocument: 'after' }).lean();
  realtime.emit('conversation_updated', conv);
  res.json(conv);
});

router.post('/conversations/:id/read', async (req, res) => {
  await Conversation.updateOne({ _id: req.params.id }, { $set: { unread: 0 } });
  res.json({ ok: true });
});

router.post('/conversations/:id/send', async (req, res) => {
  const conv = await Conversation.findById(req.params.id);
  if (!conv) return res.status(404).json({ message: 'المحادثة غير موجودة' });
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ message: 'النص فارغ' });
  if (!messenger.insideWindow(conv)) return res.status(400).json({ message: 'مرّت 24 ساعة على آخر رسالة من العميل — يلزم قالب معتمد (استخدم المتابعة الآلية)' });
  const r = await messenger.send(conv.customerPhone, { text, sender: 'agent', agentName: req.user.name || req.user.username });
  await audit.log({ ...dashActor(req), action: 'conversation.manual_message', target: conv.customerPhone });
  if (!r.ok) return res.status(502).json({ message: `فشل الإرسال: ${r.error}` });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Pipeline والحجوزات
router.get('/pipeline', async (req, res) => {
  const since = new Date(Date.now() - 30 * 86400000);
  const convs = await Conversation.find({ isStaff: { $ne: true }, stage: { $nin: ['in_house'] }, lastMessageAt: { $gt: since } })
    .sort({ lastMessageAt: -1 }).limit(400).lean();
  res.json(convs.map((c) => ({ _id: c._id, name: c.customerName, phone: c.customerPhone, stage: c.stage, state: c.state, lastMessage: c.lastMessage, lastMessageAt: c.lastMessageAt, aiEnabled: c.aiEnabled, followUp: c.followUp })));
});

router.get('/bookings', async (req, res) => {
  const q = req.query.status ? { status: req.query.status } : {};
  res.json(await Booking.find(q).sort({ createdAt: -1 }).limit(200).lean());
});

router.post('/bookings/:id/finalize', async (req, res) => {
  res.json(await bookings.finalizeBooking(req.params.id, req.user.name || req.user.username));
});

router.post('/bookings/:ref/cancel', async (req, res) => {
  res.json(await bookings.cancel(req.params.ref, req.user.name || req.user.username, req.body.reason));
});

router.get('/payments', async (req, res) => {
  const q = req.query.status ? { status: req.query.status } : {};
  res.json(await Payment.find(q).sort({ createdAt: -1 }).limit(200).lean());
});

router.post('/payments/:id/confirm', async (req, res) => {
  res.json(await payments.confirm(req.params.id, { name: req.user.name || req.user.username, phone: 'dashboard' }));
});
router.post('/payments/:id/reject', async (req, res) => {
  res.json(await payments.reject(req.params.id, { name: req.user.name || req.user.username, phone: 'dashboard' }, req.body.reason));
});

// ------------------------------------------------------------------ التذاكر
router.get('/tickets', async (req, res) => {
  const q = {};
  if (req.query.kind) q.kind = req.query.kind;
  if (req.query.status === 'open') q.status = { $in: ['open', 'assigned', 'acknowledged', 'reopened'] };
  else if (req.query.status) q.status = req.query.status;
  if (req.query.room) q.roomNumber = req.query.room;
  res.json(await Ticket.find(q).sort({ createdAt: -1 }).limit(300).lean());
});

router.post('/tickets', async (req, res) => {
  const t = await tickets.create({ ...req.body, createdBy: `dashboard:${req.user.username}` });
  res.json(t);
});

router.patch('/tickets/:id', async (req, res) => {
  const { status, note, assignToPhone, priority } = req.body;
  res.json(await tickets.update(req.params.id, { status, note, priority, assignToPhone: assignToPhone && normalizePhone(assignToPhone, config.defaultCountryCode) }, `dashboard:${req.user.username}`));
});

router.get('/reports/recurring-faults', async (req, res) => {
  res.json(await tickets.recurringFaults(Number(req.query.days) || 90, Number(req.query.min) || 2));
});

// ------------------------------------------------------------------ الأسعار والتفاوض
router.get('/pricing', async (req, res) => res.json(await PricingRule.find().sort({ name: 1 }).lean()));
router.post('/pricing/import-zaaer', requireManager, async (req, res) => {
  try {
    const r = await require('../services/unitTypes').importFromZaaer();
    await audit.log({ ...dashActor(req), action: 'pricing.import_zaaer', details: r });
    res.json(r);
  } catch (err) {
    res.status(502).json({ message: err.message });
  }
});

router.post('/pricing', requireManager, async (req, res) => {
  const r = await PricingRule.create(req.body);
  await audit.log({ ...dashActor(req), action: 'pricing.create', target: r.name, details: req.body });
  res.json(r);
});
router.put('/pricing/:id', requireManager, async (req, res) => {
  const before = await PricingRule.findById(req.params.id).lean();
  const r = await PricingRule.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after', runValidators: true });
  await audit.log({ ...dashActor(req), action: 'pricing.update', target: r?.name, details: { before: { baseRate: before?.baseRate, minRate: before?.minRate, weekendRate: before?.weekendRate }, after: req.body } });
  res.json(r);
});
router.delete('/pricing/:id', requireManager, async (req, res) => {
  await PricingRule.updateOne({ _id: req.params.id }, { $set: { active: false } });
  await audit.log({ ...dashActor(req), action: 'pricing.deactivate', target: req.params.id });
  res.json({ ok: true });
});

router.get('/negotiations', async (req, res) => {
  const list = await Negotiation.find().sort({ updatedAt: -1 }).limit(300).lean();
  const closed = list.filter((n) => ['booked', 'lost', 'rejected'].includes(n.status));
  const won = closed.filter((n) => n.status === 'booked');
  const discounts = won.filter((n) => n.listPrice).map((n) => 1 - (n.finalPrice || n.listPrice) / n.listPrice);
  res.json({
    stats: {
      total: list.length,
      closed: closed.length,
      won: won.length,
      successPct: closed.length ? Math.round((won.length / closed.length) * 100) : null,
      avgDiscountPct: discounts.length ? Math.round((discounts.reduce((a, b) => a + b, 0) / discounts.length) * 100) : 0,
      managerApprovals: list.filter((n) => n.status === 'approved' || (n.offers || []).some((o) => o.by === 'manager')).length,
    },
    items: list,
  });
});

router.get('/zaaer/properties', requireManager, async (req, res) => {
  try {
    res.json(await zaaer.getProperties());
  } catch (err) {
    res.status(502).json({ message: err.message });
  }
});

// ------------------------------------------------------------------ الموظفون والصلاحيات
router.get('/staff', async (req, res) => res.json(await Staff.find().sort({ role: 1, name: 1 }).lean()));
router.post('/staff', requireManager, async (req, res) => {
  const s = await Staff.create({ ...req.body, phone: normalizePhone(req.body.phone, config.defaultCountryCode) });
  await Conversation.updateOne({ customerPhone: s.phone }, { $set: { isStaff: true } });
  await audit.log({ ...dashActor(req), action: 'staff.create', target: s.name, details: { phone: s.phone, role: s.role } });
  res.json(s);
});
router.put('/staff/:id', requireManager, async (req, res) => {
  const body = { ...req.body };
  if (body.phone) body.phone = normalizePhone(body.phone, config.defaultCountryCode);
  const s = await Staff.findByIdAndUpdate(req.params.id, body, { returnDocument: 'after', runValidators: true });
  await Conversation.updateOne({ customerPhone: s.phone }, { $set: { isStaff: s.active } });
  await audit.log({ ...dashActor(req), action: 'staff.update', target: s.name, details: body });
  res.json(s);
});
router.delete('/staff/:id', requireManager, async (req, res) => {
  const s = await Staff.findByIdAndDelete(req.params.id);
  if (s) await Conversation.updateOne({ customerPhone: s.phone }, { $set: { isStaff: false } });
  await audit.log({ ...dashActor(req), action: 'staff.delete', target: s?.name });
  res.json({ ok: true });
});

router.get('/permissions', async (req, res) => {
  const tools = require('../services/tools');
  res.json({ roles: Staff.ROLES, tools: Object.keys(tools.DECLARATIONS), guestTools: tools.GUEST_TOOLS, guestOnly: tools.GUEST_ONLY, confirmTools: tools.CONFIRM_TOOLS, labels: tools.PERMISSION_AR, permissions: settings.get('rolePermissions') });
});
router.put('/permissions', requireManager, async (req, res) => {
  const perms = { ...req.body, manager: ['*'], owner: ['*'] };
  await settings.set('rolePermissions', perms);
  await audit.log({ ...dashActor(req), action: 'permissions.update', details: perms });
  res.json(perms);
});

// ------------------------------------------------------------------ المخزون
router.get('/inventory', async (req, res) => res.json(await inventory.list()));
router.post('/inventory', async (req, res) => {
  const item = await InventoryItem.create(req.body);
  await audit.log({ ...dashActor(req), action: 'inventory.create', target: item.name });
  res.json(item);
});
router.put('/inventory/:id', async (req, res) => {
  const { quantity, ...rest } = req.body; // الكمية تُعدّل عبر adjust لتسجيلها
  res.json(await InventoryItem.findByIdAndUpdate(req.params.id, rest, { returnDocument: 'after' }));
});
router.post('/inventory/:id/adjust', async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'غير موجود' });
  res.json(await inventory.adjust(item.name, { delta: req.body.delta, setTo: req.body.setTo, note: req.body.note }, { name: req.user.name || req.user.username }));
});
router.delete('/inventory/:id', requireManager, async (req, res) => {
  await InventoryItem.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ الديلفري والدراي كلين
router.get('/service-orders', async (req, res) => res.json(await ServiceOrder.find().sort({ createdAt: -1 }).limit(200).lean()));

// ------------------------------------------------------------------ الإعدادات
router.get('/settings', async (req, res) => {
  const s = { ...settings.all() };
  delete s.rolePermissions;
  res.json({
    settings: s,
    env: {
      model: config.gemini.model,
      zaaerCheckout: config.zaaer.checkoutEnabled,
      holdInZaaer: config.zaaer.holdInZaaer,
      zaaerReceipt: !!config.zaaer.endpoints.receipt.path,
      zaaerCheckin: !!config.zaaer.endpoints.checkin.path,
      zaaerBalances: !!config.zaaer.endpoints.balances.path,
      dryCleanApi: !!config.dryClean.apiUrl,
      deliveryMode: config.delivery.mode,
      signatureCheck: !!config.whatsapp.appSecret,
      publicUrl: config.publicUrl,
    },
  });
});
router.put('/settings', requireManager, async (req, res) => {
  const updated = await settings.setMany(req.body);
  await audit.log({ ...dashActor(req), action: 'settings.update', details: Object.keys(req.body) });
  res.json(updated);
});

// ------------------------------------------------------------------ التقارير والتدقيق
router.get('/reports/daily', async (req, res) => res.json({ text: await reports.buildDailyReport(), stats: await reports.stats() }));
router.post('/reports/daily/send', requireManager, async (req, res) => res.json({ text: await scheduler.dailyReport(true) }));

router.get('/audit', async (req, res) => {
  const q = {};
  if (req.query.action) q.action = new RegExp(String(req.query.action).replace(/[.*+?^${}()|[\]\\]/g, ''), 'i');
  res.json(await AuditLog.find(q).sort({ at: -1 }).limit(Math.min(Number(req.query.limit) || 200, 1000)).lean());
});

// ------------------------------------------------------------------ الـ Prompt (التحكم بالـ AI)
const prompts = require('../prompts/system');
const gemini = require('../services/gemini');

router.get('/prompts', async (req, res) => {
  const s = settings.all();
  res.json({
    guestPrompt: s.guestPrompt, guestExtraRules: s.guestExtraRules, staffPrompt: s.staffPrompt, staffExtraRules: s.staffExtraRules,
    defaults: { guest: prompts.DEFAULT_GUEST_PROMPT, staff: prompts.DEFAULT_STAFF_PROMPT },
    preview: { guest: prompts.guestSystemPrompt(), staff: prompts.staffSystemPrompt({ name: 'أحمد', role: 'reception' }) },
    variables: ['{propertyName}', '{dialect}', '{propertyInfo}', '{paymentMethods}', '{staffName}', '{staffRole}'],
  });
});

router.put('/prompts', requireManager, async (req, res) => {
  const allowed = ['guestPrompt', 'guestExtraRules', 'staffPrompt', 'staffExtraRules'];
  const before = Object.fromEntries(allowed.map((k) => [k, settings.get(k)]));
  for (const k of allowed) if (typeof req.body[k] === 'string') await settings.set(k, req.body[k]);
  await audit.log({ ...dashActor(req), action: 'prompt.update', details: { changed: allowed.filter((k) => typeof req.body[k] === 'string' && req.body[k] !== before[k]) } });
  res.json({ ok: true, preview: { guest: prompts.guestSystemPrompt() } });
});

// تجربة الـ Prompt بدون أدوات (لا يُنفّذ أي حجز أو تغيير) — لمعاينة الأسلوب
router.post('/prompts/test', requireManager, async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ message: 'اكتب رسالة تجريبية' });
  let system = req.body.audience === 'staff' ? prompts.staffSystemPrompt({ name: 'أحمد', role: 'reception' }) : prompts.guestSystemPrompt();
  if (typeof req.body.draft === 'string' && req.body.draft.trim()) {
    const vars = { propertyName: settings.get('propertyName'), dialect: settings.get('dialect'), propertyInfo: settings.get('propertyInfo'), paymentMethods: settings.enabledPaymentLabels(), staffName: 'أحمد', staffRole: 'استقبال' };
    system = prompts.fill(req.body.draft, vars);
  }
  const r = await gemini.generate({ systemInstruction: `${system}\n\n[وضع التجربة: لا توجد أدوات متاحة؛ إن احتجت سعراً أو توفراً قل ما كنت ستفعله بين قوسين]`, contents: [{ role: 'user', parts: [{ text: message }] }] });
  res.json({ reply: gemini.responseText(r) });
});

// ------------------------------------------------------------------ التحليلات والمخاطر والأرصدة
const analytics = require('../services/analytics');
const insights = require('../services/insights');
const finance = require('../services/finance');

function requireRoles(...roles) {
  return (req, res, next) => (roles.includes(req.user?.role) ? next() : res.status(403).json({ message: 'لا تملك صلاحية عرض هذه البيانات' }));
}
const analyticsRoles = requireRoles('owner', 'manager', 'finance');

router.get('/analytics/compare', analyticsRoles, async (req, res) => {
  const type = ['day', 'week', 'month', 'year'].includes(req.query.type) ? req.query.type : 'week';
  res.json(await analytics.compare(type, Number(req.query.offset) || 0));
});
router.get('/analytics/series', analyticsRoles, async (req, res) => {
  const type = ['day', 'week', 'month', 'year'].includes(req.query.type) ? req.query.type : 'month';
  const max = { day: 31, week: 26, month: 24, year: 5 }[type];
  res.json(await analytics.series(type, Math.min(Number(req.query.count) || { day: 14, week: 8, month: 12, year: 3 }[type], max)));
});
router.get('/analytics/forward', analyticsRoles, async (req, res) => res.json(await analytics.forward()));
router.get('/insights', analyticsRoles, async (req, res) => res.json(await insights.getInsights({ refresh: req.query.refresh === '1' })));
router.get('/finance/balances', analyticsRoles, async (req, res) => {
  await audit.log({ ...dashActor(req), action: 'finance.balances_viewed' });
  res.json(await finance.balances());
});

// ------------------------------------------------------------------ الوسائط (صور/صوت)
router.get('/media/:file', (req, res) => {
  const p = media.filePath(req.params.file);
  if (!fs.existsSync(p)) return res.sendStatus(404);
  res.sendFile(p);
});

module.exports = router;
