// services/finance.js — الأرصدة والتحصيل حسب طريقة الدفع + المستحقات من زائر
const { Payment } = require('../models');
const analytics = require('./analytics');
const config = require('../config');
const { todayISO, addDaysISO } = require('../utils/helpers');

const METHOD_AR = { cliq: 'كليك', bank: 'تحويل بنكي', cash: 'كاش', card: 'فيزا/بطاقة', other: 'أخرى' };

/** تحويل ما قرأه Gemini من الإيصال إلى قناة دفع */
function methodFromText(t = '') {
  const s = String(t).toLowerCase();
  if (/cliq|كليك|click/.test(s)) return 'cliq';
  if (/bank|transfer|تحويل|بنك|iban/.test(s)) return 'bank';
  if (/card|visa|master|فيزا|بطاقة/.test(s)) return 'card';
  if (/cash|كاش|نقد/.test(s)) return 'cash';
  return 'other';
}

async function collectedBetween(from, to) {
  const rows = await Payment.aggregate([
    { $match: { status: { $in: ['confirmed', 'paid'] }, updatedAt: { $gte: from, $lt: to } } },
    { $group: { _id: '$paymentMethod', total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  const byMethod = Object.fromEntries(rows.map((r) => [r._id || 'other', { total: Math.round(r.total || 0), count: r.count }]));
  return { total: rows.reduce((s, r) => s + (r.total || 0), 0), byMethod };
}

/** ملخص الأرصدة: المحصّل (اليوم/الأسبوع/الشهر/السنة) حسب الطريقة + المستحقات على الحجوزات */
async function balances() {
  const today = todayISO(config.timezone);
  const ranges = {
    اليوم: analytics.periodRange('day'),
    'هذا الأسبوع': analytics.periodRange('week'),
    'هذا الشهر': analytics.periodRange('month'),
    'هذه السنة': analytics.periodRange('year'),
  };
  const collected = {};
  for (const [label, r] of Object.entries(ranges)) {
    collected[label] = await collectedBetween(new Date(r.start + 'T00:00:00Z'), new Date(r.end + 'T00:00:00Z'));
  }
  let receivables = null;
  try {
    const res = (await analytics.loadReservations()).filter((r) => !r.cancelled && r.checkOut >= today);
    receivables = {
      total: Math.round(res.reduce((s, r) => s + r.balance, 0)),
      inHouse: Math.round(res.filter((r) => r.checkIn <= today).reduce((s, r) => s + r.balance, 0)),
      next7Days: Math.round(res.filter((r) => r.checkIn > today && r.checkIn <= addDaysISO(today, 7)).reduce((s, r) => s + r.balance, 0)),
      reservationsWithBalance: res.filter((r) => r.balance > 0).length,
    };
  } catch {
    receivables = null;
  }
  // أرصدة حسابات زائر (صندوق/بنك) — تُضاف عند توفر توثيق النقطة
  let zaaerAccounts = null;
  try {
    zaaerAccounts = await require('./zaaer').getAccountBalances?.();
  } catch {
    zaaerAccounts = null;
  }
  return { currency: config.zaaer.currency, collected, receivables, zaaerAccounts };
}

function formatForChat(b) {
  const lines = ['💰 الأرصدة والتحصيل'];
  for (const [label, c] of Object.entries(b.collected)) {
    const parts = Object.entries(c.byMethod).map(([m, v]) => `${METHOD_AR[m] || m} ${v.total}`);
    lines.push(`• ${label}: ${Math.round(c.total)} ${b.currency}${parts.length ? ` (${parts.join('، ')})` : ''}`);
  }
  if (b.receivables) lines.push(`• مستحقات على الحجوزات: ${b.receivables.total} (نزلاء حاليون ${b.receivables.inHouse}، وصول 7 أيام ${b.receivables.next7Days})`);
  if (Array.isArray(b.zaaerAccounts)) for (const a of b.zaaerAccounts) lines.push(`• ${a.name}: ${a.balance}`);
  return lines.join('\n');
}

module.exports = { balances, formatForChat, methodFromText, METHOD_AR };
