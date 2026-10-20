// services/tools.js — أدوات Gemini (Function Declarations) + الصلاحيات + التنفيذ + التأكيد قبل التغيير
const config = require('../config');
const settings = require('./settings');
const bookings = require('./bookings');
const payments = require('./payments');
const tickets = require('./tickets');
const inventory = require('./inventory');
const serviceOrders = require('./serviceOrders');
const approvals = require('./approvals');
const zaaer = require('./zaaer');
const messenger = require('./messenger');
const audit = require('./audit');
const reports = require('./reports');
const { Conversation, Ticket, Payment, Booking, PricingRule } = require('../models');
const { normalizePhone } = require('../utils/helpers');
const { ITEM_KEYS } = require('../adapters/dryClean');

const S = (description, extra = {}) => ({ type: 'STRING', description, ...extra });
const N = (description) => ({ type: 'NUMBER', description });
const I = (description) => ({ type: 'INTEGER', description });
const obj = (properties, required = []) => ({ type: 'OBJECT', properties, required });

const DATE = 'YYYY-MM-DD';
const TICKET_CATEGORIES = ['towels', 'cleaning', 'amenities', 'linen', 'plumbing', 'electric', 'ac', 'appliance', 'internet', 'furniture', 'checkin', 'checkout', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

// ------------------------------------------------------------------
// التعريفات
// ------------------------------------------------------------------
const DECLARATIONS = {
  list_unit_types: {
    description: 'قائمة أنواع الوحدات المتاحة في المنشأة (المعرف، الاسم، الوصف). استخدمها لمعرفة unit_id.',
    parameters: obj({}),
  },
  check_availability: {
    description: 'الشواغر والأسعار للتواريخ المطلوبة فقط. استدعِها فقط بعد معرفة تاريخي الوصول والمغادرة.',
    parameters: obj(
      { check_in: S(DATE), check_out: S(DATE), adults: I('عدد البالغين'), children: I('عدد الأطفال'), unit_id: S('اختياري: نوع وحدة محدد') },
      ['check_in', 'check_out']
    ),
  },
  get_price_quote: {
    description: 'عرض سعر رسمي لنوع وحدة وتواريخ محددة (يفتح سجل التفاوض). اعرض السعر كما هو بدون تعديل.',
    parameters: obj({ unit_id: S('معرف نوع الوحدة'), check_in: S(DATE), check_out: S(DATE), adults: I(''), children: I('') }, ['unit_id', 'check_in', 'check_out']),
  },
  negotiate_price: {
    description: 'عند طلب العميل خصماً أو عرضه سعراً أقل. الكود يحسب الرد (قبول/عرض مقابل/آخر سعر/تحت الحد). لا تخترع أي سعر غير الذي تُرجعه هذه الأداة.',
    parameters: obj({ customer_offer: N('المبلغ الإجمالي الذي يعرضه العميل، أو 0 إن طلب خصماً بدون رقم'), unit_id: S('اختياري'), check_in: S('اختياري'), check_out: S('اختياري') }, ['customer_offer']),
  },
  request_manager_approval: {
    description: 'رفع طلب سعر أقل من الحد الأدنى للمدير بعد أن تُرجع negotiate_price الحالة below_floor وبعد موافقة العميل على الانتظار.',
    parameters: obj({ requested_price: N('السعر الإجمالي الذي يطلبه العميل'), note: S('سبب/ملاحظة') }, ['requested_price']),
  },
  save_guest_details: {
    description: 'حفظ ما عرفته عن العميل في حالة المحادثة (الاسم، رقم الغرفة إن كان نزيلاً، التواريخ، العدد).',
    parameters: obj({ name: S('الاسم الكامل'), room_number: S('رقم الغرفة/الشقة إن كان مقيماً'), check_in: S(DATE), check_out: S(DATE), adults: I(''), children: I('') }),
  },
  create_hold: {
    description: 'إنشاء حجز مبدئي بعد موافقة العميل على السعر وتوفر الاسم الكامل. يُرجع تعليمات الدفع. الحجز ليس مؤكداً حتى يُدفع.',
    parameters: obj({ guest_name: S('الاسم الكامل للنزيل'), unit_id: S('اختياري إن سبق عرض السعر'), check_in: S(DATE), check_out: S(DATE), adults: I(''), children: I('') }, ['guest_name']),
  },
  send_payment_link: {
    description: 'إنشاء رابط دفع بالبطاقة للحجز المبدئي النشط (إن رغب العميل بالدفع بالبطاقة).',
    parameters: obj({}),
  },
  get_booking_by_phone: {
    description: 'جلب حجوزات عميل من زائر والحجوزات المحلية. للنزيل: رقمه فقط. للموظف: أي رقم أو اسم.',
    parameters: obj({ phone_or_name: S('للموظف فقط: رقم أو اسم أو رقم حجز') }),
  },
  cancel_booking: {
    description: 'إلغاء حجز. للنزيل: يلغي حجزه المبدئي غير المدفوع فقط؛ الحجز المؤكد يُحوَّل للموظف. للموظف: أي حجز برقمه.',
    parameters: obj({ booking_ref: S('رقم الحجز (B-xxxx أو رقم زائر)'), reason: S('السبب') }),
  },
  create_guest_request: {
    description: 'طلب خدمة من نزيل مقيم (مناشف، تنظيف، مستلزمات...). يُنشئ تذكرة ويحوّلها للموظف المختص.',
    parameters: obj(
      { category: S('التصنيف', { enum: TICKET_CATEGORIES }), description: S('تفاصيل الطلب'), room_number: S('رقم الغرفة'), priority: S('', { enum: PRIORITIES }) },
      ['category', 'description']
    ),
  },
  create_maintenance_ticket: {
    description: 'بلاغ عطل/صيانة. يُرفق تلقائياً آخر صور أرسلها المرسل.',
    parameters: obj(
      { category: S('التصنيف', { enum: TICKET_CATEGORIES }), description: S('وصف العطل'), room_number: S('رقم الغرفة'), priority: S('urgent للتسريب/الكهرباء/الأمان', { enum: PRIORITIES }) },
      ['category', 'description']
    ),
  },
  update_ticket: {
    description: 'تحديث تذكرة برقمها: استلام، إنجاز، تحويل لموظف آخر، إضافة ملاحظة، إلغاء.',
    parameters: obj(
      { ticket_number: I('رقم التذكرة'), status: S('', { enum: ['acknowledged', 'done', 'cancelled', 'closed'] }), note: S(''), assign_to_phone: S('رقم الموظف الجديد'), priority: S('', { enum: PRIORITIES }) },
      ['ticket_number']
    ),
  },
  list_open_tickets: {
    description: 'التذاكر المفتوحة (للموظف: تذاكره، وللمدير: الكل).',
    parameters: obj({ kind: S('', { enum: ['request', 'maintenance', 'all'] }) }),
  },
  order_delivery: {
    description: 'طلب توصيل (أكل، أغراض من الخارج...) لغرفة.',
    parameters: obj({ details: S('ماذا يريد بالتفصيل ومن أين'), room_number: S('رقم الغرفة') }, ['details']),
  },
  order_dry_clean: {
    description: 'طلب دراي كلين/غسيل لغرفة.',
    parameters: obj(
      {
        room_number: S('رقم الغرفة'),
        items: obj(Object.fromEntries(Object.entries(ITEM_KEYS).map(([k, ar]) => [k, I(ar)]))),
        notes: S('ملاحظات (مثلاً: ملابس شخصية، كي فقط)'),
      },
      ['notes']
    ),
  },
  get_service_order_status: {
    description: 'حالة طلب ديلفري/دراي كلين برقمه (DL-xxx / DC-xxx).',
    parameters: obj({ ref: S('رقم الطلب') }, ['ref']),
  },
  handoff_to_human: {
    description: 'تحويل المحادثة لموظف وإيقاف الرد الآلي: عند غضب العميل، أو طلبه موظفاً، أو طلب غير مفهوم/خارج الصلاحية.',
    parameters: obj({ reason: S('السبب باختصار') }, ['reason']),
  },
  // ---- أدوات الموظفين ----
  create_booking_in_zaer: {
    description: 'حجز مباشر في زائر بأمر موظف (يتطلب تأكيده بنعم/لا). السعر إجمالي لكامل الإقامة.',
    parameters: obj(
      { unit_id: S('نوع الوحدة أو اسمها كما قاله الموظف'), check_in: S(DATE), check_out: S(DATE), guest_name: S(''), guest_phone: S(''), price: N('السعر الإجمالي (اختياري)'), adults: I(''), children: I(''), notes: S(''), paid_amount: N('المبلغ المدفوع الآن إن ذكره (يُنشأ له وصل مالي) — وإلا لا وصل'), payment_method: S('', { enum: ['cash', 'cliq', 'bank', 'card'] }) },
      ['unit_id', 'check_in', 'check_out', 'guest_name', 'guest_phone']
    ),
  },
  confirm_payment: {
    description: 'تأكيد دفع حجز (برقم الحجز أو اسم/رقم العميل) ← إدخاله في زائر وإرسال التأكيد للعميل.',
    parameters: obj({ booking_ref: S('رقم الحجز أو رقم/اسم العميل'), payment_method: S('عند الدفع بدون إيصال', { enum: ['cash', 'cliq', 'bank', 'card'] }) }, ['booking_ref']),
  },
  reject_payment: {
    description: 'رفض إيصال دفع.',
    parameters: obj({ booking_ref: S(''), reason: S('') }, ['booking_ref']),
  },
  list_pending_payments: { description: 'المدفوعات المعلّقة بانتظار المراجعة والحجوزات بانتظار الدفع.', parameters: obj({}) },
  get_inventory: { description: 'كميات المخزون (صنف محدد أو الكل).', parameters: obj({ item: S('اسم الصنف (اختياري)') }) },
  adjust_inventory: {
    description: 'تعديل المخزون: delta موجب للإضافة وسالب للصرف، أو set_to لتعيين الكمية.',
    parameters: obj({ item: S('اسم الصنف'), delta: N(''), set_to: N(''), note: S('') }, ['item']),
  },
  send_message_to_guest: {
    description: 'إرسال رسالة نصية لعميل برقمه نيابة عن المنشأة.',
    parameters: obj({ phone: S(''), text: S('') }, ['phone', 'text']),
  },
  respond_to_approval: {
    description: 'للمدير: قرار على طلب سعر خاص (approve/reject) مع سعر مختلف اختياري.',
    parameters: obj({ code: S('آخر 6 خانات من رقم الطلب (اختياري — الأحدث افتراضياً)'), decision: S('', { enum: ['approve', 'reject'] }), price: N('سعر مختلف اختياري') }, ['decision']),
  },
  update_unit_price: {
    description: 'للمدير: تعديل أسعار نوع وحدة (الأساسي/نهاية الأسبوع/الحد الأدنى).',
    parameters: obj({ unit_id: S(''), base_rate: N(''), weekend_rate: N(''), min_rate: N('') }, ['unit_id']),
  },
  get_daily_report: { description: 'تقرير اليوم: الإشغال، الوصول والمغادرة، المدفوعات المعلقة، التذاكر.', parameters: obj({}) },
  modify_booking: {
    description: 'تعديل حجز موجود (تواريخ، نوع الوحدة، السعر، اسم النزيل، العدد). يُعدَّل في زائر مباشرة.',
    parameters: obj({
      booking_ref: S('رقم الحجز (B-xxx أو رقم زائر) أو اسم/رقم النزيل'), check_in: S(DATE), check_out: S(DATE), unit_id: S('نوع الوحدة الجديد'),
      price: N('السعر الإجمالي الجديد (اختياري)'), guest_name: S(''), adults: I(''), children: I(''), notes: S(''), notify_guest: { type: 'BOOLEAN', description: 'إبلاغ النزيل (افتراضي نعم)' },
    }, ['booking_ref']),
  },
  check_in_guest: {
    description: 'تسجيل وصول نزيل (Check-in) مع رقم الغرفة/الشقة.',
    parameters: obj({ booking_ref: S('رقم الحجز أو اسم/رقم النزيل'), room_number: S('رقم الشقة') }, ['booking_ref']),
  },
  check_out_guest: {
    description: 'تسجيل مغادرة نزيل (Check-out). يرفض إن كان عليه مبلغ متبقٍ.',
    parameters: obj({ booking_ref: S('رقم الحجز أو اسم/رقم النزيل') }, ['booking_ref']),
  },
  create_payment_receipt: {
    description: 'للمحاسب: تسجيل دفعة وإنشاء وصل مالي (سند قبض) في زائر على حجز. مثال: "سجّل وصل لأحمد 120 كليك".',
    parameters: obj({
      booking_ref: S('رقم الحجز أو اسم/رقم النزيل'), amount: N('المبلغ'), payment_method: S('', { enum: ['cash', 'cliq', 'bank', 'card'] }),
      reference: S('رقم مرجع التحويل إن وُجد'), notes: S(''),
    }, ['booking_ref', 'amount', 'payment_method']),
  },
  get_analytics: {
    description: 'إحصائيات ومقارنة الأداء: الفترة الحالية مقابل السابقة ونفس الفترة العام الماضي (إشغال، إيراد، ADR، حجوزات، إلغاءات، تحصيل...). أو الحجوزات المستقبلية.',
    parameters: obj({ period: S('', { enum: ['day', 'week', 'month', 'year', 'forward'] }), offset: I('0 الحالية، -1 السابقة...') }, ['period']),
  },
  get_risks_and_advice: { description: 'المخاطر المكتشفة (إشغال منخفض قادم، إلغاءات، مستحقات، أعطال...) ونصائح لزيادة الحجوزات.', parameters: obj({ refresh: { type: 'BOOLEAN', description: 'إعادة التحليل الآن' } }) },
  get_account_balances: { description: 'الأرصدة: المحصّل اليوم/الأسبوع/الشهر/السنة حسب طريقة الدفع، والمستحقات على الحجوزات، وأرصدة الحسابات.', parameters: obj({}) },
  grant_permission: {
    description: 'للمدير/المالك: منح موظف صلاحية إضافية (اختيارياً لعدد ساعات).',
    parameters: obj({ staff: S('اسم الموظف أو رقمه'), permission: S('اسم الصلاحية (الأداة)'), hours: N('مدة الصلاحية بالساعات — فارغ = دائمة') }, ['staff', 'permission']),
  },
  revoke_permission: {
    description: 'للمدير/المالك: سحب صلاحية من موظف (حتى لو كان دوره يملكها) أو إلغاء صلاحية ممنوحة.',
    parameters: obj({ staff: S('اسم الموظف أو رقمه'), permission: S('اسم الصلاحية') }, ['staff', 'permission']),
  },
};

// أسماء عربية للصلاحيات (للرسائل)
const PERMISSION_AR = {
  confirm_payment: 'تأكيد الدفع', reject_payment: 'رفض الدفع', create_booking_in_zaer: 'الحجز المباشر', cancel_booking: 'إلغاء الحجز',
  update_unit_price: 'تعديل الأسعار', send_message_to_guest: 'مراسلة العملاء', adjust_inventory: 'تعديل المخزون', get_account_balances: 'الأرصدة',
  get_analytics: 'التحليلات', get_risks_and_advice: 'المخاطر والنصائح', create_payment_receipt: 'إنشاء وصل مالي', check_in_guest: 'تسجيل الوصول',
  modify_booking: 'تعديل الحجز', grant_permission: 'منح الصلاحيات', revoke_permission: 'سحب الصلاحيات',
};

const GUEST_TOOLS = [
  'list_unit_types', 'check_availability', 'get_price_quote', 'negotiate_price', 'request_manager_approval', 'save_guest_details',
  'create_hold', 'send_payment_link', 'get_booking_by_phone', 'cancel_booking', 'create_guest_request', 'create_maintenance_ticket',
  'order_delivery', 'order_dry_clean', 'get_service_order_status', 'handoff_to_human',
];

// أدوات تغيّر بيانات ← يُطلب تأكيد الموظف قبل التنفيذ
const CONFIRM_TOOLS = ['create_booking_in_zaer', 'modify_booking', 'check_in_guest', 'check_out_guest', 'cancel_booking', 'confirm_payment', 'reject_payment', 'create_payment_receipt', 'update_unit_price', 'send_message_to_guest', 'grant_permission', 'revoke_permission'];

const GUEST_ONLY = ['handoff_to_human', 'save_guest_details', 'create_hold', 'send_payment_link', 'negotiate_price', 'request_manager_approval'];

/** صلاحيات الموظف = صلاحيات دوره + الممنوحة له خصيصاً (غير المنتهية) − المسحوبة منه */
function allowedToolNames(actor) {
  let names;
  if (!actor) names = GUEST_TOOLS;
  else {
    const perms = settings.get('rolePermissions') || {};
    const list = perms[actor.role] || [];
    names = list.includes('*') ? Object.keys(DECLARATIONS).filter((n) => !GUEST_ONLY.includes(n)) : [...list];
    const now = Date.now();
    for (const g of actor.extraPermissions || []) {
      if (g?.tool && (!g.expiresAt || new Date(g.expiresAt).getTime() > now) && !names.includes(g.tool)) names.push(g.tool);
    }
    const revoked = actor.revokedPermissions || [];
    names = names.filter((n) => !revoked.includes(n));
  }
  if (!settings.cardAvailable()) names = names.filter((n) => n !== 'send_payment_link');
  return names.filter((n) => DECLARATIONS[n]);
}

function declarationsFor(actor) {
  return allowedToolNames(actor).map((name) => ({ name, ...DECLARATIONS[name] }));
}

// ------------------------------------------------------------------
// إعادة صياغة العملية للموظف قبل التنفيذ
// ------------------------------------------------------------------
async function describe(name, a) {
  switch (name) {
    case 'create_booking_in_zaer': {
      const rule = await bookings.findRule(a.unit_id);
      return `📝 حجز جديد في زائر:\n• الوحدة: ${rule?.name || a.unit_id}\n• من ${a.check_in} إلى ${a.check_out}\n• النزيل: ${a.guest_name} — ${a.guest_phone}\n• السعر: ${a.price ? `${a.price} ${config.zaaer.currency}` : 'حسب التسعيرة'}${a.adults ? `\n• العدد: ${a.adults} بالغ${a.children ? ` + ${a.children} طفل` : ''}` : ''}`;
    }
    case 'modify_booking':
      return `✏️ تعديل الحجز ${a.booking_ref}:\n${[a.check_in && `• الوصول ← ${a.check_in}`, a.check_out && `• المغادرة ← ${a.check_out}`, a.unit_id && `• الوحدة ← ${a.unit_id}`, a.price && `• السعر ← ${a.price} ${config.zaaer.currency}`, a.guest_name && `• الاسم ← ${a.guest_name}`, a.adults && `• البالغين ← ${a.adults}`].filter(Boolean).join('\n') || '• ملاحظات'}`;
    case 'check_in_guest':
      return `🛎️ تسجيل وصول ${a.booking_ref}${a.room_number ? ` — شقة ${a.room_number}` : ''}`;
    case 'check_out_guest':
      return `🚪 تسجيل مغادرة ${a.booking_ref}`;
    case 'create_payment_receipt':
      return `🧾 وصل مالي في زائر:\n• الحجز: ${a.booking_ref}\n• المبلغ: ${a.amount} ${config.zaaer.currency}\n• الطريقة: ${({ cash: 'كاش', cliq: 'كليك', bank: 'تحويل بنكي', card: 'بطاقة' })[a.payment_method] || a.payment_method}${a.reference ? `\n• المرجع: ${a.reference}` : ''}`;
    case 'cancel_booking':
      return `🗑️ إلغاء الحجز ${a.booking_ref}${a.reason ? `\nالسبب: ${a.reason}` : ''}`;
    case 'confirm_payment':
      return `💳 تأكيد دفع الحجز ${a.booking_ref} وإدخاله في زائر وإرسال التأكيد للعميل`;
    case 'reject_payment':
      return `❌ رفض دفع الحجز ${a.booking_ref}${a.reason ? ` — ${a.reason}` : ''}`;
    case 'update_unit_price':
      return `💲 تعديل أسعار ${a.unit_id}: ${[a.base_rate && `الأساسي ${a.base_rate}`, a.weekend_rate && `نهاية الأسبوع ${a.weekend_rate}`, a.min_rate && `الحد الأدنى ${a.min_rate}`].filter(Boolean).join('، ')}`;
    case 'send_message_to_guest':
      return `✉️ إرسال إلى ${a.phone}:\n"${a.text}"`;
    case 'grant_permission':
      return `🔑 منح ${a.staff} صلاحية "${PERMISSION_AR[a.permission] || a.permission}"${a.hours ? ` لمدة ${a.hours} ساعة` : ' (دائمة)'}`;
    case 'revoke_permission':
      return `🚫 سحب صلاحية "${PERMISSION_AR[a.permission] || a.permission}" من ${a.staff}`;
    default:
      return `${name} ${JSON.stringify(a)}`;
  }
}

// ------------------------------------------------------------------
// التنفيذ
// ctx: { conversation, actor (Staff|null), isStaff, confirmed, recentImages }
// ------------------------------------------------------------------
async function execute(name, args = {}, ctx = {}) {
  const actor = ctx.actor || null;
  if (!allowedToolNames(actor).includes(name)) {
    await audit.log({ actorType: actor ? 'staff' : 'guest', actorPhone: actor?.phone || ctx.conversation?.customerPhone, action: `${name}.denied`, success: false });
    return { error: 'غير مسموح لهذا المستخدم بهذه العملية' };
  }

  // تأكيد الموظف قبل أي عملية مغيِّرة
  if (actor && CONFIRM_TOOLS.includes(name) && !ctx.confirmed) {
    // رفض مبكر لما سيفشل حتماً (وحدة غير معروفة، غير متاح، تحت الحد الأدنى) بدل سؤال "نعم/لا" ثم الفشل
    if (name === 'create_booking_in_zaer') {
      try {
        await bookings.validateStaffBooking(actor, { unitRef: args.unit_id, checkIn: args.check_in, checkOut: args.check_out, guestName: args.guest_name, guestPhone: args.guest_phone, price: args.price, adults: args.adults, children: args.children }, { fresh: false });
      } catch (err) {
        return { error: err.message };
      }
    }
    if (name === 'grant_permission' || name === 'revoke_permission') {
      const t = await resolveStaffTarget(args.staff, args.permission, name);
      if (t.error) return { error: t.error };
      args = { ...args, staff: t.target.name }; // الاسم الكامل في رسالة التأكيد وعند التنفيذ
    }
    if (name === 'check_out_guest') {
      const blocked = bookings.checkoutBlock(await bookings.findBooking(args.booking_ref));
      if (blocked) return { error: blocked };
    }
    let extra = '';
    if (name === 'modify_booking') {
      // الموظف يرى السعر الجديد والمتبقي قبل أن يضغط "نعم"
      try {
        const { booking, plan } = await bookings.previewModification(actor, args.booking_ref, { checkIn: args.check_in, checkOut: args.check_out, unitRef: args.unit_id, price: args.price, adults: args.adults, children: args.children });
        if (booking) {
          extra = `\n• الحجز: ${booking.zaaerReservationId || booking.ref} — ${booking.guestName} (${booking.unitName} ${booking.checkIn} ← ${booking.checkOut})`;
          if (plan.changed) extra += `\n• السعر الجديد: ${plan.newPrice} ${booking.currency} (كان ${booking.agreedPrice}) — المدفوع ${booking.paidAmount || 0}، المتبقي ${Math.max(0, plan.newPrice - (booking.paidAmount || 0))}`;
        }
      } catch (err) {
        return { error: err.message };
      }
    }
    const summary = (await describe(name, args)) + extra;
    await approvals.requestStaffConfirmation(actor, name, args, summary);
    return { status: 'awaiting_staff_confirmation', __stop: true };
  }

  const conv = ctx.conversation;
  const phone = conv?.customerPhone;
  const by = actor ? { actorType: 'staff', actorName: actor.name, actorPhone: actor.phone } : { actorType: 'ai', actorPhone: phone };

  let result;
  switch (name) {
    case 'list_unit_types': {
      const rules = await bookings.listRules();
      result = { units: rules.map((r) => ({ unit_id: String(r._id), name: r.name, aliases: r.aliases, description: r.description, max_adults: r.maxAdults })) };
      break;
    }
    case 'check_availability':
      result = await bookings.checkAvailability({ checkIn: args.check_in, checkOut: args.check_out, adults: args.adults, children: args.children, unitRef: args.unit_id });
      if (conv && !actor) {
        await saveState(conv, { checkIn: args.check_in, checkOut: args.check_out, adults: args.adults, children: args.children });
        // عُرضت أسعار على العميل ← المرحلة "تم عرض السعر" (إن لم يكن متقدماً أصلاً)
        if (result.options?.some((o) => o.available) && ['new', 'lost'].includes(conv.stage)) {
          await bookings.setStage(conv._id, 'quoted');
          conv.stage = 'quoted';
        }
      }
      break;
    case 'get_price_quote':
      result = await bookings.priceQuote(conv, { unitRef: args.unit_id, checkIn: args.check_in, checkOut: args.check_out, adults: args.adults, children: args.children });
      break;
    case 'negotiate_price':
      result = await bookings.negotiate(conv, { unitRef: args.unit_id, checkIn: args.check_in, checkOut: args.check_out, customerOffer: args.customer_offer || null });
      break;
    case 'request_manager_approval':
      result = await approvals.requestPriceApproval(conv, { requestedPrice: args.requested_price, note: args.note });
      break;
    case 'save_guest_details': {
      const patch = { guestName: args.name, roomNumber: args.room_number, checkIn: args.check_in, checkOut: args.check_out, adults: args.adults, children: args.children };
      await saveState(conv, patch);
      if (args.name) await Conversation.updateOne({ _id: conv._id }, { $set: { customerName: args.name } });
      if (args.room_number) await Conversation.updateOne({ _id: conv._id, stage: { $in: ['new', 'lost', 'confirmed'] } }, { $set: { stage: 'in_house' } });
      result = { saved: true };
      break;
    }
    case 'create_hold':
      result = await bookings.createHold(conv, { unitRef: args.unit_id, checkIn: args.check_in, checkOut: args.check_out, adults: args.adults, children: args.children, guestName: args.guest_name });
      break;
    case 'send_payment_link':
      result = await payments.createCheckoutLink(conv);
      break;
    case 'get_booking_by_phone': {
      const target = actor && args.phone_or_name ? args.phone_or_name : phone;
      const isPhone = /\d{6,}/.test(String(target).replace(/\D/g, ''));
      let remote = [];
      try {
        remote = isPhone ? await zaaer.getReservationsByPhone(target) : await zaaer.searchReservations(target);
      } catch (err) {
        remote = [];
        result = { zaaer_error: 'تعذر الوصول لزائر' };
      }
      const local = await Booking.find(isPhone ? { phone: normalizePhone(target, config.defaultCountryCode) } : { $or: [{ guestName: new RegExp(escapeRe(target), 'i') }, { ref: target }] })
        .sort({ createdAt: -1 }).limit(5).lean();
      result = {
        ...(result || {}),
        zaaer: remote.slice(0, 5).map((r) => ({ id: r.number ?? r.reservation_number ?? r.id, guest: r.guest?.name, check_in: r.check_in_date, check_out: r.check_out_date, status: r.reservation_status ?? r.status, unit: r.rooms?.[0]?.unit_name, total: r.finance?.total ?? r.totals?.total ?? r.total, paid: r.finance?.paid, balance_due: r.finance?.balance_due })),
        local: local.map((b) => ({ ref: b.ref, unit: b.unitName, check_in: b.checkIn, check_out: b.checkOut, price: b.agreedPrice, status: b.status })),
      };
      break;
    }
    case 'cancel_booking': {
      if (!actor) {
        const b = await payments.activeBookingFor(conv);
        if (b && (!args.booking_ref || args.booking_ref === b.ref)) {
          result = await bookings.cancel(b.ref, phone, args.reason || 'بطلب العميل');
        } else {
          await handoff(conv, `طلب إلغاء حجز مؤكد ${args.booking_ref || ''} — ${args.reason || ''}`);
          result = { status: 'handed_to_staff', message: 'الحجز المؤكد يلغيه موظف — أخبر العميل أن الاستقبال سيتواصل معه' };
        }
      } else {
        result = await bookings.cancel(args.booking_ref, actor.name, args.reason);
      }
      break;
    }
    case 'create_guest_request':
    case 'create_maintenance_ticket': {
      const kind = name === 'create_maintenance_ticket' ? 'maintenance' : 'request';
      const room = args.room_number || conv?.state?.roomNumber || '';
      const recent = (conv?.state?.recentImages || []).filter((x) => Date.now() - new Date(x.at).getTime() < 30 * 60000).map((x) => x.path);
      const t = await tickets.create({
        kind, category: args.category || 'other', priority: args.priority || (kind === 'maintenance' ? 'high' : 'normal'),
        description: args.description, roomNumber: room, guestPhone: actor ? undefined : phone, guestName: actor ? undefined : conv?.customerName,
        mediaFiles: kind === 'maintenance' ? recent : [], createdBy: actor?.phone || phone,
      });
      if (!actor && room) await saveState(conv, { roomNumber: room });
      result = { ticket_number: t.number, assigned: !!t.assignedTo, message: 'أخبر النزيل برقم الطلب وأنه تم تحويله للفريق' };
      break;
    }
    case 'update_ticket':
      result = await tickets.update(args.ticket_number, { status: args.status, note: args.note, assignToPhone: args.assign_to_phone && normalizePhone(args.assign_to_phone, config.defaultCountryCode), priority: args.priority }, actor?.phone);
      result = { ok: result.ok, message: result.message };
      break;
    case 'list_open_tickets': {
      const q = { status: { $in: ['open', 'assigned', 'acknowledged', 'reopened'] } };
      if (args.kind && args.kind !== 'all') q.kind = args.kind;
      if (actor && !['manager', 'owner', 'reception'].includes(actor.role)) q.assignedPhone = actor.phone;
      const list = await Ticket.find(q).sort({ createdAt: 1 }).limit(15).lean();
      result = { tickets: list.map((t) => ({ number: t.number, kind: t.kind, category: t.category, room: t.roomNumber, status: t.status, assigned: t.assignedName, description: t.description?.slice(0, 80) })) };
      break;
    }
    case 'order_delivery': {
      const room = args.room_number || conv?.state?.roomNumber;
      if (!room) return { error: 'اسأل عن رقم الغرفة أولاً' };
      const o = await serviceOrders.orderDelivery({ details: args.details, roomNumber: room, guestPhone: actor ? undefined : phone, guestName: actor ? undefined : conv?.customerName, requestedBy: actor?.phone || phone });
      result = { order_ref: o.ref, status: o.statusText };
      break;
    }
    case 'order_dry_clean': {
      const room = args.room_number || conv?.state?.roomNumber;
      if (!room) return { error: 'اسأل عن رقم الغرفة أولاً' };
      const o = await serviceOrders.orderDryClean({ roomNumber: room, items: args.items || {}, notes: args.notes, guestPhone: actor ? undefined : phone, guestName: actor ? undefined : conv?.customerName, requestedBy: actor?.phone || phone });
      result = { order_ref: o.ref, status: o.statusText };
      break;
    }
    case 'get_service_order_status':
      result = (await serviceOrders.statusOf(args.ref)) || { error: 'الطلب غير موجود' };
      break;
    case 'handoff_to_human':
      await handoff(conv, args.reason);
      result = { status: 'handed_off', message: 'أخبر العميل بلطف أن أحد الزملاء سيتابع معه حالاً' };
      break;

    // ---- موظفين ----
    case 'create_booking_in_zaer':
      result = await bookings.staffBooking(actor, {
        unitRef: args.unit_id, checkIn: args.check_in, checkOut: args.check_out, guestName: args.guest_name, guestPhone: args.guest_phone,
        price: args.price, adults: args.adults, children: args.children, notes: args.notes, paidAmount: Number(args.paid_amount || 0), paymentMethod: args.payment_method,
      });
      result = { ok: result.ok, message: result.message, booking_ref: result.booking?.ref, zaaer_id: result.booking?.zaaerReservationId };
      break;
    case 'confirm_payment': {
      const ref = await resolvePaymentRef(args.booking_ref);
      result = ref ? await payments.confirm(ref, actor) : await confirmWithoutReceipt(args.booking_ref, actor, args.payment_method);
      break;
    }
    case 'reject_payment': {
      const ref = await resolvePaymentRef(args.booking_ref);
      result = ref ? await payments.reject(ref, actor, args.reason) : { ok: false, message: 'لا يوجد إيصال معلّق لهذا الحجز' };
      break;
    }
    case 'list_pending_payments': {
      const pend = await Payment.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10).lean();
      const awaiting = await Booking.find({ status: 'awaiting_payment' }).sort({ createdAt: -1 }).limit(10).lean();
      result = {
        receipts_pending_review: pend.map((p) => ({ booking_ref: p.bookingRef, amount: p.amount, method: p.method, phone: p.phone })),
        bookings_awaiting_payment: awaiting.map((b) => ({ ref: b.ref, guest: b.guestName, amount: b.agreedPrice, check_in: b.checkIn, expires: b.holdExpiresAt })),
      };
      break;
    }
    case 'get_inventory': {
      if (args.item) {
        const it = await inventory.find(args.item);
        result = it ? { item: it.name, quantity: it.quantity, unit: it.unit, min: it.minQuantity } : { error: 'الصنف غير موجود' };
      } else {
        const all = await inventory.list();
        result = { items: all.map((i) => ({ item: i.name, quantity: i.quantity, unit: i.unit, low: i.minQuantity > 0 && i.quantity <= i.minQuantity })) };
      }
      break;
    }
    case 'adjust_inventory':
      result = await inventory.adjust(args.item, { delta: args.delta, setTo: args.set_to, note: args.note }, actor || {});
      result = { ok: result.ok, message: result.message };
      break;
    case 'send_message_to_guest': {
      const to = normalizePhone(args.phone, config.defaultCountryCode);
      const r = await messenger.send(to, { text: args.text, sender: 'agent', agentName: actor.name });
      result = { ok: r.ok, message: r.ok ? 'تم الإرسال' : `فشل الإرسال: ${r.error}` };
      break;
    }
    case 'respond_to_approval':
      result = await approvals.decidePriceApproval(args.code, args.decision === 'approve', actor.phone, args.price);
      break;
    case 'update_unit_price': {
      const rule = await bookings.findRule(args.unit_id);
      if (!rule) return { error: 'نوع الوحدة غير معروف' };
      const set = {};
      if (args.base_rate) set.baseRate = args.base_rate;
      if (args.weekend_rate) set.weekendRate = args.weekend_rate;
      if (args.min_rate) set.minRate = args.min_rate;
      await PricingRule.updateOne({ _id: rule._id }, { $set: set });
      result = { ok: true, message: `تم تحديث أسعار ${rule.name}` };
      break;
    }
    case 'get_daily_report':
      result = { report: await reports.buildDailyReport() };
      break;
    case 'modify_booking':
      result = await bookings.modifyBooking(actor, args.booking_ref, {
        checkIn: args.check_in, checkOut: args.check_out, unitRef: args.unit_id, price: args.price, guestName: args.guest_name,
        adults: args.adults, children: args.children, notes: args.notes, notifyGuest: args.notify_guest,
      });
      result = { ok: result.ok, message: result.message };
      break;
    case 'check_in_guest':
      result = await bookings.checkInGuest(actor, args.booking_ref, args.room_number);
      break;
    case 'check_out_guest':
      result = await bookings.checkOutGuest(actor, args.booking_ref);
      break;
    case 'create_payment_receipt':
      result = await createPaymentReceipt(actor, args);
      break;
    case 'get_analytics': {
      const analytics = require('./analytics');
      if (args.period === 'forward') {
        const f = await analytics.forward();
        result = { forward: f.rows, weekend_avg_pct: f.weekendAvgPct, weekday_avg_pct: f.weekdayAvgPct, low_days: f.gaps.slice(0, 10), arrivals_with_balance: f.arrivalsWithBalance };
      } else {
        const c = await analytics.compare(args.period || 'week', Number(args.offset || 0));
        result = { summary: analytics.formatCompareForChat(c), rows: c.rows.map((r) => ({ metric: r.label, current: r.current, previous: r.previous, last_year: r.lastYear, change_pct: r.changePct })) };
      }
      break;
    }
    case 'get_risks_and_advice': {
      const insights = require('./insights');
      const ins = await insights.getInsights({ refresh: !!args.refresh });
      result = { text: insights.formatForChat(ins) };
      break;
    }
    case 'get_account_balances': {
      const finance = require('./finance');
      result = { text: finance.formatForChat(await finance.balances()) };
      break;
    }
    case 'grant_permission':
    case 'revoke_permission': {
      const t = await resolveStaffTarget(args.staff, args.permission, name);
      if (t.error) return { error: t.error };
      const { target } = t;
      if (name === 'grant_permission') {
        target.extraPermissions = (target.extraPermissions || []).filter((g) => g.tool !== args.permission);
        target.extraPermissions.push({ tool: args.permission, expiresAt: args.hours ? new Date(Date.now() + args.hours * 3600000) : undefined, grantedBy: actor.name });
        target.revokedPermissions = (target.revokedPermissions || []).filter((t) => t !== args.permission);
      } else {
        target.extraPermissions = (target.extraPermissions || []).filter((g) => g.tool !== args.permission);
        if (!target.revokedPermissions.includes(args.permission)) target.revokedPermissions.push(args.permission);
      }
      await target.save();
      if (name === 'grant_permission') {
        await messenger.notifyStaff([target.phone], `🔑 تم منحك صلاحية "${PERMISSION_AR[args.permission] || args.permission}"${args.hours ? ` لمدة ${args.hours} ساعة` : ''} من ${actor.name}.`, { kind: 'alert' });
      }
      result = { ok: true, message: `${name === 'grant_permission' ? 'تم منح' : 'تم سحب'} الصلاحية ${name === 'grant_permission' ? 'لـ' : 'من'} ${target.name}` };
      break;
    }
    default:
      return { error: `أداة غير معروفة: ${name}` };
  }

  if (!['list_unit_types', 'check_availability', 'get_inventory', 'list_open_tickets', 'get_service_order_status', 'list_pending_payments', 'get_daily_report', 'get_booking_by_phone', 'save_guest_details'].includes(name)) {
    await audit.log({ ...by, action: `tool.${name}`, details: { args, result: summarizeResult(result) } });
  }
  return result;
}

