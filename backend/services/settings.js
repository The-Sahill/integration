// services/settings.js — إعدادات قابلة للتعديل من اللوحة مع قيم افتراضية ونسخة في الذاكرة
const { Setting } = require('../models');

// معلومات المنشأة — نسخة مختصرة من prompt.js القديم (تم حل التناقضات: الروب متوفر، وطرق الدفع موحّدة)
const DEFAULT_PROPERTY_INFO = `The Sahill Stays — شقق فندقية عائلية هادئة قرب الدوار السابع في عمّان، موقع حيوي قريب من المولات والمستشفيات والمطاعم والمقاهي (لا تخترع مسافات).
أنواع الشقق:
- شقة غرفة نوم واحدة: غرفة نوم + صالة مستقلة + مطبخ كامل + حمام. بعضها بصوفة بيد واحدة وبعضها بصوفتين، وبعضها ببلكونة وبعضها بدون — لا تفترض.
- شقة غرفتي نوم: غرفتا نوم + صالة + مطبخ كامل + حمام + بلكونة. مناسبة للعائلات.
التجهيزات: غسالة، ثلاجة، ميكرويف، سخان، Wi-Fi (الباسورد على باركود خلف الباب الرئيسي أو من الاستقبال)، موقف سيارات مجاني غير مغطى بجانب المبنى.
المستلزمات: مناشف، شامبو، شاور جل، فرشاة أسنان، سليبر، ليفة، روب.
التدخين ممنوع داخل الشقق، ويوجد مكان/حديقة خارجية للتدخين.
الدخول 2:00 مساءً والخروج 12:00 ظهراً. الدخول المبكر/الخروج المتأخر حسب التوفر ولا يُؤكد مباشرة.`;

// طرق الدفع — كل طريقة تُفعّل/تُعطّل من الإعدادات. تعليمات الدفع للعميل تُبنى تلقائياً من المفعّل فقط
const DEFAULT_PAYMENT_METHODS = {
  cliq: { enabled: true, label: 'كليك (CliQ)', alias: 'sahill', beneficiary: 'AL RUKN ALAMIN', note: '' },
  bank: {
    enabled: true,
    label: 'تحويل بنكي',
    accounts: [
      { bankName: 'بنك الإسكان للتجارة والتمويل', accountName: 'ALRUKN ALAMIN', accountNumber: '0229133300101001', iban: 'JO26HBHO0440000229133300101001', swift: 'HBHOJOAXXXX', enabled: true },
    ],
  },
  // فيزا/ماستركارد عبر رابط دفع (زائر payment-checkouts أو أي بوابة مستقبلاً) — معطّل حتى تفعيله
  card: { enabled: false, label: 'فيزا / ماستركارد (رابط دفع)', provider: 'zaaer', note: 'يُرسل للعميل رابط دفع آمن' },
  cash: { enabled: true, label: 'كاش عند الوصول', note: 'يُقبل لتأكيد الحجز فقط بموافقة الاستقبال' },
};

// صلاحيات الأدوار — أسماء الأدوات المسموحة لكل دور (المدير له كل شيء)
const DEFAULT_ROLE_PERMISSIONS = {
  owner: ['*'],
  manager: ['*'],
  reception: [
    'check_availability', 'get_price_quote', 'list_unit_types', 'create_booking_in_zaer', 'cancel_booking',
    'get_booking_by_phone', 'create_guest_request', 'create_maintenance_ticket', 'update_ticket', 'list_open_tickets',
    'order_delivery', 'order_dry_clean', 'get_service_order_status', 'get_inventory', 'adjust_inventory', 'send_message_to_guest',
    'list_pending_payments', 'get_daily_report', 'modify_booking', 'check_in_guest', 'check_out_guest',
  ],
  finance: [
    'check_availability', 'get_booking_by_phone', 'confirm_payment', 'reject_payment', 'list_pending_payments',
    'get_daily_report', 'list_unit_types', 'create_payment_receipt', 'get_account_balances', 'get_analytics',
  ],
  maintenance: ['update_ticket', 'list_open_tickets', 'create_maintenance_ticket', 'get_inventory', 'adjust_inventory'],
  housekeeping: [
    'update_ticket', 'list_open_tickets', 'create_guest_request', 'get_inventory', 'adjust_inventory', 'order_dry_clean',
    'get_service_order_status',
  ],
  delivery: ['list_open_tickets', 'update_ticket', 'get_service_order_status'],
};

