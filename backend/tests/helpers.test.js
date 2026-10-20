const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const h = require('../utils/helpers');

test('توحيد أرقام الهواتف', () => {
  assert.strictEqual(h.normalizePhone('0791234567'), '962791234567');
  assert.strictEqual(h.normalizePhone('+962 79 123 4567'), '962791234567');
  assert.strictEqual(h.normalizePhone('00962791234567'), '962791234567');
  assert.strictEqual(h.normalizePhone('791234567'), '962791234567');
});

test('توقيع Meta', () => {
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
  assert.ok(h.verifyMetaSignature(body, sig, 's3cret'));
  assert.ok(!h.verifyMetaSignature(body, 'sha256=bad', 's3cret'));
});

test('توقيع زائر', () => {
  const body = '{"result":{"status":"paid"}}';
  const ts = '1760000000';
  const sig = crypto.createHmac('sha256', 'whsec').update(`${ts}.${body}`).digest('hex');
  assert.ok(h.verifyZaaerSignature(body, ts, sig, 'whsec'));
  assert.ok(!h.verifyZaaerSignature(body, ts, sig, 'other'));
});

test('الليالي بين تاريخين', () => {
  assert.deepStrictEqual(h.nightsBetween('2026-10-22', '2026-10-24'), ['2026-10-22', '2026-10-23']);
  assert.deepStrictEqual(h.nightsBetween('2026-10-24', '2026-10-22'), []);
});

test('كلمات المرور', () => {
  const stored = h.hashPassword('abc123');
  assert.ok(h.checkPassword('abc123', stored));
  assert.ok(!h.checkPassword('wrong', stored));
});

test('تنسيق واتساب: عريض وجداول Markdown', () => {
  const { waFormat } = require('../services/whatsapp');
  assert.strictEqual(waFormat('السعر **152 دينار**'), 'السعر *152 دينار*');
  const t = waFormat('مقارنة:\n\n| المؤشر | الحالي | السابق |\n| :--- | :---: | :---: |\n| **الإشغال** | 47% | 76% |');
  assert.strictEqual(t, 'مقارنة:\n\n• المؤشر — الحالي — السابق\n• *الإشغال* — 47% — 76%');
});
