// services/zaaer.js — تكامل منصة زائر (مبني على controllers/zaaer.js القديم مع cache وإعادة محاولة)
// ملاحظة أمنية: التوكن انتقل من الكود إلى .env (ZAAER_API_TOKEN) — غيّر التوكن القديم لأنه كان مكشوفاً في الكود.
const axios = require('axios');
const config = require('../config');
const { sleep } = require('../utils/helpers');

const cache = new Map(); // key -> { at, value }
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  return fn().then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}
function clearCache(prefix = '') {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

function headers() {
  if (!config.zaaer.token) throw new Error('ZAAER_API_TOKEN مفقود في .env');
  return { Authorization: `Bearer ${config.zaaer.token.trim()}`, Accept: 'application/json', 'Content-Type': 'application/json' };
}

async function request(method, path, data, params) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios({ method, url: `${config.zaaer.baseUrl}${path}`, data, params, headers: headers(), timeout: 20000 });
      return res.data;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      // أخطاء 4xx (عدا 429) = بيانات خاطئة أو غير متاح — لا فائدة من الإعادة
      if (status && status < 500 && status !== 429) break;
      if (attempt < 3) await sleep(700 * attempt);
    }
  }
  const e = new Error(`زائر: ${lastErr.response?.status || ''} ${JSON.stringify(lastErr.response?.data || lastErr.message).slice(0, 400)}`);
  e.status = lastErr.response?.status;
  e.details = lastErr.response?.data;
  throw e;
}

function extractItems(d) {
  return [d?.result?.items, d?.items, d?.data?.items, d?.data, d?.result].find(Array.isArray) || [];
}
function extractMeta(d) {
  return d?.result?.meta || d?.meta || d?.data?.meta || {};
}

// زائر: أقصى limit = 250، وعدد الصفحات في totalPages على المستوى الأعلى من الرد
async function getAllPages(endpoint, extraParams = {}, maxPages = 60) {
  const limit = 250;
  const first = await request('get', endpoint, undefined, { ...extraParams, page: 1, limit });
  const all = [...extractItems(first)];
  const meta = extractMeta(first);
  const lastPage = Number(first?.totalPages ?? meta.last_page ?? meta.totalPages);
  if (Number.isFinite(lastPage)) {
    // عدد الصفحات معروف ← جلب الباقي بالتوازي (5 طلبات معاً) بدل التسلسل (21 صفحة ≈ 45 ثانية)
    const pages = [];
    for (let p = 2; p <= Math.min(lastPage, maxPages); p++) pages.push(p);
    for (let i = 0; i < pages.length; i += 5) {
      const batch = await Promise.all(pages.slice(i, i + 5).map((page) => request('get', endpoint, undefined, { ...extraParams, page, limit })));
      for (const data of batch) all.push(...extractItems(data));
    }
    return all;
  }
  // بدون عدد صفحات: نتابع حتى تأتي صفحة ناقصة
  for (let page = 2, items = all; page <= maxPages && items.length === limit; page++) {
    items = extractItems(await request('get', endpoint, undefined, { ...extraParams, page, limit }));
    all.push(...items);
  }
  return all;
}

/** طلب GET خام (للاستكشاف) */
function rawGet(path, params) {
  return request('get', path, undefined, params);
}

/** العقارات/أنواع الوحدات (cache 10 دقائق) */
function getProperties() {
  return cached('properties', 10 * 60000, () => getAllPages('/properties'));
}

/**
 * الحجوزات المحمّلة مسبقاً إن كان عمرها ≤ maxAgeMs، وإلا null مع تحميلها في الخلفية
 * (للتسعير أثناء المحادثة: لا ننتظر 10 ثوانٍ لجلب كل الصفحات)
 */
function cachedReservations(maxAgeMs = 15 * 60000) {
  const hit = cache.get('reservations');
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  getAllReservations().catch(() => {});
  return null;
}

/** كل الحجوزات (cache دقيقة) */
function getAllReservations() {
  return cached('reservations', 3 * 60000, () => getAllPages('/reservations')); // يُمسح فوراً بعد أي كتابة في زائر
}

function phoneDigits(p) {
  return String(p || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0/, '962');
}

/** حجوزات بفلتر من زائر مباشرة (guest_phone / number / booking_id / reservation_status) */
async function filterReservations(params) {
  const data = await request('get', '/reservations', undefined, { page: 1, limit: 50, ...params });
  return extractItems(data);
}

