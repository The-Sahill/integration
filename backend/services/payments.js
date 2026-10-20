// services/payments.js — إيصالات التحويل (مراجعة المالية) وروابط الدفع من زائر
const { Payment, Booking, PendingAction, Staff } = require('../models');
const messenger = require('./messenger');
const bookings = require('./bookings');
const zaaer = require('./zaaer');
const audit = require('./audit');
const media = require('./media');
const wa = require('./whatsapp');
const realtime = require('./realtime');
const config = require('../config');

async function activeBookingFor(conversation) {
  const ref = conversation.state?.activeBookingRef;
  if (ref) {
    const b = await Booking.findOne({ ref });
    if (b && ['hold', 'awaiting_payment', 'failed', 'zaaer_entered'].includes(b.status)) return b;
  }
  return Booking.findOne({ conversationId: conversation._id, status: { $in: ['hold', 'awaiting_payment'] } }).sort({ createdAt: -1 });
}

/** العميل أرسل صورة إيصال ← تُرسل للمالية مع أزرار تأكيد/رفض */
async function submitReceipt(conversation, { mediaPath, mimeType, extracted }) {
  const booking = await activeBookingFor(conversation);
  const payment = await Payment.create({
    bookingId: booking?._id, bookingRef: booking?.ref, phone: conversation.customerPhone, method: 'receipt', paymentMethod: require('./finance').methodFromText(`${extracted?.method || ''} ${extracted?.beneficiary_name || ''}`),
    amount: extracted?.amount, currency: extracted?.currency || config.zaaer.currency, extracted, mediaPath, status: 'pending',
  });
  // المراجعون: كل موظف يملك صلاحية تأكيد الدفع (المالية والمدير والمالك + من مُنح الصلاحية خصيصاً)
  const { allowedToolNames } = require('./tools');
  const reviewers = (await Staff.find({ active: true }).lean()).filter((s) => s.role !== 'owner' && allowedToolNames(s).includes('confirm_payment'));
  await PendingAction.create({
    type: 'payment_review', requestedBy: conversation.customerPhone, targetPhones: reviewers.map((r) => r.phone),
    relatedId: String(payment._id), summary: `مراجعة دفع ${booking?.ref || 'بدون حجز'}`, expiresAt: new Date(Date.now() + 48 * 3600000),
  });

  const mismatch = booking && extracted?.amount && Number(extracted.amount) + 0.01 < Number(booking.agreedPrice);
  const text =
    `💳 إيصال دفع جديد\nالعميل: ${conversation.customerName} (+${conversation.customerPhone})\n` +
    (booking ? `الحجز: ${booking.ref} — ${booking.unitName}\n${booking.checkIn} ← ${booking.checkOut}\nالمطلوب: ${booking.agreedPrice} ${booking.currency}\n` : '⚠️ لا يوجد حجز مبدئي نشط لهذا العميل\n') +
    `المقروء من الإيصال: ${extracted?.amount ?? '؟'} ${extracted?.currency || ''} — ${extracted?.date || '؟'} — ${extracted?.payer_name || '؟'}${extracted?.reference ? ` — مرجع ${extracted.reference}` : ''}` +
    (mismatch ? '\n⚠️ المبلغ أقل من المطلوب!' : '');
  await messenger.notifyStaff(reviewers.map((r) => r.phone), text, {
    kind: 'decision',
    buttons: [
      { id: `pay:ok:${payment._id}`, title: '✅ تأكيد الدفع' },
      { id: `pay:no:${payment._id}`, title: '❌ رفض' },
    ],
  });
  // إرسال صورة الإيصال نفسها
  if (mediaPath) {
    try {
      const id = await wa.uploadMedia(media.read(mediaPath), mimeType || 'image/jpeg', mediaPath);
      for (const r of reviewers) await wa.sendImage(r.phone, { mediaId: id }, `إيصال ${booking?.ref || ''}`);
    } catch (err) {
      console.error('⚠️ تعذر إرسال صورة الإيصال للمالية:', err.message);
    }
  }
  await audit.log({ actorType: 'guest', actorPhone: conversation.customerPhone, action: 'payment.receipt_submitted', target: booking?.ref, details: extracted });
  realtime.emit('payment_updated', payment.toObject());
  return { payment, booking };
}

async function findPayment(ref) {
  if (/^[a-f0-9]{24}$/i.test(String(ref))) return Payment.findById(ref);
  return Payment.findOne({ bookingRef: ref, status: 'pending' }).sort({ createdAt: -1 });
}

async function confirm(paymentRef, actor) {
  const payment = await findPayment(paymentRef);
  if (!payment) return { ok: false, message: 'لا يوجد دفع معلّق بهذا المرجع' };
  if (payment.status !== 'pending') return { ok: false, message: `تمت مراجعة هذا الدفع مسبقاً (${payment.status})` };
  payment.status = 'confirmed';
  payment.reviewedBy = actor.name || actor.phone;
  payment.reviewedAt = new Date();
  await payment.save();
  await PendingAction.updateMany({ type: 'payment_review', relatedId: String(payment._id), status: 'pending' }, { $set: { status: 'executed', decidedBy: actor.phone, decidedAt: new Date() } });
  await audit.log({ actorType: 'staff', actorName: actor.name, actorPhone: actor.phone, action: 'payment.confirm', target: payment.bookingRef, details: { amount: payment.amount } });
  realtime.emit('payment_updated', payment.toObject());
  if (!payment.bookingId) return { ok: true, message: 'تم تأكيد الدفع — لا يوجد حجز مرتبط، أنشئ الحجز يدوياً' };
  const result = await bookings.finalizeBooking(payment.bookingId, actor.name || actor.phone, payment);
  return { ok: result.ok, message: `✅ تم تأكيد الدفع. ${result.message}` };
}

