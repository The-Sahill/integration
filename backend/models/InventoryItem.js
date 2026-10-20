// models/InventoryItem.js — المخزون والمستهلكات
const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    aliases: [{ type: String }],
    category: { type: String, default: 'عام' }, // مناشف، نظافة، صيانة، ضيافة
    unit: { type: String, default: 'قطعة' },
    quantity: { type: Number, default: 0, min: 0 },
    minQuantity: { type: Number, default: 0 }, // تنبيه عند الوصول لهذا الحد
    lastAlertAt: { type: Date },
    history: [{ at: { type: Date, default: Date.now }, delta: Number, by: String, note: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
