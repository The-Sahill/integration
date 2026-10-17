const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['customer', 'ai', 'agent'], required: true },
  text: { type: String, required: true },
  time: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const conversationSchema = new mongoose.Schema({
  customerPhone: { type: String, required: true, unique: true, index: true },
  customerName: { type: String, default: 'عميل جديد' },
  aiEnabled: { type: Boolean, default: true }, // حالة الـ AI لكل محادثة
  status: { type: String, default: 'active' },
  lastMessage: { type: String, default: '' },
  lastTime: { type: String, default: '' },
  messages: [messageSchema]
}, { timestamps: true });

module.exports = mongoose.model('Conversation', conversationSchema);