// utils/helpers.js — دوال صغيرة بدون أي اعتماديات (قابلة للاختبار)
const crypto = require('crypto');

/** يحوّل أي رقم أردني/دولي إلى صيغة واتساب: أرقام فقط مع رمز الدولة (962791234567) */
function normalizePhone(input, defaultCountryCode = '962') {
  if (!input) return '';
  let p = String(input).replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = defaultCountryCode + p.slice(1);
  // رقم محلي بدون صفر (مثلاً 791234567)
  if (p.length === 9 && p.startsWith('7') && defaultCountryCode === '962') p = '962' + p;
  return p;
}

/** التحقق من توقيع Meta: X-Hub-Signature-256 = sha256=HMAC(appSecret, rawBody) */
function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true; // لم يُضبط السر — يُسجَّل تحذير عند التشغيل
  if (!signatureHeader || !rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signatureHeader);
}

/** التحقق من توقيع زائر: HMAC-SHA256("{timestamp}.{rawBody}", webhook_secret) */
function verifyZaaerSignature(rawBody, timestamp, signatureHeader, secret) {
  if (!secret || !signatureHeader || !timestamp || !rawBody) return false;
  const hex = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const sig = String(signatureHeader).replace(/^sha256=/, '');
  return safeEqual(hex, sig) || safeEqual(Buffer.from(hex, 'hex').toString('base64'), sig);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** تاريخ اليوم بصيغة YYYY-MM-DD حسب المنطقة الزمنية */
function todayISO(tz = 'Asia/Amman', date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function hourIn(tz = 'Asia/Amman', date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(date)) % 24;
}

function weekdayName(tz = 'Asia/Amman', date = new Date()) {
  return new Intl.DateTimeFormat('ar', { timeZone: tz, weekday: 'long' }).format(date);
}

function timeLabel(date = new Date(), tz = 'Asia/Amman') {
  return new Intl.DateTimeFormat('ar-EG', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(date);
}

/** قائمة الليالي بين تاريخين (YYYY-MM-DD)، تاريخ المغادرة غير مشمول */
function nightsBetween(checkIn, checkOut) {
  const out = [];
  const start = new Date(checkIn + 'T00:00:00Z');
  const end = new Date(checkOut + 'T00:00:00Z');
  if (!(start < end)) return out;
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** إعادة المحاولة مع تأخير متزايد */
async function withRetry(fn, { retries = 3, baseDelay = 800, onError } = {}) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (onError) onError(err, i);
      if (i < retries) await sleep(baseDelay * i);
    }
  }
  throw lastErr;
}

function truncate(s, n = 900) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** مرجع قصير مقروء (مثل B-7K3Q9) */
function shortRef(prefix = 'B') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${prefix}-${s}`;
}

/** تشفير كلمة المرور بدون مكتبات خارجية */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return safeEqual(test, hash);
}

module.exports = {
  normalizePhone,
  verifyMetaSignature,
  verifyZaaerSignature,
  safeEqual,
  todayISO,
  hourIn,
  weekdayName,
  timeLabel,
  nightsBetween,
  isISODate,
  addDaysISO,
  round2,
  sleep,
  withRetry,
  truncate,
  shortRef,
  hashPassword,
  checkPassword,
};