async function reject(paymentRef, actor, reason = '') {
  const payment = await findPayment(paymentRef);
  if (!payment) return { ok: false, message: 'لا يوجد دفع معلّق بهذا المرجع' };
  if (payment.status !== 'pending') return { ok: false, message: `تمت مراجعة هذا الدفع مسبقاً (${payment.status})` };
  payment.status = 'rejected';
  payment.reviewedBy = actor.name || actor.phone;
  payment.reviewedAt = new Date();
  payment.rejectReason = reason;
  await payment.save();
  await PendingAction.updateMany({ type: 'payment_review', relatedId: String(payment._id), status: 'pending' }, { $set: { status: 'rejected', decidedBy: actor.phone, decidedAt: new Date() } });
  await messenger.send(payment.phone, {
    text: `نعتذر، لم نتمكن من تأكيد الدفع${reason ? ` (${reason})` : ''}. يرجى التأكد من التحويل وإرسال الإيصال مرة أخرى، أو التواصل معنا 🙏`,
    sender: 'system',
  });
  await audit.log({ actorType: 'staff', actorName: actor.name, actorPhone: actor.phone, action: 'payment.reject', target: payment.bookingRef, details: { reason } });
  realtime.emit('payment_updated', payment.toObject());
  return { ok: true, message: '❌ تم رفض الدفع وإبلاغ العميل' };
}

/** رابط دفع بالبطاقة من زائر */
async function createCheckoutLink(conversation) {
  if (!require('./settings').cardAvailable()) throw new Error('الدفع بالبطاقة غير مفعّل');
  const booking = await activeBookingFor(conversation);
  if (!booking) throw new Error('لا يوجد حجز مبدئي نشط — أنشئ create_hold أولاً');
  const webhookUrl = `${config.publicUrl.replace(/\/$/, '')}/webhook/zaaer/payments?ref=${encodeURIComponent(booking.ref)}`;
  const co = await zaaer.createPaymentCheckout({
    amount: booking.agreedPrice, currency: booking.currency, referenceNumber: booking.ref, guestName: booking.guestName,
    guestPhone: booking.phone, description: `Reservation ${booking.ref}: ${booking.unitName} ${booking.checkIn} → ${booking.checkOut}`, webhookUrl, returnUrl: config.zaaer.paymentReturnUrl || undefined,
  });
  if (!co.url) throw new Error('لم يُرجع زائر رابط الدفع');
  await Payment.create({
    bookingId: booking._id, bookingRef: booking.ref, phone: booking.phone, method: 'checkout', paymentMethod: 'card', amount: booking.agreedPrice,
    currency: booking.currency, status: 'pending', checkout: co,
  });
  await audit.log({ actorType: 'ai', actorPhone: booking.phone, action: 'payment.checkout_created', target: booking.ref });
  return { payment_url: co.url, amount: booking.agreedPrice, currency: booking.currency, booking_ref: booking.ref };
}

/** معالجة نتيجة الدفع (من webhook أو الاستطلاع الدوري) */
async function applyCheckoutResult(payment, result, source) {
  if (payment.status !== 'pending') return;
  payment.checkout.raw = result;
  payment.checkout.status = result?.status;
  if (zaaer.isCheckoutPaid(result)) {
    payment.status = 'paid';
    await payment.save();
    await audit.log({ actorType: 'system', action: 'payment.card_paid', target: payment.bookingRef, details: { source } });
    realtime.emit('payment_updated', payment.toObject());
    await bookings.finalizeBooking(payment.bookingId, 'zaaer-checkout', payment);
  } else if (zaaer.isCheckoutFailed(result)) {
    payment.status = 'failed';
    await payment.save();
    realtime.emit('payment_updated', payment.toObject());
    await messenger.send(payment.phone, { text: 'لم تكتمل عملية الدفع بالبطاقة 😕 يمكنك المحاولة مرة أخرى أو الدفع عبر كليك/التحويل.', sender: 'system' });
  } else {
    await payment.save();
  }
}

async function pollCheckouts() {
  if (!config.zaaer.checkoutEnabled) return;
  const pending = await Payment.find({ method: 'checkout', status: 'pending', createdAt: { $gt: new Date(Date.now() - 48 * 3600000) } });
  for (const p of pending) {
    try {
      const r = await zaaer.getPaymentCheckout(p.checkout.paymentLinkId);
      await applyCheckoutResult(p, r, 'poll');
    } catch (err) {
      console.error('⚠️ فشل استطلاع حالة الدفع:', err.message);
    }
  }
}

module.exports = { submitReceipt, confirm, reject, createCheckoutLink, applyCheckoutResult, pollCheckouts, activeBookingFor };
