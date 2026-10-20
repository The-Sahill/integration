// scripts/doctor.js — فحص كل الاتصالات قبل التشغيل: node scripts/doctor.js
const config = require('../config');
const axios = require('axios');

const ok = (m) => console.log(`✅ ${m}`);
const bad = (m, hint) => console.log(`❌ ${m}${hint ? `\n   ↳ ${hint}` : ''}`);
const warn = (m) => console.log(`⚠️  ${m}`);
const msg = (e) => JSON.stringify(e.response?.data?.error || e.response?.data || e.message).slice(0, 300);

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    bad(`${name}: ${msg(e)}`);
  }
}

(async () => {
  console.log('\n🩺 فحص إعدادات The Sahill Stays\n');

  // .env منطقية
  if (!config.auth.jwtSecret || /ضع|change-me/.test(config.auth.jwtSecret)) warn('JWT_SECRET ما زال افتراضياً — ضع نصاً عشوائياً طويلاً');
  if (/zaaer\.com/.test(config.publicUrl) || /example\.com|localhost/.test(config.publicUrl)) warn(`PUBLIC_URL=${config.publicUrl} — يجب أن يكون رابط سيرفرك العام (ngrok أو Render)، وليس رابط زائر`);
  if (config.whatsapp.appSecret && !/^[a-f0-9]{32}$/i.test(config.whatsapp.appSecret)) bad('META_APP_SECRET لا يبدو App Secret حقيقياً (32 حرفاً hex)', 'كل رسائل واتساب ستُرفض بـ 401. ضع القيمة من Meta → App settings → Basic → App secret، أو اتركه فارغاً للتجربة');
  if (!config.whatsapp.appSecret) warn('META_APP_SECRET فارغ — التحقق من التوقيع معطّل (مقبول للتجربة فقط)');

  await step('MongoDB', async () => {
    const mongoose = require('mongoose');
    await mongoose.connect(config.mongoUrl, { family: 4, serverSelectionTimeoutMS: 15000 });
    const users = await mongoose.connection.db.collection('users').countDocuments();
    ok(`MongoDB متصل (قاعدة: ${mongoose.connection.name}، مستخدمو اللوحة: ${users})`);
    await mongoose.disconnect();
  });

  await step('WhatsApp', async () => {
    const r = await axios.get(`https://graph.facebook.com/${config.whatsapp.graphVersion}/${config.whatsapp.phoneNumberId}`, {
      params: { fields: 'display_phone_number,verified_name,quality_rating' },
      headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` }, timeout: 15000,
    });
    ok(`WhatsApp: ${r.data.verified_name} (${r.data.display_phone_number}) — الجودة ${r.data.quality_rating || '-'}`);
    const t = await axios.get(`https://graph.facebook.com/${config.whatsapp.graphVersion}/debug_token`, {
      params: { input_token: config.whatsapp.accessToken }, headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` }, timeout: 15000,
    }).catch(() => null);
    const exp = t?.data?.data?.expires_at;
    if (exp === 0) ok('توكن واتساب دائم');
    else if (exp) warn(`توكن واتساب مؤقت ينتهي ${new Date(exp * 1000).toLocaleString('ar-EG')} — أنشئ توكناً دائماً من System User`);
  });

  await step('Gemini', async () => {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    for (const model of [config.gemini.model, config.gemini.fallbackModel].filter(Boolean)) {
      try {
        const r = await ai.models.generateContent({ model, contents: 'قل: تمام' });
        ok(`Gemini ${model}: ${String(r.text || '').trim().slice(0, 30)}`);
      } catch (e) {
        bad(`Gemini ${model}: ${String(e.message).slice(0, 200)}`, /API key|401|403|PERMISSION/i.test(e.message) ? 'المفتاح غير صالح — أنشئ مفتاحاً من aistudio.google.com/apikey (يبدأ عادة بـ AIza)' : /not found|404/i.test(e.message) ? `اسم النموذج غير متاح لحسابك — غيّر ${model === config.gemini.model ? 'GEMINI_MODEL' : 'GEMINI_FALLBACK_MODEL'}` : '');
      }
    }
  });

  await step('زائر', async () => {
    const r = await axios.get(`${config.zaaer.baseUrl}/properties`, { headers: { Authorization: `Bearer ${config.zaaer.token}`, Accept: 'application/json' }, timeout: 15000 });
    const items = r.data?.result?.items || r.data?.items || r.data?.data || [];
    ok(`زائر متصل (${Array.isArray(items) ? items.length : '?'} عقار)`);
    for (const [name, ep] of Object.entries(config.zaaer.endpoints)) {
      if (ep.path) warn(`نقطة زائر "${name}" مضبوطة على ${ep.method} ${ep.path} — تأكد أنها من توثيق زائر (إن لم توجد سيُرسل تنبيه يدوي تلقائياً)`);
    }
  });

  if (config.dryClean.apiUrl) {
    await step('الدراي كلين', async () => {
      const r = await axios.post(`${config.dryClean.apiUrl}/login`, { name: config.dryClean.username, password: config.dryClean.password }, { timeout: 60000 });
      if (r.data?.error) throw new Error(r.data.message);
      ok(`برنامج الدراي كلين: تسجيل الدخول ناجح (${config.dryClean.username})`);
    });
  }

  if (/^https:\/\//.test(config.publicUrl) && !/zaaer\.com|example\.com/.test(config.publicUrl)) {
    await step('رابط الـ webhook العام', async () => {
      const r = await axios.get(`${config.publicUrl.replace(/\/$/, '')}/webhook`, {
        params: { 'hub.mode': 'subscribe', 'hub.verify_token': config.whatsapp.verifyToken, 'hub.challenge': 'ping123' }, timeout: 20000,
      });
      if (String(r.data) === 'ping123') ok(`الـ webhook يستجيب: ${config.publicUrl}/webhook`);
      else bad('الـ webhook رد بشيء غير متوقع');
    });
  }

  console.log('\nانتهى الفحص.\n');
  process.exit(0);
})();
