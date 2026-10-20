// src/pages/Tickets.jsx — لوحة التذاكر (طلبات النزلاء والصيانة)
import { useEffect, useState } from 'react'
import { Plus, Wrench, BellRing, RefreshCw } from 'lucide-react'
import { api, mediaUrl, errMsg, getSocket } from '../lib/api'
import { TICKET_STATUS, CATEGORIES, PRIORITY, fmtDate } from '../lib/labels'
import { PageHeader, Tabs, Table, Badge, Button, Modal, Field, Input, Select, Textarea } from '../components/ui'

const catOptions = Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))
const prOptions = Object.entries(PRIORITY).map(([value, v]) => ({ value, label: v.label }))

export default function Tickets() {
  const [tickets, setTickets] = useState([])
  const [staff, setStaff] = useState([])
  const [tab, setTab] = useState('open')
  const [kind, setKind] = useState('')
  const [selected, setSelected] = useState(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ kind: 'request', category: 'towels', priority: 'normal', roomNumber: '', description: '' })
  const [note, setNote] = useState('')

  const load = async () => {
    const { data } = await api.get('/tickets', { params: { status: tab === 'open' ? 'open' : undefined, kind: kind || undefined } })
    setTickets(data)
  }
  useEffect(() => { load() }, [tab, kind])
  useEffect(() => {
    api.get('/staff').then(({ data }) => setStaff(data.filter((s) => s.active)))
    const s = getSocket()
    const on = (t) => {
      setTickets((prev) => {
        const i = prev.findIndex((x) => x._id === t._id)
        if (i === -1) return [t, ...prev]
        const n = [...prev]
        n[i] = t
        return n
      })
      setSelected((cur) => (cur && cur._id === t._id ? t : cur))
    }
    s.on('ticket_updated', on)
    return () => s.off('ticket_updated', on)
  }, [])

  const update = async (body) => {
    try {
      const { data } = await api.patch(`/tickets/${selected._id}`, body)
      if (!data.ok) alert(data.message)
      setNote('')
      load()
    } catch (e) {
      alert(errMsg(e))
    }
  }

  const create = async () => {
    try {
      await api.post('/tickets', form)
      setCreating(false)
      setForm({ kind: 'request', category: 'towels', priority: 'normal', roomNumber: '', description: '' })
      load()
    } catch (e) {
      alert(errMsg(e))
    }
  }

  const cols = [
    { key: 'number', label: '#', render: (t) => <span className="font-mono">#{t.number}</span> },
    { key: 'kind', label: 'النوع', render: (t) => (t.kind === 'maintenance' ? <span className="flex items-center gap-1"><Wrench className="h-3.5 w-3.5" />صيانة</span> : 'طلب') },
    { key: 'category', label: 'التصنيف', render: (t) => CATEGORIES[t.category] || t.category },
    { key: 'roomNumber', label: 'الغرفة' },
    { key: 'description', label: 'الوصف', render: (t) => <span className="line-clamp-2 max-w-xs">{t.description}</span> },
    { key: 'priority', label: 'الأولوية', render: (t) => <Badge color={PRIORITY[t.priority]?.color}>{PRIORITY[t.priority]?.label}</Badge> },
    { key: 'assignedName', label: 'المسؤول', render: (t) => t.assignedName || <span className="text-rose-300">غير محوّلة</span> },
    { key: 'status', label: 'الحالة', render: (t) => <div className="flex items-center gap-1"><Badge color={TICKET_STATUS[t.status]?.color}>{TICKET_STATUS[t.status]?.label}</Badge>{t.escalated && <BellRing className="h-3.5 w-3.5 text-rose-400" title="مصعّدة" />}</div> },
    { key: 'createdAt', label: 'الوقت', render: (t) => fmtDate(t.createdAt) },
  ]

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="الطلبات والصيانة"
        subtitle="تُحوّل تلقائياً للموظف المختص على واتساب مع تذكير وتصعيد"
        actions={<>
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />تذكرة جديدة</Button>
        </>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Tabs tabs={[{ value: 'open', label: 'المفتوحة' }, { value: 'all', label: 'الكل' }]} value={tab} onChange={setTab} />
        <Tabs tabs={[{ value: '', label: 'الكل' }, { value: 'request', label: 'طلبات' }, { value: 'maintenance', label: 'صيانة' }]} value={kind} onChange={setKind} />
      </div>
      <Table columns={cols} rows={tickets} onRowClick={setSelected} empty="لا توجد تذاكر" />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `تذكرة #${selected.number}` : ''} wide>
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><div className="text-xs text-slate-500">التصنيف</div>{CATEGORIES[selected.category]}</div>
              <div><div className="text-xs text-slate-500">الغرفة</div>{selected.roomNumber || '-'}</div>
              <div><div className="text-xs text-slate-500">النزيل</div>{selected.guestName || '-'} {selected.guestPhone && <span className="ltr text-xs text-slate-400">+{selected.guestPhone}</span>}</div>
              <div><div className="text-xs text-slate-500">رضا النزيل</div>{selected.satisfied === true ? '✅ راضٍ' : selected.satisfied === false ? '❌ غير راضٍ' : '-'}</div>
            </div>
            <p className="rounded-lg bg-slate-950 p-3 leading-7">{selected.description}</p>
            {selected.media?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selected.media.map((m) => <a key={m} href={mediaUrl(m)} target="_blank" rel="noreferrer"><img src={mediaUrl(m)} className="h-28 rounded-lg" alt="" /></a>)}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => update({ status: 'acknowledged' })}>👍 استلمت</Button>
              <Button size="sm" onClick={() => update({ status: 'done' })}>✅ تم</Button>
              <Button size="sm" variant="ghost" onClick={() => update({ status: 'cancelled' })}>إلغاء</Button>
              <Select
                value=""
                onChange={(e) => e.target.value && update({ assignToPhone: e.target.value })}
                options={[{ value: '', label: 'تحويل إلى...' }, ...staff.map((s) => ({ value: s.phone, label: `${s.name} (${s.role})` }))]}
                className="!w-auto !py-1 text-xs"
              />
              <Select value={selected.priority} onChange={(e) => update({ priority: e.target.value })} options={prOptions} className="!w-auto !py-1 text-xs" />
            </div>
            <div className="flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="إضافة ملاحظة..." />
              <Button variant="secondary" onClick={() => note && update({ note })}>إضافة</Button>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-400">السجل</div>
              <ul className="space-y-1 text-xs text-slate-400">
                {[...(selected.history || [])].reverse().map((h, i) => (
                  <li key={i}>• {fmtDate(h.at)} — <b className="text-slate-300">{h.action}</b> {h.note && `— ${h.note}`} <span className="opacity-60">({h.by})</span></li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="تذكرة جديدة">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="النوع"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} options={[{ value: 'request', label: 'طلب نزيل' }, { value: 'maintenance', label: 'صيانة' }]} /></Field>
            <Field label="التصنيف"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={catOptions} /></Field>
            <Field label="الغرفة"><Input value={form.roomNumber} onChange={(e) => setForm({ ...form, roomNumber: e.target.value })} /></Field>
            <Field label="الأولوية"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} options={prOptions} /></Field>
          </div>
          <Field label="الوصف"><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Button onClick={create} disabled={!form.description}>إنشاء وتحويل</Button>
        </div>
      </Modal>
    </div>
  )
}
