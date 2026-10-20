// src/pages/Payments.jsx — الحجوزات المحلية والمدفوعات (تأكيد/رفض الإيصال)
import { useEffect, useState } from 'react'
import { Check, X, RotateCcw, Ban } from 'lucide-react'
import { api, mediaUrl, errMsg, getSocket } from '../lib/api'
import { BOOKING_STATUS, PAYMENT_STATUS, fmtDate } from '../lib/labels'
import { PageHeader, Tabs, Table, Badge, Button } from '../components/ui'

export default function Payments() {
  const [tab, setTab] = useState('pending')
  const [payments, setPayments] = useState([])
  const [bookings, setBookings] = useState([])
  const [busy, setBusy] = useState('')

  const load = async () => {
    const [p, b] = await Promise.all([api.get('/payments'), api.get('/bookings')])
    setPayments(p.data)
    setBookings(b.data)
  }
  useEffect(() => {
    load()
    const s = getSocket()
    s.on('payment_updated', load)
    s.on('booking_updated', load)
    return () => {
      s.off('payment_updated', load)
      s.off('booking_updated', load)
    }
  }, [])

  const act = async (fn, key) => {
    setBusy(key)
    try {
      const { data } = await fn()
      if (data?.message) alert(data.message)
      await load()
    } catch (e) {
      alert(errMsg(e))
    } finally {
      setBusy('')
    }
  }

  const pending = payments.filter((p) => p.status === 'pending')
  const tabs = [
    { value: 'pending', label: 'إيصالات للمراجعة', count: pending.length },
    { value: 'bookings', label: 'الحجوزات', count: bookings.length },
    { value: 'payments', label: 'كل المدفوعات', count: payments.length },
  ]

  const paymentCols = [
    { key: 'createdAt', label: 'الوقت', render: (r) => fmtDate(r.createdAt) },
    { key: 'bookingRef', label: 'الحجز', render: (r) => r.bookingRef || <span className="text-rose-300">بدون حجز</span> },
    { key: 'phone', label: 'العميل', render: (r) => <span className="ltr">+{r.phone}</span> },
    { key: 'method', label: 'الطريقة', render: (r) => <div>{({ receipt: 'إيصال', checkout: 'رابط بطاقة', manual: 'بأمر موظف' }[r.method])}<div className="text-[11px] text-slate-500">{({ cliq: 'كليك', bank: 'تحويل', cash: 'كاش', card: 'بطاقة' })[r.paymentMethod] || ''}</div></div> },
    { key: 'receipt', label: 'وصل زائر', render: (r) => r.zaaerReceiptId || (['confirmed', 'paid'].includes(r.status) ? <span className="text-amber-300">يدوي</span> : '-') },
    { key: 'amount', label: 'المبلغ (مقروء)', render: (r) => `${r.amount ?? '؟'} ${r.currency || ''}` },
    { key: 'extracted', label: 'من الإيصال', render: (r) => r.extracted ? `${r.extracted.payer_name || ''} ${r.extracted.date || ''} ${r.extracted.reference || ''}` : '-' },
    { key: 'img', label: 'الصورة', render: (r) => r.mediaPath ? <a href={mediaUrl(r.mediaPath)} target="_blank" rel="noreferrer"><img src={mediaUrl(r.mediaPath)} className="h-12 rounded" alt="" /></a> : '-' },
    { key: 'status', label: 'الحالة', render: (r) => <Badge color={PAYMENT_STATUS[r.status]?.color}>{PAYMENT_STATUS[r.status]?.label}</Badge> },
    {
      key: 'act', label: '', render: (r) => r.status === 'pending' && r.method === 'receipt' && (
        <div className="flex gap-1">
          <Button size="sm" loading={busy === `ok${r._id}`} onClick={() => act(() => api.post(`/payments/${r._id}/confirm`), `ok${r._id}`)}><Check className="h-3.5 w-3.5" />تأكيد</Button>
          <Button size="sm" variant="danger" loading={busy === `no${r._id}`} onClick={() => { const reason = prompt('سبب الرفض؟') ?? ''; act(() => api.post(`/payments/${r._id}/reject`, { reason }), `no${r._id}`) }}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ),
    },
  ]

  const bookingCols = [
    { key: 'ref', label: 'رقم', render: (r) => <span className="font-mono text-xs">{r.ref}</span> },
    { key: 'guestName', label: 'النزيل', render: (r) => <div>{r.guestName}<div className="ltr text-right text-[11px] text-slate-500">+{r.phone}</div></div> },
    { key: 'unitName', label: 'الوحدة' },
    { key: 'dates', label: 'التواريخ', render: (r) => `${r.checkIn} ← ${r.checkOut} (${r.nights})` },
    { key: 'price', label: 'السعر', render: (r) => <div>{r.agreedPrice} {r.currency}{r.listPrice > r.agreedPrice && <div className="text-[11px] text-slate-500 line-through">{r.listPrice}</div>}</div> },
    { key: 'status', label: 'الحالة', render: (r) => <Badge color={BOOKING_STATUS[r.status]?.color}>{BOOKING_STATUS[r.status]?.label}</Badge> },
    { key: 'zaaer', label: 'زائر', render: (r) => (r.inZaaer ? r.zaaerReservationId || '✓' : <span className="text-slate-500">—</span>) },
    { key: 'paid', label: 'المدفوع / المتبقي', render: (r) => <span>{r.paidAmount || 0}{r.agreedPrice - (r.paidAmount || 0) > 0 && <span className="text-amber-300"> / {r.agreedPrice - (r.paidAmount || 0)}</span>}</span> },
    { key: 'source', label: 'المصدر', render: (r) => ({ ai: 'الـ AI', staff: 'موظف', dashboard: 'اللوحة' }[r.source] || r.source) },
    { key: 'exp', label: 'ينتهي', render: (r) => (['hold', 'awaiting_payment'].includes(r.status) ? fmtDate(r.holdExpiresAt) : '-') },
    {
      key: 'act', label: '', render: (r) => (
        <div className="flex gap-1">
          {r.status === 'failed' && <Button size="sm" variant="warning" loading={busy === `f${r._id}`} onClick={() => act(() => api.post(`/bookings/${r._id}/finalize`), `f${r._id}`)}><RotateCcw className="h-3.5 w-3.5" />إعادة الإدخال</Button>}
          {['hold', 'awaiting_payment', 'confirmed', 'zaaer_entered'].includes(r.status) && (
            <Button size="sm" variant="ghost" onClick={() => { if (confirm(`إلغاء ${r.ref}؟`)) act(() => api.post(`/bookings/${r.ref}/cancel`, { reason: 'من اللوحة' }), `c${r._id}`) }}><Ban className="h-3.5 w-3.5" /></Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="الحجوزات والدفع" subtitle="الحجز يُنشأ في زائر فوراً بدون وصل مالي، والوصل يُنشأ فقط بعد تأكيد الدفع" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'pending' && <Table columns={paymentCols} rows={pending} empty="لا توجد إيصالات بانتظار المراجعة 👌" />}
      {tab === 'payments' && <Table columns={paymentCols} rows={payments} />}
      {tab === 'bookings' && <Table columns={bookingCols} rows={bookings} />}
    </div>
  )
}
