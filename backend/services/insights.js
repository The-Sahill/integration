// services/insights.js — كشف المخاطر (قواعد في الكود) + نصائح لزيادة الحجوزات (Gemini مبني على الأرقام)
const analytics = require('./analytics');
const gemini = require('./gemini');
const settings = require('./settings');
const tickets = require('./tickets');
const { Booking, Payment, InventoryItem, Ticket, Negotiation } = require('../models');

let cache = null; // { at, data }
const CACHE_MS = 6 * 3600 * 1000;

/** يجمع البيانات اللازمة للتحليل */
async function gather() {
  const [weekCmp, monthCmp, fwd, failed, awaiting, oldReceipts, lowStock, faults, urgent, recentNegs] = await Promise.all([
    analytics.compare('week'),
    analytics.compare('month'),
    analytics.forward(),
    Booking.countDocuments({ status: 'failed' }),
    Booking.find({ status: 'awaiting_payment' }).lean(),
    Payment.countDocuments({ status: 'pending', method: 'receipt', createdAt: { $lt: new Date(Date.now() - 2 * 3600000) } }),
    InventoryItem.find({ $expr: { $and: [{ $gt: ['$minQuantity', 0] }, { $lte: ['$quantity', '$minQuantity'] }] } }).lean(),
    tickets.recurringFaults(60, 2),
    Ticket.countDocuments({ priority: 'urgent', status: { $in: ['open', 'assigned', 'acknowledged', 'reopened'] } }),
    Negotiation.find({ updatedAt: { $gte: new Date(Date.now() - 30 * 86400000) }, status: 'booked' }).lean(),
  ]);
  const avgDiscount = recentNegs.length
    ? Math.round((recentNegs.reduce((s, n) => s + (1 - (n.finalPrice || n.listPrice) / n.listPrice), 0) / recentNegs.length) * 100)
    : 0;
  return { weekCmp, monthCmp, fwd, failed, awaiting, oldReceipts, lowStock, faults, urgent, avgDiscount };
}

const val = (cmp, key, field = 'current') => cmp.rows.find((r) => r.key === key)?.[field];

