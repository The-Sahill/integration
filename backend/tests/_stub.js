// tests/_stub.js — يسمح باختبار الدوال النقية في ملفات تستورد قاعدة البيانات/الشبكة (بدون MongoDB)
const Module = require('module');
const STUB = new Set(['mongoose', 'axios', '@google/genai', 'socket.io', 'jsonwebtoken', 'express', 'cors', 'dotenv']);
function stub() {
  const fn = function () {};
  return new Proxy(fn, {
    get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()),
    apply: () => stub(),
    construct: () => stub(),
  });
}
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (STUB.has(req)) {
    try {
      return orig.call(this, req, ...rest); // استخدم المكتبة الحقيقية إن كانت مثبتة
    } catch {
      return stub();
    }
  }
  return orig.call(this, req, ...rest);
};
