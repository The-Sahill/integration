// src/pages/Settings.jsx — الإعدادات: معلومات المنشأة، فترات المتابعة والتصعيد، القوالب، الصوت
import { useEffect, useState } from 'react'
import { Save, CircleCheck, CircleX } from 'lucide-react'
import { api, errMsg } from '../lib/api'
import { PageHeader, Card, Field, Input, Textarea, Toggle, Button, Spinner, Select } from '../components/ui'

const TEMPLATE_AR = {
  followUp: 'متابعة العميل', holdExpired: 'انتهاء الحجز المبدئي', bookingConfirmed: 'تأكيد الحجز', paymentReminder: 'تذكير بالدفع',
  requestFeedback: 'سؤال رضا النزيل', staffAlert: 'تنبيه موظف', staffTask: 'مهمة موظف (استلمت/تم)', staffDecision: 'قرار موظف (تأكيد/رفض)', dailyReport: 'التقرير اليومي',
}
const ROUTING_ROLES = [
  { value: 'housekeeping', label: 'تدبير منزلي' }, { value: 'maintenance', label: 'صيانة' }, { value: 'reception', label: 'استقبال' }, { value: 'manager', label: 'مدير' },
]
const CAT_AR = { towels: 'مناشف', cleaning: 'تنظيف', amenities: 'مستلزمات', linen: 'بياضات', plumbing: 'سباكة', electric: 'كهرباء', ac: 'تكييف', appliance: 'أجهزة', internet: 'إنترنت', furniture: 'أثاث', checkin: 'دخول', checkout: 'خروج', other: 'أخرى' }