// توجيه التذاكر حسب التصنيف إلى الدور المختص
const DEFAULT_TICKET_ROUTING = {
  towels: 'housekeeping',
  cleaning: 'housekeeping',
  amenities: 'housekeeping',
  linen: 'housekeeping',
  plumbing: 'maintenance',
  electric: 'maintenance',
  ac: 'maintenance',
  appliance: 'maintenance',
  internet: 'maintenance',
  furniture: 'maintenance',
  checkin: 'reception',
  checkout: 'reception',
  other: 'reception',
};

const DEFAULTS = {
  propertyName: 'The Sahill Stays',
  propertyInfo: DEFAULT_PROPERTY_INFO,
  paymentMethods: DEFAULT_PAYMENT_METHODS,
  paymentFooter: 'وبعد الدفع أرسل صورة الإيصال هنا لنثبّت حجزك ✅',

  // الـ Prompt: فارغ = النص الافتراضي في prompts/system.js. يدعم {propertyName} {dialect} {propertyInfo} {paymentMethods} {staffName} {staffRole}
  guestPrompt: '',
  guestExtraRules: '', // تعليمات إضافية تُلحق بالـ prompt الافتراضي بدون استبداله
  staffPrompt: '',
  staffExtraRules: '',

  // التحليلات والمخاطر
  insightsEnabled: true,
  weeklyInsightsDay: 0, // 0=الأحد — يوم إرسال تقرير المخاطر والنصائح للمالك والمدير
  lastWeeklyInsights: '',
  lowOccupancyThreshold: 40, // % — أقل منه يُعتبر خطر إشغال منخفض في الأيام القادمة
  dialect: 'لهجة أردنية مهذبة وبسيطة، وبالإنجليزية إذا كتب العميل بالإنجليزية',
  supportPhone: '00962791772424',
  totalUnits: 20,

  // المحادثة
  debounceSeconds: 4,
  historyMessages: 18,
  summaryEvery: 20, // حدّث الملخص كل 20 رسالة جديدة
  voiceReplyEnabled: false, // الرد بصوت عندما يرسل العميل صوتاً (يتطلب ffmpeg)

  // التسعير الذكي: هامش التفاوض حسب إشغال المنشأة للتواريخ المطلوبة ومدة الإقامة (السعر الأول دائماً الأعلى)
  dynamicPricing: {
    enabled: true,
    occupancyBands: [ // من الأعلى: إشغال ≥ minOcc% ← أقصى خصم
      { minOcc: 85, maxDiscountPct: 0 },
      { minOcc: 65, maxDiscountPct: 5 },
      { minOcc: 40, maxDiscountPct: 10 },
      { minOcc: 0, maxDiscountPct: 15 },
    ],
    lengthBands: [ // خصم إضافي حسب عدد الليالي
      { minNights: 28, extraPct: 15 },
      { minNights: 7, extraPct: 7 },
      { minNights: 3, extraPct: 3 },
      { minNights: 1, extraPct: 0 },
    ],
    oneNightMaxPct: 0, // ليلة واحدة = أعلى سعر
    maxTotalPct: 30,
  },

  // الحجز والمتابعة (بالدقائق)
  holdMinutes: 120,
  followUp1Minutes: 60,
  followUp2Minutes: 24 * 60,
  closeAfterMinutes: 48 * 60,
  followUpText1: 'أهلاً {name} 👋 حابب أذكرك بعرضنا لإقامتك من {checkIn} إلى {checkOut}. هل تحب أثبّت لك الحجز؟',
  followUpText2: 'مرحبا {name}، ما زالت الشقة متاحة حالياً لتواريخك. إذا عندك أي سؤال أنا جاهز 🌿',

  // التذاكر (بالدقائق)
  ticketAckMinutes: 10,
  ticketEscalateMinutes: 25,
  ticketMaxReminders: 2,

  // التقرير اليومي
  dailyReportHour: 8,
  lastDailyReport: '',

  // أسماء قوالب Meta المعتمدة (يجب أن تطابق ما اعتمدته في WhatsApp Manager)
  templates: {
    followUp: 'guest_followup',
    holdExpired: 'hold_expired',
    bookingConfirmed: 'booking_confirmed',
    paymentReminder: 'payment_reminder',
    requestFeedback: 'request_feedback',
    staffAlert: 'staff_alert',
    staffTask: 'staff_task',
    staffDecision: 'staff_decision',
    dailyReport: 'daily_report',
  },

  rolePermissions: DEFAULT_ROLE_PERMISSIONS,
  ticketRouting: DEFAULT_TICKET_ROUTING,
};