function summarizeResult(r) {
  try {
    return JSON.parse(JSON.stringify(r, (k, v) => (k === 'payment_instructions' ? undefined : v)).slice(0, 2000));
  } catch {
    return null;
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function saveState(conv, patch) {
  if (!conv) return;
  const set = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null && v !== '') set[`state.${k}`] = v;
  if (Object.keys(set).length) await Conversation.updateOne({ _id: conv._id }, { $set: set });
  conv.state = { ...(conv.state || {}), ...patch };
}

async function handoff(conv, reason) {
  if (!conv) return;
  await Conversation.updateOne({ _id: conv._id }, { $set: { aiEnabled: false, handoff: { active: true, reason, at: new Date() } } });
  conv.aiEnabled = false;
  const staff = await messenger.staffByRole(['reception', 'manager']);
  await messenger.notifyStaff(
    staff.map((s) => s.phone),
    `🙋 تحويل لموظف — ${conv.customerName} (+${conv.customerPhone})\nالسبب: ${reason}\nتم إيقاف الرد الآلي لهذه المحادثة. تابعها من لوحة المحادثات.`,
    { kind: 'alert' }
  );
  await audit.log({ actorType: 'ai', actorPhone: conv.customerPhone, action: 'conversation.handoff', details: { reason } });
  messenger.pushConversationUpdate(conv._id).catch(() => {});
}

/** الموظف المقصود بمنح/سحب صلاحية: نشط فقط، ورفض الاسم الغامض، ولا منح لمدير/مالك (يملك كل الصلاحيات) */
async function resolveStaffTarget(ref, permission, toolName) {
  const { Staff } = require('../models');
  if (!ref) return { error: 'حدد اسم الموظف أو رقمه' };
  if (!DECLARATIONS[permission]) return { error: `صلاحية غير معروفة: ${permission}` };
  const phone = normalizePhone(ref, config.defaultCountryCode);
  const matches = await Staff.find({ active: true, ...(/^\d{9,}$/.test(phone) ? { phone } : { name: new RegExp(escapeRe(ref), 'i') }) });
  if (!matches.length) return { error: `لم أجد موظفاً نشطاً باسم/رقم "${ref}"` };
  if (matches.length > 1) return { error: `الاسم "${ref}" يطابق أكثر من موظف: ${matches.map((m) => `${m.name} (${m.phone.slice(-4)})`).join('، ')} — حدد بالاسم الكامل أو الرقم` };
  const target = matches[0];
  if (toolName === 'grant_permission' && ['manager', 'owner'].includes(target.role)) return { error: `${target.name} يملك كل الصلاحيات بحكم دوره` };
  return { target };
}

/** إيجاد دفع معلّق من رقم حجز أو رقم/اسم عميل */
async function resolvePaymentRef(ref) {
  if (!ref) return null;
  let p = await Payment.findOne({ status: 'pending', bookingRef: ref }).sort({ createdAt: -1 });
  if (!p) {
    const phone = normalizePhone(ref, config.defaultCountryCode);
    if (/^\d{9,}$/.test(phone)) p = await Payment.findOne({ status: 'pending', phone }).sort({ createdAt: -1 });
  }
  if (!p) {
    const b = await Booking.findOne({ guestName: new RegExp(escapeRe(ref), 'i'), status: { $in: ['awaiting_payment', 'hold'] } }).sort({ createdAt: -1 });
    if (b) p = await Payment.findOne({ status: 'pending', bookingId: b._id });
  }
  return p ? String(p._id) : null;
}

/** "أكّد دفع حجز أحمد" بدون إيصال (دفع كاش/فيزا بالاستقبال) */
async function confirmWithoutReceipt(ref, actor, paymentMethod) {
  const b = await bookings.findBooking(ref);
  if (!b || !['awaiting_payment', 'hold', 'failed', 'zaaer_entered'].includes(b.status)) return { ok: false, message: 'لم أجد حجزاً بانتظار الدفع بهذا الاسم/الرقم' };
  const due = Math.max(0, b.agreedPrice - (b.paidAmount || 0));
  const pay = await Payment.create({ bookingId: b._id, bookingRef: b.ref, phone: b.phone, method: 'manual', paymentMethod: paymentMethod || 'cash', amount: due || b.agreedPrice, currency: b.currency, status: 'confirmed', reviewedBy: actor.name, reviewedAt: new Date() });
  await audit.log({ actorType: 'staff', actorName: actor.name, actorPhone: actor.phone, action: 'payment.confirm_manual', target: b.ref, details: { amount: pay.amount, method: pay.paymentMethod } });
  const r = await bookings.finalizeBooking(b._id, actor.name, pay);
  return { ok: r.ok, message: `✅ تم تأكيد دفع ${b.guestName} (${pay.amount} ${b.currency}). ${r.message}` };
}

/** وصل مالي بأمر المحاسب (صوت/نص): يُسجَّل الدفع ويُنشأ الوصل في زائر */
async function createPaymentReceipt(actor, args) {
  const amount = Number(args.amount);
  if (!amount || amount <= 0) return { ok: false, message: 'حدد المبلغ' };
  let b = await bookings.findBooking(args.booking_ref);
  let zaaerOnly = null;
  if (!b) {
    // حجز موجود في زائر فقط (أُدخل يدوياً)
    try {
      const found = /\d{6,}/.test(String(args.booking_ref)) ? await zaaer.getReservationsByPhone(args.booking_ref) : await zaaer.searchReservations(args.booking_ref);
      zaaerOnly = found[0] || null;
    } catch { /* زائر لا يستجيب */ }
    if (!zaaerOnly) return { ok: false, message: `لم أجد حجزاً باسم/رقم "${args.booking_ref}"` };
  }
  const pay = await Payment.create({
    bookingId: b?._id, bookingRef: b?.ref || String(zaaerOnly.number ?? zaaerOnly.reservation_number ?? zaaerOnly.id), phone: b?.phone || normalizePhone(zaaerOnly.guest?.phone || '', config.defaultCountryCode),
    method: 'manual', paymentMethod: args.payment_method || 'cash', amount, currency: b?.currency || config.zaaer.currency, status: 'confirmed',
    reviewedBy: actor.name, reviewedAt: new Date(), extracted: { reference: args.reference, note: args.notes },
  });
  await audit.log({ actorType: 'staff', actorName: actor.name, actorPhone: actor.phone, action: 'payment.receipt_by_staff', target: pay.bookingRef, details: { amount, method: pay.paymentMethod, reference: args.reference } });
  if (b && ['awaiting_payment', 'hold', 'failed'].includes(b.status)) {
    const r = await bookings.finalizeBooking(b._id, actor.name, pay);
    return { ok: r.ok, message: `🧾 ${amount} ${pay.currency} — ${r.message}` };
  }
  if (b) {
    b.paidAmount = (b.paidAmount || 0) + amount;
    b.history.push({ status: b.status, by: actor.name, note: `payment:${pay._id}` });
    await b.save();
  }
  const fakeBooking = b || { ref: null, zaaerReservationId: String(zaaerOnly.number ?? zaaerOnly.reservation_number ?? zaaerOnly.id), guestName: zaaerOnly.guest?.name };
  const rc = await bookings.issueReceipt(fakeBooking, pay, actor.name);
  const due = b ? Math.max(0, b.agreedPrice - b.paidAmount) : null;
  return {
    ok: true,
    message: `🧾 تم تسجيل ${amount} ${pay.currency} (${({ cliq: 'كليك', bank: 'تحويل', cash: 'كاش', card: 'بطاقة' })[pay.paymentMethod] || pay.paymentMethod}) لـ ${fakeBooking.guestName || pay.bookingRef}` +
      (rc.ok ? ` — وصل زائر ${rc.receiptId}` : ' — نقطة الوصل في زائر غير مُعدّة: وصلك تنبيه بالتفاصيل لإصداره يدوياً') +
      (due !== null ? `\nالمتبقي: ${due}` : ''),
  };
}

/** نص نتيجة مختصر للموظف بعد ضغط "نعم" */
function formatResultForStaff(name, r) {
  if (!r) return 'تم.';
  if (r.error) return `❌ ${r.error}`;
  if (r.message) return (r.ok === false ? '❌ ' : '') + r.message + (r.booking_ref ? `\nرقم الحجز: ${r.booking_ref}${r.zaaer_id ? ` | زائر: ${r.zaaer_id}` : ''}` : '');
  return `✅ تم تنفيذ ${name}`;
}

module.exports = { declarationsFor, allowedToolNames, execute, formatResultForStaff, handoff, saveState, GUEST_TOOLS, GUEST_ONLY, CONFIRM_TOOLS, DECLARATIONS, PERMISSION_AR };
