// services/messenger.js — إرسال ذكي: يسجّل الرسالة، يراعي نافذة 24 ساعة، ويبث للوحة
const wa = require('./whatsapp');
const settings = require('./settings');
const realtime = require('./realtime');
const { Conversation, Message, Staff } = require('../models');
const { timeLabel, truncate, normalizePhone } = require('../utils/helpers');
const config = require('../config');

const WINDOW_MS = 23.5 * 60 * 60 * 1000; // هامش أمان قبل 24 ساعة

// قوالب رفضها Meta (غير موجودة/غير معتمدة) — لا نعيد المحاولة بها حتى إعادة التشغيل، ونطبع التنبيه مرة واحدة
const missingTemplates = new Set();
function isTemplateMissing(err) {
  const code = err?.response?.data?.error?.code;
  return code === 132001 || code === 132000 || code === 132012;
}
async function trySendTemplate(phone, template) {
  if (missingTemplates.has(template.name)) {
    const e = new Error(`القالب "${template.name}" غير معتمد في Meta — والرقم خارج نافذة 24 ساعة`);
    e.skipLog = true;
    throw e;
  }
  try {
    return await wa.sendTemplate(phone, template.name, template.params || [], template.payloads || []);
  } catch (err) {
    if (isTemplateMissing(err)) {
      missingTemplates.add(template.name);
      console.warn(`⚠️ القالب "${template.name}" غير موجود/غير معتمد في WhatsApp Manager (لغة ${require('../config').whatsapp.templateLang}). اعتمده أو غيّر اسمه من الإعدادات. لن تُرسل رسائل خارج نافذة 24 ساعة بهذا القالب حتى ذلك.`);
      err.skipLog = true;
    }
    throw err;
  }
}

async function getOrCreateConversation(phone, name) {
  const isStaff = !!(await Staff.exists({ phone, active: true }));
  // الاسم من بروفايل واتساب يُحفظ عند الإنشاء فقط حتى لا يمسح الاسم الحقيقي الذي أعطاه العميل
  const update = {
    $setOnInsert: { customerPhone: phone, aiEnabled: true, stage: 'new', state: {}, customerName: name || 'عميل جديد' },
    $set: { isStaff },
  };
  const conv = await Conversation.findOneAndUpdate({ customerPhone: phone }, update, { upsert: true, returnDocument: 'after' });
  if (name && conv.customerName === 'عميل جديد') {
    conv.customerName = name;
    await Conversation.updateOne({ _id: conv._id }, { $set: { customerName: name } });
  }
  return conv;
}

function insideWindow(conversation) {
  return !!(conversation?.lastInboundAt && Date.now() - new Date(conversation.lastInboundAt).getTime() < WINDOW_MS);
}

async function pushConversationUpdate(conversationId) {
  const conv = await Conversation.findById(conversationId).lean();
  if (conv) realtime.emit('conversation_updated', conv);
}

async function recordMessage(conversation, data) {
  const msg = await Message.create({ conversationId: conversation._id, phone: conversation.customerPhone, ...data });
  const preview = data.text || data.transcript || (data.type === 'audio' ? '🎤 رسالة صوتية' : data.type === 'image' ? '📷 صورة' : '');
  const set = { lastMessage: truncate(preview, 120), lastTime: timeLabel(new Date(), config.timezone), lastMessageAt: new Date() };
  const inc = { messageCount: 1 };
  if (data.direction === 'in') {
    set.lastInboundAt = new Date();
    inc.unread = 1;
  }
  await Conversation.updateOne({ _id: conversation._id }, { $set: set, $inc: inc });
  realtime.emit('message', { conversationId: String(conversation._id), message: msg.toObject() });
  pushConversationUpdate(conversation._id).catch(() => {});
  return msg;
}

