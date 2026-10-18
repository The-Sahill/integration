// server.js
require('dotenv').config();
const express = require('express');
const http = require('http'); // 👈 مطلوب لإنشاء سيرفر الـ HTTP
const { Server } = require('socket.io'); // 👈 استدعاء Socket.io
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const webhookRoute = require('./routes/webhookRoute');
const chatRoute = require('./routes/chatRoute');

const app = express();
const server = http.createServer(app); // 👈 إنشاء السيرفر

// 👈 إعدادات الـ Socket.io والسماح بالـ CORS
const io = new Server(server, {
  cors: {
    origin: "*", // يمكنك تحديد رابط الفرونت إند لاحقاً للأمان
    methods: ["GET", "POST", "PATCH"]
  }
});

app.use(cors());
app.use(bodyParser.json());

// 👈 حفظ الـ io داخل الـ app لنتمكن من استخدامه داخل الـ Controllers
app.set('io', io);

// 👈 إدارة اتصال الـ Sockets
io.on('connection', (socket) => {
  console.log(`⚡ موظف متصل بالـ Socket ID: ${socket.id}`);

  // انضمام الموظف لغرفة خاصة بمحادثة معينة إذا رغبت، أو استقبال الأحداث العامة
  socket.on('join_conversation', (conversationId) => {
    socket.join(conversationId);
    console.log(`👤 انضم الموظف الغرفة: ${conversationId}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 انقطع اتصال الموظف: ${socket.id}`);
  });
});

// الاتصال بقاعدة البيانات MongoDB
const MONGO_URI = process.env.MongoDB_URL;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ تم الاتصال بقاعدة البيانات MongoDB بنجاح');
    try {
      await mongoose.connection.collection('conversations').dropIndex('phone_1');
    } catch (err) {}
  })
  .catch((err) => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message));

// مسارات الـ API والـ Webhook
app.get('/', (req, res) => {
    res.status(200).send("Server is running with WebSockets! 🚀");
});

app.use('/webhook', webhookRoute);
app.use('/api/dashboard', chatRoute);

// تشغيل السيرفر عبر الـ http server وليس app.listen
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`🚀 Server & Socket.io running on port ${PORT}`);
});