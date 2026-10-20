// services/inventory.js — المخزون مع تنبيه انخفاض الكمية
const { InventoryItem, Staff } = require('../models');
const messenger = require('./messenger');
const audit = require('./audit');
const realtime = require('./realtime');

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
}

async function find(name) {
  const n = norm(name);
  const items = await InventoryItem.find();
  return (
    items.find((i) => norm(i.name) === n || (i.aliases || []).some((a) => norm(a) === n)) ||
    items.find((i) => norm(i.name).includes(n) || n.includes(norm(i.name)) || (i.aliases || []).some((a) => n.includes(norm(a))))
  );
}

async function list() {
  return InventoryItem.find().sort({ category: 1, name: 1 }).lean();
}

/** delta: +5 / -3 ، أو setTo: 20 */
async function adjust(name, { delta, setTo, note }, actor = {}) {
  const item = await find(name);
  if (!item) return { ok: false, message: `الصنف "${name}" غير موجود في المخزون` };
  const before = item.quantity;
  if (setTo !== undefined && setTo !== null) item.quantity = Math.max(0, Number(setTo));
  else item.quantity = Math.max(0, item.quantity + Number(delta || 0));
  item.history.push({ delta: item.quantity - before, by: actor.name || actor.phone || 'dashboard', note });
  if (item.history.length > 200) item.history = item.history.slice(-200);
  await item.save();
  await audit.log({ actorType: actor.phone ? 'staff' : 'dashboard', actorName: actor.name, actorPhone: actor.phone, action: 'inventory.adjust', target: item.name, details: { before, after: item.quantity, note } });
  realtime.emit('inventory_updated', item.toObject());
  await checkLow(item);
  return { ok: true, message: `${item.name}: ${before} ← ${item.quantity} ${item.unit}`, item };
}

async function checkLow(item) {
  if (item.minQuantity > 0 && item.quantity <= item.minQuantity) {
    const recent = item.lastAlertAt && Date.now() - item.lastAlertAt.getTime() < 6 * 3600000;
    if (recent) return;
    const staff = await Staff.find({ active: true, role: { $in: ['manager', 'housekeeping'] } }).lean();
    await messenger.notifyStaff(staff.map((s) => s.phone), `📦 تنبيه مخزون: ${item.name} وصل إلى ${item.quantity} ${item.unit} (الحد الأدنى ${item.minQuantity})`, { kind: 'alert' });
    item.lastAlertAt = new Date();
    await item.save();
  }
}

module.exports = { find, list, adjust, checkLow };
