require('./_stub');
const test = require('node:test');
const assert = require('node:assert');
const analytics = require('../services/analytics');
const bookings = require('../services/bookings');
const insights = require('../services/insights');

test('حدود الفترات: يوم/أسبوع (يبدأ السبت)/شهر/سنة', () => {
  const ref = '2026-10-19'; // الإثنين
  assert.deepStrictEqual(analytics.periodRange('day', 0, ref).start, '2026-10-19');
  const w = analytics.periodRange('week', 0, ref);
  assert.strictEqual(w.start, '2026-10-17'); // السبت
  assert.strictEqual(w.days, 7);
  assert.strictEqual(analytics.periodRange('week', -1, ref).start, '2026-10-10');
  const m = analytics.periodRange('month', -1, ref);
  assert.strictEqual(m.start, '2026-09-01');
  assert.strictEqual(m.end, '2026-10-01');
  assert.strictEqual(analytics.periodRange('year', 0, ref).days, 365);
});

test('توحيد حجز زائر بأسماء حقول مختلفة', () => {
  const r = analytics.normalizeReservation({ id: 7, status: 'Cancelled', check_in_date: '2026-10-22', check_out_date: '2026-10-24', totals: { total: 170 }, paid_amount: 50 });
  assert.strictEqual(r.nights, 2);
  assert.strictEqual(r.cancelled, true);
  assert.strictEqual(r.balance, 120);
  assert.strictEqual(r.perNight, 85);
});

test('توزيع السعر المتفق على الليالي يحافظ على المجموع والشكل', () => {
  const rates = [{ date: '2026-10-22', amount: 85, rate_plan: 'x' }, { date: '2026-10-23', amount: '85' }, { date: '2026-10-24', amount: 85 }];
  const out = bookings.spreadDailyRates(rates, 200, 3);
  assert.strictEqual(out[0].rate_plan, 'x');
  const sum = out.reduce((s, d) => s + Number(d.amount), 0);
  assert.ok(Math.abs(sum - 200) < 0.01);
});

test('بيانات زائر: بدون وصل مالي عند الحجز المبدئي ونفس booking_id للإلغاء', () => {
  const b = { ref: 'B-TEST01', checkIn: '2026-10-22', checkOut: '2026-10-24', currency: 'JOD', guestName: 'أحمد', phone: '962790000000', unitTypeId: 3, ratePlanId: null, agreedPrice: 150, adults: 2, children: 0, nights: 2 };
  const p = bookings.buildZaaerPayload(b, [], 'new');
  assert.strictEqual(p.booking_id, 'B-TEST01');
  assert.strictEqual(p.booking_payment_method, 'pay_at_hotel');
  assert.strictEqual(p.totals.total, 150);
  assert.strictEqual(bookings.buildZaaerPayload(b, [], 'cancelled').status, 'cancelled');
});

test('كشف المخاطر: إشغال منخفض ومستحقات وحجز فاشل', () => {
  const cmp = { rows: [{ key: 'newBookings', current: 2, previous: 10, changePct: -80 }, { key: 'cancellationPct', current: 20 }, { key: 'adr', current: 50, previous: 60, changePct: -16.7 }] };
  const risks = insights.detectRisks({
    weekCmp: cmp, monthCmp: cmp,
    fwd: { rows: [{ days: 7, occupancyPct: 20, emptyNights: 50, lastYearPct: 0 }, { days: 30, occupancyPct: 30, emptyNights: 200, lastYearPct: 55 }], weekendAvgPct: 80, weekdayAvgPct: 20, gaps: [], arrivalsWithBalance: [{ guest: 'x', balance: 50 }], units: 10, hasBookingDates: true },
    failed: 1, awaiting: [], oldReceipts: 0, lowStock: [], faults: [], urgent: 0, avgDiscount: 12,
  });
  const titles = risks.map((r) => r.title).join(' | ');
  assert.strictEqual(risks[0].level, 'high');
  assert.match(titles, /السبعة القادمة/);
  assert.match(titles, /فشل إدخاله/);
  assert.match(titles, /وتيرة الحجز/);
  assert.match(titles, /نسبة الإلغاء/);
});

test('توحيد حجز زائر بالصيغة الفعلية لـ GET /reservations', () => {
  const r = analytics.normalizeReservation({
    id: 5148, number: 'REV2026125', reservation_status: 'checked_in', booking_id: null, check_in_date: '2026-10-20', check_out_date: '2026-10-22',
    guest: { name: 'x', phone: '+962790000000' }, rooms: [{ unit_type_id: 5, unit_id: 13 }, { unit_type_id: 5, unit_id: 14 }],
    finance: { total: 160, paid: 40, balance_due: 120 }, booking_source: 'walkin',
  });
  assert.strictEqual(r.id, 'REV2026125');
  assert.strictEqual(r.total, 160);
  assert.strictEqual(r.paid, 40);
  assert.strictEqual(r.balance, 120);
  assert.strictEqual(r.checkedIn, true);
  assert.strictEqual(r.cancelled, false);
  assert.strictEqual(r.rooms, 2);
  assert.strictEqual(r.source, 'walkin');
});

test('توزيع السعر على daily_rates بصيغة quote زائر (كل حقول المبلغ متطابقة)', () => {
  const rates = [
    { date: '2026-10-29', unit_price: 70, discount_amount: 0, final_price: 70, subtotal: 70, lodging_fees: 0, vat: 0, tax_amount: 0, final_amount: 70 },
    { date: '2026-10-30', unit_price: 90, discount_amount: 0, final_price: 90, subtotal: 90, lodging_fees: 0, vat: 0, tax_amount: 0, final_amount: 90 },
  ];
  const out = bookings.spreadDailyRates(rates, 136, 2);
  for (const d of out) {
    assert.strictEqual(d.unit_price, 68);
    assert.strictEqual(d.final_price, 68);
    assert.strictEqual(d.subtotal, 68);
    assert.strictEqual(d.final_amount, 68);
    assert.strictEqual(d.discount_amount, 0);
  }
  assert.strictEqual(out[0].date, '2026-10-29');
});
