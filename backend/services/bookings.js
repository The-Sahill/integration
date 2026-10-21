// services/bookings.js — الشواغر، عروض الأسعار، التفاوض، الحجز المبدئي، الإدخال في زائر، الإلغاء
const { PricingRule, Negotiation, Booking, Conversation, Payment } = require('../models');
const zaaer = require('./zaaer');
const pricing = require('./pricing');
const settings = require('./settings');
const messenger = require('./messenger');
const audit = require('./audit');
const realtime = require('./realtime');
const config = require('../config');
const { isISODate, shortRef, todayISO, normalizePhone, nightsBetween } = require('../utils/helpers');

const STAGE_ORDER = ['new', 'quoted', 'negotiating', 'hold', 'awaiting_payment', 'paid', 'zaaer_entered', 'confirmed'];

async function setStage(conversationId, stage, statePatch = {}) {
  const set = { stage, stageUpdatedAt: new Date(), 'followUp.count': 0 };
  for (const [k, v] of Object.entries(statePatch)) set[`state.${k}`] = v;
  await Conversation.updateOne({ _id: conversationId }, { $set: set });
  messenger.pushConversationUpdate(conversationId).catch(() => {});
}

function validateDates(checkIn, checkOut) {
  if (!isISODate(checkIn) || !isISODate(checkOut)) throw new Error('صيغة التاريخ يجب أن تكون YYYY-MM-DD');
  if (checkOut <= checkIn) throw new Error('تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول');
  if (checkIn < todayISO(config.timezone)) throw new Error('تاريخ الوصول في الماضي');
}

async function listRules() {
  return PricingRule.find({ active: true }).lean();
}

/** إيجاد نوع الوحدة بالمعرف أو الاسم أو الاسم البديل أو unit_type_id */
async function findRule(ref) {
  if (!ref && ref !== 0) return null;
  const s = String(ref).trim();
  const rules = await listRules();
  return (
    rules.find((r) => String(r._id) === s) ||
    rules.find((r) => String(r.zaaerUnitTypeId) === s) ||
    rules.find((r) => r.name === s || (r.aliases || []).includes(s)) ||
    rules.find((r) => s.includes(r.name) || (r.aliases || []).some((a) => a && s.includes(a))) ||
    null
  );
}

function publicRule(r) {
  // unit_id بنفس اسم معامل الأدوات (get_price_quote/negotiate_price/create_hold) حتى لا يخترع النموذج معرّفاً
  return { unit_id: String(r._id), name: r.name, description: r.description, max_adults: r.maxAdults };
}

/** الشواغر للتواريخ المطلوبة فقط (كل الأنواع أو نوع واحد) — بالتوازي ومع cache دقيقتين */
async function checkAvailability({ checkIn, checkOut, adults = 1, children = 0, unitRef }) {
  validateDates(checkIn, checkOut);
  await require('./unitTypes').ensureUnitTypes();
  let rules = await listRules();
  if (!rules.length) {
    messenger.alertManagers('⚠️ لا توجد أنواع وحدات مضبوطة — العملاء لا يرون أي شواغر. أضفها من اللوحة: الأسعار والتفاوض.', { throttleKey: 'no_units', throttleMinutes: 60 }).catch(() => {});
    return { check_in: checkIn, check_out: checkOut, options: [], error: 'not_configured', message: 'لا يمكن التحقق من التوفر الآن. لا تقل إنه لا يوجد شواغر؛ أخبر العميل أن الزميل سيؤكد له التوفر والسعر خلال دقائق، واستخدم handoff_to_human.' };
  }
  if (unitRef) {
    const r = await findRule(unitRef);
    if (r) rules = [r];
  }
  rules = rules.filter((r) => !adults || !r.maxAdults || adults <= r.maxAdults || unitRef);
  const results = await Promise.all(
    rules.map(async (r) => {
      try {
        const a = await zaaer.checkAvailability({ unitTypeId: r.zaaerUnitTypeId, ratePlanId: r.ratePlanId, checkIn, checkOut, adults, children });
        if (a.error) return { ...publicRule(r), available: null, error: 'تعذر التحقق من زائر' };
        if (!a.available) return { ...publicRule(r), available: false };
        const q = pricing.quote(r, checkIn, checkOut, { zaaerAmount: a.amount });
        return { ...publicRule(r), available: true, nights: q.nights, price_total: q.listTotal, price_per_night: q.avgNightly, currency: config.zaaer.currency };
      } catch (err) {
        return { ...publicRule(r), available: null, error: err.message };
      }
    })
  );
  if (results.length && results.every((x) => x.available === null)) {
    messenger.alertManagers('⚠️ زائر لا يستجيب لطلبات الشواغر — تحقق من الاتصال/التوكن.', { throttleKey: 'zaaer_down' }).catch(() => {});
  }
  return { check_in: checkIn, check_out: checkOut, options: results };
}

/**
 * إشغال المنشأة % للتواريخ المطلوبة = متوسط إشغال الليالي من حجوزات زائر (المحمّلة مسبقاً)
 * بديل إن لم تكن محمّلة: quote لكل نوع — أقل دقة للإقامات الطويلة (ليلة واحدة ممتلئة تجعل النوع "غير متاح" للفترة كلها)
 */
async function occupancyFor(checkIn, checkOut) {
  const rules = (await listRules()).filter((r) => Number(r.unitsCount) > 0);
  const units = rules.reduce((s, r) => s + Number(r.unitsCount), 0);
  const raw = zaaer.cachedReservations();
  if (raw && units) {
    const { normalizeReservation } = require('./analytics');
    const nights = nightsBetween(checkIn, checkOut);
    const active = raw.map(normalizeReservation).filter((r) => !r.cancelled && r.checkIn < checkOut && r.checkOut > checkIn);
    const occupied = nights.reduce((s, d) => s + active.filter((r) => r.checkIn <= d && r.checkOut > d).reduce((n, r) => n + (r.rooms || 1), 0), 0);
    return Math.min(100, Math.round((occupied / (units * nights.length)) * 100));
  }
  return occupancyFromQuotes(rules, checkIn, checkOut);
}

async function occupancyFromQuotes(rules, checkIn, checkOut) {
  const res = await Promise.all(rules.map((r) => zaaer.checkAvailability({ unitTypeId: r.zaaerUnitTypeId, ratePlanId: r.ratePlanId, checkIn, checkOut }).catch(() => null)));
  let total = 0;
  let free = 0;
  rules.forEach((r, i) => {
    const a = res[i];
    if (!a || a.error) return;
    const units = Number(r.unitsCount);
    total += units;
    free += a.available ? Math.min(units, a.availableCount ?? units) : 0;
  });
  return total ? Math.round((1 - free / total) * 100) : null;
}

