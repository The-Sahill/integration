// tests/pricing.test.js — node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const pricing = require('../services/pricing');

const rule = {
  baseRate: 50,
  weekendRate: 65,
  weekendNights: [4, 5], // الخميس والجمعة
  seasons: [{ name: 'صيف', from: '07-01', to: '08-31', rate: 80 }],
  minRate: 40,
  maxDiscountPct: 15,
  concessionSteps: [5, 10, 15],
  alternatives: { extraNightDiscountPct: 30, earlyCheckIn: true, lateCheckOut: false },
};

test('سعر الليلة: عادي / نهاية أسبوع / موسم', () => {
  assert.strictEqual(pricing.nightlyRate(rule, '2026-10-19'), 50); // الإثنين
  assert.strictEqual(pricing.nightlyRate(rule, '2026-10-22'), 65); // الخميس
  assert.strictEqual(pricing.nightlyRate(rule, '2026-07-15'), 80); // موسم
});

test('موسم يلتف حول رأس السنة', () => {
  assert.ok(pricing.inSeason('12-31', '12-20', '01-05'));
  assert.ok(pricing.inSeason('01-02', '12-20', '01-05'));
  assert.ok(!pricing.inSeason('06-01', '12-20', '01-05'));
});

test('عرض السعر والحد الأدنى', () => {
  const q = pricing.quote(rule, '2026-10-22', '2026-10-24'); // خميس + جمعة
  assert.strictEqual(q.nights, 2);
  assert.strictEqual(q.listTotal, 130);
  // max(40*2=80, 130*0.85=110.5) => 111
  assert.strictEqual(q.floorTotal, 111);
});

test('التفاوض لا يعطي أقل سعر من أول مرة ولا ينزل تحت الحد الأدنى', () => {
  const q = pricing.quote(rule, '2026-10-22', '2026-10-24');
  let state = { listPrice: q.listTotal, floorPrice: q.floorTotal, currentOffer: q.listTotal, round: 0, nights: 2 };

  const r1 = pricing.negotiateRound(state, rule, 90);
  assert.strictEqual(r1.decision, 'counter');
  assert.strictEqual(r1.price, 124); // 5%
  state = { ...state, currentOffer: r1.price, round: r1.round };

  const r2 = pricing.negotiateRound(state, rule, 90);
  assert.strictEqual(r2.decision, 'counter');
  assert.strictEqual(r2.price, 117); // 10%
  state = { ...state, currentOffer: r2.price, round: r2.round };

  const r3 = pricing.negotiateRound(state, rule, 90);
  assert.ok(['counter', 'final_offer'].includes(r3.decision));
  assert.strictEqual(r3.price, 111); // الحد الأدنى
  state = { ...state, currentOffer: r3.price, round: r3.round };

  const r4 = pricing.negotiateRound(state, rule, 90);
  assert.strictEqual(r4.decision, 'below_floor');
  assert.ok(r4.price >= q.floorTotal);
});

test('قبول عرض العميل إذا كان بين الخطوة التالية والعرض الحالي', () => {
  const state = { listPrice: 130, floorPrice: 111, currentOffer: 130, round: 0, nights: 2 };
  const r = pricing.negotiateRound(state, rule, 126);
  assert.strictEqual(r.decision, 'accept');
  assert.strictEqual(r.price, 126);
});

test('العميل يوافق على السعر الحالي', () => {
  const state = { listPrice: 130, floorPrice: 111, currentOffer: 124, round: 1, nights: 2 };
  const r = pricing.negotiateRound(state, rule, 124);
  assert.strictEqual(r.decision, 'accept');
  assert.strictEqual(r.price, 124);
});

test('سيناريو التوثيق: 170 ← 162 ← 153 ← 145 ← تحت الحد', () => {
  const r = { ...rule, baseRate: 70, weekendRate: 85, minRate: 60 };
  const q = pricing.quote(r, '2026-10-22', '2026-10-24');
  assert.strictEqual(q.listTotal, 170);
  assert.strictEqual(q.floorTotal, 145);
  let st = { listPrice: 170, floorPrice: 145, currentOffer: 170, round: 0, nights: 2 };
  const seq = [[120, 'counter', 162], [140, 'counter', 153], [130, 'final_offer', 145], [120, 'below_floor', 145]];
  for (const [offer, decision, price] of seq) {
    const res = pricing.negotiateRound(st, r, offer);
    assert.strictEqual(res.decision, decision, `offer ${offer}`);
    assert.strictEqual(res.price, price, `offer ${offer}`);
    st = { ...st, currentOffer: res.price, round: res.round };
  }
  // عرض 150 بعد 153 يُقبل
  const acc = pricing.negotiateRound({ listPrice: 170, floorPrice: 145, currentOffer: 153, round: 2, nights: 2 }, r, 150);
  assert.strictEqual(acc.decision, 'accept');
  assert.strictEqual(acc.price, 150);
});