async function getReservationsByPhone(phone) {
  const want = phoneDigits(phone).slice(-9); // آخر 9 أرقام: فلتر guest_phone في زائر يطابق جزءاً من الرقم
  const list = await filterReservations({ guest_phone: want });
  return list.filter((r) => phoneDigits(r.guest?.phone || r.phone).endsWith(want));
}

/** حجزنا في زائر برقمنا B-xxx (للتحقق بعد الإنشاء/الإلغاء) */
async function getReservationByBookingId(bookingId) {
  const list = await filterReservations({ booking_id: bookingId });
  return list.find((r) => String(r.booking_id) === String(bookingId)) || null;
}

async function searchReservations(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  // رقم حجز زائر (REV...) أو رقمنا (B-...) ← فلتر مباشر بدل جلب كل الحجوزات
  if (/^rev\d+$/i.test(q)) return filterReservations({ number: q.toUpperCase() });
  if (/^b-/i.test(q)) return filterReservations({ booking_id: q.toUpperCase() });
  const list = await getAllReservations();
  return list.filter((r) => {
    const fields = [r.guest?.name, r.guest?.phone, r.number, r.reservation_number, r.id, r.booking_id].map((x) => String(x ?? '').toLowerCase());
    return fields.some((f) => f && f.includes(q));
  });
}

/** POST /reservations/quote — كما في الكود القديم */
async function getReservationQuote(quoteData) {
  try {
    const data = await request('post', '/reservations/quote', quoteData);
    return { success: true, data: data?.result ?? data };
  } catch (err) {
    return { success: false, error: err.details ?? err.message, status: err.status ?? null };
  }
}

/**
 * فحص التوفر لنوع وحدة وتواريخ محددة عبر quote (cache دقيقتين)
 * fresh=true يتجاوز الـ cache (قبل إنشاء الحجز مباشرة)
 */
async function checkAvailability({ unitTypeId, ratePlanId, checkIn, checkOut, adults = 1, children = 0, fresh = false }) {
  const key = `avail:${unitTypeId}:${ratePlanId || ''}:${checkIn}:${checkOut}:${adults}:${children}`;
  const run = async () => {
    const payload = {
      property_id: config.zaaer.propertyId,
      rental_type: 'daily',
      check_in_date: checkIn,
      check_out_date: checkOut,
      rooms: [
        {
          unit_type_id: Number(unitTypeId),
          rate_plan_id: ratePlanId ? Number(ratePlanId) : null,
          unit_count: 1,
          occupancy: { adults: Number(adults || 1), children: Number(children || 0), infants: 0 },
        },
      ],
    };
    const quote = await getReservationQuote(payload);
    if (!quote.success) {
      // 4xx من زائر في الغالب = غير متاح لهذه التواريخ
      const unavailable = quote.status && quote.status < 500;
      console.warn(`ℹ️ زائر quote (نوع ${unitTypeId}، ${checkIn}→${checkOut}) رجع ${quote.status || 'خطأ'}: ${JSON.stringify(quote.error).slice(0, 250)}`);
      return { available: false, error: unavailable ? null : 'zaaer_error', reason: quote.error, raw: quote };
    }
    const data = quote.data?.result ?? quote.data;
    const room = data?.rooms?.[0];
    const flagged =
      room?.available === false || room?.is_available === false || room?.available_units === 0 || room?.availability === 0;
    return {
      available: !!room && !flagged,
      amount: Number(room?.amount || data?.totals?.total || 0),
      dailyRates: room?.daily_rates || [],
      ratePlanId: room?.rate_plan_id || ratePlanId || null,
      availableCount: room?.available_count != null ? Number(room.available_count) : null, // وحدات شاغرة من هذا النوع (للإشغال)
      unitTypeId: room?.unit_type_id || unitTypeId,
      raw: data,
    };
  };
  if (fresh) {
    const v = await run();
    cache.set(key, { at: Date.now(), value: v });
    return v;
  }
  return cached(key, config.zaaer.cacheSeconds * 1000, run);
}

