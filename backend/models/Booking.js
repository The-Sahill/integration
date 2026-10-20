// models/Booking.js — الحجز المحلي (Pipeline) قبل/بعد إدخاله في زائر
const mongoose = require('mongoose');

const BOOKING_STATUSES = [
  'checked_in',       // تم تسجيل الوصول
  'checked_out',      // غادر
  'hold',             // حجز مبدئي
  'awaiting_payment', // بانتظار الدفع
  'paid',             // تم الدفع
  'zaaer_entered',    // مُدخل في زائر
  'confirmed',        // مؤكد (أُبلغ العميل)
  'expired',          // انتهت مهلة الدفع
  'cancelled',
  'failed',           // فشل الإدخال في زائر — يحتاج تدخل
];

const bookingSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true }, // B-XXXXXX — يُستخدم كـ reference_number في زائر
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
    phone: { type: String, index: true },
    guestName: { type: String },
    pricingRuleId: { type: mongoose.Schema.Types.ObjectId, ref: 'PricingRule' },
    unitTypeId: { type: Number }, // unit_type_id في زائر
    ratePlanId: { type: Number },
    unitName: { type: String },
    checkIn: { type: String, required: true },
    checkOut: { type: String, required: true },
    nights: { type: Number },
    adults: { type: Number, default: 1 },
    children: { type: Number, default: 0 },
    listPrice: { type: Number },   // السعر الأساسي الكامل
    agreedPrice: { type: Number }, // السعر النهائي المتفق عليه (إجمالي)
    currency: { type: String, default: 'JOD' },
    status: { type: String, enum: BOOKING_STATUSES, default: 'hold', index: true },
    holdExpiresAt: { type: Date, index: true },
    zaaerReservationId: { type: String },
    inZaaer: { type: Boolean, default: false },       // أُنشئ في زائر (بدون وصل مالي حتى الدفع)
    zaaerPayload: { type: mongoose.Schema.Types.Mixed }, // آخر بيانات أُرسلت لزائر (للتعديل والإلغاء بنفس booking_id)
    paidAmount: { type: Number, default: 0 },
    roomNumber: { type: String },
    checkedInAt: { type: Date },
    checkedOutAt: { type: Date },
    zaaerResponse: { type: mongoose.Schema.Types.Mixed },
    negotiationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Negotiation' },
    source: { type: String, default: 'ai' }, // ai | staff | dashboard
    createdBy: { type: String }, // رقم الموظف أو 'ai'
    notes: { type: String, default: '' },
    history: [{ at: { type: Date, default: Date.now }, status: String, by: String, note: String }],
  },
  { timestamps: true }
);

bookingSchema.statics.STATUSES = BOOKING_STATUSES;

module.exports = mongoose.model('Booking', bookingSchema);
