// models/ServiceOrder.js — طلبات الديلفري والدراي كلين
const mongoose = require('mongoose');

const serviceOrderSchema = new mongoose.Schema(
  {
    ref: { type: String, unique: true },
    provider: { type: String, enum: ['delivery', 'dryclean'], required: true, index: true },
    channel: { type: String, enum: ['api', 'whatsapp'], default: 'api' },
    externalId: { type: String },
    guestPhone: { type: String, index: true },
    guestName: { type: String },
    roomNumber: { type: String },
    details: { type: String },
    items: { type: mongoose.Schema.Types.Mixed },
    status: { type: String, default: 'created', index: true }, // created | sent | accepted | in_progress | delivered | completed | failed | cancelled
    statusText: { type: String, default: '' },
    requestedBy: { type: String },
    lastCheckedAt: { type: Date },
    history: [{ at: { type: Date, default: Date.now }, status: String, note: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('ServiceOrder', serviceOrderSchema);
