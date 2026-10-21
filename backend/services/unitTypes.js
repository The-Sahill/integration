// services/unitTypes.js — استيراد أنواع الوحدات تلقائياً من زائر (GET /properties) إذا لم تُضبط في اللوحة
const { PricingRule } = require('../models');
const zaaer = require('./zaaer');
const config = require('../config');

const ARRAY_KEYS = ['unit_types', 'unitTypes', 'room_types', 'roomTypes', 'types'];

function nameOf(x) {
  const n = x?.name ?? x?.title ?? x?.label;
  if (n && typeof n === 'object') return n.ar || n.en || Object.values(n)[0];
  return n;
}

/** يستخرج أنواع الوحدات من رد /properties بأي شكل شائع */
function extractUnitTypes(properties) {
  const out = [];
  for (const p of properties || []) {
    if (config.zaaer.propertyId && p.id && Number(p.id) !== Number(config.zaaer.propertyId) && properties.length > 1) continue;
    for (const key of ARRAY_KEYS) {
      const arr = p?.[key];
      if (!Array.isArray(arr)) continue;
      for (const t of arr) {
        const id = Number(t?.id ?? t?.unit_type_id);
        if (!id) continue;
        out.push({
          zaaerUnitTypeId: id,
          name: String(nameOf(t) || `نوع ${id}`),
          ratePlanId: Number(t?.base_rate_plan_id ?? t?.rate_plans?.[0]?.id ?? t?.rate_plan_id ?? t?.default_rate_plan_id) || undefined,
          // ملاحظة: occupancy.max_adults في زائر = 2 لكل الأنواع (غير مضبوط) بينما quote يقبل 4 — لذلك لا نستورده
          maxAdults: Number(t?.max_adults ?? t?.max_occupancy ?? t?.occupancy?.adults ?? t?.capacity) || 4,
          unitsCount: Number(t?.total_units ?? t?.units_count ?? t?.units?.length ?? t?.count ?? t?.number_of_units) || 1,
          minRate: Number(t?.base_rate_plan?.min_rate) || 0, // أقل سعر لليلة كما ضبطته المنشأة في زائر
          monthlyMinRate: Number(t?.base_rate_plan?.monthly_min_rate) || 0,
          description: String(t?.description?.ar ?? t?.description ?? '').slice(0, 300),
        });
      }
    }
  }
  const seen = new Set();
  return out.filter((t) => (seen.has(t.zaaerUnitTypeId) ? false : seen.add(t.zaaerUnitTypeId)));
}

/** يجرّب عدة مصادر في زائر لإيجاد أنواع الوحدات، ويُرجع ما وجده مع تشخيص لما جُرّب */
async function discover() {
  const pid = config.zaaer.propertyId;
  const tried = [];
  const tryGet = async (path, pick) => {
    try {
      const data = await zaaer.rawGet(path);
      const types = pick(data);
      tried.push(`${path}: ${types.length}`);
      return types;
    } catch (err) {
      tried.push(`${path}: ${err.status || 'خطأ'}`);
      return [];
    }
  };
  const asList = (d) => [d?.result?.items, d?.items, d?.data?.items, d?.data, d?.result].find(Array.isArray) || (d?.result && typeof d.result === 'object' ? [d.result] : d?.data && typeof d.data === 'object' ? [d.data] : []);
  const direct = (d) => extractUnitTypes([{ unit_types: asList(d) }]);

  // 1) قائمة العقارات (مع الأنواع المضمّنة إن وُجدت)
  let types = await tryGet('/properties', (d) => extractUnitTypes(asList(d)));
  // 2) تفاصيل العقار
  if (!types.length) types = await tryGet(`/properties/${pid}`, (d) => extractUnitTypes(asList(d)));
  // 3) نقاط أنواع الوحدات الشائعة
  for (const path of ['/unit-types', `/properties/${pid}/unit-types`, '/room-types', `/properties/${pid}/room-types`]) {
    if (types.length) break;
    types = await tryGet(path, direct);
  }
  // 4) استنتاجها من الحجوزات الموجودة (unit_type_id في rooms)
  if (!types.length) {
    try {
      const res = await zaaer.getAllReservations();
      const map = new Map();
      const unitIds = new Map(); // نوع ← الوحدات المختلفة (unit_id) لحساب عدد الوحدات للإشغال
      for (const r of res) {
        for (const room of r.rooms || r.units || []) {
          const id = Number(room.unit_type_id ?? room.unit_type?.id);
          if (!id) continue;
          if (room.unit_id != null) (unitIds.get(id) || unitIds.set(id, new Set()).get(id)).add(room.unit_id);
          if (map.has(id)) continue;
          map.set(id, {
            zaaerUnitTypeId: id,
            name: String(nameOf(room.unit_type) || room.unit_type_name || `نوع وحدة ${id}`),
            ratePlanId: Number(room.rate_plan_id) || undefined,
            maxAdults: 4,
            unitsCount: 1,
            description: '',
          });
        }
      }
      for (const t of map.values()) t.unitsCount = unitIds.get(t.zaaerUnitTypeId)?.size || 1;
      types = [...map.values()];
      tried.push(`/reservations (استنتاج): ${types.length}`);
    } catch (err) {
      tried.push(`/reservations: ${err.status || 'خطأ'}`);
    }
  }
  return { types, tried };
}

