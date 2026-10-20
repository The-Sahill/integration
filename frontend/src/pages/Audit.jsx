// src/pages/Audit.jsx — سجل التدقيق: من، ماذا، متى
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fmtDate } from '../lib/labels'
import { PageHeader, Table, Input, Badge } from '../components/ui'

const ACTOR = { staff: ['موظف', 'sky'], guest: ['عميل', 'slate'], ai: ['AI', 'emerald'], system: ['النظام', 'violet'], dashboard: ['اللوحة', 'amber'] }

export default function Audit() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => api.get('/audit', { params: { action: q || undefined, limit: 300 } }).then(({ data }) => setRows(data)), 300)
    return () => clearTimeout(t)
  }, [q])

  const cols = [
    { key: 'at', label: 'متى', render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.at)}</span> },
    { key: 'actor', label: 'من', render: (r) => <div><Badge color={ACTOR[r.actorType]?.[1]}>{ACTOR[r.actorType]?.[0]}</Badge> <span className="text-xs">{r.actorName || ''}</span>{r.actorPhone && <div className="ltr text-right text-[11px] text-slate-500">{r.actorPhone}</div>}</div> },
    { key: 'action', label: 'ماذا', render: (r) => <span className={`font-mono text-xs ${r.success ? '' : 'text-rose-300'}`}>{r.action}</span> },
    { key: 'target', label: 'على', render: (r) => r.target || '-' },
    { key: 'details', label: 'تفاصيل', render: (r) => <code className="line-clamp-2 block max-w-md break-all text-[11px] text-slate-400">{r.details ? JSON.stringify(r.details) : ''}</code> },
  ]
  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="سجل التدقيق" actions={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="فلترة بالعملية: booking, payment, ticket..." className="!w-72" />} />
      <Table columns={cols} rows={rows} />
    </div>
  )
}
