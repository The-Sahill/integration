// services/reports.js — التقرير الصباحي اليومي للمدير
const { Booking, Payment, Ticket, Negotiation, PricingRule } = require('../models');
const zaaer = require('./zaaer');
const settings = require('./settings');
const config = require('../config');
const { todayISO, addDaysISO } = require('../utils/helpers');

const CANCELLED = ['cancelled', 'canceled', 'no_show', 'void'];

function resDate(r, key) {
  return String(r[key] || r[key.replace('_date', '')] || '').slice(0, 10);
}

async function stats() {
  const today = todayISO(config.timezone);
  const yesterday = addDaysISO(today, -1);
  let reservations = [];
  let zaaerOk = true;
  try {
    reservations = (await zaaer.getAllReservations()).filter((r) => !CANCELLED.includes(String(r.reservation_status ?? r.status ?? '').toLowerCase()));
  } catch {
    zaaerOk = false;
  }
  const inHouse = reservations.filter((r) => resDate(r, 'check_in_date') <= today && resDate(r, 'check_out_date') > today);
  const arrivals = reservations.filter((r) => resDate(r, 'check_in_date') === today);
  const departures = reservations.filter((r) => resDate(r, 'check_out_date') === today);
  const newInZaaer = reservations.filter((r) => String(r.created_at || '').slice(0, 10) === yesterday);

  const rules = await PricingRule.find({ active: true }).lean();
  const totalUnits = rules.reduce((s, r) => s + (r.unitsCount || 0), 0) || settings.get('totalUnits') || 1;

  const since = new Date(Date.now() - 24 * 3600000);
  const [newLocal, awaitingPayment, pendingReceipts, openTickets, openMaint, urgent] = await Promise.all([
    Booking.countDocuments({ createdAt: { $gte: since }, status: { $in: ['zaaer_entered', 'confirmed'] } }),
    Booking.find({ status: 'awaiting_payment' }).lean(),
    Payment.countDocuments({ status: 'pending' }),
    Ticket.countDocuments({ kind: 'request', status: { $in: ['open', 'assigned', 'acknowledged', 'reopened'] } }),
    Ticket.countDocuments({ kind: 'maintenance', status: { $in: ['open', 'assigned', 'acknowledged', 'reopened'] } }),
    Ticket.countDocuments({ priority: 'urgent', status: { $in: ['open', 'assigned', 'acknowledged', 'reopened'] } }),
  ]);

  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const negs = await Negotiation.find({ updatedAt: { $gte: weekAgo }, status: { $in: ['booked', 'lost', 'rejected', 'accepted', 'approved'] } }).lean();
  const won = negs.filter((n) => n.status === 'booked').length;
  const negotiated = negs.filter((n) => (n.offers || []).some((o) => o.by === 'guest'));
  const avgDiscount = negotiated.length
    ? Math.round((negotiated.reduce((s, n) => s + (1 - (n.finalPrice || n.currentOffer) / n.listPrice), 0) / negotiated.length) * 100)
    : 0;

  return {
    today, zaaerOk, totalUnits,
    occupancyPct: Math.round((inHouse.reduce((s, r) => s + (r.rooms?.length || 1), 0) / totalUnits) * 100), inHouse: inHouse.length,
    arrivals: arrivals.map((r) => r.guest?.name || '-'), departures: departures.map((r) => r.guest?.name || '-'),
    newBookings: newInZaaer.length || newLocal,
    awaitingPayment: awaitingPayment.length, awaitingPaymentTotal: awaitingPayment.reduce((s, b) => s + (b.agreedPrice || 0), 0),
    pendingReceipts, openTickets, openMaint, urgent,
    negotiationSuccessPct: negs.length ? Math.round((won / negs.length) * 100) : null, negotiations: negs.length, avgDiscountPct: avgDiscount,
  };
}

async function buildDailyReport() {
  const s = await stats();
  const lines = [
    `☀️ تقرير ${s.today} — ${settings.get('propertyName')}`,
    s.zaaerOk ? `🏨 الإشغال: ${s.occupancyPct}% (${s.inHouse}/${s.totalUnits})` : '⚠️ تعذر جلب بيانات زائر',
    `🛬 وصول اليوم (${s.arrivals.length}): ${s.arrivals.slice(0, 8).join('، ') || '-'}`,
    `🛫 مغادرة اليوم (${s.departures.length}): ${s.departures.slice(0, 8).join('، ') || '-'}`,
    `🆕 حجوزات جديدة (24 ساعة): ${s.newBookings}`,
    `💳 بانتظار الدفع: ${s.awaitingPayment} (${s.awaitingPaymentTotal} ${config.zaaer.currency}) | إيصالات للمراجعة: ${s.pendingReceipts}`,
    `🛎️ طلبات مفتوحة: ${s.openTickets} | 🔧 صيانة مفتوحة: ${s.openMaint}${s.urgent ? ` | 🚨 عاجلة: ${s.urgent}` : ''}`,
    s.negotiationSuccessPct === null ? '🤝 لا توجد مفاوضات مكتملة هذا الأسبوع' : `🤝 نجاح التفاوض (7 أيام): ${s.negotiationSuccessPct}% من ${s.negotiations} — متوسط الخصم ${s.avgDiscountPct}%`,
  ];
  return lines.join('\n');
}

module.exports = { stats, buildDailyReport };
