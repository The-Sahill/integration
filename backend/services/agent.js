// services/agent.js — بناء السياق المختصر وتشغيل حلقة Gemini + الأدوات
const gemini = require('./gemini');
const tools = require('./tools');
const settings = require('./settings');
const config = require('../config');
const { Message, Ticket, Booking, Conversation } = require('../models');
const { guestSystemPrompt, staffSystemPrompt } = require('../prompts/system');
const { todayISO, addDaysISO, truncate } = require('../utils/helpers');

const MAX_TOOL_ROUNDS = 6;

const STAGE_AR = {
  new: 'جديد', quoted: 'تم عرض السعر', negotiating: 'تفاوض', hold: 'حجز مبدئي', awaiting_payment: 'بانتظار الدفع',
  paid: 'تم الدفع', zaaer_entered: 'مُدخل في زائر', confirmed: 'مؤكد', lost: 'مغلق', in_house: 'نزيل مقيم',
};

/** جدول الأيام القادمة ليحوّل النموذج "الخميس الجاي" إلى تاريخ صحيح */
function daysTable() {
  const today = todayISO(config.timezone);
  const fmt = new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'UTC' });
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const d = addDaysISO(today, i);
    rows.push(`${fmt.format(new Date(d + 'T00:00:00Z'))} ${d}${i === 0 ? ' (اليوم)' : i === 1 ? ' (غداً)' : ''}`);
  }
  return rows.join(' | ');
}

/** آخر 15–20 رسالة (بدون رسائل الدفعة الحالية) كأدوار user/model */
async function historyContents(conversation, excludeIds) {
  const n = settings.get('historyMessages') || 18;
  const msgs = await Message.find({ conversationId: conversation._id, _id: { $nin: excludeIds } })
    .sort({ createdAt: -1 }).limit(n).lean();
  msgs.reverse();
  const contents = [];
  for (const m of msgs) {
    const role = m.direction === 'in' ? 'user' : 'model';
    let text = m.transcript || m.text || '';
    if (!text) continue;
    if (m.direction === 'in' && m.type === 'audio') text = `🎤 ${text}`;
    if (m.direction === 'out' && m.sender === 'agent') text = `[رد موظف${m.agentName ? ` ${m.agentName}` : ''}] ${text}`;
    if (m.direction === 'out' && m.sender === 'system') text = `[رسالة آلية] ${text}`;
    text = truncate(text, 1200);
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n${text}`;
    else contents.push({ role, parts: [{ text }] });
  }
  // يجب أن يبدأ السجل بدور user
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return contents;
}

async function contextBlock(conversation, actor) {
  const lines = [`[سياق: ${daysTable()}]`];
  if (actor) {
    lines.push(`[المرسل موظف: ${actor.name} — ${actor.role}]`);
  } else {
    const st = conversation.state || {};
    const stateBits = Object.entries({
      الاسم: st.guestName || (conversation.customerName !== 'عميل جديد' ? conversation.customerName : ''),
      الغرفة: st.roomNumber, الوصول: st.checkIn, المغادرة: st.checkOut, البالغين: st.adults, الأطفال: st.children,
      الوحدة: st.unitName, 'معرف الوحدة': st.unitId, 'السعر المعروض': st.quotedPrice, 'السعر المتفق': st.agreedPrice, 'الحجز المبدئي': st.activeBookingRef,
    }).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v}`);
    lines.push(`[العميل: +${conversation.customerPhone} | المرحلة: ${STAGE_AR[conversation.stage] || conversation.stage}${stateBits.length ? ' | ' + stateBits.join('، ') : ''}]`);
    const [open, booking] = await Promise.all([
      Ticket.find({ guestPhone: conversation.customerPhone, status: { $in: ['open', 'assigned', 'acknowledged', 'reopened'] } }).limit(5).lean(),
      Booking.findOne({ conversationId: conversation._id, status: { $in: ['awaiting_payment', 'hold', 'confirmed', 'zaaer_entered', 'checked_in'] } }).sort({ createdAt: -1 }).lean(),
    ]);
    if (open.length) lines.push(`[طلبات مفتوحة: ${open.map((t) => `#${t.number} ${t.category} (${t.status})`).join('، ')}]`);
    if (booking) lines.push(`[حجز ${booking.ref}: ${booking.unitName} ${booking.checkIn}→${booking.checkOut} بسعر ${booking.agreedPrice} — ${booking.status}]`);
  }
  if (conversation.summary) lines.push(`[ملخص ما سبق: ${conversation.summary}]`);
  return lines.join('\n');
}

