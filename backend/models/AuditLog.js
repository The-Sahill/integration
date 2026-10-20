// models/AuditLog.js — سجل التدقيق: من، ماذا، متى
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actorType: { type: String, enum: ['staff', 'guest', 'ai', 'system', 'dashboard'], default: 'system' },
  actorName: { type: String },
  actorPhone: { type: String },
  action: { type: String, required: true, index: true },
  target: { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
  success: { type: Boolean, default: true },
  at: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
