// models/Payment.js — إيصالات التحويل وروابط الدفع من زائر
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', index: true },
    bookingRef: { type: String, index: true },
    phone: { type: String },
    method: { type: String, enum: ['receipt', 'checkout', 'manual'], default: 'receipt' },
    // قناة الدفع الفعلية (للأرصدة): cliq | bank | cash | card | other
    paymentMethod: { type: String, default: 'other' },
    zaaerReceiptId: { type: String }, // رقم الوصل المالي في زائر بعد إنشائه
    amount: { type: Number },
    currency: { type: String, default: 'JOD' },
    extracted: { type: mongoose.Schema.Types.Mixed }, // ما قرأه Gemini من الإيصال
    mediaPath: { type: String },
    status: { type: String, enum: ['pending', 'confirmed', 'rejected', 'paid', 'failed', 'expired'], default: 'pending', index: true },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    rejectReason: { type: String },
    checkout: {
      paymentLinkId: String,
      url: String,
      webhookSecret: String,
      status: String,
      raw: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