/**
 * ينشئ قاعدة سعر لكل نوع غير موجود: سعر زائر هو الأساس، وأقصى خصم 15%
 * (عدّل الأسماء والأسعار والحد الأدنى من صفحة الأسعار لاحقاً)
 */
async function importFromZaaer() {
  const { types, tried } = await discover();
  let created = 0;
  let updated = 0;
  for (const t of types) {
    const existing = await PricingRule.findOne({ zaaerUnitTypeId: t.zaaerUnitTypeId });
    if (existing) {
      // مزامنة ما كان ناقصاً في الاستيراد السابق: عدد الوحدات (للإشغال)، خطة السعر، والحد الأدنى إن لم يضبطه المدير
      const set = {};
      if (t.unitsCount > 1 && existing.unitsCount !== t.unitsCount) set.unitsCount = t.unitsCount;
      if (t.ratePlanId && !existing.ratePlanId) set.ratePlanId = t.ratePlanId;
      if (t.minRate > 0 && !existing.minRate) set.minRate = t.minRate;
      if (t.monthlyMinRate > 0 && !existing.monthlyMinRate) set.monthlyMinRate = t.monthlyMinRate;
      if (Object.keys(set).length) {
        await PricingRule.updateOne({ _id: existing._id }, { $set: set });
        updated++;
      }
      continue;
    }
    await PricingRule.create({ ...t, baseRate: 0, minRate: t.minRate || 0, useZaaerPrice: true, maxDiscountPct: 15, concessionSteps: [5, 10, 15], active: true });
    created++;
  }
  console.log(`📥 استيراد أنواع الوحدات: وُجد ${types.length}، أُضيف ${created}، حُدّث ${updated} (عدد الوحدات/خطة السعر/الحد الأدنى) — المصادر: ${tried.join(' | ')}`);
  return { found: types.length, created, updated, tried };
}

let lastAttempt = 0;
/** إذا لا توجد أنواع وحدات مفعّلة نحاول الاستيراد تلقائياً (مرة كل 10 دقائق كحد أقصى) */
async function ensureUnitTypes() {
  if (await PricingRule.exists({ active: true })) return true;
  if (Date.now() - lastAttempt < 10 * 60000) return false;
  lastAttempt = Date.now();
  try {
    const r = await importFromZaaer();
    return r.created > 0;
  } catch (err) {
    console.error('⚠️ تعذر استيراد أنواع الوحدات من زائر:', err.message);
    return false;
  }
}

module.exports = { importFromZaaer, ensureUnitTypes, extractUnitTypes };
