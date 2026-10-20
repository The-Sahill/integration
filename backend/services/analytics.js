// services/analytics.js — مؤشرات الأداء والمقارنات (يوم/أسبوع/شهر/سنة) من حجوزات زائر + بيانات النظام
const { PricingRule, Payment, Booking, Conversation, Negotiation, Ticket } = require('../models');
const zaaer = require('./zaaer');
const settings = require('./settings');
const config = require('../config');
const { todayISO, addDaysISO, nightsBetween } = require('../utils/helpers');

const CANCELLED = ['cancelled', 'canceled', 'no_show', 'noshow', 'void', 'rejected'];
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const d10 = (v) => (v ? String(v).slice(0, 10) : '');

/**
 * توحيد شكل حجز زائر — كل أسماء الحقول المحتملة في مكان واحد
 * (عدّل هنا فقط إذا اختلفت أسماء الحقول في GET /reservations)
 */
function normalizeReservation(r) {
  const checkIn = d10(r.check_in_date ?? r.check_in ?? r.arrival_date ?? r.start_date);
  const checkOut = d10(r.check_out_date ?? r.check_out ?? r.departure_date ?? r.end_date);
  // زائر الفعلي: المبالغ في finance.{total,paid,balance_due}، والحالة في reservation_status، والرقم في number (REV...)
  const total = num(r.finance?.total ?? r.totals?.total ?? r.total ?? r.total_amount ?? r.grand_total ?? r.amount);
  const paid = num(r.finance?.paid ?? r.paid_amount ?? r.totals?.paid ?? r.amount_paid ?? r.payments_total ?? r.paid);
  const balanceRaw = r.finance?.balance_due ?? r.balance ?? r.remaining_amount ?? r.totals?.balance ?? r.due_amount;
  const status = String(r.reservation_status ?? r.status ?? '').toLowerCase();
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut).length : 0;
  return {
    id: String(r.number ?? r.reservation_number ?? r.id ?? ''),
    guest: r.guest?.name ?? r.guest_name ?? '',
    phone: r.guest?.phone ?? r.phone ?? '',
    status,
    cancelled: CANCELLED.includes(status),
    checkedIn: ['checked_in', 'checkedin', 'in_house', 'inhouse'].includes(status),
    checkIn,
    checkOut,
    nights,
    createdAt: d10(r.created_at ?? r.booking_date ?? r.createdAt),
    total,
    paid,
    balance: balanceRaw !== undefined && balanceRaw !== null ? num(balanceRaw) : Math.max(0, total - paid),
    rooms: Array.isArray(r.rooms) && r.rooms.length ? r.rooms.length : 1, // حجز واحد قد يشمل أكثر من وحدة
    perNight: nights ? total / nights : 0,
    source: String(r.source ?? r.channel ?? r.booking_source ?? r.ota ?? 'direct'),
    unitTypeId: r.rooms?.[0]?.unit_type_id ?? r.unit_type_id ?? null,
  };
}

async function loadReservations() {
  const raw = await zaaer.getAllReservations();
  return raw.map(normalizeReservation).filter((r) => r.checkIn && r.checkOut);
}

async function totalUnits() {
  const rules = await PricingRule.find({ active: true }).lean();
  return rules.reduce((s, r) => s + (r.unitsCount || 0), 0) || settings.get('totalUnits') || 1;
}

// ------------------------------------------------------------------ الفترات
const PERIOD_AR = { day: 'يوم', week: 'أسبوع', month: 'شهر', year: 'سنة' };

/** بداية ونهاية الفترة (النهاية غير مشمولة). offset=0 الحالية، -1 السابقة... الأسبوع يبدأ السبت */
function periodRange(type, offset = 0, ref = todayISO(config.timezone)) {
  const d = new Date(ref + 'T00:00:00Z');
  let start;
  let end;
  if (type === 'day') {
    start = addDaysISO(ref, offset);
    end = addDaysISO(start, 1);
  } else if (type === 'week') {
    const dow = d.getUTCDay(); // 6 = السبت
    const sinceSat = (dow + 1) % 7;
    start = addDaysISO(addDaysISO(ref, -sinceSat), offset * 7);
    end = addDaysISO(start, 7);
  } else if (type === 'month') {
    const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
    const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 1));
    start = s.toISOString().slice(0, 10);
    end = e.toISOString().slice(0, 10);
  } else {
    start = `${d.getUTCFullYear() + offset}-01-01`;
    end = `${d.getUTCFullYear() + offset + 1}-01-01`;
  }
  return { start, end, days: nightsBetween(start, end).length, label: labelFor(type, start) };
}