/** ملاحظة للـ AI تشرح سبب مرونة السعر (بدون كشف أرقام الهامش) */
function policyNote(dyn) {
  if (!dyn) return '';
  if (dyn.nights <= 1 && !dyn.maxDiscountPct) return 'سعر الليلة الواحدة ثابت: لا تخفّضه. إن أصرّ العميل اقترح إقامة أطول بسعر أفضل لليلة، أو ارفع طلبه للإدارة.';
  if (!dyn.maxDiscountPct) return 'الإقبال عالٍ جداً على هذه التواريخ والسعر ثابت: أبرز أن الشقق شبه محجوزة.';
  if (dyn.nights >= 28) return 'إقامة شهرية: يمكنك ذكر أن للإقامة الطويلة تقديراً خاصاً في السعر.';
  if (dyn.nights >= 7) return 'إقامة أسبوعية: يمكنك ذكر أن للإقامة الأسبوعية تقديراً خاصاً في السعر.';
  if (dyn.occupancyPct >= 65) return 'الإقبال جيد على هذه التواريخ: تنازل بهدوء ولا تستعجل.';
  return '';
}

/** قاعدة السعر بعد التسعير الذكي (إشغال التواريخ + مدة الإقامة) — أو القاعدة كما هي إن كان معطلاً/تعذر الإشغال */
async function dynamicRuleFor(rule, checkIn, checkOut) {
  const policy = settings.get('dynamicPricing');
  if (!policy?.enabled) return { effRule: rule, dyn: null };
  const occupancyPct = await occupancyFor(checkIn, checkOut);
  if (occupancyPct === null) return { effRule: rule, dyn: null }; // بدون بيانات إشغال: قاعدة النوع الثابتة (الأحوط)
  const dyn = pricing.dynamicDiscount(policy, { nights: nightsBetween(checkIn, checkOut).length, occupancyPct });
  return { effRule: pricing.applyDynamic(rule, dyn), dyn };
}

/** عرض سعر رسمي لنوع واحد + فتح سجل تفاوض */
async function priceQuote(conversation, { unitRef, checkIn, checkOut, adults = 1, children = 0 }) {
  validateDates(checkIn, checkOut);
  const rule = await findRule(unitRef);
  if (!rule) throw new Error('نوع الوحدة غير معروف — استخدم list_unit_types');
  const a = await zaaer.checkAvailability({ unitTypeId: rule.zaaerUnitTypeId, ratePlanId: rule.ratePlanId, checkIn, checkOut, adults, children });
  if (a.error) throw new Error('تعذر التحقق من التوفر حالياً');
  if (!a.available) return { available: false, unit: rule.name };
  let q = pricing.quote(rule, checkIn, checkOut, { zaaerAmount: a.amount });

  let neg = await Negotiation.findOne({ conversationId: conversation._id, pricingRuleId: rule._id, checkIn, checkOut, status: { $in: ['open', 'accepted', 'approved', 'approval_pending'] } });
  if (!neg) {
    // السعر الأول دائماً الأعلى؛ الهامش (والحد) يُحسب حسب الإشغال والمدة ويُثبَّت لهذا التفاوض
    const { effRule, dyn } = await dynamicRuleFor(rule, checkIn, checkOut);
    q = pricing.quote(effRule, checkIn, checkOut, { zaaerAmount: a.amount });
    neg = await Negotiation.create({
      conversationId: conversation._id, phone: conversation.customerPhone, pricingRuleId: rule._id, unitName: rule.name,
      checkIn, checkOut, nights: q.nights, listPrice: q.listTotal, floorPrice: q.floorTotal, currentOffer: q.listTotal,
      offers: [{ by: 'hotel', amount: q.listTotal, note: 'السعر الأول' }],
      policy: dyn ? { occupancyPct: dyn.occupancyPct, maxDiscountPct: dyn.maxDiscountPct, steps: dyn.concessionSteps, minRate: effRule.minRate, note: policyNote(dyn) } : undefined,
    });
  }
  await setStage(conversation._id, STAGE_ORDER.indexOf(conversation.stage) > 1 ? conversation.stage : 'quoted', {
    checkIn, checkOut, adults, children, unitId: String(rule._id), unitName: rule.name, quotedPrice: neg.currentOffer, negotiationId: String(neg._id),
  });
  return {
    available: true,
    unit_id: String(rule._id),
    unit: rule.name,
    nights: q.nights,
    price_total: neg.finalPrice || neg.currentOffer,
    price_per_night: Math.round((neg.finalPrice || neg.currentOffer) / q.nights),
    currency: config.zaaer.currency,
    negotiation_status: neg.status,
    ...(neg.policy?.note ? { pricing_note: neg.policy.note } : {}),
  };
}

/** جولة تفاوض — كل الحساب في pricing.negotiateRound */
async function negotiate(conversation, { unitRef, checkIn, checkOut, customerOffer }) {
  const rule = await findRule(unitRef || conversation.state?.unitId);
  checkIn = checkIn || conversation.state?.checkIn;
  checkOut = checkOut || conversation.state?.checkOut;
  if (!rule || !checkIn || !checkOut) throw new Error('اطلب أولاً get_price_quote لنوع الوحدة والتواريخ');
  let neg = await Negotiation.findOne({ conversationId: conversation._id, pricingRuleId: rule._id, checkIn, checkOut, status: { $in: ['open', 'accepted', 'approval_pending', 'approved'] } });
  if (!neg) {
    await priceQuote(conversation, { unitRef: String(rule._id), checkIn, checkOut, adults: conversation.state?.adults, children: conversation.state?.children });
    neg = await Negotiation.findOne({ conversationId: conversation._id, pricingRuleId: rule._id, checkIn, checkOut, status: 'open' });
    if (!neg) return { status: 'not_available', message: 'الوحدة غير متاحة لهذه التواريخ — اقترح بديلاً' };
  }
  if (neg.status === 'approval_pending') return { status: 'waiting_manager', message: 'الطلب عند المدير، أخبر العميل أنك ستعود له قريباً' };
  if (neg.status === 'approved' || neg.status === 'accepted') {
    if (customerOffer && customerOffer < neg.finalPrice) {
      // يحاول النزول أكثر بعد الاتفاق → نتابع التفاوض من السعر المتفق
      neg.status = 'open';
      neg.currentOffer = neg.finalPrice;
    } else return { status: 'agreed', price_total: neg.finalPrice };
  }

  // هامش وخطوات هذا التفاوض كما ثُبّتت عند فتحه (التسعير الذكي) — أو قاعدة النوع للتفاوضات القديمة
  const negRule = neg.policy?.maxDiscountPct != null ? { ...rule, maxDiscountPct: neg.policy.maxDiscountPct, concessionSteps: neg.policy.steps } : rule;
  const result = pricing.negotiateRound(
    { listPrice: neg.listPrice, floorPrice: neg.floorPrice, currentOffer: neg.currentOffer, round: neg.round, nights: neg.nights },
    negRule,
    customerOffer
  );
  if (customerOffer) neg.offers.push({ by: 'guest', amount: customerOffer });
  neg.round = result.round;

  let response;
  if (result.decision === 'accept') {
    neg.status = 'accepted';
    neg.finalPrice = result.price;
    neg.currentOffer = result.price;
    neg.offers.push({ by: 'hotel', amount: result.price, note: 'تم الاتفاق' });
    response = { status: 'agreed', price_total: result.price, message: 'تم الاتفاق على السعر — اعرض تثبيت الحجز (create_hold)' };
  } else if (result.decision === 'counter' || result.decision === 'final_offer') {
    neg.currentOffer = result.price;
    neg.offers.push({ by: 'hotel', amount: result.price, note: result.decision });
    response = {
      status: result.decision === 'final_offer' ? 'final_offer' : 'counter_offer',
      price_total: result.price,
      alternatives: (result.alternatives || []).map((a) => a.text),
      message: result.decision === 'final_offer'
        ? 'هذا آخر سعر ممكن — قدّمه بلطف مع البدائل'
        : 'اعرض هذا السعر بلطف مع ذكر قيمة الإقامة. لا تصفه بأنه "آخر سعر" أو "أفضل سعر"',
    };
  } else {
    response = {
      status: 'below_floor',
      price_total: neg.currentOffer,
      message: 'لا يمكنك النزول أكثر. قل للعميل إن هذا السعر يحتاج موافقة خاصة من الإدارة، واعرض أن ترفع طلبه (request_manager_approval) أو قدّم البدائل. لا تذكر "حداً" أو "المسموح" أو أي هامش.',
    };
  }
  if (neg.policy?.note && response.status !== 'agreed') response.pricing_note = neg.policy.note;
  await neg.save();
  await setStage(conversation._id, response.status === 'agreed' ? 'negotiating' : 'negotiating', { quotedPrice: neg.currentOffer, agreedPrice: neg.finalPrice || null, negotiationId: String(neg._id) });
  return response;
}