/** قواعد كشف المخاطر — قابلة للتعديل والتوسعة */
function detectRisks(d) {
  const risks = [];
  const th = settings.get('lowOccupancyThreshold') || 40;
  const add = (level, area, title, detail) => risks.push({ level, area, title, detail });

  const f7 = d.fwd.rows.find((r) => r.days === 7);
  const f30 = d.fwd.rows.find((r) => r.days === 30);
  if (f7 && f7.occupancyPct < th) add('high', 'إشغال', `إشغال الأيام السبعة القادمة ${f7.occupancyPct}% فقط`, `${f7.emptyNights} ليلة فارغة خلال أسبوع — تحتاج تحرك سريع (عروض قصيرة، تواصل مع عملاء سابقين).`);
  if (f30 && f30.occupancyPct < th) add('medium', 'إشغال', `الحجوزات المؤكدة للشهر القادم ${f30.occupancyPct}%`, `${f30.emptyNights} ليلة غير مباعة في 30 يوماً.`);
  if (f30 && d.fwd.hasBookingDates && f30.lastYearPct > 0 && f30.occupancyPct < f30.lastYearPct - 10) add('medium', 'وتيرة الحجز', 'وتيرة الحجز أبطأ من العام الماضي', `الشهر القادم ${f30.occupancyPct}% مقابل ${f30.lastYearPct}% لنفس الفترة العام الماضي.`);
  if (d.fwd.weekendAvgPct - d.fwd.weekdayAvgPct > 30) add('medium', 'توزيع الإشغال', 'فجوة كبيرة بين أيام الأسبوع ونهايته', `نهاية الأسبوع ${d.fwd.weekendAvgPct}% مقابل أيام الأسبوع ${d.fwd.weekdayAvgPct}%.`);
  if (d.fwd.gaps.length >= 7) add('low', 'إشغال', `${d.fwd.gaps.length} يوماً منخفض الإشغال في الشهر القادم`, `أولها: ${d.fwd.gaps.slice(0, 5).join('، ')}`);

  const nbW = d.weekCmp.rows.find((r) => r.key === 'newBookings');
  if (nbW && nbW.previous >= 3 && nbW.changePct !== null && nbW.changePct <= -25) add('medium', 'مبيعات', `الحجوزات الجديدة انخفضت ${Math.abs(nbW.changePct)}% هذا الأسبوع`, `${nbW.current} مقابل ${nbW.previous} الأسبوع الماضي.`);
  const adr = d.monthCmp.rows.find((r) => r.key === 'adr');
  if (adr && adr.previous && adr.changePct !== null && adr.changePct <= -10) add('medium', 'التسعير', `متوسط سعر الليلة انخفض ${Math.abs(adr.changePct)}%`, `${adr.current} مقابل ${adr.previous} الشهر الماضي.`);
  const cxl = val(d.monthCmp, 'cancellationPct');
  if (cxl >= 15) add('high', 'إلغاءات', `نسبة الإلغاء هذا الشهر ${cxl}%`, 'راجع سياسة الإلغاء واطلب دفعة مقدمة.');
  if (d.avgDiscount >= 10) add('medium', 'التسعير', `متوسط الخصم في التفاوض ${d.avgDiscount}%`, 'هامش الربح يتآكل — راجع خطوات التنازل والحد الأدنى.');
  const conv = val(d.monthCmp, 'aiConversionPct');
  const leads = val(d.monthCmp, 'whatsappLeads');
  if (leads >= 20 && conv < 10) add('medium', 'تحويل', `تحويل عملاء واتساب إلى حجوزات ${conv}% فقط`, `${leads} عميل هذا الشهر — راجع الأسعار المعروضة وأسلوب الرد في الـ Prompt.`);

  if (d.failed) add('high', 'حجوزات', `${d.failed} حجز مدفوع فشل إدخاله في زائر`, 'صفحة الحجوزات والدفع ← إعادة الإدخال.');
  if (d.oldReceipts) add('high', 'مالية', `${d.oldReceipts} إيصال دفع ينتظر المراجعة أكثر من ساعتين`, 'العميل ينتظر تأكيد حجزه.');
  if (d.awaiting.length) add('low', 'مالية', `${d.awaiting.length} حجز مبدئي بانتظار الدفع`, `بقيمة ${d.awaiting.reduce((s, b) => s + (b.agreedPrice || 0), 0)}.`);
  if (d.fwd.arrivalsWithBalance.length) add('medium', 'مالية', `${d.fwd.arrivalsWithBalance.length} وصول خلال 3 أيام عليه رصيد غير مدفوع`, d.fwd.arrivalsWithBalance.slice(0, 5).map((r) => `${r.guest} (${r.balance})`).join('، '));

  if (d.urgent) add('high', 'تشغيل', `${d.urgent} تذكرة عاجلة مفتوحة`, '');
  if (d.faults.length) add('medium', 'صيانة', `${d.faults.length} عطل متكرر`, d.faults.slice(0, 4).map((f) => `غرفة ${f._id.room}: ${f._id.category} ×${f.count}`).join('، '));
  const sat = val(d.monthCmp, 'satisfactionPct');
  if (sat !== null && sat !== undefined && sat < 80) add('medium', 'رضا النزلاء', `رضا النزلاء ${sat}%`, 'خطر على التقييمات والحجوزات المستقبلية.');
  if (d.lowStock.length) add('low', 'مخزون', `${d.lowStock.length} صنف منخفض`, d.lowStock.map((i) => `${i.name} (${i.quantity})`).join('، '));

  const order = { high: 0, medium: 1, low: 2 };
  return risks.sort((a, b) => order[a.level] - order[b.level]);
}

/** نصائح عامة احتياطية إذا تعذر Gemini */
function fallbackAdvice(d) {
  const tips = [];
  const f30 = d.fwd.rows.find((r) => r.days === 30);
  if (d.fwd.weekdayAvgPct < d.fwd.weekendAvgPct) tips.push('اعرض باقة أيام الأسبوع (الأحد–الأربعاء) بخصم 10–15% أو ليلة ثالثة مجانية.');
  if (f30 && f30.occupancyPct < 50) tips.push('أرسل عرضاً محدود المدة للعملاء السابقين عبر قالب واتساب تسويقي للتواريخ الفارغة.');
  tips.push('فعّل خصم الإقامة الطويلة (7 ليالٍ فأكثر) لاستقطاب العائلات والزوار الطبيين.');
  tips.push('تابع المحادثات المغلقة بدون حجز خلال آخر 30 يوماً بعرض شخصي.');
  return tips;
}

