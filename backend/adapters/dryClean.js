// adapters/dryClean.js — Adapter لبرنامج الدراي كلين (الباك إند في مستودع TheSahilStays)
// المسارات المستخدمة من ذلك المشروع:
//   POST /login {name,password}  → كوكي token (JWT)
//   GET  /rooms                  → الغرف مع أسعار كل صنف
//   POST /createRequest/:room    → إنشاء طلب (يتطلب الكوكي)
//   GET  /getRequest/:id         → حالة الطلب (approved + status)
// إذا لم يُضبط DRYCLEAN_API_URL أو فشل الاتصال → يُرسل الطلب كرسالة واتساب إلى DRYCLEAN_WHATSAPP
const axios = require('axios');
const config = require('../config');

// مفاتيح الأصناف كما في models/request.js في برنامج الدراي كلين
const ITEM_KEYS = {
  towels: 'مناشف', bathTowels: 'بشاكير', blankets: 'حرامات', pillows: 'مخدات', floorMats: 'أغطية أرضيات',
  bedSheets: 'شراشف', robeCovers: 'كفرات', robe: 'روب', completePillows: 'مخدات كاملة', other: 'أخرى',
};

let session = { cookie: null, at: 0 };

function enabled() {
  return !!config.dryClean.apiUrl;
}

async function login() {
  if (session.cookie && Date.now() - session.at < 20 * 3600000) return session.cookie;
  const res = await axios.post(`${config.dryClean.apiUrl}/login`, { name: config.dryClean.username, password: config.dryClean.password }, { timeout: 15000 });
  if (res.data?.error) throw new Error(res.data.message || 'فشل تسجيل الدخول لبرنامج الدراي كلين');
  const setCookie = res.headers['set-cookie'] || [];
  const token = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('token='));
  if (!token) throw new Error('لم يُرجع برنامج الدراي كلين كوكي token');
  session = { cookie: token, at: Date.now() };
  return token;
}

async function api(method, path, data, retry = true) {
  const cookie = await login();
  try {
    const res = await axios({ method, url: `${config.dryClean.apiUrl}${path}`, data, headers: { Cookie: cookie }, timeout: 15000 });
    return res.data;
  } catch (err) {
    if (retry && err.response?.status === 401) {
      session = { cookie: null, at: 0 };
      return api(method, path, data, false);
    }
    throw err;
  }
}

/**
 * إنشاء طلب
 * items: { towels: 2, bedSheets: 1, ... }
 * يُرجع { externalId, status, statusText }
 */
async function createOrder({ roomNumber, items = {}, notes = '', customer = '', type = 'نزيل' }) {
  const rooms = await api('get', '/rooms');
  const room = (Array.isArray(rooms) ? rooms : rooms?.rooms || []).find((r) => String(r.number) === String(roomNumber));
  const body = { type, customer, customNotes: notes, total: 0 };
  let total = 0;
  for (const key of Object.keys(ITEM_KEYS)) {
    const count = Number(items[key] || 0);
    if (!count) continue;
    const price = Number(room?.[key]?.price || 0);
    body[key] = { count, price };
    total += count * price;
  }
  body.total = Math.round(total * 100) / 100;
  const res = await api('post', `/createRequest/${encodeURIComponent(roomNumber)}`, body);
  if (!res?.success) throw new Error(res?.message || 'رفض برنامج الدراي كلين الطلب');
  return { externalId: String(res.request?._id), status: 'sent', statusText: `بانتظار الإرسال للمغسلة (التكلفة ${body.total})`, total: body.total };
}

async function getStatus(externalId) {
  const r = await api('get', `/getRequest/${encodeURIComponent(externalId)}`);
  // status=true يعني أنه أُضيف لدفعة وأُرسل للمغسلة؛ approved = حالة الاعتماد
  if (r?.status === true) return { status: 'in_progress', statusText: `أُرسل للمغسلة — ${r.approved || ''}`.trim() };
  if (String(r?.approved || '').includes('مرفوض')) return { status: 'failed', statusText: r.approved };
  if (r?.approved && r.approved !== 'قيد الانتظار') return { status: 'accepted', statusText: r.approved };
  return { status: 'sent', statusText: 'بانتظار الإرسال للمغسلة' };
}

function describeItems(items = {}) {
  return Object.entries(items).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${ITEM_KEYS[k] || k}: ${n}`).join('، ');
}

module.exports = { enabled, createOrder, getStatus, describeItems, ITEM_KEYS, whatsappFallback: () => config.dryClean.whatsappFallback };
