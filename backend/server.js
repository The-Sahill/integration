// server.js — عملية واحدة: API + Webhooks + Socket.io + المُجدول + واجهة اللوحة (بعد البناء)
const config = require('./config');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const realtime = require('./services/realtime');
const bootstrap = require('./services/bootstrap');
const scheduler = require('./services/scheduler');
const webhookRoute = require('./routes/webhook');
const apiRoute = require('./routes/api');

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);
app.use(cors({ origin: config.corsOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] }));
// نحتفظ بالـ body الخام للتحقق من توقيع Meta وزائر
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

const io = new Server(server, { cors: { origin: config.corsOrigins, credentials: true } });
io.use((socket, next) => {
  try {
    jwt.verify(socket.handshake.auth?.token, config.auth.jwtSecret);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
realtime.setIo(io);

app.get('/health', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1, uptime: process.uptime() }));
app.use('/webhook', webhookRoute);
app.use('/api', apiRoute);

// واجهة اللوحة المبنية (npm run build في frontend) — نفس العملية ونفس الرابط
const dist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|webhook|socket\.io).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (req, res) => res.send('Sahil Suite backend is running 🚀 (ابنِ الواجهة: cd frontend && npm run build)'));
}

// معالج الأخطاء العام
app.use((err, req, res, next) => {
  console.error('❌', req.method, req.path, err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ message: err.message || 'خطأ في الخادم' });
});

process.on('unhandledRejection', (err) => console.error('⚠️ unhandledRejection:', err));

async function start() {
  if (!config.mongoUrl) throw new Error('MONGODB_URL مفقود في .env');
  mongoose.connection.on('disconnected', () => console.warn('⚠️ انقطع الاتصال بـ MongoDB — جاري إعادة الاتصال...'));
  mongoose.connection.on('reconnected', () => console.log('✅ أُعيد الاتصال بـ MongoDB'));
  mongoose.connection.on('error', (err) => console.error('❌ MongoDB:', err.message));
  await mongoose.connect(config.mongoUrl, {
    family: 4, // IPv4 فقط — يحل ECONNRESET مع Atlas على بعض الشبكات/الراوترات
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 45000,
    heartbeatFrequencyMS: 10000,
    maxIdleTimeMS: 60000, // إغلاق الاتصالات الخاملة قبل أن يقطعها الراوتر/الجدار الناري
    retryWrites: true,
    retryReads: true,
  });
  console.log('✅ متصل بقاعدة البيانات');
  await bootstrap.run();
  if (!config.whatsapp.appSecret) console.warn('⚠️ META_APP_SECRET غير مضبوط — التحقق من توقيع الـ webhook معطّل');
  const placeholder = (v) => /^0?790000000$|^962790000000$/.test(String(v || '').replace(/\D/g, '').replace(/^00/, ''));
  if (placeholder(config.bootstrap.managerPhone)) console.warn('⚠️ MANAGER_PHONE ما زال الرقم التجريبي 0790000000 — ضع رقمك الحقيقي واحذف الموظف التجريبي من صفحة الموظفين');
  if (placeholder(config.delivery.whatsapp)) console.warn('⚠️ DELIVERY_WHATSAPP ما زال الرقم التجريبي — ضع رقم جهة التوصيل أو اتركه فارغاً');
  if (!config.whatsapp.verifyToken) console.warn('⚠️ VERIFY_TOKEN غير مضبوط — لن يُوثَّق الـ webhook في Meta');
  scheduler.start();
  server.listen(config.port, () => console.log(`🚀 السيرفر يعمل على المنفذ ${config.port}`));
}

start().catch((err) => {
  console.error('❌ فشل التشغيل:', err.message);
  process.exit(1);
});
