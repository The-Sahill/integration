// services/bootstrap.js — تجهيز أول تشغيل + ترحيل بيانات النسخة القديمة
const mongoose = require('mongoose');
const { Conversation, Message, User, Staff } = require('../models');
const settings = require('./settings');
const config = require('../config');
const { hashPassword, normalizePhone } = require('../utils/helpers');

async function ensureAdmin() {
  // نتأكد من وجود مستخدم ADMIN_USERNAME نفسه (حتى لو كانت هناك مستخدمون آخرون في نفس قاعدة البيانات)
  const user = await User.findOne({ username: config.auth.adminUsername });
  if (!user) {
    await User.create({ username: config.auth.adminUsername, name: 'المدير', passwordHash: hashPassword(config.auth.adminPassword), role: 'owner' });
    console.log(`👤 تم إنشاء مستخدم اللوحة: ${config.auth.adminUsername}`);
    return;
  }
  // ADMIN_RESET_PASSWORD=true ← يعيد كلمة المرور لقيمة ADMIN_PASSWORD عند التشغيل (ثم أرجعه false)
  if (process.env.ADMIN_RESET_PASSWORD === 'true') {
    user.passwordHash = hashPassword(config.auth.adminPassword);
    await user.save();
    console.log(`🔑 تمت إعادة تعيين كلمة مرور ${config.auth.adminUsername} من .env — أرجع ADMIN_RESET_PASSWORD=false`);
  }
}

async function ensureManager() {
  if (!config.bootstrap.managerPhone) return;
  const phone = normalizePhone(config.bootstrap.managerPhone, config.defaultCountryCode);
  const exists = await Staff.exists({ phone });
  if (!exists) {
    await Staff.create({ name: config.bootstrap.managerName, phone, role: 'manager', isSupervisor: true });
    console.log(`👔 تمت إضافة المدير ${phone} لجدول الموظفين`);
  }
}

/** النسخة القديمة كانت تخزن الرسائل داخل المحادثة وأرقام بصيغة +962 */
async function migrateLegacy() {
  try {
    await mongoose.connection.collection('conversations').dropIndex('phone_1');
  } catch (_) { /* غير موجود */ }

  const raw = mongoose.connection.collection('conversations');
  const legacy = await raw.find({ $or: [{ messages: { $exists: true, $type: 'array', $ne: [] } }, { customerPhone: /^\+/ }] }).toArray();
  if (!legacy.length) return;
  console.log(`🔄 ترحيل ${legacy.length} محادثة من النسخة القديمة...`);
  for (const c of legacy) {
    const phone = normalizePhone(c.customerPhone, config.defaultCountryCode);
    let target = c;
    const dup = await raw.findOne({ customerPhone: phone, _id: { $ne: c._id } });
    if (dup) target = dup;
    const msgs = (c.messages || []).map((m) => ({
      conversationId: target._id,
      phone,
      direction: m.sender === 'customer' ? 'in' : 'out',
      sender: ['customer', 'ai', 'agent'].includes(m.sender) ? m.sender : 'system',
      type: 'text',
      text: m.text,
      status: m.sender === 'customer' ? 'received' : 'sent',
      createdAt: m.timestamp || c.createdAt || new Date(),
      updatedAt: m.timestamp || new Date(),
    }));
    if (msgs.length) await Message.insertMany(msgs);
    const lastIn = [...(c.messages || [])].reverse().find((m) => m.sender === 'customer');
    if (dup) {
      await raw.updateOne({ _id: dup._id }, { $inc: { messageCount: msgs.length } });
      await raw.deleteOne({ _id: c._id });
    } else {
      await raw.updateOne(
        { _id: c._id },
        {
          $set: { customerPhone: phone, messageCount: msgs.length, stage: c.stage || 'new', state: c.state || {}, lastMessageAt: c.updatedAt || new Date(), lastInboundAt: lastIn?.timestamp || c.updatedAt },
          $unset: { messages: '' },
        }
      );
    }
  }
  console.log('✅ اكتمل الترحيل');
}

async function run() {
  await settings.load();
  await migrateLegacy();
  await ensureAdmin();
  await ensureManager();
  await Conversation.syncIndexes().catch(() => {});
}

module.exports = { run };
