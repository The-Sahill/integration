const conversationSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true }, // رقم الواتساب
  name: { type: String, default: "عميل واتساب" },
  isAiEnabled: { type: Boolean, default: true }, // هل الذكاء الاصطناعي يرد أم الموظف؟
  lastMessage: String,
  updatedAt: { type: Date, default: Date.now }
});