/** حجز مبدئي محلي + إرسال تعليمات الدفع (لا يُنشأ في زائر إلا بعد الدفع) */
async function createHold(conversation, { unitRef, checkIn, checkOut, adults, children, guestName }) {
  const st = conversation.state || {};
  const rule = await findRule(unitRef || st.unitId);
  checkIn = checkIn || st.checkIn;
  checkOut = checkOut || st.checkOut;
  adults = Number(adults || st.adults || 1);
  children = Number(children || st.children || 0);
  guestName = guestName || st.guestName || conversation.customerName;
  if (!rule || !checkIn || !checkOut) throw new Error('بيانات ناقصة: نوع الوحدة والتواريخ مطلوبة');
  validateDates(checkIn, checkOut);
  if (!guestName || guestName === 'عميل جديد') throw new Error('اطلب اسم النزيل الكامل أولاً');

  // تحقق أخير من التوفر (بدون cache)
  const a = await zaaer.checkAvailability({ unitTypeId: rule.zaaerUnitTypeId, ratePlanId: rule.ratePlanId, checkIn, checkOut, adults, children, fresh: true });
  if (a.error) throw new Error('تعذر التحقق من التوفر حالياً');
  if (!a.available) return { status: 'not_available', message: 'للأسف لم تعد الوحدة متاحة لهذه التواريخ — اقترح بديلاً عبر check_availability' };

  const q = pricing.quote(rule, checkIn, checkOut, { zaaerAmount: a.amount });
  const neg = await Negotiation.findOne({ conversationId: conversation._id, pricingRuleId: rule._id, checkIn, checkOut, status: { $in: ['accepted', 'approved', 'open'] } }).sort({ updatedAt: -1 });
  const agreed = neg?.finalPrice || neg?.currentOffer || q.listTotal;
  // الحد الأدنى إلا بموافقة المدير — حد التفاوض نفسه (التسعير الذكي) وليس حد قاعدة النوع الثابتة
  const price = Math.max(agreed, neg?.status === 'approved' ? 0 : neg ? neg.floorPrice : q.floorTotal);

  // حجز سابق نشط لنفس المحادثة؟ نلغيه (في زائر أيضاً) ونستبدله
  const previous = await Booking.find({ conversationId: conversation._id, status: { $in: ['hold', 'awaiting_payment'] } });
  for (const old of previous) await cancel(old.ref, 'system', 'استُبدل بحجز جديد', { silent: true });

  const holdMinutes = settings.get('holdMinutes');
  const booking = await Booking.create({
    ref: shortRef('B'), conversationId: conversation._id, phone: conversation.customerPhone, guestName,
    pricingRuleId: rule._id, unitTypeId: rule.zaaerUnitTypeId, ratePlanId: a.ratePlanId || rule.ratePlanId, unitName: rule.name,
    checkIn, checkOut, nights: q.nights, adults, children, listPrice: q.listTotal, agreedPrice: price, currency: config.zaaer.currency,
    status: 'awaiting_payment', holdExpiresAt: new Date(Date.now() + holdMinutes * 60000), negotiationId: neg?._id,
    source: 'ai', createdBy: 'ai', history: [{ status: 'hold', by: 'ai' }],
  });

  // الحجز يُنشأ في زائر فوراً بدون وصل مالي (pay_at_hotel)، ويُلغى تلقائياً إن لم يُدفع خلال المهلة
  if (config.zaaer.holdInZaaer) {
    const z = await pushToZaaer(booking, 'new', a.dailyRates);
    if (!z.ok && z.unavailable) {
      booking.status = 'cancelled';
      booking.history.push({ status: 'cancelled', by: 'system', note: 'رفض زائر: غير متاح' });
      await booking.save();
      return { status: 'not_available', message: 'للأسف لم تعد الوحدة متاحة لهذه التواريخ — اقترح بديلاً عبر check_availability' };
    }
    if (!z.ok) {
      // زائر لا يستجيب: نُبقي الحجز المبدئي محلياً ويُدخل في زائر عند الدفع
      await messenger.alertManagers(`⚠️ تعذر إنشاء الحجز المبدئي ${booking.ref} في زائر (${z.error}). سيُعاد المحاولة عند الدفع.`, { throttleKey: 'zaaer_hold' });
    }
  }
  booking.history.push({ status: 'awaiting_payment', by: 'ai' });
  await booking.save();

  if (neg) {
    neg.status = neg.status === 'approved' ? 'approved' : 'accepted';
    neg.finalPrice = price;
    await neg.save();
  }
  await setStage(conversation._id, 'awaiting_payment', { activeBookingRef: booking.ref, agreedPrice: price, guestName });
  await audit.log({ actorType: 'ai', actorPhone: conversation.customerPhone, action: 'booking.hold', target: booking.ref, details: { unit: rule.name, checkIn, checkOut, price, inZaaer: booking.inZaaer, zaaerId: booking.zaaerReservationId } });
  realtime.emit('booking_updated', booking.toObject());

  const result = {
    status: 'hold_created',
    booking_ref: booking.ref,
    unit: rule.name,
    check_in: checkIn,
    check_out: checkOut,
    price_total: price,
    currency: booking.currency,
    hold_expires_in_minutes: holdMinutes,
    payment_instructions: settings.paymentInstructions({ includeCard: settings.cardAvailable() }),
    message: 'أخبر العميل أن الحجز مبدئي وليس مؤكداً حتى الدفع، وأرسل تعليمات الدفع كما هي، واطلب صورة الإيصال',
  };
  if (settings.cardAvailable()) result.card_payment = 'متاح: يمكن إرسال رابط دفع بالبطاقة عبر send_payment_link';
  return result;
}