/** POST /reservations — نفس صيغة الـ payload التي نجحت في الكود القديم */
async function createReservation(payload) {
  const formatted = {
    property_id: Number(payload.property_id || config.zaaer.propertyId),
    booking_id: payload.booking_id || null,
    status: payload.status || 'new',
    rental_type: payload.rental_type || 'daily',
    check_in_date: payload.check_in_date,
    check_out_date: payload.check_out_date,
    currency: payload.currency || config.zaaer.currency,
    guest: {
      name: payload.guest?.name || 'Guest',
      phone: payload.guest?.phone || null,
      email: payload.guest?.email || null,
      gender: payload.guest?.gender || 'male',
    },
    rooms: (payload.rooms || []).map((room) => ({
      unit_type_id: Number(room.unit_type_id),
      rate_plan_id: room.rate_plan_id ? Number(room.rate_plan_id) : null,
      amount: Number(room.amount || 0),
      occupancy: {
        adults: room.occupancy?.adults ?? 1,
        children: room.occupancy?.children ?? 0,
        infants: room.occupancy?.infants ?? 0,
      },
      daily_rates: room.daily_rates || [],
    })),
    totals: {
      room_charges: Number(payload.totals?.room_charges || 0),
      additional_charges: Number(payload.totals?.additional_charges || 0),
      discount: Number(payload.totals?.discount || 0),
      total: Number(payload.totals?.total || 0),
      currency: payload.currency || config.zaaer.currency,
    },
    booking_payment_method: payload.booking_payment_method || 'pay_at_hotel',
  };
  try {
    const data = await request('post', '/reservations', formatted);
    const result = data?.result ?? data;
    clearCache('reservations');
    clearCache('avail:');
    const reservationId =
      result?.number ?? result?.reservation_number ?? result?.reservation?.number ?? result?.id ?? result?.reservation?.id ?? result?.reservation_id ?? null;
    return { success: true, data: result, reservationId: reservationId != null ? String(reservationId) : null };
  } catch (err) {
    const code = err.details?.code ?? err.details?.error?.code ?? err.details?.error ?? null;
    return { success: false, error: err.details ?? err.message, status: err.status ?? null, code: typeof code === 'string' ? code : null };
  }
}

/**
 * إلغاء حجز في زائر — حسب التوثيق: نفس POST /reservations مع status=cancelled
 * والتعريف بـ property_id + booking_id (رقمنا B-xxx وليس رقم زائر). نرسل نفس بيانات الحجز الأصلية.
 * 404 reservation_not_found = الحجز لم يُنشأ عبر الـ API (أُدخل يدوياً في زائر) → يلزم إلغاء يدوي.
 */
async function cancelReservation(payload) {
  if (!payload || typeof payload !== 'object' || !payload.booking_id) {
    return { success: false, manual: true, error: 'الحجز غير مُنشأ عبر النظام (لا يوجد booking_id) — يلزم إلغاؤه يدوياً في زائر' };
  }
  const r = await createReservation({ ...payload, status: 'cancelled' });
  if (!r.success && r.status === 404) return { ...r, manual: true };
  return r;
}

/** تعديل حجز: نفس POST /reservations مع status=modified وبنفس booking_id (يُتحقق من التوفر مجدداً) */
async function modifyReservation(payload) {
  if (!payload?.booking_id) return { success: false, manual: true, error: 'لا يوجد booking_id' };
  const r = await createReservation({ ...payload, status: 'modified' });
  if (!r.success && r.status === 404) return { ...r, manual: true };
  return r;
}

/**
 * نقاط إضافية غير موثّقة لدينا بعد — تُضبط من .env (METHOD + PATH) وإلا تُرجع manual=true
 * {id} = رقم الحجز في زائر، {booking_id} = رقمنا
 */
async function configuredCall(name, vars = {}, body) {
  const ep = config.zaaer.endpoints?.[name];
  if (!ep?.method || !ep?.path) return { success: false, manual: true, error: `نقطة ${name} في زائر غير مُعدّة` };
  const path = ep.path.replace(/\{(\w+)\}/g, (m, k) => encodeURIComponent(vars[k] ?? ''));
  try {
    const data = await request(ep.method.toLowerCase(), path, ep.method.toLowerCase() === 'get' ? undefined : body, ep.method.toLowerCase() === 'get' ? body : undefined);
    clearCache('reservations');
    return { success: true, data: data?.result ?? data?.data ?? data };
  } catch (err) {
    // 404/405 = المسار غير موجود في زائر (مسار مُخمَّن) → نتعامل كأنه غير مُعدّ ونرسل تنبيهاً للتنفيذ اليدوي
    if ([404, 405].includes(err.status)) {
      console.warn(`⚠️ نقطة زائر "${name}" (${ep.method.toUpperCase()} ${ep.path}) غير موجودة — راجع ZAAER_${name.toUpperCase()}_PATH في .env`);
      return { success: false, manual: true, error: 'المسار غير موجود في زائر' };
    }
    return { success: false, error: err.details ?? err.message, status: err.status };
  }
}

