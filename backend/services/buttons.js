// services/buttons.js — معالجة ضغطات الأزرار مباشرة في الكود (بدون AI = أسرع وأدق)
const { Staff, Ticket } = require('../models');
const tickets = require('./tickets');
const payments = require('./payments');
const approvals = require('./approvals');
const serviceOrders = require('./serviceOrders');
const messenger = require('./messenger');
const config = require('../config');
const { normalizePhone } = require('../utils/helpers');

const PATTERN = /^(tk|fb|pay|appr|act|svc):([a-z]+):([a-f0-9]{24})$/i;

function parse(id) {
  const m = PATTERN.exec(String(id || ''));
  return m ? { scope: m[1], action: m[2], id: m[3] } : null;
}

/** يُرجع true إذا عولجت الضغطة (فلا تذهب للـ AI) */
async function handle(phone, buttonId) {
  const p = parse(buttonId);
  if (!p) return false;
  const staff = await Staff.findOne({ phone, active: true }).lean();
  let result = { ok: false, message: 'غير مصرح لك بهذا الإجراء' };

  switch (p.scope) {
    case 'tk':
      if (staff) result = p.action === 'ack' ? await tickets.acknowledge(p.id, phone) : await tickets.markDone(p.id, phone);
      break;
    case 'fb': {
      const t = await Ticket.findById(p.id).lean();
      if (t && t.guestPhone === phone) {
        await tickets.guestFeedback(p.id, p.action === 'yes', phone);
        return true; // الرد يُرسل من داخل الدالة
      }
      break;
    }
    case 'pay':
      if (staff && (['finance', 'manager', 'owner'].includes(staff.role) || require('./tools').allowedToolNames(staff).includes('confirm_payment'))) {
        result = p.action === 'ok' ? await payments.confirm(p.id, staff) : await payments.reject(p.id, staff, 'لم يُطابق التحويل');
      }
      break;
    case 'appr':
      if (staff && ['manager', 'owner'].includes(staff.role)) result = await approvals.decidePriceApproval(p.id, p.action === 'ok', phone);
      break;
    case 'act':
      if (staff) result = await approvals.resolveStaffConfirmation(p.id, p.action === 'yes', phone);
      break;
    case 'svc': {
      const external = [config.delivery.whatsapp, config.dryClean.whatsappFallback].filter(Boolean).map((n) => normalizePhone(n, config.defaultCountryCode));
      if (staff || external.includes(phone)) result = await serviceOrders.handleButton(p.id, p.action, phone);
      break;
    }
    default:
      return false;
  }
  if (result?.message) await messenger.send(phone, { text: result.message, sender: 'system' });
  return true;
}

module.exports = { handle, parse };
