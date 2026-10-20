// models/PricingRule.js — نوع الوحدة + قواعد السعر والتفاوض (المنطق الحسابي في services/pricing.js)
const mongoose = require('mongoose');

const pricingRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },          // مثال: شقة غرفة نوم واحدة
    aliases: [{ type: String }],                      // أسماء بديلة يفهمها الموظف: "شاليه 3"، "غرفتين"...
    description: { type: String, default: '' },       // وصف قصير يُعرض للعميل
    zaaerUnitTypeId: { type: Number, required: true }, // unit_type_id في زائر
    ratePlanId: { type: Number },
    maxAdults: { type: Number, default: 4 },
    unitsCount: { type: Number, default: 1 },          // عدد الوحدات من هذا النوع (للإشغال)
    baseRate: { type: Number, required: true },        // سعر الليلة العادي
    weekendRate: { type: Number },                     // سعر ليلة نهاية الأسبوع
    weekendNights: { type: [Number], default: [4, 5] }, // 0=الأحد ... 4=الخميس 5=الجمعة
    seasons: [
      {
        name: String,
        from: String, // MM-DD
        to: String,   // MM-DD (شامل)
        rate: Number,
      },
    ],
    minRate: { type: Number, required: true },         // أقل سعر مسموح لليلة — لا يُتجاوز أبداً
    maxDiscountPct: { type: Number, default: 15 },     // أقصى نسبة خصم من السعر الأساسي
    concessionSteps: { type: [Number], default: [5, 10, 15] }, // خطوات التنازل كنسبة مئوية تراكمية
    alternatives: {
      extraNightDiscountPct: { type: Number, default: 30 }, // ليلة إضافية بخصم
      earlyCheckIn: { type: Boolean, default: true },
      lateCheckOut: { type: Boolean, default: true },
    },
    useZaaerPrice: { type: Boolean, default: false }, // إن كان true يُعتمد سعر زائر كسعر أساسي
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PricingRule', pricingRuleSchema);
