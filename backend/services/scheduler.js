// services/scheduler.js — مُجدول داخلي في نفس العملية (بدون cron خارجي)
const { Conversation, Negotiation, PendingAction } = require('../models');
const settings = require('./settings');
const messenger = require('./messenger');
const bookings = require('./bookings');
const tickets = require('./tickets');
const payments = require('./payments');
const serviceOrders = require('./serviceOrders');
const reports = require('./reports');
const audit = require('./audit');
const config = require('../config');
const { todayISO, hourIn } = require('../utils/helpers');

const running = {};
let lastDbWarn = 0;
async function guard(name, fn) {
  if (running[name]) return;
  // قاعدة البيانات غير متصلة (إعادة اتصال جارية) — نتخطى الدورة بدل إغراق السجل بالأخطاء
  if (require('mongoose').connection.readyState !== 1) {
    if (Date.now() - lastDbWarn > 60000) {
      lastDbWarn = Date.now();
      console.warn('⏸️ المُجدول متوقف مؤقتاً: قاعدة البيانات غير متصلة، بانتظار إعادة الاتصال...');
    }
    return;
  }
  running[name] = true;
  try {
    await fn();
  } catch (err) {
    const net = /ECONNRESET|ETIMEDOUT|EPIPE|MongoNetwork|connection .* closed|Server selection timed out/i.test(`${err.name} ${err.message}`);
    if (net) {
      if (Date.now() - lastDbWarn > 60000) {
        lastDbWarn = Date.now();
        console.warn(`⚠️ انقطاع شبكة مع MongoDB (${err.message}) — سيُعاد المحاولة تلقائياً في الدورة القادمة`);
      }
    } else console.error(`⚠️ مهمة ${name} فشلت:`, err.message);
  } finally {
    running[name] = false;
  }
}

function fill(text, conv) {
  const st = conv.state || {};
  return String(text || '')
    .replace('{name}', st.guestName || conv.customerName || '')
    .replace('{checkIn}', st.checkIn || '')
    .replace('{checkOut}', st.checkOut || '');
}

/** متابعة العملاء الذين لم يكملوا: تذكير ← تذكير ثانٍ ← إغلاق */
async function followUps() {
  const s = settings.all();
  const now = Date.now();
  const convs = await Conversation.find({
    isStaff: false, aiEnabled: true, stage: { $in: ['quoted', 'negotiating', 'awaiting_payment'] }, lastInboundAt: { $exists: true },
  });
  for (const c of convs) {
    // ننتظر رد العميل فقط إذا كانت آخر رسالة منّا
    if (c.lastMessageAt && c.lastInboundAt && c.lastMessageAt <= c.lastInboundAt) continue;
    const idle = (now - c.lastInboundAt.getTime()) / 60000;
    const count = c.followUp?.count || 0;
    const name = c.state?.guestName || c.customerName || 'ضيفنا';
    const tpl = s.templates;

    if (count === 0 && idle >= s.followUp1Minutes) {
      const text = c.stage === 'awaiting_payment'
        ? `أهلاً ${name} 🌿 تذكير لطيف: حجزك المبدئي ما زال محجوزاً لك، أرسل صورة إيصال الدفع لتثبيته.`
        : fill(s.followUpText1, c);
      const template = c.stage === 'awaiting_payment'
        ? { name: tpl.paymentReminder, params: [name, c.state?.activeBookingRef || '-'] }
        : { name: tpl.followUp, params: [name, `${c.state?.checkIn || ''} - ${c.state?.checkOut || ''}`] };
      await messenger.send(c.customerPhone, { text, template, sender: 'system' });
      await Conversation.updateOne({ _id: c._id }, { $set: { 'followUp.count': 1, 'followUp.lastAt': new Date() } });
    } else if (count === 1 && idle >= s.followUp2Minutes) {
      await messenger.send(c.customerPhone, {
        text: fill(s.followUpText2, c),
        template: { name: tpl.followUp, params: [name, `${c.state?.checkIn || ''} - ${c.state?.checkOut || ''}`] },
        sender: 'system',
      });
      await Conversation.updateOne({ _id: c._id }, { $set: { 'followUp.count': 2, 'followUp.lastAt': new Date() } });
    } else if (count >= 2 && idle >= s.closeAfterMinutes && c.stage !== 'awaiting_payment') {
      await Conversation.updateOne({ _id: c._id }, { $set: { stage: 'lost', stageUpdatedAt: new Date() } });
      await Negotiation.updateMany({ conversationId: c._id, status: { $in: ['open', 'accepted', 'approved'] } }, { $set: { status: 'lost', closedAt: new Date() } });
      await audit.log({ action: 'pipeline.closed', target: c.customerPhone });
      messenger.pushConversationUpdate(c._id).catch(() => {});
    }
  }
}

async function expireConfirmations() {
  await PendingAction.updateMany({ status: 'pending', expiresAt: { $lt: new Date() } }, { $set: { status: 'expired' } });
}

async function dailyReport(force = false) {
  const today = todayISO(config.timezone);
  if (!force && (hourIn(config.timezone) !== Number(settings.get('dailyReportHour')) || settings.get('lastDailyReport') === today)) return;
  await settings.set('lastDailyReport', today);
  let text = await reports.buildDailyReport();
  // أهم المخاطر في التقرير اليومي، وتحليل كامل مع النصائح مرة أسبوعياً
  const weekly = new Date().getDay() === Number(settings.get('weeklyInsightsDay') ?? 0);
  if (settings.get('insightsEnabled')) {
    try {
      const insights = require('./insights');
      const ins = await insights.getInsights({ refresh: weekly });
      const high = ins.risks.filter((r) => r.level === 'high');
      if (weekly) text += `\n\n${insights.formatForChat(ins)}`;
      else if (high.length) text += `\n\n⚠️ مخاطر عالية:\n${high.slice(0, 3).map((r) => `🔴 ${r.title}`).join('\n')}`;
    } catch (err) {
      console.error('⚠️ تعذر تحليل المخاطر:', err.message);
    }
  }
  const { Staff } = require('../models');
  const managers = await Staff.find({ active: true, $or: [{ role: { $in: ['manager', 'owner'] } }, { receivesDailyReport: true }] }).lean();
  const tpl = settings.get('templates');
  for (const m of managers) {
    await messenger.send(m.phone, { text, template: { name: tpl.dailyReport, params: [text] }, sender: 'system' });
  }
  await audit.log({ action: 'report.daily_sent', details: { to: managers.length } });
  return text;
}

function start() {
  setInterval(() => {
    guard('tickets', tickets.sweep);
    guard('holds', bookings.expireHolds);
    guard('report', () => dailyReport());
  }, 60 * 1000);

  setInterval(() => {
    guard('followups', followUps);
    guard('services', serviceOrders.pollStatuses);
    guard('checkouts', payments.pollCheckouts);
    guard('confirmations', expireConfirmations);
  }, 5 * 60 * 1000);

  console.log('⏱️ المُجدول الداخلي يعمل (كل دقيقة / كل 5 دقائق)');
}

module.exports = { start, followUps, dailyReport };