function labelFor(type, start) {
  if (type === 'day') return start;
  if (type === 'week') return `أسبوع ${start}`;
  if (type === 'month') return start.slice(0, 7);
  return start.slice(0, 4);
}

/** نفس الفترة من السنة الماضية */
function lastYear(range) {
  const shift = (iso) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;
  const start = shift(range.start);
  const end = shift(range.end);
  return { start, end, days: nightsBetween(start, end).length, label: `${range.label} (السنة الماضية)` };
}

// ------------------------------------------------------------------ المؤشرات
function overlapNights(r, start, end) {
  const s = r.checkIn > start ? r.checkIn : start;
  const e = r.checkOut < end ? r.checkOut : end;
  return s < e ? nightsBetween(s, e).length : 0;
}

/** حساب مؤشرات فترة واحدة (بيانات زائر محمّلة مسبقاً + استعلامات محلية) */
async function metricsFor(range, reservations, units) {
  const active = reservations.filter((r) => !r.cancelled);
  let roomNights = 0;
  let revenue = 0;
  for (const r of active) {
    const n = overlapNights(r, range.start, range.end);
    roomNights += n * (r.rooms || 1);
    revenue += n * r.perNight;
  }
  // زائر لا يُرجع تاريخ إنشاء الحجز ← نعتمد تاريخ الوصول بديلاً (الحجوزات/الإلغاءات حسب تاريخ الوصول)
  const bookedOn = (r) => r.createdAt || r.checkIn;
  const created = reservations.filter((r) => bookedOn(r) >= range.start && bookedOn(r) < range.end);
  const createdActive = created.filter((r) => !r.cancelled);
  const cancelled = created.filter((r) => r.cancelled);
  const arrivals = active.filter((r) => r.checkIn >= range.start && r.checkIn < range.end);
  const leadTimes = createdActive.filter((r) => r.createdAt).map((r) => nightsBetween(r.createdAt, r.checkIn).length).filter((x) => x >= 0);
  const capacity = units * range.days;

  const from = new Date(range.start + 'T00:00:00Z');
  const to = new Date(range.end + 'T00:00:00Z');
  const [payments, leads, aiBookings, negs, ticketsOpened, ticketsClosed] = await Promise.all([
    Payment.find({ status: { $in: ['confirmed', 'paid'] }, updatedAt: { $gte: from, $lt: to } }).lean(),
    Conversation.countDocuments({ isStaff: { $ne: true }, createdAt: { $gte: from, $lt: to } }),
    Booking.countDocuments({ source: 'ai', status: { $in: ['zaaer_entered', 'confirmed'] }, createdAt: { $gte: from, $lt: to } }),
    Negotiation.find({ createdAt: { $gte: from, $lt: to } }).lean(),
    Ticket.countDocuments({ createdAt: { $gte: from, $lt: to } }),
    Ticket.find({ closedAt: { $gte: from, $lt: to } }).lean(),
  ]);
  const negClosed = negs.filter((n) => ['booked', 'lost', 'rejected'].includes(n.status));
  const negWon = negClosed.filter((n) => n.status === 'booked');
  const resMinutes = ticketsClosed.filter((t) => t.doneAt).map((t) => (new Date(t.doneAt) - new Date(t.createdAt)) / 60000);
  const rated = ticketsClosed.filter((t) => typeof t.satisfied === 'boolean');

  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    period: range.label,
    occupancyPct: capacity ? r1((roomNights / capacity) * 100) : 0,
    roomNights,
    revenue: Math.round(revenue),
    adr: roomNights ? Math.round(revenue / roomNights) : 0,
    revpar: capacity ? r1(revenue / capacity) : 0,
    newBookings: createdActive.length,
    bookingValue: Math.round(createdActive.reduce((s, r) => s + r.total, 0)),
    cancellations: cancelled.length,
    cancellationPct: created.length ? r1((cancelled.length / created.length) * 100) : 0,
    arrivals: arrivals.length,
    avgLeadDays: leadTimes.length ? r1(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length) : null,
    avgStayNights: createdActive.length ? r1(createdActive.reduce((s, r) => s + r.nights, 0) / createdActive.length) : 0,
    collected: Math.round(payments.reduce((s, p) => s + num(p.amount), 0)),
    whatsappLeads: leads,
    aiBookings,
    aiConversionPct: leads ? r1((aiBookings / leads) * 100) : 0,
    negotiationSuccessPct: negClosed.length ? r1((negWon.length / negClosed.length) * 100) : null,
    ticketsOpened,
    avgResolutionMin: resMinutes.length ? Math.round(resMinutes.reduce((a, b) => a + b, 0) / resMinutes.length) : null,
    satisfactionPct: rated.length ? r1((rated.filter((t) => t.satisfied).length / rated.length) * 100) : null,
  };
}

