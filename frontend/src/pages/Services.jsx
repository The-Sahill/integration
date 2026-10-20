// src/pages/Services.jsx — طلبات الديلفري والدراي كلين
import { useEffect, useState } from 'react'
import { api, getSocket } from '../lib/api'
import { fmtDate } from '../lib/labels'
import { PageHeader, Table, Badge, Tabs } from '../components/ui'

const STATUS = {
  created: ['تم الإنشاء', 'slate'], sent: ['تم الإرسال', 'sky'], accepted: ['مقبول', 'violet'], in_progress: ['قيد التنفيذ', 'amber'],
  delivered: ['تم التوصيل', 'emerald'], completed: ['مكتمل', 'emerald'], failed: ['فشل', 'rose'], cancelled: ['ملغي', 'slate'],
}

export default function Services() {
  const [orders, setOrders] = useState([])
  const [tab, setTab] = useState('')
  const load = () => api.get('/service-orders').then(({ data }) => setOrders(data))
  useEffect(() => {
    load()
    const s = getSocket()
    s.on('service_order_updated', load)
    return () => s.off('service_order_updated', load)
  }, [])

  const rows = orders.filter((o) => !tab || o.provider === tab)
  const cols = [
    { key: 'ref', label: 'الرقم', render: (o) => <span className="font-mono text-xs">{o.ref}</span> },
    { key: 'provider', label: 'الخدمة', render: (o) => (o.provider === 'delivery' ? '🛵 توصيل' : '🧺 دراي كلين') },
    { key: 'roomNumber', label: 'الغرفة' },
    { key: 'details', label: 'التفاصيل', render: (o) => <span className="line-clamp-2 max-w-sm">{o.details}</span> },
    { key: 'channel', label: 'القناة', render: (o) => (o.channel === 'api' ? 'API' : 'واتساب') },
    { key: 'status', label: 'الحالة', render: (o) => <div><Badge color={STATUS[o.status]?.[1]}>{STATUS[o.status]?.[0] || o.status}</Badge><div className="mt-1 text-[11px] text-slate-500">{o.statusText}</div></div> },
    { key: 'createdAt', label: 'الوقت', render: (o) => fmtDate(o.createdAt) },
  ]
  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="الديلفري والدراي كلين" subtitle="تُنشأ من واتساب (نزيل أو موظف) وتُتابع حالتها ويُبلّغ النزيل تلقائياً" />
      <Tabs tabs={[{ value: '', label: 'الكل' }, { value: 'delivery', label: 'توصيل' }, { value: 'dryclean', label: 'دراي كلين' }]} value={tab} onChange={setTab} />
      <Table columns={cols} rows={rows} empty="لا توجد طلبات بعد" />
    </div>
  )
}
