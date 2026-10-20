// config.js — كل الإعدادات تُقرأ من .env في مكان واحد
require('dotenv').config();
const { normalizePhone } = require('./utils/helpers');

const env = (key, def = undefined) => {
  const v = process.env[key];
  return v === undefined || v === '' ? def : v;
};
const num = (key, def) => {
  const v = Number(env(key));
  return Number.isFinite(v) ? v : def;
};
const bool = (key, def = false) => {
  const v = env(key);
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const config = {
  port: num('PORT', 4000),
  publicUrl: env('PUBLIC_URL', 'http://localhost:4000'), // رابط السيرفر العام (لـ webhook زائر)
  mongoUrl: env('MONGODB_URL', env('MongoDB_URL')),
  timezone: env('TZ_NAME', 'Asia/Amman'),
  defaultCountryCode: env('DEFAULT_COUNTRY_CODE', '962'),
  corsOrigins: env('CORS_ORIGINS', 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),

  auth: {
    jwtSecret: env('JWT_SECRET', 'change-me'),
    adminUsername: env('ADMIN_USERNAME', 'admin'),
    adminPassword: env('ADMIN_PASSWORD', 'admin123'),
  },

  whatsapp: {
    graphVersion: env('GRAPH_API_VERSION', 'v23.0'),
    phoneNumberId: env('PHONE_NUMBER_ID'),
    accessToken: env('ACCESS_TOKEN'),
    verifyToken: env('VERIFY_TOKEN'),
    appSecret: env('META_APP_SECRET'), // للتحقق من X-Hub-Signature-256
    templateLang: env('WA_TEMPLATE_LANG', 'ar'),
    // للاختبار فقط: أرقام يُسمح بالإرسال الفعلي لها (مفصولة بفواصل). فارغ = الإرسال للجميع
    sendOnlyTo: env('WA_SEND_ONLY_TO', '').split(',').map((s) => normalizePhone(s.trim(), env('DEFAULT_COUNTRY_CODE', '962'))).filter(Boolean),
  },

  gemini: {
    apiKey: env('GEMINI_API_KEY'),
    model: env('GEMINI_MODEL', 'gemini-3.6-flash'),
    thinkingLevel: env('GEMINI_THINKING_LEVEL', ''), // مثال: low — اتركه فارغاً لاستخدام الافتراضي
    // نموذج احتياطي عند تعطل النموذج الأساسي (اختياري)، مثال: gemini-3.8-flash
    fallbackModel: env('GEMINI_FALLBACK_MODEL', ''),
    ttsModel: env('GEMINI_TTS_MODEL', 'gemini-2.5-flash-preview-tts'),
    ttsVoice: env('GEMINI_TTS_VOICE', 'Kore'),
  },

  zaaer: {
    baseUrl: env('ZAAER_BASE_URL', 'https://sahl-suites.zaaer.com/api/v1'),
    token: env('ZAAER_API_TOKEN'),
    propertyId: num('ZAAER_PROPERTY_ID', 1),
    currency: env('ZAAER_CURRENCY', 'JOD'),
    // نقاط غير موثّقة لدينا بعد — تُضبط عند معرفتها. {id}=رقم الحجز في زائر، {booking_id}=رقمنا
    endpoints: {
      receipt: { method: env('ZAAER_RECEIPT_METHOD', ''), path: env('ZAAER_RECEIPT_PATH', '') },
      checkin: { method: env('ZAAER_CHECKIN_METHOD', ''), path: env('ZAAER_CHECKIN_PATH', '') },
      checkout: { method: env('ZAAER_CHECKOUT_GUEST_METHOD', ''), path: env('ZAAER_CHECKOUT_GUEST_PATH', '') },
      balances: { method: env('ZAAER_BALANCES_METHOD', 'get'), path: env('ZAAER_BALANCES_PATH', '') },
    },
    // إنشاء الحجز في زائر فوراً عند الحجز المبدئي (بدون وصل مالي) ثم إلغاؤه إن لم يُدفع
    holdInZaaer: bool('ZAAER_HOLD_IN_ZAAER', true),
    paymentReturnUrl: env('ZAAER_PAYMENT_RETURN_URL', ''),
    checkoutEnabled: bool('ZAAER_CHECKOUT_ENABLED', false),
    checkoutPath: env('ZAAER_CHECKOUT_PATH', '/payment-checkouts'),
    cacheSeconds: num('ZAAER_CACHE_SECONDS', 120),
  },

  dryClean: {
    apiUrl: env('DRYCLEAN_API_URL', ''),
    username: env('DRYCLEAN_API_USER', ''),
    password: env('DRYCLEAN_API_PASSWORD', ''),
    whatsappFallback: env('DRYCLEAN_WHATSAPP', ''),
  },

  delivery: {
    mode: env('DELIVERY_MODE', 'whatsapp'), // whatsapp | http
    apiUrl: env('DELIVERY_API_URL', ''),
    apiKey: env('DELIVERY_API_KEY', ''),
    whatsapp: env('DELIVERY_WHATSAPP', ''),
  },

  bootstrap: {
    managerPhone: env('MANAGER_PHONE', ''),
    managerName: env('MANAGER_NAME', 'المدير'),
  },
};

module.exports = config;