function PaymentMethods({ pm, footer, onChange, onFooter, cardReady }) {
  const set = (key, patch) => onChange({ ...pm, [key]: { ...pm[key], ...patch } })
  const accounts = pm.bank?.accounts || []
  const setAcc = (i, patch) => set('bank', { accounts: accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  return (
    <Card title="طرق الدفع (تُرسل للعميل بعد الحجز المبدئي — المفعّلة فقط)">
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-800 p-3">
          <Toggle checked={!!pm.cliq?.enabled} onChange={(v) => set('cliq', { enabled: v })} label={<b>كليك (CliQ)</b>} />
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label="الاسم المستعار (Alias)"><Input value={pm.cliq?.alias || ''} onChange={(e) => set('cliq', { alias: e.target.value })} /></Field>
            <Field label="اسم المستفيد"><Input value={pm.cliq?.beneficiary || ''} onChange={(e) => set('cliq', { beneficiary: e.target.value })} /></Field>
            <Field label="ملاحظة"><Input value={pm.cliq?.note || ''} onChange={(e) => set('cliq', { note: e.target.value })} /></Field>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 p-3">
          <div className="flex items-center justify-between">
            <Toggle checked={!!pm.bank?.enabled} onChange={(v) => set('bank', { enabled: v })} label={<b>تحويل بنكي</b>} />
            <Button size="sm" variant="secondary" onClick={() => set('bank', { accounts: [...accounts, { bankName: '', accountName: '', accountNumber: '', iban: '', swift: '', enabled: true }] })}>+ حساب بنكي</Button>
          </div>
          {accounts.map((a, i) => (
            <div key={i} className="mt-3 grid gap-2 rounded-lg bg-slate-950 p-2 sm:grid-cols-3">
              <Field label="البنك"><Input value={a.bankName} onChange={(e) => setAcc(i, { bankName: e.target.value })} /></Field>
              <Field label="اسم الحساب"><Input value={a.accountName} onChange={(e) => setAcc(i, { accountName: e.target.value })} /></Field>
              <Field label="رقم الحساب"><Input className="ltr text-left" value={a.accountNumber} onChange={(e) => setAcc(i, { accountNumber: e.target.value })} /></Field>
              <Field label="IBAN"><Input className="ltr text-left" value={a.iban} onChange={(e) => setAcc(i, { iban: e.target.value })} /></Field>
              <Field label="SWIFT"><Input className="ltr text-left" value={a.swift} onChange={(e) => setAcc(i, { swift: e.target.value })} /></Field>
              <div className="flex items-end justify-between gap-2 pb-1">
                <Toggle checked={a.enabled !== false} onChange={(v) => setAcc(i, { enabled: v })} label="مفعّل" />
                <Button size="sm" variant="ghost" onClick={() => set('bank', { accounts: accounts.filter((_, j) => j !== i) })}>حذف</Button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-slate-800 p-3">
          <Toggle checked={!!pm.card?.enabled} onChange={(v) => set('card', { enabled: v })} label={<b>فيزا / ماستركارد (رابط دفع)</b>} />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="الاسم الظاهر للعميل"><Input value={pm.card?.label || ''} onChange={(e) => set('card', { label: e.target.value })} /></Field>
            <Field label="ملاحظة"><Input value={pm.card?.note || ''} onChange={(e) => set('card', { note: e.target.value })} /></Field>
          </div>
          {!cardReady && <p className="mt-2 text-[11px] text-amber-300">جاهز للتفعيل مستقبلاً: يعمل فعلياً بعد ضبط ZAAER_CHECKOUT_ENABLED=true في .env. حتى ذلك لا يظهر للعملاء حتى لو فعّلته هنا.</p>}
        </div>

        <div className="rounded-lg border border-slate-800 p-3">
          <Toggle checked={!!pm.cash?.enabled} onChange={(v) => set('cash', { enabled: v })} label={<b>كاش عند الوصول</b>} />
          <div className="mt-2"><Field label="ملاحظة"><Input value={pm.cash?.note || ''} onChange={(e) => set('cash', { note: e.target.value })} /></Field></div>
        </div>

        <Field label="السطر الأخير بعد طرق الدفع"><Input value={footer || ''} onChange={(e) => onFooter(e.target.value)} /></Field>
      </div>
    </Card>
  )
}

export default function SettingsPage() {
  const [s, setS] = useState(null)
  const [env, setEnv] = useState({})
  const [saving, setSaving] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '' })

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      setS(data.settings)
      setEnv(data.env)
    })
  }, [])

  if (!s) return <Spinner />
  const set = (k, v) => setS({ ...s, [k]: v })
  const num = (k) => (e) => set(k, Number(e.target.value))

  const save = async () => {
    setSaving(true)
    try {
      const { lastDailyReport, ...rest } = s
      await api.put('/settings', rest)
      alert('تم الحفظ ✅')
    } catch (e) {
      alert(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const Flag = ({ ok, label }) => (
    <div className="flex items-center gap-2 text-sm">{ok ? <CircleCheck className="h-4 w-4 text-emerald-400" /> : <CircleX className="h-4 w-4 text-rose-400" />}{label}</div>
  )

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="الإعدادات" actions={<Button onClick={save} loading={saving}><Save className="h-4 w-4" />حفظ</Button>} />

      <Card title="حالة التكاملات (من .env)">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="text-sm">النموذج: <b className="ltr">{env.model}</b></div>
          <Flag ok={env.signatureCheck} label="التحقق من توقيع Meta (META_APP_SECRET)" />
          <Flag ok={env.zaaerCheckout} label="روابط الدفع بالبطاقة من زائر (ZAAER_CHECKOUT_ENABLED)" />
          <Flag ok={env.holdInZaaer} label="الحجز المبدئي يُنشأ في زائر فوراً (بدون وصل مالي)" />
          <Flag ok={env.zaaerReceipt} label="الوصل المالي في زائر (وإلا: تنبيه للمحاسب)" />
          <Flag ok={env.zaaerCheckin} label="تسجيل الوصول في زائر (وإلا: تنبيه للاستقبال)" />
          <Flag ok={env.zaaerBalances} label="أرصدة الحسابات من زائر" />
          <Flag ok={env.dryCleanApi} label="API برنامج الدراي كلين (وإلا: واتساب)" />
          <div className="text-sm">التوصيل: <b>{env.deliveryMode === 'http' ? 'API' : 'واتساب'}</b></div>
        </div>
      </Card>

      <Card title="المنشأة وأسلوب الرد">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="اسم المنشأة"><Input value={s.propertyName} onChange={(e) => set('propertyName', e.target.value)} /></Field>
          <Field label="رقم الطوارئ للعملاء"><Input value={s.supportPhone} onChange={(e) => set('supportPhone', e.target.value)} /></Field>
          <Field label="إجمالي الوحدات" hint="إن لم تحدد عدد الوحدات لكل نوع"><Input type="number" value={s.totalUnits} onChange={num('totalUnits')} /></Field>
        </div>
        <div className="mt-3 space-y-3">
          <Field label="اللهجة والأسلوب"><Input value={s.dialect} onChange={(e) => set('dialect', e.target.value)} /></Field>
          <Field label="معلومات المنشأة (ما يعرفه الـ AI)" hint="اختصرها قدر الإمكان — كل كلمة هنا تُرسل مع كل رد"><Textarea rows={10} value={s.propertyInfo} onChange={(e) => set('propertyInfo', e.target.value)} /></Field>

        </div>
      </Card>

      <PaymentMethods pm={s.paymentMethods || {}} footer={s.paymentFooter} onChange={(pm) => set('paymentMethods', pm)} onFooter={(v) => set('paymentFooter', v)} cardReady={env.zaaerCheckout} />

      <Card title="التحليلات والمخاطر">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="حد الإشغال المنخفض %" hint="أقل منه في الأيام القادمة يُعتبر خطراً"><Input type="number" value={s.lowOccupancyThreshold} onChange={num('lowOccupancyThreshold')} /></Field>
          <Field label="يوم تقرير المخاطر والنصائح الأسبوعي">
            <Select value={s.weeklyInsightsDay} onChange={num('weeklyInsightsDay')} options={['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((d, i) => ({ value: i, label: d }))} />
          </Field>
          <div className="pt-6"><Toggle checked={s.insightsEnabled} onChange={(v) => set('insightsEnabled', v)} label="إضافة المخاطر للتقرير الصباحي" /></div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="المحادثة">
          <div className="grid grid-cols-2 gap-3">
            <Field label="تجميع الرسائل (ثوانٍ)"><Input type="number" value={s.debounceSeconds} onChange={num('debounceSeconds')} /></Field>
            <Field label="عدد الرسائل في السياق"><Input type="number" value={s.historyMessages} onChange={num('historyMessages')} /></Field>
            <Field label="تحديث الملخص كل (رسالة)"><Input type="number" value={s.summaryEvery} onChange={num('summaryEvery')} /></Field>
          </div>
          <div className="mt-3"><Toggle checked={s.voiceReplyEnabled} onChange={(v) => set('voiceReplyEnabled', v)} label="الرد بصوت عندما يرسل العميل رسالة صوتية (يتطلب ffmpeg)" /></div>
        </Card>

        <Card title="الحجز والمتابعة (بالدقائق)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="مهلة الحجز المبدئي"><Input type="number" value={s.holdMinutes} onChange={num('holdMinutes')} /></Field>
            <Field label="التذكير الأول بعد"><Input type="number" value={s.followUp1Minutes} onChange={num('followUp1Minutes')} /></Field>
            <Field label="التذكير الثاني بعد"><Input type="number" value={s.followUp2Minutes} onChange={num('followUp2Minutes')} /></Field>
            <Field label="الإغلاق بعد"><Input type="number" value={s.closeAfterMinutes} onChange={num('closeAfterMinutes')} /></Field>
          </div>
          <div className="mt-3 space-y-3">
            <Field label="نص التذكير الأول" hint="{name} {checkIn} {checkOut}"><Textarea rows={2} value={s.followUpText1} onChange={(e) => set('followUpText1', e.target.value)} /></Field>
            <Field label="نص التذكير الثاني"><Textarea rows={2} value={s.followUpText2} onChange={(e) => set('followUpText2', e.target.value)} /></Field>
          </div>
        </Card>

        <Card title="التذاكر والتصعيد (بالدقائق)">
          <div className="grid grid-cols-3 gap-3">
            <Field label="تذكير إن لم يستلم بعد"><Input type="number" value={s.ticketAckMinutes} onChange={num('ticketAckMinutes')} /></Field>
            <Field label="تصعيد للمشرف بعد"><Input type="number" value={s.ticketEscalateMinutes} onChange={num('ticketEscalateMinutes')} /></Field>
            <Field label="أقصى تذكيرات"><Input type="number" value={s.ticketMaxReminders} onChange={num('ticketMaxReminders')} /></Field>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.keys(CAT_AR).map((c) => (
              <Field key={c} label={CAT_AR[c]}>
                <Select value={s.ticketRouting?.[c] || 'reception'} onChange={(e) => set('ticketRouting', { ...s.ticketRouting, [c]: e.target.value })} options={ROUTING_ROLES} className="!py-1 text-xs" />
              </Field>
            ))}
          </div>
        </Card>

        <Card title="التقرير اليومي وقوالب Meta">
          <Field label="ساعة التقرير الصباحي (0-23)"><Input type="number" value={s.dailyReportHour} onChange={num('dailyReportHour')} /></Field>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.keys(TEMPLATE_AR).map((k) => (
              <Field key={k} label={TEMPLATE_AR[k]}>
                <Input className="ltr text-left" value={s.templates?.[k] || ''} onChange={(e) => set('templates', { ...s.templates, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
        </Card>
      </div>

      <Card title="تغيير كلمة مرور اللوحة">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="الحالية"><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="الجديدة"><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Button variant="secondary" onClick={async () => { try { await api.put('/auth/password', pw); setPw({ current: '', next: '' }); alert('تم التغيير ✅') } catch (e) { alert(errMsg(e)) } }}>تغيير</Button>
        </div>
      </Card>
    </div>
  )
}
