// models/Conversation.js — المحادثة كوحدة كاملة (الرسائل في مجموعة Message منفصلة)
const mongoose = require('mongoose');

const STAGES = [
  'new',              // جديد
  'quoted',           // تم عرض السعر
  'negotiating',      // تفاوض
  'hold',             // حجز مبدئي
  'awaiting_payment', // بانتظار الدفع
  'paid',             // تم الدفع
  'zaaer_entered',    // مُدخل في زائر
  'confirmed',        // مؤكد
  'lost',             // مغلق بدون حجز
  'in_house',         // نزيل حالي
];

const conversationSchema = new mongoose.Schema(
  {
    // أبقينا أسماء الحقول القديمة لتسهيل الترحيل من النسخة السابقة
    customerPhone: { type: String, required: true, unique: true, index: true }, // أرقام فقط: 9627xxxxxxxx
    customerName: { type: String, default: 'عميل جديد' },
    isStaff: { type: Boolean, default: false },
    aiEnabled: { type: Boolean, default: true },
    status: { type: String, default: 'active' },
    stage: { type: String, enum: STAGES, default: 'new', index: true },
    stageUpdatedAt: { type: Date, default: Date.now },

    // ذاكرة المحادثة
    summary: { type: String, default: '' },
    summarizedCount: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    state: { type: mongoose.Schema.Types.Mixed, default: {} }, // تواريخ، عدد، سعر معروض، حجز نشط...

    lastMessage: { type: String, default: '' },
    lastTime: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastInboundAt: { type: Date }, // لحساب نافذة 24 ساعة
    unread: { type: Number, default: 0 },

    followUp: {
      count: { type: Number, default: 0 },
      lastAt: { type: Date },
    },
    handoff: {
      active: { type: Boolean, default: false },
      reason: { type: String, default: '' },
      at: { type: Date },
    },
    // للتوافق مع النسخة القديمة (يُفرَّغ بعد الترحيل)
    messages: { type: Array, default: undefined, select: false },
  },
  { timestamps: true }
);

conversationSchema.statics.STAGES = STAGES;

module.exports = mongoose.model('Conversation', conversationSchema);
