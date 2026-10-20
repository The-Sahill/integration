// src/pages/Analytics.jsx — التحليلات: مقارنات يوم/أسبوع/شهر/سنة، سلسلة زمنية، الحجوزات القادمة، المخاطر والنصائح، الأرصدة
import { useEffect, useState } from 'react'
import { ChevronRight, ChevronLeft, RefreshCw, Download, TriangleAlert, Lightbulb, Wallet } from 'lucide-react'
import { api, errMsg } from '../lib/api'
import { PageHeader, Tabs, Card, Button, Spinner, Badge } from '../components/ui'

const PERIODS = [
  { value: 'day', label: 'يوم بيوم' },
  { value: 'week', label: 'أسبوع بأسبوع' },
  { value: 'month', label: 'شهر بشهر' },
  { value: 'year', label: 'سنة بسنة' },
]
const SERIES_COLS = [
  ['occupancyPct', 'الإشغال %'], ['roomNights', 'ليالٍ'], ['revenue', 'الإيراد'], ['adr', 'ADR'], ['revpar', 'RevPAR'],
  ['newBookings', 'حجوزات جديدة'], ['cancellations', 'إلغاءات'], ['collected', 'المحصّل'], ['whatsappLeads', 'عملاء واتساب'], ['aiBookings', 'حجوزات AI'],
]
const METHOD_AR = { cliq: 'كليك', bank: 'تحويل بنكي', cash: 'كاش', card: 'فيزا/بطاقة', other: 'أخرى' }

function Change({ value, lowerIsBetter }) {
  if (value === null || value === undefined) return <span className="text-slate-500">—</span>
  if (value === 0) return <span className="text-slate-400">0%</span>
  const good = lowerIsBetter ? value < 0 : value > 0
  return <span className={good ? 'text-emerald-400' : 'text-rose-400'}>{value > 0 ? '▲' : '▼'} {Math.abs(value)}%</span>
}

function toCSV(rows, cols) {
  const head = cols.map((c) => c[1]).join(',')
  const body = rows.map((r) => cols.map((c) => JSON.stringify(r[c[0]] ?? '')).join(',')).join('\n')
  const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'analytics.csv'
  a.click()
}