// ------------------------------------------------------------------ زائر: بناء البيانات والإرسال
/** توزيع السعر المتفق على الليالي مع الحفاظ على شكل daily_rates كما أرجعه quote */
function spreadDailyRates(dailyRates, total, nights) {
  nights = nights || 1;
  const perNight = Math.round((total / nights) * 100) / 100;
  const lastNight = Math.round((total - perNight * (nights - 1)) * 100) / 100;
  // quote زائر يُرجع لكل ليلة: unit_price, discount_amount, final_price, subtotal, final_amount (+ضرائب) — كلها يجب أن تطابق السعر المتفق
  const MONEY = ['amount', 'rate', 'price', 'unit_price', 'final_price', 'subtotal', 'final_amount', 'total', 'net_amount', 'gross_amount'];
  const isNum = (x) => typeof x === 'number' || (typeof x === 'string' && x !== '' && !Number.isNaN(Number(x)));
  return (dailyRates || []).map((d, i, arr) => {
    const v = i === arr.length - 1 ? lastNight : perNight;
    const out = { ...d };
    for (const k of MONEY) if (isNum(out[k])) out[k] = v;
    if (isNum(out.discount_amount)) out.discount_amount = 0;
    if (isNum(out.final_amount)) out.final_amount = Math.round((v + ['lodging_fees', 'vat', 'tax_amount'].reduce((s, k) => s + (Number(out[k]) || 0), 0)) * 100) / 100;
    return out;
  });
}

function buildZaaerPayload(booking, dailyRates, status = 'new') {
  return {
    booking_id: booking.ref, // التعريف في زائر = property_id + booking_id
    status,
    check_in_date: booking.checkIn,
    check_out_date: booking.checkOut,
    currency: booking.currency,
    guest: { name: booking.guestName, phone: '+' + booking.phone },
    rooms: [{
      unit_type_id: booking.unitTypeId,
      rate_plan_id: booking.ratePlanId,
      amount: booking.agreedPrice,
      occupancy: { adults: booking.adults, children: booking.children, infants: 0 },
      daily_rates: spreadDailyRates(dailyRates, booking.agreedPrice, booking.nights),
    }],
    totals: { room_charges: booking.agreedPrice, additional_charges: 0, discount: 0, total: booking.agreedPrice },
    // بدون دفع → لا وصل مالي. الوصل يُنشأ فقط بعد تأكيد الدفع (issueReceipt)
    booking_payment_method: 'pay_at_hotel',
  };
}

/** إنشاء (new) أو تعديل (modified) في زائر وتحديث الحجز المحلي */
async function pushToZaaer(booking, status = 'new', dailyRates) {
  if (!dailyRates) {
    const a = await zaaer.checkAvailability({ unitTypeId: booking.unitTypeId, ratePlanId: booking.ratePlanId, checkIn: booking.checkIn, checkOut: booking.checkOut, adults: booking.adults, children: booking.children });
    dailyRates = a.dailyRates || [];
  }
  const payload = buildZaaerPayload(booking, dailyRates, status);
  const res = status === 'modified' ? await zaaer.modifyReservation(payload) : await zaaer.createReservation(payload);
  if (!res.success) {
    const errText = JSON.stringify(res.error || '').slice(0, 300);
    const unavailable = [409, 422].includes(res.status) && !/booking_id_exists/.test(errText);
    // booking_id_exists = أُنشئ مسبقاً (إعادة محاولة) → نعتبره ناجحاً
    if (/booking_id_exists/.test(errText) && status === 'new') {
      booking.inZaaer = true;
      booking.zaaerPayload = payload;
      await booking.save();
      return { ok: true, already: true };
    }
    booking.history.push({ status: booking.status, by: 'system', note: `زائر رفض (${status}): ${errText}` });
    await booking.save();
    await audit.log({ actorType: 'system', action: `zaaer.${status}_failed`, target: booking.ref, details: res.error, success: false });
    return { ok: false, unavailable, manual: res.manual, error: errText };
  }
  booking.inZaaer = true;
  booking.zaaerPayload = payload;
  if (res.reservationId) booking.zaaerReservationId = res.reservationId;
  booking.zaaerResponse = res.data;
  booking.history.push({ status: booking.status, by: 'system', note: `زائر (${status}): ${res.reservationId || ''}` });
  await booking.save();
  return { ok: true, reservationId: res.reservationId };
}

// ------------------------------------------------------------------ الوصل المالي
const METHOD_AR = { cliq: 'كليك', bank: 'تحويل بنكي', cash: 'كاش', card: 'بطاقة', other: 'أخرى' };

/** إنشاء وصل مالي في زائر لدفعة مؤكدة — أو تنبيه المحاسب لإصداره يدوياً إن لم تُضبط النقطة */
async function issueReceipt(booking, payment, actor = 'system') {
  if (payment.zaaerReceiptId) return { ok: true, receiptId: payment.zaaerReceiptId, already: true };
  const r = await zaaer.createReceipt({
    reservationId: booking?.zaaerReservationId, bookingId: booking?.ref, amount: payment.amount,
    method: payment.paymentMethod, reference: payment.extracted?.reference || payment.bookingRef, notes: `${actor}`, date: new Date().toISOString().slice(0, 10),
  });
  if (r.success) {
    payment.zaaerReceiptId = r.receiptId || 'created';
    await payment.save();
    await audit.log({ actorType: 'system', actorName: actor, action: 'zaaer.receipt_created', target: booking?.ref, details: { amount: payment.amount, receiptId: payment.zaaerReceiptId } });
    return { ok: true, receiptId: payment.zaaerReceiptId };
  }
  // بديل يدوي: تنبيه المالية بالتفاصيل
  const finance = await messenger.staffByRole(['finance']);
  const to = finance.length ? finance : await messenger.staffByRole(['manager']);
  await messenger.notifyStaff(
    to.map((x) => x.phone),
    `🧾 مطلوب إصدار وصل مالي في زائر\nالحجز: ${booking?.ref || '-'}${booking?.zaaerReservationId ? ` (زائر ${booking.zaaerReservationId})` : ''} — ${booking?.guestName || ''}\nالمبلغ: ${payment.amount} ${payment.currency} — ${METHOD_AR[payment.paymentMethod] || payment.paymentMethod}${payment.extracted?.reference ? `\nمرجع: ${payment.extracted.reference}` : ''}`,
    { kind: 'alert' }
  );
  return { ok: false, manual: true, error: r.error };
}

