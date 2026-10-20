// models/Negotiation.js — سجل كل تفاوض للتحليل
const mongoose = require('mongoose');

const negotiationSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', index: true },
    phone: { type: String, index: true },
    pricingRuleId: { type: mongoose.Schema.Types.ObjectId, ref: 'PricingRule' },
    unitName: String,
    checkIn: String,
    checkOut: String,
    nights: Number,
    listPrice: Number,    // السعر الأول المعروض (إجمالي)
    floorPrice: Number,   // الحد الأدنى المحسوب (إجمالي) — لا يُكشف للعميل
    currentOffer: Number, // آخر سعر عرضناه
    round: { type: Number, default: 0 },
    offers: [{ by: String, amount: Number, at: { type: Date, default: Date.now }, note: String }],
    status: {
      type: String,
      enum: ['open', 'accepted', 'approval_pending', 'approved', 'rejected', 'lost', 'booked'],
      default: 'open',
      index: true,
    },
    finalPrice: Number,
    closedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Negotiation', negotiationSchema);
