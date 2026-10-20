// services/inbound.js — استقبال رسائل واتساب: منع التكرار، القراءة، الصوت، الصور، التجميع (Debounce)، الرد
const { ProcessedEvent, Message, Conversation, Staff } = require('../models');
const wa = require('./whatsapp');
const messenger = require('./messenger');
const gemini = require('./gemini');
const media = require('./media');
const agent = require('./agent');
const buttons = require('./buttons');
const payments = require('./payments');
const settings = require('./settings');
const realtime = require('./realtime');
const audit = require('./audit');
const config = require('../config');
const { normalizePhone } = require('../utils/helpers');

// ------------------------------------------------------------------
// Debounce في الذاكرة (عملية واحدة — لا حاجة لـ Redis)
// ------------------------------------------------------------------
const buffers = new Map(); // phone -> { items: [], timer, voice }
const processing = new Set();
const rerun = new Set();

function enqueue(phone, item) {
  const b = buffers.get(phone) || { items: [], timer: null, voice: false };
  b.items.push(item);
  if (item.voice) b.voice = true;
  clearTimeout(b.timer);
  b.timer = setTimeout(() => flush(phone), (settings.get('debounceSeconds') || 4) * 1000);
  buffers.set(phone, b);
}

async function flush(phone) {
  if (processing.has(phone)) {
    rerun.add(phone); // رسائل وصلت أثناء المعالجة — نعالجها بعد الانتهاء
    return;
  }
  const b = buffers.get(phone);
  if (!b || !b.items.length) return;
  buffers.delete(phone);
  processing.add(phone);
  try {
    await processBatch(phone, b.items, b.voice);
  } catch (err) {
    console.error(`❌ خطأ في معالجة دفعة ${phone}:`, err);
  } finally {
    processing.delete(phone);
    if (rerun.has(phone)) {
      rerun.delete(phone);
      if (buffers.get(phone)?.items.length) setTimeout(() => flush(phone), 300);
    }
  }
}

// ------------------------------------------------------------------
// الرد على الدفعة المجمّعة
// ------------------------------------------------------------------
async function processBatch(phone, items, hadVoice) {
  const conversation = await Conversation.findOne({ customerPhone: phone });
  if (!conversation) return;
  const actor = await Staff.findOne({ phone, active: true }).lean();
  if (!conversation.aiEnabled) {
    console.log(`⏸️ الـ AI متوقف لمحادثة ${phone}`);
    return;
  }
  const batchText = items.map((i) => i.text).filter(Boolean).join('\n');
  if (!batchText.trim()) return;
  const excludeIds = items.map((i) => i.messageId).filter(Boolean);

  let reply;
  try {
    const out = await agent.run(conversation, batchText, { actor, excludeMessageIds: excludeIds });
    if (out.stopped) return;
    reply = out.text;
  } catch (err) {
    console.error('❌ فشل الـ AI:', err.message);
    await audit.log({ actorType: 'system', action: 'ai.error', target: phone, details: { error: err.message }, success: false });
    await messenger.alertManagers(`⚠️ تعذر الرد الآلي على +${phone}: ${err.message.slice(0, 200)}`, { throttleKey: 'ai_error' });
    reply = actor
      ? 'تعذر تنفيذ الطلب حالياً بسبب عطل مؤقت، حاول بعد قليل 🙏'
      : `أهلاً بك 🌿 نواجه ضغطاً مؤقتاً في الرد، سيتواصل معك أحد الزملاء خلال دقائق. للتواصل المباشر: ${settings.get('supportPhone')}`;
  }
  if (!reply) return;

  // الرد بصوت (اختياري) إذا أرسل العميل صوتاً
  if (hadVoice && settings.get('voiceReplyEnabled') && !actor) {
    try {
      const ogg = await gemini.textToSpeechOgg(reply);
      const mediaId = await wa.uploadMedia(ogg, 'audio/ogg', 'reply.ogg');
      await wa.sendAudio(phone, mediaId);
      const fileName = media.save(ogg, 'audio/ogg');
      await messenger.recordMessage(conversation, { direction: 'out', sender: 'ai', type: 'audio', text: reply, transcript: reply, mediaPath: fileName, mimeType: 'audio/ogg' });
      return;
    } catch (err) {
      console.error('⚠️ فشل الرد الصوتي، سنرسل نصاً:', err.message);
    }
  }
  await messenger.send(phone, { text: reply, sender: 'ai' });
  maybeRefreshSummary(conversation._id).catch((e) => console.error('⚠️ الملخص:', e.message));
}

/** تحديث ملخص المحادثة كل N رسالة (للرسائل التي خرجت من نافذة السياق) */
async function maybeRefreshSummary(conversationId) {
  const conv = await Conversation.findById(conversationId);
  const every = settings.get('summaryEvery') || 20;
  const window = settings.get('historyMessages') || 18;
  const pending = conv.messageCount - conv.summarizedCount - window;
  if (pending < every) return;
  const msgs = await Message.find({ conversationId }).sort({ createdAt: 1 }).skip(conv.summarizedCount).limit(pending).lean();
  const lines = msgs.map((m) => `${m.direction === 'in' ? 'العميل' : 'نحن'}: ${(m.transcript || m.text || '').slice(0, 300)}`).join('\n');
  const summary = await gemini.summarize(conv.summary, lines);
  if (summary) await Conversation.updateOne({ _id: conversationId }, { $set: { summary }, $inc: { summarizedCount: msgs.length } });
}

