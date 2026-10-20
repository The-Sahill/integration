// models/ProcessedEvent.js — منع التكرار (message_id من Meta و event id من زائر)
const mongoose = require('mongoose');

const processedEventSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 }, // يُحذف تلقائياً بعد 7 أيام
});

module.exports = mongoose.model('ProcessedEvent', processedEventSchema);