async function aiAdvice(d, risks) {
  const compact = {
    week: Object.fromEntries(d.weekCmp.rows.map((r) => [r.label, { الحالي: r.current, السابق: r.previous, التغير: r.changePct }])),
    month: Object.fromEntries(d.monthCmp.rows.map((r) => [r.label, { الحالي: r.current, السابق: r.previous, 'العام الماضي': r.lastYear }])),
    // بدون تاريخ إنشاء الحجوزات، "العام الماضي" هنا إشغال فعلي نهائي لا يُقارن بالمحجوز حالياً ← لا نرسله حتى لا يُبنى عليه استنتاج خاطئ
    forward: d.fwd.hasBookingDates ? d.fwd.rows : d.fwd.rows.map(({ lastYearPct, ...r }) => r),
    weekendVsWeekday: { weekend: d.fwd.weekendAvgPct, weekday: d.fwd.weekdayAvgPct },
    lowDays: d.fwd.gaps.slice(0, 15),
    avgNegotiationDiscountPct: d.avgDiscount,
    risks: risks.map((r) => `${r.level}: ${r.title}`),
  };
  const res = await gemini.generate({
    temperature: 0.5,
    contents: [{
      role: 'user',
      parts: [{
        text: `أنت مستشار إيرادات (Revenue Manager) لشقق فندقية عائلية في عمّان (${settings.get('propertyName')}، عدد الوحدات ${d.fwd.units}).
هذه بيانات الأداء الحالية والمستقبلية بصيغة JSON:
${JSON.stringify(compact)}

اكتب 5 إلى 7 نصائح عملية ومحددة لزيادة الحجوزات والإيراد خلال الأسابيع القادمة، مبنية على الأرقام أعلاه فقط.
- كل نصيحة سطر أو سطران، تبدأ بفعل، وتذكر الرقم/التاريخ الذي استندت إليه، والأثر المتوقع.
- رتّبها حسب الأولوية. لا مقدمات ولا خاتمة. بالعربية.`,
      }],
    }],
  });
  // يُزال الترقيم من البداية، و**التنسيق** من كامل السطر (كان يبقى نصفه: "الليلة** فوراً")
  return gemini.responseText(res).split('\n').map((l) => l.replace(/^[\s\-•*\d.)]+/, '').replace(/\*\*/g, '').trim()).filter(Boolean);
}

/** المخاطر + النصائح (مخزنة مؤقتاً 6 ساعات) */
async function getInsights({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const d = await gather();
  const risks = detectRisks(d);
  let advice;
  let adviceSource = 'ai';
  try {
    advice = await aiAdvice(d, risks);
    if (!advice.length) throw new Error('empty');
  } catch {
    advice = fallbackAdvice(d);
    adviceSource = 'rules';
  }
  const data = { generatedAt: new Date(), risks, advice, adviceSource, forward: d.fwd.rows, weekendAvgPct: d.fwd.weekendAvgPct, weekdayAvgPct: d.fwd.weekdayAvgPct };
  cache = { at: Date.now(), data };
  return data;
}

function formatForChat(ins, { maxRisks = 6, maxAdvice = 5 } = {}) {
  const icon = { high: '🔴', medium: '🟠', low: '🟡' };
  const lines = ['⚠️ المخاطر:'];
  if (!ins.risks.length) lines.push('لا توجد مخاطر واضحة حالياً ✅');
  for (const r of ins.risks.slice(0, maxRisks)) lines.push(`${icon[r.level]} ${r.title}${r.detail ? ` — ${r.detail}` : ''}`);
  lines.push('', '💡 نصائح لزيادة الحجوزات:');
  ins.advice.slice(0, maxAdvice).forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  return lines.join('\n');
}

module.exports = { getInsights, detectRisks, formatForChat };
