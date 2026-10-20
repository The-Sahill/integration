// src/pages/Staff.jsx — الموظفون، صلاحيات الأدوار، ومستخدمو اللوحة
import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Save } from 'lucide-react'
import { api, errMsg } from '../lib/api'
import { ROLES } from '../lib/labels'
import { PageHeader, Tabs, Table, Button, Modal, Field, Input, Select, Toggle, Badge } from '../components/ui'

const TOOL_AR = {
  list_unit_types: 'أنواع الوحدات', check_availability: 'الشواغر', get_price_quote: 'عرض سعر', negotiate_price: 'تفاوض', request_manager_approval: 'طلب موافقة',
  save_guest_details: 'حفظ بيانات العميل', create_hold: 'حجز مبدئي', send_payment_link: 'رابط دفع', get_booking_by_phone: 'بحث حجوزات', cancel_booking: 'إلغاء حجز',
  create_guest_request: 'طلب نزيل', create_maintenance_ticket: 'بلاغ صيانة', update_ticket: 'تحديث تذكرة', list_open_tickets: 'التذاكر المفتوحة',
  order_delivery: 'طلب توصيل', order_dry_clean: 'طلب دراي كلين', get_service_order_status: 'حالة طلب خدمة', handoff_to_human: 'تحويل لموظف',
  create_booking_in_zaer: 'حجز مباشر في زائر', confirm_payment: 'تأكيد دفع', reject_payment: 'رفض دفع', list_pending_payments: 'المدفوعات المعلقة',
  get_inventory: 'عرض المخزون', adjust_inventory: 'تعديل المخزون', send_message_to_guest: 'مراسلة عميل', respond_to_approval: 'قرار موافقة',
  update_unit_price: 'تعديل الأسعار', get_daily_report: 'التقرير اليومي', modify_booking: 'تعديل الحجز', check_in_guest: 'تسجيل الوصول',
  check_out_guest: 'تسجيل المغادرة', create_payment_receipt: 'وصل مالي في زائر', get_analytics: 'التحليلات', get_risks_and_advice: 'المخاطر والنصائح',
  get_account_balances: 'الأرصدة', grant_permission: 'منح صلاحيات', revoke_permission: 'سحب صلاحيات',
}
/** صلاحيات خاصة لهذا الموظف: ما يملكه دوره + ممنوح له − مسحوب منه */
function StaffPermissions({ staff, perm, tools, onChange }) {
  const roleTools = perm.permissions[staff.role] || []
  const extras = staff.extraPermissions || []
  const revoked = staff.revokedPermissions || []
  const activeExtra = (t) => extras.find((g) => g.tool === t && (!g.expiresAt || new Date(g.expiresAt) > new Date()))
  const effective = (t) => (roleTools.includes(t) && !revoked.includes(t)) || !!activeExtra(t)
  const toggle = (t) => {
    const on = effective(t)
    let ex = extras.filter((g) => g.tool !== t)
    let rv = revoked.filter((x) => x !== t)
    if (on) {
      if (roleTools.includes(t)) rv = [...rv, t]
    } else if (!roleTools.includes(t)) ex = [...ex, { tool: t, grantedBy: 'اللوحة' }]
    onChange({ ...staff, extraPermissions: ex, revokedPermissions: rv })
  }
  return (
    <div className="rounded-lg border border-slate-800 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-300">صلاحيات هذا الموظف</div>
      <p className="mb-2 text-[11px] text-slate-500">رمادي = من دوره، أخضر = ممنوحة له خصيصاً، أحمر = مسحوبة منه. يمكن للمدير أيضاً المنح بالصوت: "أعطِ أحمد صلاحية تأكيد الدفع لمدة 8 ساعات".</p>
      <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {tools.map((t) => {
          const fromRole = roleTools.includes(t)
          const extra = activeExtra(t)
          const isRevoked = revoked.includes(t)
          const tone = isRevoked ? 'text-rose-300' : extra ? 'text-emerald-300' : fromRole ? 'text-slate-300' : 'text-slate-500'
          return (
            <label key={t} className={`flex items-center gap-2 text-xs ${tone}`}>
              <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={effective(t)} onChange={() => toggle(t)} />
              {TOOL_AR[t] || t}
              {extra?.expiresAt && <span className="text-[10px] opacity-70">(حتى {new Date(extra.expiresAt).toLocaleString('ar-EG')})</span>}
            </label>
          )
        })}
      </div>
    </div>
  )
}

const roleOptions = Object.entries(ROLES).map(([value, label]) => ({ value, label }))
const EMPTY = { name: '', phone: '', role: 'reception', isSupervisor: false, active: true, notes: '' }

