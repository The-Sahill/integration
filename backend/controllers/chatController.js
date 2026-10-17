// controllers/chatDashboardController.js
const Conversation = require('../models/Conversation');
const { sendWhatsAppMessage } = require('../controllers/whatsappIntegration');

// 1. جلب كل المحادثات للواجهة
const getAllConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find().sort({ updatedAt: -1 });
    res.status(200).json(conversations);
  } catch (error) {
    res.status(500).json({ message: 'حدث خطأ في جلب المحادثات', error: error.message });
  }
};

// 2. تغيير حالة الـ AI (تفعيل / تعطيل) لمحادثة معينة
const toggleAiStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { aiEnabled } = req.body;

    const updated = await Conversation.findByIdAndUpdate(
      id,
      { $set: { aiEnabled: aiEnabled } },
      { new: true }
    );

    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تغيير حالة الـ AI', error: error.message });
  }
};

// 3. إرسال رسالة يدوية من الموظف عبر الشات
const sendAgentMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    const conversation = await Conversation.findById(id);
    if (!conversation) return res.status(404).json({ message: 'المحادثة غير موجودة' });

    const currentTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const agentMsg = {
      sender: 'agent',
      text,
      time: currentTime
    };

    // إرسال للواتساب عبر Meta
    const senderID = conversation.customerPhone.replace('+', '');
    await sendWhatsAppMessage(senderID, text);

    // تحديث قاعدة البيانات
    const updated = await Conversation.findByIdAndUpdate(
      id,
      {
        $set: { lastMessage: text, lastTime: currentTime },
        $push: { messages: agentMsg }
      },
      { new: true }
    );

    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إرسال الرسالة اليدوية', error: error.message });
  }
};

module.exports = {
  getAllConversations,
  toggleAiStatus,
  sendAgentMessage
};