/** وصل مالي / سند قبض على حجز */
async function createReceipt({ reservationId, bookingId, amount, method, reference, notes, date }) {
  const r = await configuredCall('receipt', { id: reservationId, booking_id: bookingId }, {
    property_id: config.zaaer.propertyId,
    reservation_id: reservationId,
    booking_id: bookingId,
    amount: Number(amount).toFixed(2),
    currency: config.zaaer.currency,
    payment_method: method,
    reference_number: reference,
    notes,
    date,
  });
  if (r.success) r.receiptId = String(r.data?.receipt_number ?? r.data?.id ?? r.data?.number ?? '');
  return r;
}

async function checkIn({ reservationId, bookingId, unitNumber }) {
  return configuredCall('checkin', { id: reservationId, booking_id: bookingId }, { property_id: config.zaaer.propertyId, unit_number: unitNumber });
}

async function checkOut({ reservationId, bookingId }) {
  return configuredCall('checkout', { id: reservationId, booking_id: bookingId }, { property_id: config.zaaer.propertyId });
}

/** أرصدة الحسابات (صندوق/بنك) — يُرجع [{name, balance}] أو null */
async function getAccountBalances() {
  const r = await configuredCall('balances', {}, { property_id: config.zaaer.propertyId });
  if (!r.success) return null;
  const list = Array.isArray(r.data) ? r.data : r.data?.items || r.data?.accounts || [];
  return list.map((a) => ({ name: a.name ?? a.account_name ?? a.title ?? '-', balance: Number(a.balance ?? a.amount ?? 0) }));
}

/** رابط دفع بالبطاقة من زائر (POST /payment-checkouts) — الحقول حسب التوثيق */
async function createPaymentCheckout({ amount, currency, referenceNumber, guestName, guestPhone, description, webhookUrl, returnUrl, securityDeposit }) {
  const body = {
    property_id: config.zaaer.propertyId,
    total_amount: Number(amount).toFixed(2),
    currency: currency || config.zaaer.currency,
    reference_number: referenceNumber,
    purpose: description || 'Reservation payment',
    payment_webhook_url: webhookUrl,
    guest_name: guestName,
    guest_phone: String(guestPhone || '').replace(/\D/g, ''),
  };
  if (securityDeposit) body.security_deposit = Number(securityDeposit).toFixed(2);
  if (returnUrl) body.payment_return_url = returnUrl;
  const data = await request('post', config.zaaer.checkoutPath, body);
  const r = data?.result ?? data?.data ?? data;
  return {
    paymentLinkId: String(r?.payment_link_id ?? r?.id ?? ''),
    url: r?.payment_url ?? r?.url ?? r?.checkout_url ?? r?.link ?? '',
    webhookSecret: r?.webhook_secret ?? '',
    status: r?.status ?? 'pending',
    raw: r,
  };
}

async function getPaymentCheckout(paymentLinkId) {
  const data = await request('get', `${config.zaaer.checkoutPath}/${encodeURIComponent(paymentLinkId)}`);
  return data?.result ?? data?.data ?? data;
}

/** هل الدفع مكتمل؟ يقرأ حالة كائن الـ checkout بمرونة */
function isCheckoutPaid(obj) {
  const s = String(obj?.status ?? obj?.payment_status ?? '').toLowerCase();
  return ['paid', 'captured', 'succeeded', 'success', 'completed'].includes(s);
}
function isCheckoutFailed(obj) {
  const s = String(obj?.status ?? obj?.payment_status ?? '').toLowerCase();
  return ['failed', 'declined', 'expired', 'cancelled', 'canceled'].includes(s);
}

module.exports = {
  getProperties,
  rawGet,
  getAllReservations,
  cachedReservations,
  getReservationsByPhone,
  getReservationByBookingId,
  searchReservations,
  getReservationQuote,
  checkAvailability,
  createReservation,
  cancelReservation,
  modifyReservation,
  createReceipt,
  checkIn,
  checkOut,
  getAccountBalances,
  createPaymentCheckout,
  getPaymentCheckout,
  isCheckoutPaid,
  isCheckoutFailed,
  clearCache,
};