export default function Staff() {
  const [tab, setTab] = useState('staff')
  const [staff, setStaff] = useState([])
  const [perm, setPerm] = useState(null)
  const [users, setUsers] = useState([])
  const [editing, setEditing] = useState(null)
  const [newUser, setNewUser] = useState(null)

  const load = async () => {
    const [s, p] = await Promise.all([api.get('/staff'), api.get('/permissions')])
    setStaff(s.data)
    setPerm(p.data)
    api.get('/users').then(({ data }) => setUsers(data)).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    try {
      if (editing._id) await api.put(`/staff/${editing._id}`, editing)
      else await api.post('/staff', editing)
      setEditing(null)
      load()
    } catch (e) {
      alert(errMsg(e))
    }
  }

  const togglePerm = (role, tool) => {
    const list = perm.permissions[role] || []
    const next = list.includes(tool) ? list.filter((t) => t !== tool) : [...list, tool]
    setPerm({ ...perm, permissions: { ...perm.permissions, [role]: next } })
  }
  const savePerms = async () => {
    try {
      await api.put('/permissions', perm.permissions)
      alert('تم حفظ الصلاحيات ✅')
    } catch (e) {
      alert(errMsg(e))
    }
  }

  const cols = [
    { key: 'name', label: 'الاسم', render: (s) => <div><b>{s.name}</b>{s.isSupervisor && <Badge color="violet" className="mr-2">مشرف</Badge>}</div> },
    { key: 'phone', label: 'واتساب', render: (s) => <span className="ltr">+{s.phone}</span> },
    { key: 'role', label: 'الدور', render: (s) => ROLES[s.role] },
    { key: 'active', label: 'الحالة', render: (s) => <Badge color={s.active ? 'emerald' : 'slate'}>{s.active ? 'نشط' : 'موقوف'}</Badge> },
    { key: 'act', label: '', render: (s) => <Button size="sm" variant="ghost" onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /></Button> },
  ]

  const roles = perm?.roles?.filter((r) => !['manager', 'owner'].includes(r)) || []
  const staffTools = perm?.tools?.filter((t) => !(perm.guestOnly || []).includes(t)) || []

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="الموظفون والصلاحيات" subtitle="أي رقم غير مسجّل هنا يُعامل كعميل/نزيل" actions={tab === 'staff' && <Button size="sm" onClick={() => setEditing({ ...EMPTY })}><Plus className="h-4 w-4" />موظف</Button>} />
      <Tabs tabs={[{ value: 'staff', label: 'الموظفون' }, { value: 'perms', label: 'صلاحيات الأدوار' }, { value: 'users', label: 'مستخدمو اللوحة' }]} value={tab} onChange={setTab} />

      {tab === 'staff' && <Table columns={cols} rows={staff} empty="أضف الموظفين بأرقام واتساب" />}

      {tab === 'perms' && perm && (
        <div>
          <p className="mb-3 text-xs text-slate-400">المالك والمدير يملكان كل الصلاحيات. لصلاحيات موظف بعينه افتح ملفه من تبويب الموظفين. العمليات المعلّمة ⚠️ تطلب تأكيد الموظف بزر "نعم/لا" قبل التنفيذ.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-900 text-slate-400">
                <tr><th className="px-3 py-2 text-right">العملية</th>{roles.map((r) => <th key={r} className="px-2 py-2">{ROLES[r]}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {staffTools.map((t) => (
                  <tr key={t} className="bg-slate-950/40">
                    <td className="px-3 py-2">{TOOL_AR[t] || t} {perm.confirmTools.includes(t) && '⚠️'}</td>
                    {roles.map((r) => (
                      <td key={r} className="px-2 py-2 text-center">
                        <input type="checkbox" checked={(perm.permissions[r] || []).includes(t)} onChange={() => togglePerm(r, t)} className="h-4 w-4 accent-emerald-500" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button className="mt-3" onClick={savePerms}><Save className="h-4 w-4" />حفظ الصلاحيات</Button>
        </div>
      )}

      {tab === 'users' && (
        <div>
          <Button size="sm" className="mb-3" onClick={() => setNewUser({ username: '', name: '', password: '', role: 'reception' })}><Plus className="h-4 w-4" />مستخدم</Button>
          <Table
            columns={[
              { key: 'username', label: 'اسم المستخدم' },
              { key: 'name', label: 'الاسم' },
              { key: 'role', label: 'الدور', render: (u) => ROLES[u.role] || u.role },
              { key: 'act', label: '', render: (u) => <Button size="sm" variant="ghost" onClick={async () => { if (confirm('حذف المستخدم؟')) { await api.delete(`/users/${u._id}`).catch((e) => alert(errMsg(e))); load() } }}><Trash2 className="h-3.5 w-3.5" /></Button> },
            ]}
            rows={users}
            empty="الإدارة فقط ترى هذه القائمة"
          />
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?._id ? 'تعديل موظف' : 'موظف جديد'}>
        {editing && (
          <div className="space-y-3">
            <Field label="الاسم"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="رقم واتساب" hint="مثال: 0791234567"><Input className="ltr text-right" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            <Field label="الدور"><Select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} options={roleOptions} /></Field>
            <Toggle checked={editing.isSupervisor} onChange={(v) => setEditing({ ...editing, isSupervisor: v })} label="مشرف (يستلم التصعيدات)" />
            <Toggle checked={!!editing.receivesDailyReport} onChange={(v) => setEditing({ ...editing, receivesDailyReport: v })} label="يستلم التقرير الصباحي" />
            {perm && !['manager', 'owner'].includes(editing.role) && (
              <StaffPermissions staff={editing} perm={perm} tools={staffTools} onChange={setEditing} />
            )}
            <Toggle checked={editing.active} onChange={(v) => setEditing({ ...editing, active: v })} label="نشط" />
            <div className="flex justify-between">
              <Button onClick={save} disabled={!editing.name || !editing.phone}>حفظ</Button>
              {editing._id && <Button variant="danger" onClick={async () => { if (confirm('حذف الموظف؟')) { await api.delete(`/staff/${editing._id}`); setEditing(null); load() } }}>حذف</Button>}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!newUser} onClose={() => setNewUser(null)} title="مستخدم لوحة جديد">
        {newUser && (
          <div className="space-y-3">
            <Field label="اسم المستخدم"><Input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} /></Field>
            <Field label="الاسم"><Input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} /></Field>
            <Field label="كلمة المرور"><Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /></Field>
            <Field label="الدور"><Select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} options={roleOptions} /></Field>
            <Button onClick={async () => { try { await api.post('/users', newUser); setNewUser(null); load() } catch (e) { alert(errMsg(e)) } }}>إنشاء</Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