// ------------------------------------------------------------------ بعد تأكيد الدفع
/** الدفع مؤكد ← (إن لم يكن في زائر: إنشاؤه) ← وصل مالي ← تأكيد للعميل */
async function finalizeBooking(bookingId, actor = 'system', payment = null) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new Error('الحجز غير موجود');
  if (!payment) payment = await Payment.findOne({ bookingId: booking._id, status: { $in: ['confirmed', 'paid'] } }).sort({ updatedAt: -1 });

  if (payment && !(booking.history || []).some((h) => h.note === `payment:${payment._id}`)) {
    booking.paidAmount = (booking.paidAmount || 0) + Number(payment.amount || 0);
    booking.history.push({ status: 'paid', by: actor, note: `payment:${payment._id}` });
  }
  const wasConfirmed = ['confirmed', 'checked_in', 'checked_out'].includes(booking.status);
  if (!wasConfirmed) booking.status = 'paid';
  booking.holdExpiresAt = undefined;
  await booking.save();
  if (booking.conversationId && !wasConfirmed) await setStage(booking.conversationId, 'paid');

  if (!booking.inZaaer) {
    const z = await pushToZaaer(booking, 'new');
    if (!z.ok) {
      booking.status = 'failed';
      await booking.save();
      await messenger.alertManagers(`🚨 دفع مؤكد للحجز ${booking.ref} (${booking.guestName}) لكن تعذر إدخاله في زائر${z.unavailable ? ' (الوحدة لم تعد متاحة)' : ''} — يحتاج تدخل يدوي فوراً.\n${z.error || ''}`);
      return { ok: false, message: 'فشل الإدخال في زائر — تم تنبيه المدير', booking };
    }
  }
  if (!wasConfirmed) {
    booking.status = 'zaaer_entered';
    await booking.save();
    if (booking.conversationId) await setStage(booking.conversationId, 'zaaer_entered');
  }

  let receiptNote = '';
  if (payment) {
    const rc = await issueReceipt(booking, payment, actor);
    receiptNote = rc.ok ? ` — وصل مالي ${rc.receiptId}` : ' — أُرسل تنبيه للمالية لإصدار الوصل يدوياً';
  }

  if (!wasConfirmed) {
    const ref = booking.zaaerReservationId || booking.ref;
    const tpl = settings.get('templates');
    const text =
      `✅ تم تأكيد حجزك بنجاح!\nرقم الحجز: ${ref}\nالوحدة: ${booking.unitName}\n` +
      `الوصول: ${booking.checkIn} (الدخول 2:00 م)\nالمغادرة: ${booking.checkOut} (الخروج 12:00 ظ)\nالمبلغ: ${booking.agreedPrice} ${booking.currency}` +
      `${booking.paidAmount ? ` — المدفوع: ${booking.paidAmount}` : ''}\nبانتظارك في ${settings.get('propertyName')} 🌿`;
    await messenger.send(booking.phone, { text, template: { name: tpl.bookingConfirmed, params: [booking.guestName, String(ref), booking.checkIn, booking.checkOut] }, sender: 'system' });
    booking.status = 'confirmed';
    booking.history.push({ status: 'confirmed', by: 'system' });
    await booking.save();
    if (booking.negotiationId) await Negotiation.updateOne({ _id: booking.negotiationId }, { $set: { status: 'booked', closedAt: new Date() } });
    if (booking.conversationId) await setStage(booking.conversationId, 'confirmed', { zaaerReservationId: booking.zaaerReservationId });
  }
  await audit.log({ actorType: 'system', actorName: actor, action: 'booking.paid_confirmed', target: booking.ref, details: { zaaerReservationId: booking.zaaerReservationId, price: booking.agreedPrice, paid: booking.paidAmount } });
  realtime.emit('booking_updated', booking.toObject());
  return { ok: true, message: `الحجز ${booking.zaaerReservationId || booking.ref} مؤكد${receiptNote}`, booking };
}

// ------------------------------------------------------------------ أوامر الموظفين
/** حجز مباشر من موظف: يُنشأ في زائر فوراً. الوصل المالي فقط إذا ذكر الموظف مبلغاً مدفوعاً */
/** تحقق حجز الموظف (الوحدة، التواريخ، التوفر، الحد الأدنى) — يُستدعى قبل طلب "نعم/لا" وعند التنفيذ */
async function validateStaffBooking(staff, { unitRef, checkIn, checkOut, guestName, guestPhone, price, adults = 1, children = 0 }, { fresh = true } = {}) {
  validateDates(checkIn, checkOut);
  const rule = await findRule(unitRef);
  if (!rule) throw new Error(`نوع الوحدة "${unitRef}" غير معروف`);
  if (!guestName || !guestPhone) throw new Error('اسم النزيل ورقمه مطلوبان');
  const a = await zaaer.checkAvailability({ unitTypeId: rule.zaaerUnitTypeId, ratePlanId: rule.ratePlanId, checkIn, checkOut, adults, children, fresh });
  if (a.error) throw new Error('زائر لا يستجيب حالياً');
  if (!a.available) throw new Error(`${rule.name} غير متاحة من ${checkIn} إلى ${checkOut}`);
  const q = pricing.quote(rule, checkIn, checkOut, { zaaerAmount: a.amount });
  const finalPrice = price ? Number(price) : q.listTotal;
  if (finalPrice < q.floorTotal && !['manager', 'owner'].includes(staff.role)) {
    throw new Error(`السعر ${finalPrice} أقل من الحد الأدنى المسموح (${q.floorTotal}) — يحتاج موافقة المدير`);
  }
  return { rule, a, q, finalPrice };
}

async function staffBooking(staff, { unitRef, checkIn, checkOut, guestName, guestPhone, price, adults = 1, children = 0, notes, paidAmount, paymentMethod }) {
  const { rule, a, q, finalPrice } = await validateStaffBooking(staff, { unitRef, checkIn, checkOut, guestName, guestPhone, price, adults, children });
  const phone = normalizePhone(guestPhone, config.defaultCountryCode);
  const conv = await messenger.getOrCreateConversation(phone, guestName);
  const booking = await Booking.create({
    ref: shortRef('B'), conversationId: conv._id, phone, guestName, pricingRuleId: rule._id, unitTypeId: rule.zaaerUnitTypeId,
    ratePlanId: a.ratePlanId || rule.ratePlanId, unitName: rule.name, checkIn, checkOut, nights: q.nights, adults, children,
    listPrice: q.listTotal, agreedPrice: finalPrice, currency: config.zaaer.currency, status: 'zaaer_entered', source: 'staff',
    createdBy: staff.phone, notes, history: [{ status: 'created', by: staff.name, note: 'حجز مباشر من موظف' }],
  });
  const z = await pushToZaaer(booking, 'new', a.dailyRates);
  if (!z.ok) {
    booking.status = 'failed';
    await booking.save();
    throw new Error(`رفض زائر الحجز: ${z.error}`);
  }
  await setStage(conv._id, 'zaaer_entered', { guestName, activeBookingRef: booking.ref, checkIn, checkOut, unitName: rule.name, agreedPrice: finalPrice });
  let extra = ' — بدون وصل مالي (غير مدفوع)';
  if (paidAmount > 0) {
    const pay = await Payment.create({ bookingId: booking._id, bookingRef: booking.ref, phone, method: 'manual', paymentMethod: paymentMethod || 'cash', amount: paidAmount, currency: booking.currency, status: 'confirmed', reviewedBy: staff.name, reviewedAt: new Date() });
    const r = await finalizeBooking(booking._id, staff.name, pay);
    return { ok: true, message: `✅ تم الحجز في زائر (${booking.zaaerReservationId || booking.ref}) — ${r.message}`, booking };
  }
  const tpl = settings.get('templates');
  await messenger.send(phone, {
    text: `أهلاً ${guestName} 🌿 تم تسجيل حجزك في ${settings.get('propertyName')}\nالوحدة: ${rule.name}\nمن ${checkIn} إلى ${checkOut}\nالمبلغ: ${finalPrice} ${booking.currency}\nرقم الحجز: ${booking.zaaerReservationId || booking.ref}`,
    template: { name: tpl.bookingConfirmed, params: [guestName, String(booking.zaaerReservationId || booking.ref), checkIn, checkOut] },
    sender: 'system',
  });
  realtime.emit('booking_updated', booking.toObject());
  return { ok: true, message: `✅ تم الحجز في زائر (${booking.zaaerReservationId || booking.ref})${extra}`, booking };
}

