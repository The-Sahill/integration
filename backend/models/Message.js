// models/Message.js — كل رسالة واردة وصادرة (نص/صوت/صورة/أزرار)
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', index: true },
    phone: { type: String, index: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    sender: { type: String, enum: ['customer', 'staff', 'ai', 'agent', 'system'], required: true },
    type: { type: String, default: 'text' }, // text | audio | image | document | interactive | button | template | location
    text: { type: String, default: '' },
    transcript: { type: String, default: '' }, // نص الرسالة الصوتية المفرَّغ
    mediaId: { type: String },
    mediaPath: { type: String }, // اسم الملف داخل uploads/
    mimeType: { type: String },
    waMessageId: { type: String, index: true },
    status: { type: String, default: 'sent' }, // sent | delivered | read | failed | received
    agentName: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
