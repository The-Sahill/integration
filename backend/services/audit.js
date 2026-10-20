// services/audit.js — تسجيل كل عملية (من، ماذا، متى)
const { AuditLog } = require('../models');

async function log({ actorType = 'system', actorName, actorPhone, action, target, details, success = true }) {
  try {
    await AuditLog.create({ actorType, actorName, actorPhone, action, target, details, success });
  } catch (err) {
    console.error('⚠️ فشل تسجيل التدقيق:', err.message);
  }
}

module.exports = { log };
