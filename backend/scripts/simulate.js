// scripts/simulate.js — محاكاة رسالة واتساب واردة (موقّعة) على السيرفر المحلي للاختبار
// الاستخدام:
//   node scripts/simulate.js 962790000000 "مرحبا بدي شقة من الخميس للسبت لشخصين"
//   node scripts/simulate.js 962790000000 --button "tk:ack:<ticketId>"
//   node scripts/simulate.js 962790000000 "نفس الرسالة" --dup     (يرسلها مرتين بنفس الـ id لاختبار منع التكرار)
//   node scripts/simulate.js 962790000000 --image receipt.jpg "تعليق اختياري"
//   node scripts/simulate.js 962790000000 --audio voice.ogg
//   node scripts/simulate.js 962790000000 --tts "صرفنا 10 مناشف"     (يولّد رسالة صوتية بـ Gemini — يتطلب ffmpeg)
// الصور والصوت تُرفع إلى وسائط واتساب (Meta) للحصول على media id حقيقي، فيمر السيرفر بنفس مسار التحميل والتحليل.
// ملاحظة: الرد سيُرسل فعلياً عبر Meta إلى هذا الرقم — استخدم رقمك أو رقم اختبار، أو اضبط WA_SEND_ONLY_TO.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [, , from, ...rest] = process.argv;
if (!from) {
  console.log('usage: node scripts/simulate.js <phone> "<text>" [--button <id>] [--image <file> [caption]] [--audio <file>] [--tts "<text>"] [--dup]');
  process.exit(1);
}
const dup = rest.includes('--dup');
const args = rest.filter((x) => x !== '--dup');
const mode = ['--button', '--image', '--audio', '--tts'].includes(args[0]) ? args[0] : 'text';
const value = mode === 'text' ? args.join(' ') : args[1];
const caption = mode === '--image' ? args.slice(2).join(' ') : '';
const id = `wamid.SIM${Date.now()}`;
const ts = String(Math.floor(Date.now() / 1000));

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4' };

async function buildMessage() {
  if (mode === '--button') return { from, id, timestamp: ts, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: value, title: value } } };
  if (mode === 'text') return { from, id, timestamp: ts, type: 'text', text: { body: value } };
  const wa = require('../services/whatsapp');
  let buffer;
  let mime;
  if (mode === '--tts') {
    buffer = await require('../services/gemini').textToSpeechOgg(value);
    mime = 'audio/ogg';
  } else {
    buffer = fs.readFileSync(value);
    mime = MIME[path.extname(value).toLowerCase()] || 'application/octet-stream';
  }
  const mediaId = await wa.uploadMedia(buffer, mime, mode === '--image' ? path.basename(value) : 'voice.ogg');
  console.log(`📤 رُفع الملف إلى Meta (${mime}) → media id ${mediaId}`);
  if (mode === '--image') {
    const type = mime === 'application/pdf' ? 'document' : 'image';
    return { from, id, timestamp: ts, type, [type]: { id: mediaId, mime_type: mime, ...(caption ? { caption } : {}) } };
  }
  return { from, id, timestamp: ts, type: 'audio', audio: { id: mediaId, mime_type: 'audio/ogg; codecs=opus', voice: true } };
}

(async () => {
  const message = await buildMessage();
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'SIM', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: {}, contacts: [{ wa_id: from, profile: { name: 'Test User' } }], messages: [message] } }] }],
  });
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.META_APP_SECRET) {
    headers['X-Hub-Signature-256'] = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(body).digest('hex');
  }
  const url = `http://localhost:${process.env.PORT || 4000}/webhook`;
  for (let i = 0; i < (dup ? 2 : 1); i++) {
    const res = await fetch(url, { method: 'POST', headers, body });
    console.log(`→ ${res.status} ${await res.text()}`);
  }
})().catch((err) => {
  console.error('❌', err.response?.data?.error?.message || err.message);
  process.exit(1);
});
