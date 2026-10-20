// models/PendingAction.js — عمليات بانتظار تأكيد الموظف / موافقة المدير / مراجعة الدفع
const mongoose = require('mongoose');

const pendingActionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['staff_confirm', 'manager_approval', 'payment_review'], required: true },
    requestedBy: { type: String },        // رقم من طلب العملية
    requestedByName: { type: String },
    targetPhones: [{ type: String }],     // من يحق له الرد
    tool: { type: String },               // اسم الدالة المؤجلة
    args: { type: mongoose.Schema.Types.Mixed },
    summary: { type: String },            // إعادة صياغة العملية
    relatedId: { type: String },          // negotiationId / paymentId ...
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired', 'executed', 'failed'], default: 'pending', index: true },
    decidedBy: { type: String },
    decidedAt: { type: Date },
    result: { type: mongoose.Schema.Types.Mixed },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PendingAction', pendingActionSchema);