function CompareTab() {
  const [type, setType] = useState('week')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setData(null)
    api.get('/analytics/compare', { params: { type, offset } }).then(({ data }) => setData(data)).catch((e) => setErr(errMsg(e)))
  }, [type, offset])
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs tabs={PERIODS} value={type} onChange={(v) => { setType(v); setOffset(0) }} />
        <div className="mb-4 flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => setOffset(offset - 1)}><ChevronRight className="h-4 w-4" />السابق</Button>
          <Button size="sm" variant="secondary" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>التالي<ChevronLeft className="h-4 w-4" /></Button>
        </div>
      </div>
      {err && <p className="text-sm text-rose-300">{err}</p>}
      {!data ? <Spinner /> : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-900 text-xs text-slate-400">
              <tr>
                <th className="px-3 py-2.5 text-right">المؤشر</th>
                <th className="px-3 py-2.5 text-right">{data.current.label}</th>
                <th className="px-3 py-2.5 text-right">{data.previous.label}</th>
                <th className="px-3 py-2.5 text-right">التغيّر</th>
                <th className="px-3 py-2.5 text-right">نفس الفترة العام الماضي</th>
                <th className="px-3 py-2.5 text-right">التغيّر السنوي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {data.rows.map((r) => (
                <tr key={r.key} className="bg-slate-950/40">
                  <td className="px-3 py-2 text-slate-300">{r.label}</td>
                  <td className="px-3 py-2 font-semibold">{r.current ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{r.previous ?? '—'}</td>
                  <td className="px-3 py-2"><Change value={r.changePct} lowerIsBetter={r.lowerIsBetter} /></td>
                  <td className="px-3 py-2 text-slate-400">{r.lastYear ?? '—'}</td>
                  <td className="px-3 py-2"><Change value={r.changeLyPct} lowerIsBetter={r.lowerIsBetter} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-500">الإيراد والإشغال محسوبان على الليالي المقيمة داخل الفترة (من زائر). "المحصّل" = المدفوعات المؤكدة في النظام. عدد الوحدات: {data?.units}</p>
    </div>
  )
}

function SeriesTab() {
  const [type, setType] = useState('month')
  const [data, setData] = useState(null)
  useEffect(() => {
    setData(null)
    api.get('/analytics/series', { params: { type } }).then(({ data }) => setData(data))
  }, [type])
  const max = data ? Math.max(1, ...data.rows.map((r) => r.revenue)) : 1
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs tabs={PERIODS} value={type} onChange={setType} />
        {data && <Button size="sm" variant="secondary" className="mb-4" onClick={() => toCSV(data.rows, [['period', 'الفترة'], ...SERIES_COLS])}><Download className="h-4 w-4" />تصدير CSV</Button>}
      </div>
      {!data ? <Spinner /> : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-900 text-xs text-slate-400">
              <tr><th className="px-3 py-2.5 text-right">الفترة</th>{SERIES_COLS.map(([k, l]) => <th key={k} className="px-3 py-2.5 text-right">{l}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {[...data.rows].reverse().map((r) => (
                <tr key={r.period} className="bg-slate-950/40">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-300">{r.period}</td>
                  {SERIES_COLS.map(([k]) => (
                    <td key={k} className="px-3 py-2">
                      {k === 'revenue' ? (
                        <div className="flex items-center gap-2">
                          <div className="h-2 rounded bg-emerald-500/60" style={{ width: `${Math.max(2, (r.revenue / max) * 80)}px` }} />
                          <span>{r.revenue}</span>
                        </div>
                      ) : (r[k] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ForwardTab() {
  const [data, setData] = useState(null)
  useEffect(() => { api.get('/analytics/forward').then(({ data }) => setData(data)) }, [])
  if (!data) return <Spinner />
  const color = (p) => (p >= 80 ? 'bg-emerald-500' : p >= 50 ? 'bg-emerald-700' : p >= 25 ? 'bg-amber-600' : 'bg-rose-700')
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-slate-900 text-xs text-slate-400">
            <tr>{['الأيام القادمة', 'الإشغال المحجوز', 'الإشغال الفعلي لنفس الفترة العام الماضي', 'ليالٍ مباعة', 'ليالٍ فارغة', 'الإيراد المتوقع'].map((h) => <th key={h} className="px-3 py-2.5 text-right">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {data.rows.map((r) => (
              <tr key={r.days} className="bg-slate-950/40">
                <td className="px-3 py-2">{r.days} يوم</td>
                <td className="px-3 py-2 font-semibold">{r.occupancyPct}%</td>
                <td className="px-3 py-2 text-slate-400">{r.lastYearPct}%</td>
                <td className="px-3 py-2">{r.roomNights}</td>
                <td className="px-3 py-2 text-amber-300">{r.emptyNights}</td>
                <td className="px-3 py-2">{r.revenue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Card title={`إشغال الـ 30 يوماً القادمة — نهاية الأسبوع ${data.weekendAvgPct}% | أيام الأسبوع ${data.weekdayAvgPct}%`}>
        <div className="grid grid-cols-7 gap-1 sm:grid-cols-10 lg:grid-cols-15" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))' }}>
          {data.daily.map((d) => (
            <div key={d.date} className={`rounded p-1.5 text-center text-[10px] text-white ${color(d.pct)}`} title={`${d.date}: ${d.occupied}/${data.units}`}>
              <div>{d.date.slice(5)}</div>
              <div className="text-xs font-bold">{d.pct}%</div>
            </div>
          ))}
        </div>
      </Card>
      {data.arrivalsWithBalance.length > 0 && (
        <Card title="وصول خلال 3 أيام عليه رصيد غير مدفوع">
          <ul className="space-y-1 text-sm">{data.arrivalsWithBalance.map((r) => <li key={r.id}>{r.checkIn} — {r.guest} — <span className="text-amber-300">{r.balance}</span></li>)}</ul>
        </Card>
      )}
    </div>
  )
}

function InsightsTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const load = async (refresh) => {
    setLoading(true)
    try {
      const { data } = await api.get('/insights', { params: { refresh: refresh ? 1 : undefined } })
      setData(data)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load(false) }, [])
  if (!data) return <Spinner text="جاري تحليل البيانات..." />
  const lvl = { high: ['عالي', 'rose'], medium: ['متوسط', 'amber'], low: ['منخفض', 'sky'] }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><TriangleAlert className="h-4 w-4 text-rose-400" />المخاطر المكتشفة</span>} actions={<Button size="sm" variant="secondary" loading={loading} onClick={() => load(true)}><RefreshCw className="h-4 w-4" />إعادة التحليل</Button>}>
        {data.risks.length === 0 ? <p className="text-sm text-emerald-300">لا توجد مخاطر واضحة حالياً ✅</p> : (
          <ul className="space-y-3">
            {data.risks.map((r, i) => (
              <li key={i} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-center gap-2"><Badge color={lvl[r.level][1]}>{lvl[r.level][0]}</Badge><span className="text-xs text-slate-500">{r.area}</span></div>
                <div className="mt-1 text-sm font-semibold">{r.title}</div>
                {r.detail && <div className="mt-0.5 text-xs text-slate-400">{r.detail}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={<span className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-300" />نصائح لزيادة الحجوزات</span>}>
        <ol className="list-decimal space-y-2 pr-5 text-sm leading-7">{data.advice.map((a, i) => <li key={i}>{a}</li>)}</ol>
        <p className="mt-3 text-[11px] text-slate-500">{data.adviceSource === 'ai' ? 'مولّدة بالـ AI من أرقامك الحالية والمستقبلية' : 'نصائح قاعدية (تعذر الوصول للـ AI)'} — {new Date(data.generatedAt).toLocaleString('ar-EG')}</p>
      </Card>
    </div>
  )
}

function BalancesTab() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get('/finance/balances').then(({ data }) => setData(data)).catch((e) => setErr(errMsg(e))) }, [])
  if (err) return <p className="text-sm text-rose-300">{err}</p>
  if (!data) return <Spinner />
  const methods = [...new Set(Object.values(data.collected).flatMap((c) => Object.keys(c.byMethod)))]
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-900 text-xs text-slate-400">
            <tr><th className="px-3 py-2.5 text-right">الفترة</th><th className="px-3 py-2.5 text-right">إجمالي المحصّل</th>{methods.map((m) => <th key={m} className="px-3 py-2.5 text-right">{METHOD_AR[m] || m}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {Object.entries(data.collected).map(([label, c]) => (
              <tr key={label} className="bg-slate-950/40">
                <td className="px-3 py-2">{label}</td>
                <td className="px-3 py-2 font-semibold text-emerald-300">{Math.round(c.total)} {data.currency}</td>
                {methods.map((m) => <td key={m} className="px-3 py-2">{c.byMethod[m]?.total ?? 0}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4" />المستحقات على الحجوزات</span>}>
          {data.receivables ? (
            <ul className="space-y-1 text-sm">
              <li>الإجمالي: <b className="text-amber-300">{data.receivables.total}</b> {data.currency}</li>
              <li>نزلاء حاليون: {data.receivables.inHouse}</li>
              <li>وصول خلال 7 أيام: {data.receivables.next7Days}</li>
              <li>حجوزات عليها رصيد: {data.receivables.reservationsWithBalance}</li>
            </ul>
          ) : <p className="text-sm text-slate-500">تعذر جلب الحجوزات من زائر</p>}
        </Card>
        <Card title="أرصدة الحسابات في زائر">
          {Array.isArray(data.zaaerAccounts) && data.zaaerAccounts.length ? (
            <ul className="space-y-1 text-sm">{data.zaaerAccounts.map((a) => <li key={a.name}>{a.name}: <b>{a.balance}</b></li>)}</ul>
          ) : <p className="text-sm text-slate-500">تُعرض هنا أرصدة الصندوق والبنك من زائر بعد ضبط نقطة الأرصدة.</p>}
        </Card>
      </div>
    </div>
  )
}

export default function Analytics() {
  const [tab, setTab] = useState('compare')
  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="التحليلات والمخاطر" subtitle="مقارنات الأداء، الحجوزات القادمة، المخاطر، النصائح والأرصدة — متاحة أيضاً على واتساب للمالك والمدير" />
      <Tabs
        tabs={[
          { value: 'compare', label: 'مقارنة الفترات' },
          { value: 'series', label: 'جدول زمني' },
          { value: 'forward', label: 'الحجوزات القادمة' },
          { value: 'insights', label: 'المخاطر والنصائح' },
          { value: 'balances', label: 'الأرصدة' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'compare' && <CompareTab />}
      {tab === 'series' && <SeriesTab />}
      {tab === 'forward' && <ForwardTab />}
      {tab === 'insights' && <InsightsTab />}
      {tab === 'balances' && <BalancesTab />}
    </div>
  )
}