const METRIC_LABELS = {
  occupancyPct: 'الإشغال %', roomNights: 'ليالٍ مباعة', revenue: 'الإيراد (حسب الإقامة)', adr: 'متوسط سعر الليلة ADR', revpar: 'العائد لكل وحدة RevPAR',
  newBookings: 'حجوزات جديدة', bookingValue: 'قيمة الحجوزات الجديدة', cancellations: 'إلغاءات', cancellationPct: 'نسبة الإلغاء %', arrivals: 'وصول',
  avgLeadDays: 'متوسط الحجز المسبق (يوم)', avgStayNights: 'متوسط مدة الإقامة', collected: 'المحصّل (مؤكد في النظام)', whatsappLeads: 'عملاء واتساب جدد',
  aiBookings: 'حجوزات عبر الـ AI', aiConversionPct: 'تحويل واتساب → حجز %', negotiationSuccessPct: 'نجاح التفاوض %', ticketsOpened: 'تذاكر جديدة',
  avgResolutionMin: 'متوسط إنجاز التذكرة (دقيقة)', satisfactionPct: 'رضا النزلاء %',
};
// مؤشرات "الأقل أفضل"
const LOWER_IS_BETTER = ['cancellations', 'cancellationPct', 'avgResolutionMin'];

function change(cur, prev) {
  if (cur === null || prev === null || cur === undefined || prev === undefined) return null;
  if (!prev) return cur ? 100 : 0;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

/** مقارنة الفترة الحالية مع السابقة ونفس الفترة من السنة الماضية */
async function compare(type = 'week', offset = 0) {
  const [reservations, units] = await Promise.all([loadReservations(), totalUnits()]);
  let cur = periodRange(type, offset);
  let prev = periodRange(type, offset - 1);
  // الفترة الحالية لم تنتهِ: نقارن "حتى اليوم" بنفس عدد الأيام من الفترة السابقة (وإلا تظهر الأيام القادمة غير المباعة كهبوط)
  const toDate = addDaysISO(todayISO(config.timezone), 1);
  if (offset === 0 && type !== 'day' && cur.end > toDate) {
    const days = nightsBetween(cur.start, toDate).length;
    cur = { ...cur, end: toDate, days, label: `${cur.label} (حتى اليوم)` };
    prev = { ...prev, end: addDaysISO(prev.start, days), days, label: `${prev.label} (أول ${days} يوم)` };
  }
  const ly = lastYear(cur);
  const [a, b, c] = await Promise.all([metricsFor(cur, reservations, units), metricsFor(prev, reservations, units), metricsFor(ly, reservations, units)]);
  const rows = Object.keys(METRIC_LABELS).map((k) => ({
    key: k, label: METRIC_LABELS[k], current: a[k], previous: b[k], lastYear: c[k],
    changePct: change(a[k], b[k]), changeLyPct: change(a[k], c[k]), lowerIsBetter: LOWER_IS_BETTER.includes(k),
  }));
  return { type, typeLabel: PERIOD_AR[type], current: cur, previous: prev, lastYear: ly, units, rows };
}

/** سلسلة آخر N فترات (لجدول المقارنة الزمني) */
async function series(type = 'month', count = 12) {
  const [reservations, units] = await Promise.all([loadReservations(), totalUnits()]);
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(await metricsFor(periodRange(type, -i), reservations, units));
  return { type, units, labels: METRIC_LABELS, rows: out };
}

/** الحجوزات المستقبلية (On-the-books) للأيام القادمة + مقارنة بنفس الفترة العام الماضي + أيام الأسبوع مقابل نهايته */
async function forward(windows = [7, 14, 30, 60, 90]) {
  const [reservations, units] = await Promise.all([loadReservations(), totalUnits()]);
  const active = reservations.filter((r) => !r.cancelled);
  const today = todayISO(config.timezone);
  const rows = windows.map((w) => {
    const range = { start: today, end: addDaysISO(today, w), days: w };
    const ly = lastYear({ ...range, label: '' });
    const nights = active.reduce((s, r) => s + overlapNights(r, range.start, range.end) * (r.rooms || 1), 0);
    const lyNights = active.reduce((s, r) => s + overlapNights(r, ly.start, ly.end) * (r.rooms || 1), 0);
    const revenue = active.reduce((s, r) => s + overlapNights(r, range.start, range.end) * r.perNight, 0);
    return {
      days: w,
      occupancyPct: Math.round((nights / (units * w)) * 1000) / 10,
      lastYearPct: Math.round((lyNights / (units * w)) * 1000) / 10,
      roomNights: nights,
      revenue: Math.round(revenue),
      emptyNights: units * w - nights,
    };
  });

  // إشغال كل يوم في الـ 30 يوماً القادمة (لكشف الفجوات)
  const daily = [];
  for (let i = 0; i < 30; i++) {
    const day = addDaysISO(today, i);
    const occ = active.filter((r) => r.checkIn <= day && r.checkOut > day).reduce((s, r) => s + (r.rooms || 1), 0);
    const dow = new Date(day + 'T00:00:00Z').getUTCDay();
    daily.push({ date: day, dow, occupied: occ, pct: Math.round((occ / units) * 100) });
  }
  const weekendNights = (settings.get('weekendNights') || [4, 5]);
  const wk = daily.filter((d) => weekendNights.includes(d.dow));
  const wd = daily.filter((d) => !weekendNights.includes(d.dow));
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, d) => s + d.pct, 0) / arr.length) : 0);

  // أرصدة مستحقة لوصول قريب
  const soon = active.filter((r) => r.checkIn >= today && r.checkIn <= addDaysISO(today, 3) && r.balance > 0);
  return {
    units,
    rows,
    // بدون تاريخ إنشاء الحجز لا يمكن معرفة ما كان محجوزاً "حتى اليوم" العام الماضي ← lastYearPct = الإشغال الفعلي النهائي وليس وتيرة الحجز
    hasBookingDates: reservations.some((r) => r.createdAt),
    daily,
    weekendAvgPct: avg(wk),
    weekdayAvgPct: avg(wd),
    gaps: daily.filter((d) => d.pct < (settings.get('lowOccupancyThreshold') || 40)).map((d) => d.date),
    arrivalsWithBalance: soon.map((r) => ({ id: r.id, guest: r.guest, checkIn: r.checkIn, balance: r.balance })),
  };
}

/** ملخص قصير للواتساب */
function formatCompareForChat(c) {
  const pick = ['occupancyPct', 'revenue', 'adr', 'newBookings', 'cancellationPct', 'collected', 'aiBookings'];
  const lines = [`📊 مقارنة ${c.typeLabel}: ${c.current.label} مقابل ${c.previous.label}`];
  for (const k of pick) {
    const r = c.rows.find((x) => x.key === k);
    if (!r) continue;
    const arrow = r.changePct === null ? '' : r.changePct > 0 ? '▲' : r.changePct < 0 ? '▼' : '=';
    lines.push(`• ${r.label}: ${r.current ?? '-'} (السابق ${r.previous ?? '-'}) ${arrow}${r.changePct !== null ? Math.abs(r.changePct) + '%' : ''}`);
  }
  return lines.join('\n');
}

module.exports = { normalizeReservation, loadReservations, periodRange, metricsFor, compare, series, forward, formatCompareForChat, METRIC_LABELS, totalUnits };
