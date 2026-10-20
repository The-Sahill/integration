// scripts/reset-admin.js — إعادة تعيين (أو إنشاء) مستخدم اللوحة من قيم .env
// الاستخدام: node scripts/reset-admin.js
const config = require('../config');
const mongoose = require('mongoose');
const { User } = require('../models');
const { hashPassword } = require('../utils/helpers');

(async () => {
  await mongoose.connect(config.mongoUrl);
  const all = await User.find({}, { username: 1, role: 1 }).lean();
  console.log('المستخدمون الحاليون:', all.map((u) => `${u.username} (${u.role})`).join('، ') || 'لا يوجد');
  await User.findOneAndUpdate(
    { username: config.auth.adminUsername },
    { $set: { passwordHash: hashPassword(config.auth.adminPassword), role: 'owner' }, $setOnInsert: { name: 'المدير' } },
    { upsert: true }
  );
  console.log(`✅ تم: اسم المستخدم "${config.auth.adminUsername}" وكلمة المرور = قيمة ADMIN_PASSWORD في .env`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
