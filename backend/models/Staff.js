// models/Staff.js — الموظفون (أي رقم غير موجود هنا = نزيل/عميل)
const mongoose = require('mongoose');

const ROLES = ['owner', 'manager', 'reception', 'finance', 'maintenance', 'housekeeping', 'delivery'];

const staffSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true, index: true }, // 9627xxxxxxxx
    role: { type: String, enum: ROLES, required: true },
    isSupervisor: { type: Boolean, default: false }, // يستلم التصعيدات
    active: { type: Boolean, default: true },
    // صلاحيات خاصة لهذا الموظف فوق صلاحيات دوره (اختيارياً بتاريخ انتهاء)
    extraPermissions: [{ tool: String, expiresAt: Date, grantedBy: String }],
    // صلاحيات مسحوبة منه رغم أن دوره يملكها
    revokedPermissions: [{ type: String }],
    receivesDailyReport: { type: Boolean, default: false }, // يستلم التقرير الصباحي حتى لو لم يكن مديراً
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

staffSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('Staff', staffSchema);