/** إيجاد حجز محلي برقمنا أو رقم زائر أو رقم/اسم العميل */
async function findBooking(ref) {
  if (!ref) return null;
  const s = String(ref).trim();
  const phone = normalizePhone(s, config.defaultCountryCode);
  const active = { status: { $nin: ['cancelled', 'expired'] } };
  return (
    (await Booking.findOne({ ref: s })) ||
    (await Booking.findOne({ zaaerReservationId: s })) ||
    (/^\d{9,}$/.test(phone) ? await Booking.findOne({ phone, ...active }).sort({ checkIn: 1, createdAt: -1 }) : null) ||
    (await Booking.findOne({ guestName: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ...active }).sort({ createdAt: -1 }))
  );
}

/**
 * حساب التعديل (بدون حفظ): الوحدة والتواريخ والسعر الجديد — يُستخدم للمعاينة قبل "نعم/لا" وعند التنفيذ
 * لا نرفض هنا عند available=false لأن الحجز نفسه قد يشغل الوحدة؛ زائر يقرر عند status=modified
 */
async function planModification(staff, booking, changes = {}, { fresh = false } = {}) {
  const rule = changes.unitRef ? await findRule(changes.unitRef) : await PricingRule.findById(booking.pricingRuleId).lean();
  if (changes.unitRef && !rule) throw new Error(`نوع الوحدة "${changes.unitRef}" غير معروف`);
  const checkIn = changes.checkIn || booking.checkIn;
  const checkOut = changes.checkOut || booking.checkOut;
  if (checkOut <= checkIn) throw new Error('تاريخ المغادرة يجب أن يكون بعد الوصول');
  const datesOrUnitChanged = checkIn !== booking.checkIn || checkOut !== booking.checkOut || (rule && rule.zaaerUnitTypeId !== booking.unitTypeId);
  if (!datesOrUnitChanged && !changes.price) return { changed: false, checkIn, checkOut, newPrice: booking.agreedPrice };

  const a = await zaaer.checkAvailability({ unitTypeId: rule.zaaerUnitTypeId, ratePlanId: rule.ratePlanId, checkIn, checkOut, adults: changes.adults || booking.adults, children: changes.children ?? booking.children, fresh });
  if (a.error) throw new Error('زائر لا يستجيب حالياً');
  const q = pricing.quote(rule, checkIn, checkOut, { zaaerAmount: a.amount });
  // السعر: المحدد من الموظف، أو نفس نسبة الخصم السابقة على السعر الجديد
  let newPrice = changes.price ? Number(changes.price) : datesOrUnitChanged ? Math.round(q.listTotal * (booking.agreedPrice / (booking.listPrice || booking.agreedPrice))) : booking.agreedPrice;
  const privileged = ['manager', 'owner'].includes(staff.role);
  if (newPrice < q.floorTotal && !privileged && changes.price) {
    throw new Error(`السعر ${newPrice} أقل من الحد الأدنى (${q.floorTotal}) — يحتاج موافقة المدير`);
  }
  newPrice = Math.max(newPrice, privileged ? 0 : q.floorTotal);
  return { changed: true, rule, a, q, checkIn, checkOut, newPrice, dailyRates: a.dailyRates };
}

const ZAAER_CLOSED = ['cancelled', 'canceled', 'checked_out', 'no_show'];

/**
 * حجز في زائر غير مُنشأ عبر النظام (walk-in / OTA): برقم REV، أو رقم الوحدة ("غرفة 1")، أو اسم/هاتف
 * عند البحث بالوحدة أو الاسم نختار الأنسب: المقيم الآن ← الحالي ← القادم، والملغى أخيراً
 */
