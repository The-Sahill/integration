// services/pricing.js — المنطق الحسابي للسعر والتفاوض (في الكود وليس تقدير الـ AI)
// دوال نقية بدون قاعدة بيانات — مغطاة باختبارات في tests/pricing.test.js
const { nightsBetween } = require('../utils/helpers');

function inSeason(mmdd, from, to) {
  if (!from || !to) return false;
  // موسم داخل نفس السنة (06-01 → 08-31) أو يلتف حول رأس السنة (12-20 → 01-05)
  return from <= to ? mmdd >= from && mmdd <= to : mmdd >= from || mmdd <= to;
}

/** سعر ليلة واحدة حسب المواسم ثم نهاية الأسبوع ثم الأساسي */
function nightlyRate(rule, isoDate) {
  const mmdd = isoDate.slice(5);
  const season = (rule.seasons || []).find((s) => s && s.rate > 0 && inSeason(mmdd, s.from, s.to));
  if (season) return Number(season.rate);
  const dow = new Date(isoDate + 'T00:00:00Z').getUTCDay();
  const weekendNights = rule.weekendNights?.length ? rule.weekendNights : [4, 5];
  if (rule.weekendRate && weekendNights.includes(dow)) return Number(rule.weekendRate);
  return Number(rule.baseRate);
}

/**
 * عرض السعر الكامل
 * zaaerAmount: سعر زائر (يُستخدم إن كانت القاعدة useZaaerPrice أو لا يوجد سعر أساسي)
 */
function quote(rule, checkIn, checkOut, { zaaerAmount } = {}) {
  const dates = nightsBetween(checkIn, checkOut);
  const nights = dates.length;
  if (!nights) throw new Error('تواريخ غير صحيحة: يجب أن تكون المغادرة بعد الوصول');
  const nightly = dates.map((date) => ({ date, rate: nightlyRate(rule, date) }));
  let listTotal = nightly.reduce((s, n) => s + n.rate, 0);
  if ((rule.useZaaerPrice || !rule.baseRate) && zaaerAmount > 0) listTotal = Number(zaaerAmount);
  listTotal = Math.round(listTotal);

  const byMin = Number(rule.minRate || 0) * nights;
  const byDiscount = listTotal * (1 - Number(rule.maxDiscountPct || 0) / 100);
  let floorTotal = Math.ceil(Math.max(byMin, byDiscount));
  if (floorTotal > listTotal) floorTotal = listTotal; // لا يكون الحد الأدنى أعلى من السعر المعروض

  return { nights, nightly, listTotal, floorTotal, avgNightly: Math.round(listTotal / nights) };
}

function steps(rule) {
  const max = Number(rule.maxDiscountPct || 0);
  const s = (rule.concessionSteps || []).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
  const capped = s.map((x) => Math.min(x, max));
  return capped.length ? [...new Set(capped)] : max > 0 ? [max] : [];
}

/** السعر عند خطوة تنازل معينة (1 = أول تنازل) — لا ينزل تحت الحد الأدنى */
function priceAtStep(listTotal, floorTotal, rule, step) {
  const s = steps(rule);
  if (!s.length || step <= 0) return listTotal;
  const pct = s[Math.min(step, s.length) - 1];
  return Math.max(floorTotal, Math.round(listTotal * (1 - pct / 100)));
}

/** بدائل بدل الخصم */
function alternatives(rule, q) {
  const out = [];
  const alt = rule.alternatives || {};
  if (alt.extraNightDiscountPct > 0) {
    const extra = Math.max(Number(rule.minRate || 0), Math.round(q.avgNightly * (1 - alt.extraNightDiscountPct / 100)));
    out.push({ type: 'extra_night', text: `ليلة إضافية بسعر ${extra} بدل ${q.avgNightly}`, price: extra });
  }
  if (alt.earlyCheckIn) out.push({ type: 'early_check_in', text: 'دخول مبكر مجاني حسب التوفر' });
  if (alt.lateCheckOut) out.push({ type: 'late_check_out', text: 'خروج متأخر مجاني حسب التوفر' });
  return out;
}

/**
 * جولة تفاوض واحدة
 * state: { listPrice, floorPrice, currentOffer, round }
 * customerOffer: المبلغ الإجمالي الذي يطلبه العميل (أو null إن طلب خصماً بدون رقم)
 * يُرجع: { decision, price, round, alternatives }
 *  - accept: نقبل بهذا السعر
 *  - counter: نعرض سعراً جديداً (خطوة تنازل)
 *  - final_offer: آخر سعر ممكن (= الحد الأدنى)
 *  - below_floor: العميل يطلب أقل من الحد الأدنى بعد العرض النهائي ← موافقة المدير
 */
function negotiateRound(state, rule, customerOffer) {
  const list = Number(state.listPrice);
  const floor = Number(state.floorPrice);
  const current = Number(state.currentOffer ?? list);
  const round = Number(state.round || 0);
  const offer = customerOffer == null || Number.isNaN(Number(customerOffer)) ? 0 : Number(customerOffer);
  const totalSteps = steps(rule).length;

  // العميل يعرض سعراً ≥ عرضنا الحالي → نقبل بعرضنا الحالي
  if (offer >= current) return { decision: 'accept', price: current, round };

  const nextRound = round + 1;
  const next = nextRound <= totalSteps ? priceAtStep(list, floor, rule, nextRound) : floor;

  // عرض العميل بين الخطوة التالية وعرضنا الحالي → نقبل عرضه
  if (offer > 0 && offer >= next) return { decision: 'accept', price: Math.max(Math.round(offer), floor), round: nextRound };

  if (next > floor && next < current) {
    return { decision: 'counter', price: next, round: nextRound, alternatives: nextRound >= 2 ? alternatives(rule, { avgNightly: Math.round(list / (state.nights || 1)) }) : [] };
  }
  if (current > floor) {
    return { decision: 'final_offer', price: floor, round: nextRound, alternatives: alternatives(rule, { avgNightly: Math.round(list / (state.nights || 1)) }) };
  }
  return { decision: 'below_floor', price: floor, round };
}

module.exports = { nightlyRate, quote, priceAtStep, negotiateRound, alternatives, steps, inSeason };



