// src/pages/Pricing.jsx — الأسعار وقواعد التفاوض لكل نوع وحدة + سجل التفاوض
import { useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Database } from 'lucide-react'
import { api, errMsg } from '../lib/api'
import { NEG_STATUS, fmtDate } from '../lib/labels'
import { PageHeader, Tabs, Table, Badge, Button, Modal, Field, Input, Textarea, Toggle, Stat, Card } from '../components/ui'

const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const EMPTY = {
  name: '', aliases: [], description: '', zaaerUnitTypeId: '', ratePlanId: '', maxAdults: 4, unitsCount: 1, baseRate: '', weekendRate: '',
  weekendNights: [4, 5], seasons: [], minRate: '', maxDiscountPct: 15, concessionSteps: [5, 10, 15],
  alternatives: { extraNightDiscountPct: 30, earlyCheckIn: true, lateCheckOut: true }, useZaaerPrice: false, active: true,
}

function RuleForm({ value, onChange }) {
  const v = value
  const set = (k, val) => onChange({ ...v, [k]: val })
  const num = (k) => (e) => set(k, e.target.value === '' ? '' : Number(e.target.value))
  const floorEx = v.baseRate && v.minRate ? Math.max(Number(v.minRate), Math.ceil(v.baseRate * (1 - (v.maxDiscountPct || 0) / 100))) : null
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="اسم النوع"><Input value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="شقة غرفة نوم واحدة" /></Field>
        <Field label="أسماء بديلة (مفصولة بفاصلة)" hint="مثل: شاليه 3، غرفة وصالة"><Input value={(v.aliases || []).join('، ')} onChange={(e) => set('aliases', e.target.value.split(/[,،]/).map((s) => s.trim()).filter(Boolean))} /></Field>
        <Field label="unit_type_id في زائر"><Input type="number" value={v.zaaerUnitTypeId} onChange={num('zaaerUnitTypeId')} /></Field>
        <Field label="rate_plan_id (اختياري)"><Input type="number" value={v.ratePlanId || ''} onChange={num('ratePlanId')} /></Field>
        <Field label="أقصى عدد بالغين"><Input type="number" value={v.maxAdults} onChange={num('maxAdults')} /></Field>
        <Field label="عدد الوحدات من هذا النوع" hint="لحساب نسبة الإشغال"><Input type="number" value={v.unitsCount} onChange={num('unitsCount')} /></Field>
      </div>
      <Field label="وصف قصير للعميل"><Textarea rows={2} value={v.description} onChange={(e) => set('description', e.target.value)} /></Field>

      <Card title="الأسعار (لليلة)">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="السعر الأساسي"><Input type="number" value={v.baseRate} onChange={num('baseRate')} /></Field>
          <Field label="سعر نهاية الأسبوع"><Input type="number" value={v.weekendRate || ''} onChange={num('weekendRate')} /></Field>
          <Field label="أقل سعر مسموح 🔒" hint="لا يُتجاوز أبداً بدون المدير"><Input type="number" value={v.minRate} onChange={num('minRate')} /></Field>
        </div>
        <div className="mt-3">
          <div className="mb-1 text-xs text-slate-400">ليالي نهاية الأسبوع</div>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <button key={i} type="button" onClick={() => set('weekendNights', v.weekendNights.includes(i) ? v.weekendNights.filter((x) => x !== i) : [...v.weekendNights, i])} className={`rounded-md border px-2 py-1 text-xs ${v.weekendNights.includes(i) ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>{d}</button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span>المواسم (تتقدم على نهاية الأسبوع)</span>
            <Button size="sm" variant="ghost" onClick={() => set('seasons', [...v.seasons, { name: '', from: '07-01', to: '08-31', rate: '' }])}><Plus className="h-3.5 w-3.5" />موسم</Button>
          </div>
          {v.seasons.map((s, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_80px_80px_80px_auto] gap-2">
              <Input placeholder="الاسم" value={s.name} onChange={(e) => set('seasons', v.seasons.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input placeholder="من MM-DD" value={s.from} onChange={(e) => set('seasons', v.seasons.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
              <Input placeholder="إلى MM-DD" value={s.to} onChange={(e) => set('seasons', v.seasons.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
              <Input type="number" placeholder="السعر" value={s.rate} onChange={(e) => set('seasons', v.seasons.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)))} />
              <button onClick={() => set('seasons', v.seasons.filter((_, j) => j !== i))} className="text-rose-400"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <div className="mt-3"><Toggle checked={v.useZaaerPrice} onChange={(x) => set('useZaaerPrice', x)} label="استخدم سعر زائر كسعر أساسي (بدل الأسعار أعلاه)" /></div>
      </Card>

      <Card title="التفاوض">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="أقصى نسبة خصم %"><Input type="number" value={v.maxDiscountPct} onChange={num('maxDiscountPct')} /></Field>
          <Field label="خطوات التنازل % (تراكمية)" hint="مثال: 5، 10، 15 — لا يعطي الأقل من أول مرة"><Input value={(v.concessionSteps || []).join('، ')} onChange={(e) => set('concessionSteps', e.target.value.split(/[,،]/).map((s) => Number(s.trim())).filter((n) => n > 0))} /></Field>
          <Field label="خصم الليلة الإضافية % (بديل)"><Input type="number" value={v.alternatives?.extraNightDiscountPct ?? 0} onChange={(e) => set('alternatives', { ...v.alternatives, extraNightDiscountPct: Number(e.target.value) })} /></Field>
          <div className="space-y-2 pt-5">
            <Toggle checked={!!v.alternatives?.earlyCheckIn} onChange={(x) => set('alternatives', { ...v.alternatives, earlyCheckIn: x })} label="عرض دخول مبكر كبديل" />
            <Toggle checked={!!v.alternatives?.lateCheckOut} onChange={(x) => set('alternatives', { ...v.alternatives, lateCheckOut: x })} label="عرض خروج متأخر كبديل" />
          </div>
        </div>
        {floorEx && <p className="mt-3 text-xs text-slate-400">مثال لليلة عادية: يبدأ بـ <b>{v.baseRate}</b> ← خطوات: {(v.concessionSteps || []).map((p) => Math.max(floorEx, Math.round(v.baseRate * (1 - p / 100)))).join(' ← ')} — الحد الفعلي <b className="text-amber-300">{floorEx}</b></p>}
      </Card>
      <Toggle checked={v.active} onChange={(x) => set('active', x)} label="مفعّل" />
    </div>
  )
}

export default function Pricing() {
  const [tab, setTab] = useState('rules')
  const [rules, setRules] = useState([])
  const [neg, setNeg] = useState({ stats: {}, items: [] })
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [props, setProps] = useState(null)

  const load = async () => {
    const [r, n] = await Promise.all([api.get('/pricing'), api.get('/negotiations')])
    setRules(r.data)
    setNeg(n.data)
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    setSaving(true)
    try {
      if (editing._id) await api.put(`/pricing/${editing._id}`, editing)
      else await api.post('/pricing', editing)
      setEditing(null)
      load()
    } catch (e) {
      alert(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const loadProps = async () => {
    try {
      const { data } = await api.get('/zaaer/properties')
      setProps(data)
    } catch (e) {
      alert(errMsg(e))
    }
  }

  const ruleCols = [
    { key: 'name', label: 'النوع', render: (r) => <div><b>{r.name}</b>{!r.active && <Badge color="slate" className="mr-2">معطّل</Badge>}<div className="text-[11px] text-slate-500">{(r.aliases || []).join('، ')}</div></div> },
    { key: 'zaaerUnitTypeId', label: 'زائر' },
    { key: 'baseRate', label: 'أساسي' },
    { key: 'weekendRate', label: 'نهاية أسبوع', render: (r) => r.weekendRate || '-' },
    { key: 'seasons', label: 'مواسم', render: (r) => r.seasons?.length || 0 },
    { key: 'minRate', label: 'الحد الأدنى', render: (r) => <span className="text-amber-300">{r.minRate}</span> },
    { key: 'maxDiscountPct', label: 'أقصى خصم', render: (r) => `${r.maxDiscountPct}%` },
    { key: 'steps', label: 'الخطوات', render: (r) => (r.concessionSteps || []).join(' / ') },
    { key: 'act', label: '', render: (r) => <Button size="sm" variant="ghost" onClick={() => setEditing({ ...EMPTY, ...r })}><Pencil className="h-3.5 w-3.5" /></Button> },
  ]

  const negCols = [
    { key: 'updatedAt', label: 'التاريخ', render: (n) => fmtDate(n.updatedAt) },
    { key: 'phone', label: 'العميل', render: (n) => <span className="ltr">+{n.phone}</span> },
    { key: 'unitName', label: 'الوحدة' },
    { key: 'dates', label: 'الإقامة', render: (n) => `${n.checkIn} ← ${n.checkOut}` },
    { key: 'listPrice', label: 'السعر الأول' },
    { key: 'floorPrice', label: 'الحد', render: (n) => <span className="text-amber-300">{n.floorPrice}</span> },
    { key: 'offers', label: 'العروض', render: (n) => <span className="text-xs">{(n.offers || []).map((o) => `${o.by === 'guest' ? '👤' : o.by === 'manager' ? '👔' : '🏨'}${o.amount}`).join(' → ')}</span> },
    { key: 'finalPrice', label: 'النهائي', render: (n) => n.finalPrice || '-' },
    { key: 'status', label: 'النتيجة', render: (n) => <Badge color={NEG_STATUS[n.status]?.color}>{NEG_STATUS[n.status]?.label}</Badge> },
  ]

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="الأسعار والتفاوض"
        subtitle="الحساب في الكود: الـ AI لا يستطيع النزول تحت الحد الأدنى"
        actions={tab === 'rules' && <>
          <Button size="sm" variant="secondary" onClick={loadProps}><Database className="h-4 w-4" />أنواع الوحدات في زائر</Button>
          <Button size="sm" variant="secondary" onClick={async () => { try { const { data } = await api.post('/pricing/import-zaaer'); alert(`وُجد ${data.found} نوع، أُضيف ${data.created}${data.found ? '' : '\nلم أتعرف على أنواع الوحدات في رد زائر — أضفها يدوياً'}`); load() } catch (e) { alert(errMsg(e)) } }}>استيراد من زائر</Button>
          <Button size="sm" onClick={() => setEditing({ ...EMPTY })}><Plus className="h-4 w-4" />نوع وحدة</Button>
        </>}
      />
      <Tabs tabs={[{ value: 'rules', label: 'قواعد الأسعار' }, { value: 'neg', label: 'سجل التفاوض', count: neg.items.length }]} value={tab} onChange={setTab} />
      {tab === 'rules' && <Table columns={ruleCols} rows={rules} empty="أضف أنواع الوحدات وربطها بـ unit_type_id في زائر" />}
      {tab === 'neg' && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="نسبة النجاح" value={neg.stats.successPct != null ? `${neg.stats.successPct}%` : '—'} hint={`${neg.stats.won || 0} من ${neg.stats.closed || 0} مغلقة`} />
            <Stat label="متوسط الخصم" value={`${neg.stats.avgDiscountPct || 0}%`} color="amber" />
            <Stat label="موافقات المدير" value={neg.stats.managerApprovals || 0} color="violet" />
            <Stat label="كل التفاوضات" value={neg.stats.total || 0} color="sky" />
          </div>
          <Table columns={negCols} rows={neg.items} />
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?._id ? `تعديل: ${editing.name}` : 'نوع وحدة جديد'} wide>
        {editing && (
          <>
            <RuleForm value={editing} onChange={setEditing} />
            <div className="mt-4 flex justify-between">
              <Button onClick={save} loading={saving} disabled={!editing.name || !editing.zaaerUnitTypeId || !editing.minRate}>حفظ</Button>
              {editing._id && <Button variant="danger" onClick={async () => { await api.delete(`/pricing/${editing._id}`); setEditing(null); load() }}>تعطيل</Button>}
            </div>
          </>
        )}
      </Modal>
      <Modal open={!!props} onClose={() => setProps(null)} title="البيانات الخام من زائر (/properties)" wide>
        <pre className="ltr max-h-[60vh] overflow-auto whitespace-pre-wrap text-left text-xs text-slate-300">{JSON.stringify(props, null, 2)}</pre>
      </Modal>
    </div>
  )
}
