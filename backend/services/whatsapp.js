// services/whatsapp.js — استدعاءات WhatsApp Cloud API منخفضة المستوى
const axios = require('axios');
const config = require('../config');
const { truncate } = require('../utils/helpers');

const base = () => `https://graph.facebook.com/${config.whatsapp.graphVersion}`;
const headers = () => ({ Authorization: `Bearer ${config.whatsapp.accessToken}` });

function ensureConfigured() {
  if (!config.whatsapp.phoneNumberId || !config.whatsapp.accessToken) {
    throw new Error('WhatsApp غير مُعدّ: PHONE_NUMBER_ID / ACCESS_TOKEN مفقود');
  }
}

async function postMessage(payload) {
  ensureConfigured();
  // وضع الاختبار: إن ضُبط WA_SEND_ONLY_TO فالأرقام خارج القائمة لا تُرسل فعلياً (تُطبع في السجل فقط)
  const allow = config.whatsapp.sendOnlyTo;
  if (allow.length && !allow.includes(String(payload.to))) {
    const preview = payload.text?.body || payload.interactive?.body?.text || payload.template?.name || payload.type;
    const buttons = payload.interactive?.action?.buttons?.map((b) => `[${b.reply.title} | ${b.reply.id}]`).join(' ') || '';
    console.log(`🧪 [WA غير مُرسل] → ${payload.to} (${payload.type}): ${truncate(String(preview), 600)}${buttons ? `\n   أزرار: ${buttons}` : ''}`);
    return `wamid.DRY${Date.now()}`;
  }
  const res = await axios.post(
    `${base()}/${config.whatsapp.phoneNumberId}/messages`,
    { messaging_product: 'whatsapp', recipient_type: 'individual', ...payload },
    { headers: { ...headers(), 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  return res.data?.messages?.[0]?.id || null;
}

/** Markdown من النموذج ← تنسيق واتساب (**عريض** ← *عريض*، العناوين # تُحذف، الجداول ← سطور) */
function waFormat(text) {
  return String(text || '')
    .replace(/^[ \t]*\|?([ \t]*:?-{2,}:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*\n?/gm, '') // سطر فاصل الجدول | :--- | :---: |
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (m, row) => '• ' + row.split('|').map((c) => c.trim()).filter(Boolean).join(' — '))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+/gm, '');
}

/** نص عادي (حد واتساب 4096 حرف — نقسم الرسائل الطويلة) */
async function sendText(to, text) {
  const body = waFormat(text).trim();
  if (!body) return null;
  const chunks = body.match(/[\s\S]{1,4000}/g) || [];
  let lastId = null;
  for (const chunk of chunks) {
    lastId = await postMessage({ to, type: 'text', text: { body: chunk, preview_url: false } });
  }
  return lastId;
}

/** أزرار تفاعلية (حتى 3 أزرار، عنوان الزر حتى 20 حرف) */
async function sendButtons(to, bodyText, buttons, { header, footer } = {}) {
  const interactive = {
    type: 'button',
    body: { text: truncate(waFormat(bodyText), 1024) },
    action: {
      buttons: buttons.slice(0, 3).map((b) => ({
        type: 'reply',
        reply: { id: String(b.id).slice(0, 256), title: truncate(b.title, 20) },
      })),
    },
  };
  if (header) interactive.header = { type: 'text', text: truncate(header, 60) };
  if (footer) interactive.footer = { text: truncate(footer, 60) };
  return postMessage({ to, type: 'interactive', interactive });
}

/**
 * قالب معتمد (للمراسلة خارج نافذة 24 ساعة)
 * bodyParams: قيم المتغيرات {{1}}, {{2}} ...
 * buttonPayloads: قيمة payload لكل زر Quick Reply بالترتيب
 */
async function sendTemplate(to, name, bodyParams = [], buttonPayloads = [], lang = config.whatsapp.templateLang) {
  const components = [];
  if (bodyParams.length) {
    components.push({
      type: 'body',
      // Meta يرفض المتغيرات الفارغة أو التي تحتوي أسطراً جديدة
      parameters: bodyParams.map((p) => ({ type: 'text', text: truncate(String(p ?? '').replace(/\s*\n+\s*/g, ' — ').trim() || '-', 1000) })),
    });
  }
  buttonPayloads.forEach((payload, index) => {
    components.push({
      type: 'button',
      sub_type: 'quick_reply',
      index: String(index),
      parameters: [{ type: 'payload', payload: String(payload) }],
    });
  });
  return postMessage({ to, type: 'template', template: { name, language: { code: lang }, components } });
}

async function sendImage(to, { mediaId, link }, caption = '') {
  const image = mediaId ? { id: mediaId } : { link };
  if (caption) image.caption = truncate(caption, 1024);
  return postMessage({ to, type: 'image', image });
}

async function sendAudio(to, mediaId) {
  return postMessage({ to, type: 'audio', audio: { id: mediaId } });
}

/** "تمت القراءة" + مؤشر الكتابة فوراً عند الاستلام */
async function markReadAndTyping(messageId) {
  ensureConfigured();
  try {
    await axios.post(
      `${base()}/${config.whatsapp.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } },
      { headers: headers(), timeout: 10000 }
    );
  } catch (err) {
    // بعض الحسابات لا تدعم typing_indicator — نرسل القراءة فقط
    try {
      await axios.post(
        `${base()}/${config.whatsapp.phoneNumberId}/messages`,
        { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
        { headers: headers(), timeout: 10000 }
      );
    } catch (_) { /* تجاهل */ }
  }
}

/** تحميل ملف وسائط من Meta (صوت/صورة) */
async function downloadMedia(mediaId) {
  ensureConfigured();
  const meta = await axios.get(`${base()}/${mediaId}`, { headers: headers(), timeout: 15000 });
  const file = await axios.get(meta.data.url, { headers: headers(), responseType: 'arraybuffer', timeout: 30000 });
  return { buffer: Buffer.from(file.data), mimeType: (meta.data.mime_type || 'application/octet-stream').split(';')[0] };
}

/** رفع ملف لإعادة إرساله (مثلاً صورة عطل للفني، أو رد صوتي) */
async function uploadMedia(buffer, mimeType, filename = 'file') {
  ensureConfigured();
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  const res = await axios.post(`${base()}/${config.whatsapp.phoneNumberId}/media`, form, { headers: headers(), timeout: 30000 });
  return res.data.id;
}

module.exports = {
  waFormat,
  sendText,
  sendButtons,
  sendTemplate,
  sendImage,
  sendAudio,
  markReadAndTyping,
  downloadMedia,
  uploadMedia,
};
