// models/User.js — مستخدمو لوحة التحكم
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    passwordHash: { type: String, required: true },
    role: { type: String, default: 'manager' }, // نفس أدوار الموظفين
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