/**
 * إرسال رسالة لأي رقم
 * opts: { text, buttons:[{id,title}], template:{name, params, payloads}, sender, agentName, meta }
 * داخل نافذة 24 ساعة → نص/أزرار. خارجها → قالب معتمد (إن وُجد) وإلا تُسجَّل كفاشلة.
 */
async function send(phone, opts) {
  const { text = '', buttons, template, sender = 'system', agentName, meta } = opts;
  // أرقام من .env أو الموظفين قد تكون محلية (07...) — Meta يتطلب الصيغة الدولية
  phone = normalizePhone(phone, config.defaultCountryCode);
  const conversation = await getOrCreateConversation(phone);
  let waMessageId = null;
  let status = 'sent';
  let type = buttons?.length ? 'interactive' : 'text';
  let error = null;

  try {
    if (insideWindow(conversation) || !template) {
      waMessageId = buttons?.length ? await wa.sendButtons(phone, text, buttons) : await wa.sendText(phone, text);
    } else {
      type = 'template';
      waMessageId = await trySendTemplate(phone, template);
    }
  } catch (err) {
    let skipLog = !!err.skipLog;
    status = 'failed';
    error = err.response?.data?.error?.message || err.message;
    // 131047 = خارج نافذة 24 ساعة؛ إن كان لدينا قالب نجرّبه
    if (template && type !== 'template') {
      try {
        type = 'template';
        waMessageId = await trySendTemplate(phone, template);
        status = 'sent';
        error = null;
      } catch (err2) {
        error = err2.response?.data?.error?.message || err2.message;
        skipLog = skipLog || !!err2.skipLog;
      }
    }
    if (error && !skipLog) console.error(`❌ فشل الإرسال إلى ${phone}:`, error);
  }

  await recordMessage(conversation, {
    direction: 'out',
    sender,
    type,
    text,
    waMessageId,
    status,
    agentName,
    meta: { ...(meta || {}), buttons, template: type === 'template' ? template?.name : undefined, error },
  });
  return { ok: status === 'sent', waMessageId, error };
}

/**
 * إشعار الموظفين مع قالب احتياطي حسب نوع الإشعار
 * kind: alert (بدون أزرار) | task (استلمت/تم) | decision (تأكيد/رفض)
 */
async function notifyStaff(phones, text, { buttons, kind = 'alert' } = {}) {
  const t = settings.get('templates');
  const propertyName = settings.get('propertyName');
  const unique = [...new Set((phones || []).filter(Boolean).map((p) => normalizePhone(p, config.defaultCountryCode)))];
  const results = [];
  for (const phone of unique) {
    let template;
    if (kind === 'task') template = { name: t.staffTask, params: [text], payloads: (buttons || []).map((b) => b.id) };
    else if (kind === 'decision') template = { name: t.staffDecision, params: [text], payloads: (buttons || []).map((b) => b.id) };
    else template = { name: t.staffAlert, params: [propertyName, text] };
    results.push(await send(phone, { text, buttons, template, sender: 'system' }));
  }
  return results;
}

async function staffByRole(roles, { supervisorsOnly = false } = {}) {
  const q = { active: true, role: { $in: [].concat(roles) } };
  if (supervisorsOnly) q.isSupervisor = true;
  return Staff.find(q).lean();
}

/** تنبيه المدراء (يُستخدم عند الأخطاء والموافقات) */
let lastAlerts = {};
async function alertManagers(text, { throttleKey, throttleMinutes = 10 } = {}) {
  if (throttleKey) {
    const last = lastAlerts[throttleKey] || 0;
    if (Date.now() - last < throttleMinutes * 60000) return;
    lastAlerts[throttleKey] = Date.now();
  }
  const managers = await staffByRole('manager');
  return notifyStaff(managers.map((m) => m.phone), text, { kind: 'alert' });
}

module.exports = {
  getOrCreateConversation,
  insideWindow,
  recordMessage,
  send,
  notifyStaff,
  staffByRole,
  alertManagers,
  pushConversationUpdate,
};
