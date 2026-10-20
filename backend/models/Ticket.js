// models/Ticket.js — طلبات النزلاء والصيانة بنفس الدورة
const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema(
  {
    number: { type: Number, unique: true, index: true },
    kind: { type: String, enum: ['request', 'maintenance'], default: 'request', index: true },
    category: { type: String, default: 'other' }, // towels, cleaning, amenities, plumbing, electric, ac, internet, appliance ...
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    title: { type: String },
    description: { type: String },
    roomNumber: { type: String, index: true },
    guestPhone: { type: String, index: true },
    guestName: { type: String },
    media: [{ type: String }], // أسماء ملفات الصور في uploads/
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    assignedName: { type: String },
    assignedPhone: { type: String },
    status: {
      type: String,
      enum: ['open', 'assigned', 'acknowledged', 'done', 'closed', 'reopened', 'cancelled'],
      default: 'open',
      index: true,
    },
    assignedAt: Date,
    ackAt: Date,
    doneAt: Date,
    closedAt: Date,
    reminderCount: { type: Number, default: 0 },
    lastReminderAt: Date,
    escalated: { type: Boolean, default: false },
    escalatedAt: Date,
    feedbackAskedAt: Date,
    satisfied: { type: Boolean },
    createdBy: { type: String }, // رقم النزيل أو الموظف أو dashboard
    history: [{ at: { type: Date, default: Date.now }, by: String, action: String, note: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Ticket', ticketSchema);
