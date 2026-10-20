// adapters/delivery.js — Adapter لبرنامج التوصيل الخارجي
// الوضع الافتراضي (whatsapp): يُرسل الطلب كرسالة واتساب للجهة مع أزرار "استلمت / تم التوصيل"
// الوضع http: عدّل الدالتين أدناه حسب توثيق API برنامج التوصيل عند توفره
const axios = require('axios');
const config = require('../config');

function mode() {
  return config.delivery.mode === 'http' && config.delivery.apiUrl ? 'http' : 'whatsapp';
}

function client() {
  return axios.create({
    baseURL: config.delivery.apiUrl,
    timeout: 15000,
    headers: { Authorization: `Bearer ${config.delivery.apiKey}`, 'Content-Type': 'application/json' },
  });
}

/** إنشاء طلب توصيل عبر API (افتراض REST عام — عدّله حسب التوثيق) */
async function createOrder({ ref, roomNumber, guestName, guestPhone, details, address }) {
  const res = await client().post('/orders', {
    external_reference: ref,
    customer: { name: guestName, phone: guestPhone },
    dropoff: { address: address || `غرفة ${roomNumber}`, notes: `غرفة ${roomNumber}` },
    description: details,
  });
  const d = res.data?.data ?? res.data;
  return { externalId: String(d?.id ?? d?.order_id ?? ''), status: 'sent', statusText: d?.status || 'تم الإرسال' };
}

async function getStatus(externalId) {
  const res = await client().get(`/orders/${encodeURIComponent(externalId)}`);
  const d = res.data?.data ?? res.data;
  const s = String(d?.status || '').toLowerCase();
  const map = { delivered: 'delivered', completed: 'delivered', cancelled: 'cancelled', canceled: 'cancelled', failed: 'failed', on_the_way: 'in_progress', picked_up: 'in_progress', accepted: 'accepted' };
  return { status: map[s] || 'sent', statusText: d?.status || '' };
}

module.exports = { mode, createOrder, getStatus, whatsappNumber: () => config.delivery.whatsapp };
