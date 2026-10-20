// src/lib/labels.js — تسميات وألوان موحّدة
export const STAGES = [
  { key: 'new', label: 'جديد', color: 'slate' },
  { key: 'quoted', label: 'تم عرض السعر', color: 'sky' },
  { key: 'negotiating', label: 'تفاوض', color: 'violet' },
  { key: 'hold', label: 'حجز مبدئي', color: 'amber' },
  { key: 'awaiting_payment', label: 'بانتظار الدفع', color: 'orange' },
  { key: 'paid', label: 'تم الدفع', color: 'teal' },
  { key: 'zaaer_entered', label: 'مُدخل في زائر', color: 'cyan' },
  { key: 'confirmed', label: 'مؤكد', color: 'emerald' },
  { key: 'lost', label: 'مغلق', color: 'rose' },
  { key: 'in_house', label: 'نزيل مقيم', color: 'indigo' },
]
export const stageOf = (k) => STAGES.find((s) => s.key === k) || STAGES[0]

export const COLOR = {
  slate: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  teal: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  indigo: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
}

export const ROLES = {
  owner: 'مالك', manager: 'مدير', reception: 'استقبال', finance: 'مالية', maintenance: 'صيانة', housekeeping: 'تدبير منزلي', delivery: 'ديلفري',
}

export const TICKET_STATUS = {
  open: { label: 'مفتوحة', color: 'rose' },
  assigned: { label: 'محوّلة', color: 'amber' },
  acknowledged: { label: 'مستلمة', color: 'sky' },
  done: { label: 'منجزة', color: 'teal' },
  closed: { label: 'مغلقة', color: 'emerald' },
  reopened: { label: 'أعيد فتحها', color: 'orange' },
  cancelled: { label: 'ملغاة', color: 'slate' },
}

export const CATEGORIES = {
  towels: 'مناشف', cleaning: 'تنظيف', amenities: 'مستلزمات', linen: 'بياضات', plumbing: 'سباكة', electric: 'كهرباء',
  ac: 'تكييف', appliance: 'أجهزة', internet: 'إنترنت', furniture: 'أثاث', checkin: 'دخول', checkout: 'خروج', other: 'أخرى',
}

export const PRIORITY = {
  low: { label: 'منخفضة', color: 'slate' },
  normal: { label: 'عادية', color: 'sky' },
  high: { label: 'عالية', color: 'amber' },
  urgent: { label: 'عاجلة', color: 'rose' },
}

export const BOOKING_STATUS = {
  checked_in: { label: 'مقيم (تم الوصول)', color: 'indigo' },
  checked_out: { label: 'غادر', color: 'slate' },
  hold: { label: 'مبدئي', color: 'amber' },
  awaiting_payment: { label: 'بانتظار الدفع', color: 'orange' },
  paid: { label: 'مدفوع', color: 'teal' },
  zaaer_entered: { label: 'في زائر (غير مدفوع)', color: 'cyan' },
  confirmed: { label: 'مؤكد', color: 'emerald' },
  expired: { label: 'منتهي', color: 'slate' },
  cancelled: { label: 'ملغي', color: 'slate' },
  failed: { label: 'فشل — يحتاج تدخل', color: 'rose' },
}

export const PAYMENT_STATUS = {
  pending: { label: 'قيد المراجعة', color: 'amber' },
  confirmed: { label: 'مؤكد', color: 'emerald' },
  paid: { label: 'مدفوع بالبطاقة', color: 'emerald' },
  rejected: { label: 'مرفوض', color: 'rose' },
  failed: { label: 'فشل', color: 'rose' },
  expired: { label: 'منتهي', color: 'slate' },
}

export const NEG_STATUS = {
  open: { label: 'مفتوح', color: 'sky' },
  accepted: { label: 'اتُّفق', color: 'teal' },
  approval_pending: { label: 'عند المدير', color: 'amber' },
  approved: { label: 'وافق المدير', color: 'violet' },
  rejected: { label: 'مرفوض', color: 'rose' },
  lost: { label: 'خسارة', color: 'rose' },
  booked: { label: 'تم الحجز', color: 'emerald' },
}

export const fmtDate = (d) => (d ? new Date(d).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '-')
export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '')