async function findZaaerReservation(ref) {
  const s = String(ref || '').trim();
  if (!s) return null;
  const unit = s.match(/^(?:غرفة|غرفه|شقة|شقه|الشقة|الغرفة|وحدة|room|unit)?\s*#?\s*(\d{1,4})$/i);
  let list;
  if (/^rev\d+$/i.test(s)) return (await zaaer.searchReservations(s))[0] || null;
  if (unit) {
    const all = await zaaer.getAllReservations();
    list = all.filter((r) => (r.rooms || []).some((x) => String(x.unit_name ?? '').trim() === unit[1] || String(x.unit_number ?? '') === unit[1]));
  } else {
    list = /\d{6,}/.test(s.replace(/\D/g, '')) ? await zaaer.getReservationsByPhone(s) : await zaaer.searchReservations(s);
  }
  const today = todayISO(config.timezone);
  const rank = (r) => {
    const st = String(r.reservation_status || '').toLowerCase();
    if (st === 'checked_in') return 0;
    if (ZAAER_CLOSED.includes(st)) return 9;
    if (r.check_in_date <= today && r.check_out_date >= today) return 1;
    if (r.check_in_date > today) return 2;
    return 5;
  };
  return list.sort((a, b) => rank(a) - rank(b) || String(a.check_in_date).localeCompare(String(b.check_in_date)))[0] || null;
}

function zaaerLabel(r) {
  const units = (r.rooms || []).map((x) => x.unit_name).filter(Boolean).join('، ');
  return `${r.number} — ${r.guest?.name || '-'} (شقة ${units || '-'}، ${r.check_in_date} ← ${r.check_out_date}، ${r.reservation_status})`;
}

function changesText(changes, r = {}) {
  return [
    changes.checkIn && `الوصول ${r.check_in_date || ''} ← ${changes.checkIn}`,
    changes.checkOut && `المغادرة ${r.check_out_date || ''} ← ${changes.checkOut}`,
    changes.unitRef && `الوحدة ← ${changes.unitRef}`,
    changes.price && `السعر ← ${changes.price}`,
    changes.guestName && `الاسم ← ${changes.guestName}`,
    changes.adults && `البالغين ← ${changes.adults}`,
  ].filter(Boolean).join('، ') || JSON.stringify(changes);
}

/** حجز زائر فقط: يُرفض إن كان ملغى/منتهياً — وإلا { reservation } */
async function resolveZaaerOnly(ref) {
  const r = await findZaaerReservation(ref);
  if (!r) throw new Error(`لم أجد الحجز "${ref}" لا في النظام ولا في زائر`);
  if (ZAAER_CLOSED.includes(String(r.reservation_status).toLowerCase())) throw new Error(`الحجز ${zaaerLabel(r)} ملغى أو منتهٍ في زائر — لا يمكن تعديله`);
  return r;
}

/** معاينة التعديل لرسالة التأكيد: { booking, plan } أو { zaaerReservation } لحجز زائر فقط، أو خطأ */
async function previewModification(staff, ref, changes) {
  const booking = await findBooking(ref);
  if (!booking) return { booking: null, zaaerReservation: await resolveZaaerOnly(ref) };
  if (['cancelled', 'expired', 'checked_out'].includes(booking.status)) throw new Error(`لا يمكن تعديل حجز حالته ${booking.status}`);
  return { booking, plan: await planModification(staff, booking, changes) };
}

/** تعديل حجز (تواريخ/وحدة/سعر/اسم/عدد) — في زائر عبر status=modified */
async function modifyBooking(staff, ref, changes = {}) {
  const booking = await findBooking(ref);
  if (!booking) {
    // حجز أُدخل في زائر يدوياً أو من OTA: زائر يسمح بتعديل حجوزات الـ API فقط (بـ booking_id الخاص بنا)
    let r;
    try {
      r = await resolveZaaerOnly(ref);
    } catch (err) {
      return { ok: false, message: err.message };
    }
    const what = changesText(changes, r);
    await notifyManual('تعديل', zaaerLabel(r), staff.name, what);
    return {
      ok: false, manual: true,
      message: `الحجز ${zaaerLabel(r)} مُدخل في زائر ${r.booking_source === 'ota' ? 'من منصة حجز' : 'يدوياً'} — زائر لا يسمح بتعديله عبر الـ API.\nأُرسل للاستقبال لتنفيذه يدوياً: ${what}`,
    };
  }
  if (['cancelled', 'expired', 'checked_out'].includes(booking.status)) return { ok: false, message: `لا يمكن تعديل حجز حالته ${booking.status}` };
  const before = { checkIn: booking.checkIn, checkOut: booking.checkOut, unitName: booking.unitName, price: booking.agreedPrice, guestName: booking.guestName };

  const plan = await planModification(staff, booking, changes, { fresh: true });
  const dailyRates = plan.dailyRates;
  if (plan.changed) {
    const { rule, q, a } = plan;
    Object.assign(booking, { checkIn: plan.checkIn, checkOut: plan.checkOut, nights: q.nights, listPrice: q.listTotal, agreedPrice: plan.newPrice, pricingRuleId: rule._id, unitTypeId: rule.zaaerUnitTypeId, ratePlanId: a.ratePlanId || rule.ratePlanId, unitName: rule.name });
  }
  if (changes.guestName) booking.guestName = changes.guestName;
  if (changes.adults) booking.adults = changes.adults;
  if (changes.children !== undefined && changes.children !== null) booking.children = changes.children;
  if (changes.notes) booking.notes = changes.notes;

  if (booking.inZaaer) {
    const z = await pushToZaaer(booking, 'modified', dailyRates);
    if (!z.ok) {
      if (z.manual) await notifyManual('تعديل', booking.zaaerReservationId || booking.ref, staff.name, JSON.stringify(changes));
      return { ok: false, message: z.unavailable ? 'التعديل غير ممكن: الوحدة غير متاحة للتواريخ الجديدة' : `رفض زائر التعديل: ${z.error}` };
    }
  } else {
    await booking.save();
  }
  booking.history.push({ status: booking.status, by: staff.name, note: `تعديل: ${JSON.stringify(before)} ← ${booking.checkIn}/${booking.checkOut}/${booking.unitName}/${booking.agreedPrice}` });
  await booking.save();
  if (booking.conversationId) await setStage(booking.conversationId, (await Conversation.findById(booking.conversationId).lean())?.stage || 'confirmed', { checkIn: booking.checkIn, checkOut: booking.checkOut, unitName: booking.unitName, agreedPrice: booking.agreedPrice });
  await audit.log({ actorType: 'staff', actorName: staff.name, actorPhone: staff.phone, action: 'booking.modified', target: booking.ref, details: { before, after: { checkIn: booking.checkIn, checkOut: booking.checkOut, unit: booking.unitName, price: booking.agreedPrice, guestName: booking.guestName } } });
  if (changes.notifyGuest !== false) {
    await messenger.send(booking.phone, { text: `تم تعديل حجزك ${booking.zaaerReservationId || booking.ref} ✅\nالوحدة: ${booking.unitName}\nمن ${booking.checkIn} إلى ${booking.checkOut}\nالمبلغ: ${booking.agreedPrice} ${booking.currency}`, sender: 'system' });
  }
  realtime.emit('booking_updated', booking.toObject());
  const due = Math.max(0, booking.agreedPrice - (booking.paidAmount || 0));
  return { ok: true, message: `✅ تم تعديل الحجز ${booking.zaaerReservationId || booking.ref}: ${booking.unitName}، ${booking.checkIn} ← ${booking.checkOut}، ${booking.agreedPrice} ${booking.currency}${due ? ` (المتبقي ${due})` : ''}`, booking };
}

/** تسجيل الوصول / المغادرة */
async function checkInGuest(staff, ref, roomNumber) {
  const booking = await findBooking(ref);
  const zaaerId = booking?.zaaerReservationId || (!booking ? (await findZaaerReservation(ref).catch(() => null))?.number || ref : null);
  const r = await zaaer.checkIn({ reservationId: zaaerId, bookingId: booking?.ref, unitNumber: roomNumber });
  if (!r.success && !r.manual) return { ok: false, message: `رفض زائر تسجيل الوصول: ${JSON.stringify(r.error).slice(0, 200)}` };
  if (r.manual) await notifyManual('تسجيل وصول', `${zaaerId || ref}${roomNumber ? ` — غرفة ${roomNumber}` : ''}`, staff.name, '');
  let due = 0;
  if (booking) {
    booking.status = 'checked_in';
    booking.checkedInAt = new Date();
    if (roomNumber) booking.roomNumber = roomNumber;
    booking.history.push({ status: 'checked_in', by: staff.name, note: roomNumber ? `غرفة ${roomNumber}` : '' });
    await booking.save();
    due = Math.max(0, booking.agreedPrice - (booking.paidAmount || 0));
    if (booking.conversationId) {
      await setStage(booking.conversationId, 'in_house', { roomNumber: roomNumber || booking.roomNumber });
      await messenger.send(booking.phone, {
        text: `أهلاً وسهلاً ${booking.guestName} في ${settings.get('propertyName')} 🌿${roomNumber ? `\nشقتك رقم ${roomNumber}` : ''}\nلأي طلب (مناشف، تنظيف، صيانة، توصيل) راسلنا هنا مباشرة، كتابةً أو صوتاً.`,
        sender: 'system',
      });
    }
    realtime.emit('booking_updated', booking.toObject());
  }
  await audit.log({ actorType: 'staff', actorName: staff.name, actorPhone: staff.phone, action: 'booking.checked_in', target: booking?.ref || ref, details: { roomNumber, zaaer: r.success ? 'ok' : 'manual' } });
  return { ok: true, message: `✅ تم تسجيل وصول ${booking?.guestName || ref}${roomNumber ? ` — غرفة ${roomNumber}` : ''}${r.manual ? ' (أُرسل تنبيه لتسجيله في زائر يدوياً)' : ' في زائر'}${due ? `\n⚠️ متبقٍ عليه ${due} ${booking.currency}` : ''}` };
}

/** رسالة رفض المغادرة إن كان على النزيل مبلغ متبقٍ (null = مسموح) */
function checkoutBlock(booking) {
  const due = booking ? Math.max(0, booking.agreedPrice - (booking.paidAmount || 0)) : 0;
  return due > 0 ? `⚠️ لا يمكن تسجيل المغادرة: متبقٍ على ${booking.guestName} مبلغ ${due} ${booking.currency}. سجّل وصلاً مالياً أولاً.` : null;
}

async function checkOutGuest(staff, ref) {
  const booking = await findBooking(ref);
  // الرصيد أولاً — قبل أي استدعاء لزائر أو تنبيه يدوي (وإلا يُسجَّل الخروج في زائر رغم الرفض)
  const blocked = checkoutBlock(booking);
  if (blocked) return { ok: false, message: blocked };
  const zaaerId = booking?.zaaerReservationId || (!booking ? (await findZaaerReservation(ref).catch(() => null))?.number || ref : null);
  const r = await zaaer.checkOut({ reservationId: zaaerId, bookingId: booking?.ref });
  if (!r.success && !r.manual) return { ok: false, message: `رفض زائر تسجيل المغادرة: ${JSON.stringify(r.error).slice(0, 200)}` };
  if (r.manual) await notifyManual('تسجيل مغادرة', zaaerId || ref, staff.name, '');
  if (booking) {
    booking.status = 'checked_out';
    booking.checkedOutAt = new Date();
    booking.history.push({ status: 'checked_out', by: staff.name });
    await booking.save();
    if (booking.conversationId) await setStage(booking.conversationId, 'confirmed', { roomNumber: null });
    realtime.emit('booking_updated', booking.toObject());
  }
  await audit.log({ actorType: 'staff', actorName: staff.name, actorPhone: staff.phone, action: 'booking.checked_out', target: booking?.ref || ref });
  return { ok: true, message: `✅ تم تسجيل مغادرة ${booking?.guestName || ref}${r.manual ? ' (أُرسل تنبيه لتسجيلها في زائر يدوياً)' : ''}` };
}

/** إلغاء — للحجوزات المُنشأة عبر النظام يُلغى في زائر (status=cancelled)، وغيرها تنبيه يدوي */
async function cancel(ref, actor, reason = '', { silent = false } = {}) {
  const booking = await findBooking(ref);
  if (!booking) {
    await notifyManual('إلغاء', ref, actor, reason);
    return { ok: true, manual: true, message: `الحجز ${ref} غير مُنشأ عبر النظام — أُرسل تنبيه للاستقبال لإلغائه يدوياً في زائر` };
  }
  if (['cancelled', 'expired'].includes(booking.status)) return { ok: true, message: `الحجز ${booking.ref} ملغى مسبقاً` };
  let msg = `تم إلغاء الحجز ${booking.zaaerReservationId || booking.ref}`;
  if (booking.inZaaer) {
    const r = await zaaer.cancelReservation(booking.zaaerPayload || buildZaaerPayload(booking, [], 'cancelled'));
    if (!r.success) {
      if (!r.manual) return { ok: false, message: `رفض زائر الإلغاء — لم يتغير شيء (${JSON.stringify(r.error).slice(0, 150)})` };
      await notifyManual('إلغاء', booking.zaaerReservationId || booking.ref, actor, reason);
      msg += ' محلياً — وأُرسل تنبيه لإلغائه يدوياً في زائر';
    } else msg += ' في زائر';
  }
  booking.status = 'cancelled';
  booking.history.push({ status: 'cancelled', by: actor, note: reason });
  await booking.save();
  if (!silent && booking.conversationId) await setStage(booking.conversationId, 'lost', { activeBookingRef: null });
  if (booking.paidAmount > 0) msg += `\n⚠️ مدفوع ${booking.paidAmount} ${booking.currency} — راجع الاسترداد`;
  await audit.log({ actorType: actor === 'system' ? 'system' : 'staff', actorName: actor, action: 'booking.cancelled', target: booking.ref, details: { reason, inZaaer: booking.inZaaer } });
  realtime.emit('booking_updated', booking.toObject());
  return { ok: true, message: msg, booking };
}

async function notifyManual(what, ref, actor, details) {
  const reception = await messenger.staffByRole(['reception', 'manager']);
  await messenger.notifyStaff(reception.map((s) => s.phone), `❗ مطلوب ${what} يدوياً في زائر: ${ref}\nبطلب: ${actor}${details ? `\n${details}` : ''}`, { kind: 'alert' });
}

/** انتهاء الحجوزات المبدئية غير المدفوعة ← إلغاؤها في زائر */
async function expireHolds() {
  const expired = await Booking.find({ status: { $in: ['hold', 'awaiting_payment'] }, holdExpiresAt: { $lt: new Date() } });
  for (const b of expired) {
    const pendingPay = await Payment.exists({ bookingId: b._id, status: 'pending' });
    if (pendingPay) continue; // إيصال قيد المراجعة — لا نُلغي
    const c = await cancel(b.ref, 'system', 'انتهت مهلة الدفع', { silent: true });
    if (!c.ok) {
      // زائر رفض الإلغاء: لا نعتبره منتهياً (وإلا تبقى الشقة محجوزة في زائر بلا متابعة) — نعيد المحاولة في الدورة التالية
      await messenger.alertManagers(`⚠️ انتهت مهلة الحجز ${b.ref} لكن تعذر إلغاؤه في زائر: ${c.message}`, { throttleKey: `expire_${b.ref}`, throttleMinutes: 60 });
      continue;
    }
    await Booking.updateOne({ _id: b._id }, { $set: { status: 'expired' } });
    if (b.negotiationId) await Negotiation.updateOne({ _id: b.negotiationId, status: { $ne: 'booked' } }, { $set: { status: 'lost', closedAt: new Date() } });
    if (b.conversationId) await setStage(b.conversationId, 'lost', { activeBookingRef: null });
    const tpl = settings.get('templates');
    await messenger.send(b.phone, {
      text: `انتهت مهلة الحجز المبدئي (${b.ref}) لعدم وصول الدفع. إذا ما زلت ترغب بالحجز راسلنا ونرتّبه لك من جديد 🌿`,
      template: { name: tpl.holdExpired, params: [b.guestName || 'ضيفنا', b.ref] },
      sender: 'system',
    });
    await audit.log({ action: 'booking.expired', target: b.ref });
  }
}

module.exports = { checkAvailability, priceQuote, negotiate, createHold, finalizeBooking, staffBooking, validateStaffBooking, previewModification, checkoutBlock, findZaaerReservation, zaaerLabel, dynamicRuleFor, occupancyFor, modifyBooking, checkInGuest, checkOutGuest, issueReceipt, findBooking, cancel, expireHolds, findRule, listRules, setStage, validateDates, buildZaaerPayload, spreadDailyRates };
