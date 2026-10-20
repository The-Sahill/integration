// src/pages/Inventory.jsx — المخزون والمستهلكات (يمكن تعديله أيضاً بالأوامر الصوتية على واتساب)
import { useEffect, useState } from 'react'
import { Plus, Minus, Pencil, TriangleAlert } from 'lucide-react'
import { api, errMsg, getSocket } from '../lib/api'
import { PageHeader, Table, Button, Modal, Field, Input, Badge } from '../components/ui'

const EMPTY = { name: '', aliases: [], category: 'مناشف', unit: 'قطعة', quantity: 0, minQuantity: 0 }

export default function Inventory() {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [adjusting, setAdjusting] = useState(null)
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')

  const load = () => api.get('/inventory').then(({ data }) => setItems(data))
  useEffect(() => {
    load()
    const s = getSocket()
    s.on('inventory_updated', load)
    return () => s.off('inventory_updated', load)
  }, [])

  const save = async () => {
    try {
      if (editing._id) await api.put(`/inventory/${editing._id}`, editing)
      else await api.post('/inventory', editing)
      setEditing(null)
      load()
    } catch (e) {
      alert(errMsg(e))
    }
  }

  const adjust = async (sign) => {
    try {
      await api.post(`/inventory/${adjusting._id}/adjust`, { delta: sign * Number(delta || 0), note })
      setAdjusting(null)
      setDelta('')
      setNote('')
      load()
    } catch (e) {
      alert(errMsg(e))
    }
  }

  const cols = [
    { key: 'name', label: 'الصنف', render: (i) => <div><b>{i.name}</b><div className="text-[11px] text-slate-500">{(i.aliases || []).join('، ')}</div></div> },
    { key: 'category', label: 'الفئة' },
    { key: 'quantity', label: 'الكمية', render: (i) => <span className={i.minQuantity > 0 && i.quantity <= i.minQuantity ? 'font-bold text-rose-300' : ''}>{i.quantity} {i.unit}</span> },
    { key: 'minQuantity', label: 'حد التنبيه' },
    { key: 'status', label: '', render: (i) => (i.minQuantity > 0 && i.quantity <= i.minQuantity ? <Badge color="rose"><TriangleAlert className="h-3 w-3" />منخفض</Badge> : <Badge color="emerald">جيد</Badge>) },
    {
      key: 'act', label: '', render: (i) => (
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => setAdjusting(i)}>± تعديل الكمية</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(i)}><Pencil className="h-3.5 w-3.5" /></Button>
        </div>
      ),
    },
  ]

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="المخزون" subtitle='مثال على واتساب: "صرفنا 10 مناشف" أو "صار عنا 40 شامبو"' actions={<Button size="sm" onClick={() => setEditing({ ...EMPTY })}><Plus className="h-4 w-4" />صنف جديد</Button>} />
      <Table columns={cols} rows={items} empty="أضف أصناف المخزون (مناشف، أدوات نظافة، قطع صيانة...)" />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?._id ? 'تعديل صنف' : 'صنف جديد'}>
        {editing && (
          <div className="space-y-3">
            <Field label="الاسم"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="أسماء بديلة (فاصلة)" hint="ليفهمها الـ AI من الأوامر الصوتية"><Input value={(editing.aliases || []).join('، ')} onChange={(e) => setEditing({ ...editing, aliases: e.target.value.split(/[,،]/).map((s) => s.trim()).filter(Boolean) })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="الفئة"><Input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field>
              <Field label="الوحدة"><Input value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} /></Field>
              {!editing._id && <Field label="الكمية الحالية"><Input type="number" value={editing.quantity} onChange={(e) => setEditing({ ...editing, quantity: Number(e.target.value) })} /></Field>}
              <Field label="حد التنبيه"><Input type="number" value={editing.minQuantity} onChange={(e) => setEditing({ ...editing, minQuantity: Number(e.target.value) })} /></Field>
            </div>
            <Button onClick={save} disabled={!editing.name}>حفظ</Button>
          </div>
        )}
      </Modal>

      <Modal open={!!adjusting} onClose={() => setAdjusting(null)} title={`تعديل كمية: ${adjusting?.name || ''}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-400">الحالية: {adjusting?.quantity} {adjusting?.unit}</p>
          <Field label="الكمية"><Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} /></Field>
          <Field label="ملاحظة"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: توريد جديد / صرف للطابق 2" /></Field>
          <div className="flex gap-2">
            <Button onClick={() => adjust(1)} disabled={!delta}><Plus className="h-4 w-4" />إضافة</Button>
            <Button variant="warning" onClick={() => adjust(-1)} disabled={!delta}><Minus className="h-4 w-4" />صرف</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
