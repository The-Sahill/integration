// src/pages/Overview.jsx — نظرة عامة + التقرير اليومي
import { useEffect, useState } from 'react'
import { MessageSquare, UserRound, CreditCard, Ticket, Package, Receipt, Send, RefreshCw } from 'lucide-react'
import { api, errMsg } from '../lib/api'
import { PageHeader, Stat, Card, Button, Spinner } from '../components/ui'
import { CATEGORIES } from '../lib/labels'

export default function Overview() {
  const [stats, setStats] = useState(null)
  const [report, setReport] = useState(null)
  const [faults, setFaults] = useState([])
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async () => {
    const [s, r, f] = await Promise.allSettled([api.get('/stats'), api.get('/reports/daily'), api.get('/reports/recurring-faults')])
    if (s.status === 'fulfilled') setStats(s.value.data)
    if (r.status === 'fulfilled') setReport(r.value.data)
    if (f.status === 'fulfilled') setFaults(f.value.data)
  }
  useEffect(() => { load() }, [])

  const sendNow = async () => {
    setSending(true)
    try {
      await api.post('/reports/daily/send')
      setMsg('تم إرسال التقرير للمدراء على واتساب ✅')
    } catch (e) {
      setMsg(errMsg(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="الرئيسية" subtitle="ملخص تشغيل اليوم" actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />تحديث</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="محادثات اليوم" value={stats?.conversations} icon={MessageSquare} />
        <Stat label="بانتظار موظف" value={stats?.handoffs} icon={UserRound} color={stats?.handoffs ? 'rose' : 'emerald'} />
        <Stat label="بانتظار الدفع" value={stats?.awaiting} icon={CreditCard} color="amber" />
        <Stat label="إيصالات للمراجعة" value={stats?.pendingReceipts} icon={Receipt} color={stats?.pendingReceipts ? 'amber' : 'emerald'} />
        <Stat label="تذاكر مفتوحة" value={stats?.openTickets} icon={Ticket} color="sky" />
        <Stat label="أصناف منخفضة" value={stats?.lowStock} icon={Package} color={stats?.lowStock ? 'rose' : 'emerald'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="التقرير الصباحي (معاينة)" actions={<Button size="sm" onClick={sendNow} loading={sending}><Send className="h-4 w-4" />أرسل الآن</Button>}>
          {report ? <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-slate-200">{report.text}</pre> : <Spinner />}
          {msg && <p className="mt-3 text-xs text-emerald-300">{msg}</p>}
        </Card>
        <Card title="أعطال متكررة (آخر 90 يوماً)">
          {faults.length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد أعطال متكررة 👌</p>
          ) : (
            <ul className="divide-y divide-slate-800 text-sm">
              {faults.map((f) => (
                <li key={`${f._id.room}-${f._id.category}`} className="flex items-center justify-between py-2">
                  <span>غرفة <b>{f._id.room}</b> — {CATEGORIES[f._id.category] || f._id.category}</span>
                  <span className="text-xs text-rose-300">{f.count} مرات (#{f.numbers.slice(-3).join(', #')})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