/**
 * تشغيل الوكيل على دفعة رسائل
 * يُرجع { text, stopped } — stopped=true إذا أرسل النظام زر تأكيد ولا داعي لرد نصي
 */
async function run(conversation, batchText, { actor = null, excludeMessageIds = [] } = {}) {
  const systemInstruction = actor ? staffSystemPrompt(actor) : guestSystemPrompt();
  const declarations = tools.declarationsFor(actor);
  const history = await historyContents(conversation, excludeMessageIds);
  const ctx = await contextBlock(conversation, actor);
  const contents = [...history];
  const current = `${ctx}\n\n${batchText}`;
  if (contents.length && contents[contents.length - 1].role === 'user') contents[contents.length - 1].parts.push({ text: current });
  else contents.push({ role: 'user', parts: [{ text: current }] });
  const toolCtx = { conversation, actor, isStaff: !!actor };

  const called = new Set();
  let response = await gemini.generate({ systemInstruction, contents, tools: declarations });
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = gemini.functionCalls(response);
    if (!calls.length) break;
    const modelContent = response.candidates[0].content;
    if (!modelContent.role) modelContent.role = 'model';
    contents.push(modelContent); // يحفظ thought signatures كما هي
    const parts = [];
    let stop = false;
    for (const call of calls) {
      let result;
      try {
        console.log(`🔧 ${call.name}`, JSON.stringify(call.args || {}));
        called.add(call.name);
        result = await tools.execute(call.name, call.args || {}, toolCtx);
      } catch (err) {
        console.error(`❌ أداة ${call.name} فشلت:`, err.message);
        result = { error: err.message };
      }
      if (result?.__stop) stop = true;
      parts.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: sanitize(result) } });
    }
    if (stop) return { text: '', stopped: true };
    // تحديث الحالة بعد الأدوات (قد تتغير المرحلة)
    const fresh = await Conversation.findById(conversation._id).lean();
    if (fresh) Object.assign(conversation, { state: fresh.state, stage: fresh.stage, aiEnabled: fresh.aiEnabled });
    contents.push({ role: 'user', parts });
    response = await gemini.generate({ systemInstruction, contents, tools: declarations });
  }
  const text = gemini.responseText(response);
  // شبكة أمان: النموذج وعد العميل بالتحويل لموظف دون أن يستدعي handoff_to_human ← ننفّذه نحن (وإلا لا يعلم أحد)
  const routedElsewhere = ['create_guest_request', 'create_maintenance_ticket', 'request_manager_approval', 'order_delivery', 'order_dry_clean', 'cancel_booking'].some((n) => called.has(n));
  if (!actor && !called.has('handoff_to_human') && !routedElsewhere && conversation.aiEnabled !== false && PROMISED_HANDOFF.test(text.replace(/[ً-ْ]/g, ''))) {
    console.warn('⚠️ وعد بالتحويل بدون handoff_to_human — تحويل تلقائي');
    await tools.handoff(conversation, `تحويل تلقائي: الرد وعد العميل بموظف — آخر رسالة: ${truncate(batchText, 150)}`);
  }
  return { text, stopped: false };
}

// "سأحوّلك لأحد الزملاء" / "بتحويل المحادثة للمدير" / "سيتواصل معك أحد الموظفين" — وليس "تم تحويل طلبك للفريق" (تذكرة)
// جذور الكلمات لأن "لـ" تحذف الألف: "للاستقبال"، "للإدارة"، "للمحادثة" (يُطبَّق بعد حذف التشكيل)
const PROMISED_HANDOFF = /(تحويل|حول)[^.\n؟!]{0,25}(موظف|زميل|زملاء|مدير|إدار|ادار|استقبال|محادث)|يتواصل\s+معك[^.\n؟!]{0,15}(موظف|زميل|زملاء|مدير|إدار|ادار|استقبال)/;

function sanitize(r) {
  if (r === undefined || r === null) return { ok: true };
  if (typeof r !== 'object' || Array.isArray(r)) return { result: r };
  const { __stop, ...rest } = r;
  return rest;
}

module.exports = { run, daysTable, STAGE_AR };
