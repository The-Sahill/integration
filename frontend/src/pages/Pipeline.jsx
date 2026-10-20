// src/pages/Pipeline.jsx — لوحة الحجوزات المحتملة حسب المرحلة
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, RefreshCw, BellRing } from 'lucide-react'
import { api, getSocket } from '../lib/api'
import { STAGES, fmtDate } from '../lib/labels'
import { PageHeader, Badge, Button, Spinner } from '../components/ui'

const COLUMNS = STAGES.filter((s) => s.key !== 'in_house')

export default function Pipeline() {
  const [items, setItems] = useState(null)
  const navigate = useNavigate()
  const load = () => api.get('/pipeline').then(({ data }) => setItems(data))

  useEffect(() => {
    load()
    const s = getSocket()
    const on = () => load()
    s.on('booking_updated', on)
    return () => s.off('booking_updated', on)
  }, [])

  const move = async (id, stage) => {
    await api.patch(`/conversations/${id}`, { stage })
    load()
  }

  if (!items) return <Spinner />
  const total = items.filter((i) => !['lost', 'new'].includes(i.stage)).length
  const won = items.filter((i) => i.stage === 'confirmed').length

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="الحجوزات المحتملة"
        subtitle={`آخر 30 يوماً — ${total} في المسار، ${won} مؤكد`}
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />تحديث</Button>}
      />
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const list = items.filter((i) => i.stage === col.key)
          return (
            <div key={col.key} className="w-64 shrink-0 rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                <Badge color={col.color}>{col.label}</Badge>
                <span className="text-xs text-slate-500">{list.length}</span>
              </div>
              <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
                {list.map((c) => (
                  <div key={c._id} className="rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-xs">
                    <button onClick={() => navigate(`/chat?c=${c._id}`)} className="w-full text-right">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-100">{c.name}</span>
                        {c.aiEnabled && <Bot className="h-3.5 w-3.5 text-emerald-400" />}
                      </div>
                      <div className="ltr mt-0.5 text-right text-[11px] text-slate-500">+{c.phone}</div>
                      {c.state?.checkIn && <div className="mt-1 text-slate-300">📅 {c.state.checkIn} ← {c.state.checkOut}</div>}
                      {c.state?.unitName && <div className="text-slate-400">🏠 {c.state.unitName}</div>}
                      {(c.state?.agreedPrice || c.state?.quotedPrice) && <div className="text-emerald-300">💰 {c.state.agreedPrice || c.state.quotedPrice}</div>}
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                        <span>{fmtDate(c.lastMessageAt)}</span>
                        {c.followUp?.count > 0 && <span className="flex items-center gap-0.5"><BellRing className="h-3 w-3" />{c.followUp.count}</span>}
                      </div>
                    </button>
                    <select value={c.stage} onChange={(e) => move(c._id, e.target.value)} className="mt-2 w-full rounded border border-slate-800 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-300">
                      {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