let cache = null;

async function load() {
  const docs = await Setting.find().lean();
  const stored = Object.fromEntries(docs.map((d) => [d.key, d.value]));
  cache = {
    ...DEFAULTS,
    ...stored,
    templates: { ...DEFAULTS.templates, ...(stored.templates || {}) },
    paymentMethods: { ...DEFAULTS.paymentMethods, ...(stored.paymentMethods || {}) },
    rolePermissions: { ...DEFAULTS.rolePermissions, ...(stored.rolePermissions || {}) },
  };
  return cache;
}

function all() {
  return cache || { ...DEFAULTS };
}

function get(key) {
  return all()[key];
}

async function set(key, value) {
  await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
  if (!cache) await load();
  cache[key] = value;
  return value;
}

async function setMany(obj) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (!(k in DEFAULTS)) continue; // لا نقبل مفاتيح غير معروفة
    await set(k, v);
  }
  return all();
}

/** طرق الدفع المفعّلة كنص يُرسل للعميل بعد الحجز المبدئي */
function paymentInstructions({ includeCard = false } = {}) {
  const m = get('paymentMethods') || {};
  const lines = ['لتثبيت الحجز يمكنك الدفع عبر:'];
  if (m.cliq?.enabled) lines.push(`• ${m.cliq.label}: ${m.cliq.alias} — اسم المستفيد: ${m.cliq.beneficiary}${m.cliq.note ? ` (${m.cliq.note})` : ''}`);
  if (m.bank?.enabled) {
    for (const a of (m.bank.accounts || []).filter((x) => x.enabled !== false)) {
      lines.push(`• ${m.bank.label} — ${a.bankName}\n  اسم الحساب: ${a.accountName}\n  رقم الحساب: ${a.accountNumber}${a.iban ? `\n  IBAN: ${a.iban}` : ''}${a.swift ? ` — SWIFT: ${a.swift}` : ''}`);
    }
  }
  if (m.card?.enabled && includeCard) lines.push(`• ${m.card.label}: ${m.card.note || 'نرسل لك رابط دفع آمن عند الطلب'}`);
  if (m.cash?.enabled) lines.push(`• ${m.cash.label}${m.cash.note ? ` (${m.cash.note})` : ''}`);
  lines.push(get('paymentFooter') || '');
  return lines.filter(Boolean).join('\n');
}

/** الدفع بالبطاقة متاح فقط إذا فُعّل من الإعدادات ومُعدّ تقنياً في .env */
function cardAvailable() {
  const config = require('../config');
  return !!(get('paymentMethods')?.card?.enabled && config.zaaer.checkoutEnabled);
}

/** أسماء الطرق المفعّلة (لإدراجها في الـ prompt) */
function enabledPaymentLabels() {
  const m = get('paymentMethods') || {};
  return Object.values(m).filter((x) => x?.enabled).map((x) => x.label).join('، ');
}

module.exports = { load, all, get, set, setMany, paymentInstructions, enabledPaymentLabels, cardAvailable, DEFAULTS };