// ------------------------------------------------------------------
// تحويل رسالة Meta إلى نص + حفظها
// ------------------------------------------------------------------
async function handleMessage(message, contactName) {
  // 1) منع التكرار — Meta تعيد إرسال الـ webhook
  try {
    await ProcessedEvent.create({ key: `wa:${message.id}` });
  } catch (err) {
    if (err.code === 11000) return;
    throw err;
  }
  // 2) "تمت القراءة" + مؤشر الكتابة فوراً
  wa.markReadAndTyping(message.id).catch(() => {});

  const phone = normalizePhone(message.from, config.defaultCountryCode);
  const conversation = await messenger.getOrCreateConversation(phone, contactName);
  const isStaff = conversation.isStaff;
  const base = { direction: 'in', sender: isStaff ? 'staff' : 'customer', waMessageId: message.id, status: 'received' };

  switch (message.type) {
    case 'text': {
      const msg = await messenger.recordMessage(conversation, { ...base, type: 'text', text: message.text.body });
      enqueue(phone, { text: message.text.body, messageId: msg._id });
      return;
    }
    case 'interactive':
    case 'button': {
      const id = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || message.button?.payload;
      const title = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || message.button?.text || id;
      const msg = await messenger.recordMessage(conversation, { ...base, type: 'button', text: title, meta: { buttonId: id } });
      const handled = await buttons.handle(phone, id);
      if (!handled) enqueue(phone, { text: title, messageId: msg._id });
      return;
    }
    case 'audio': {
      const { buffer, mimeType } = await wa.downloadMedia(message.audio.id);
      const fileName = media.save(buffer, mimeType);
      let transcript = '';
      try {
        transcript = await gemini.transcribeAudio(buffer, mimeType);
      } catch (err) {
        console.error('⚠️ فشل تفريغ الصوت:', err.message);
        transcript = '[تعذر فهم الرسالة الصوتية]';
      }
      const msg = await messenger.recordMessage(conversation, { ...base, type: 'audio', text: '', transcript, mediaId: message.audio.id, mediaPath: fileName, mimeType });
      enqueue(phone, { text: `🎤 (رسالة صوتية) ${transcript}`, messageId: msg._id, voice: true });
      return;
    }
    case 'image':
    case 'document': {
      const m = message.image || message.document;
      const { buffer, mimeType } = await wa.downloadMedia(m.id);
      const fileName = media.save(buffer, mimeType);
      const caption = m.caption || '';
      let analysis = { is_receipt: false, description: 'صورة' };
      if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
        try {
          analysis = await gemini.analyzeImage(buffer, mimeType, caption);
        } catch (err) {
          console.error('⚠️ فشل تحليل الصورة:', err.message);
        }
      }
      const msg = await messenger.recordMessage(conversation, {
        ...base, type: message.type, text: caption, mediaId: m.id, mediaPath: fileName, mimeType, meta: { analysis },
      });
      // حفظ آخر الصور لإرفاقها بتذاكر الصيانة
      const recent = [...(conversation.state?.recentImages || []), { path: fileName, at: new Date() }].slice(-3);
      await Conversation.updateOne({ _id: conversation._id }, { $set: { 'state.recentImages': recent } });

      if (!isStaff && analysis.is_receipt) {
        const { booking } = await payments.submitReceipt(conversation, { mediaPath: fileName, mimeType, extracted: analysis });
        await messenger.send(phone, {
          text: booking
            ? `استلمنا إيصال الدفع ✅ (${analysis.amount ?? ''} ${analysis.currency || ''}) — قسم المالية يراجعه الآن وسنرسل لك تأكيد الحجز فور اعتماده 🙏`
            : 'استلمنا الإيصال ✅ وسيتواصل معك أحد الزملاء لمطابقته مع حجزك.',
          sender: 'system',
        });
        return;
      }
      enqueue(phone, { text: `📷 [صورة: ${analysis.description}]${caption ? ` ${caption}` : ''}`, messageId: msg._id });
      return;
    }
    case 'location': {
      const t = `📍 موقع: ${message.location.name || ''} ${message.location.latitude},${message.location.longitude}`;
      const msg = await messenger.recordMessage(conversation, { ...base, type: 'location', text: t });
      enqueue(phone, { text: t, messageId: msg._id });
      return;
    }
    default: {
      await messenger.recordMessage(conversation, { ...base, type: message.type, text: `[${message.type}]` });
      if (message.type !== 'reaction' && message.type !== 'sticker') {
        enqueue(phone, { text: `[أرسل العميل ${message.type} غير مدعوم — اطلب منه كتابة طلبه أو إرسال صوت]`, messageId: null });
      }
    }
  }
}

/** تحديث حالات الرسائل الصادرة (تم التسليم/القراءة/فشل) */
async function handleStatus(status) {
  const msg = await Message.findOneAndUpdate({ waMessageId: status.id }, { $set: { status: status.status } }, { returnDocument: 'after' }).lean();
  if (msg) realtime.emit('message_status', { conversationId: String(msg.conversationId), messageId: String(msg._id), status: status.status });
  if (status.status === 'failed') console.error('❌ رسالة فشلت:', JSON.stringify(status.errors || []));
}

/** نقطة الدخول من الـ webhook (بعد الرد على Meta بـ 200) */
async function handlePayload(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      for (const s of value.statuses || []) handleStatus(s).catch((e) => console.error('status:', e.message));
      const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages || []) {
        try {
          await handleMessage(m, names[m.from]);
        } catch (err) {
          console.error('❌ خطأ في رسالة واردة:', err);
        }
      }
    }
  }
}

module.exports = { handlePayload, enqueue, flush, maybeRefreshSummary };
