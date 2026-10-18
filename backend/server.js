// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const webhookRoute = require('./routes/webhookRoute');
const chatRoute = require('./routes/chatRoute');

const app = express();
const server = http.createServer(app);

// 👈 ضع الروابط الصحيحة تماماً هنا
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://the-sahill-stays-integration.onrender.com"
];

// إعداد CORS للـ Express (تأكد ألا تكتب app.use(cors()) مرتين لتجنب التضارب)
app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  credentials: true
}));

app.use(bodyParser.json());

// إعداد CORS للـ Socket.io
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH"],
    credentials: true
  }
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log(`⚡ موظف متصل بالـ Socket ID: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`🔌 انقطع اتصال الموظف: ${socket.id}`);
  });
});

const MONGO_URI = process.env.MongoDB_URL;
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ تم الاتصال بقاعدة البيانات MongoDB بنجاح');
    try {
      await mongoose.connection.collection('conversations').dropIndex('phone_1');
    } catch (err) {}
  })
  .catch((err) => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message));

app.get('/', (req, res) => {
    res.status(200).send("Server is running with WebSockets! 🚀");
});

app.use('/webhook', webhookRoute);
app.use('/api/dashboard', chatRoute);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`🚀 Server & Socket.io running on port ${PORT}`);
});