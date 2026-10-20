// src/pages/AiPrompt.jsx — التحكم بالـ Prompt: تعليمات إضافية، استبدال كامل، معاينة، وتجربة بدون تنفيذ
import { useEffect, useState } from 'react'
import { Save, RotateCcw, FlaskConical, Eye } from 'lucide-react'
import { api, errMsg } from '../lib/api'
import { PageHeader, Card, Field, Textarea, Button, Spinner, Tabs, Input } from '../components/ui'

export default function AiPrompt() {
  const [data, setData] = useState(null)
  const [aud, setAud] = useState('guest')
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [testMsg, setTestMsg] = useState('مرحبا، بدي شقة لعائلة من 5 أشخاص آخر الأسبوع، كم السعر؟')
  const [testReply, setTestReply] = useState('')
  const [testing, setTesting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const load = () =>
    api.get('/prompts').then(({ data }) => {
      setData(data)
      setForm({ guestPrompt: data.guestPrompt, guestExtraRules: data.guestExtraRules, staffPrompt: data.staffPrompt, staffExtraRules: data.staffExtraRules })
    })
  useEffect(() => { load() }, [])
  if (!data) return <Spinner />

  const pKey = aud === 'guest' ? 'guestPrompt' : 'staffPrompt'
  const xKey = aud === 'guest' ? 'guestExtraRules' : 'staffExtraRules'
  const custom = !!form[pKey]?.trim()

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/prompts', form)
      await load()
      alert('تم الحفظ ✅ — يُطبّق على الرسالة التالية مباشرة')
    } catch (e) {
      alert(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestReply('')
    try {
      const { data: r } = await api.post('/prompts/test', { message: testMsg, audience: aud, draft: custom ? `${form[pKey]}${form[xKey] ? `\n\nتعليمات إضافية:\n${form[xKey]}` : ''}` : form[xKey] ? `${data.defaults[aud]}\n\nتعليمات إضافية:\n${form[xKey]}` : '' })
      setTestReply(r.reply)
    } catch (e) {
      setTestReply(`⚠️ ${errMsg(e)}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="الـ AI والـ Prompt" subtitle="تحكم بشخصية وأسلوب وقواعد الرد الآلي — التغيير يُطبّق فوراً" actions={<Button onClick={save} loading={saving}><Save className="h-4 w-4" />حفظ</Button>} />
      <Tabs tabs={[{ value: 'guest', label: 'الرد على العملاء والنزلاء' }, { value: 'staff', label: 'مساعد الموظفين' }]} value={aud} onChange={(v) => { setAud(v); setTestReply('') }} />

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-6 text-amber-100">
        الحماية الأساسية في الكود ولا تتأثر بالـ Prompt: لا نزول تحت أقل سعر، لا حجز بدون فحص التوفر، الصلاحيات، وتأكيد الموظف قبل أي تغيير.
        الأسعار ومعلومات المنشأة وطرق الدفع تُعدّل من صفحتي الأسعار والإعدادات وتُدرج تلقائياً.
      </div>

      <Card title="1) تعليمات إضافية (الأسهل — تُلحق بالـ Prompt الافتراضي)">
        <Field hint={'مثال: "رحّب بالعملاء من السعودية بلهجتهم" — "اقترح دائماً شقة الغرفتين للعائلات فوق 4 أشخاص" — "لا تذكر الكاش إلا إذا سأل العميل"'}>
          <Textarea rows={5} value={form[xKey] || ''} onChange={(e) => setForm({ ...form, [xKey]: e.target.value })} placeholder="اكتب كل تعليمة في سطر..." />
        </Field>
      </Card>

      <Card
        title="2) استبدال الـ Prompt بالكامل (متقدم)"
        actions={<>
          {!custom && <Button size="sm" variant="secondary" onClick={() => setForm({ ...form, [pKey]: data.defaults[aud] })}>ابدأ من النص الافتراضي</Button>}
          {custom && <Button size="sm" variant="ghost" onClick={() => { if (confirm('العودة للنص الافتراضي؟')) setForm({ ...form, [pKey]: '' }) }}><RotateCcw className="h-4 w-4" />استعادة الافتراضي</Button>}
        </>}
      >
        {custom ? (
          <Field hint={`المتغيرات المتاحة: ${data.variables.join('  ')}`}>
            <Textarea rows={18} className="font-mono text-xs leading-6" value={form[pKey]} onChange={(e) => setForm({ ...form, [pKey]: e.target.value })} />
          </Field>
        ) : (
          <p className="text-sm text-slate-400">يُستخدم النص الافتراضي حالياً. اضغط "ابدأ من النص الافتراضي" لتعديله.</p>
        )}
      </Card>

      <Card title={<span className="flex items-center gap-2"><FlaskConical className="h-4 w-4" />3) جرّب قبل الحفظ</span>} actions={<Button size="sm" variant="ghost" onClick={() => setShowPreview(!showPreview)}><Eye className="h-4 w-4" />{showPreview ? 'إخفاء' : 'عرض'} الـ Prompt المحفوظ</Button>}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={testMsg} onChange={(e) => setTestMsg(e.target.value)} placeholder={aud === 'guest' ? 'رسالة عميل تجريبية' : 'أمر موظف تجريبي'} />
          <Button onClick={test} loading={testing} disabled={!testMsg.trim()}>تجربة</Button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">التجربة بدون أدوات: لا تنفّذ أي حجز أو تغيير، وتعرض الأسلوب فقط (تستخدم المسودة الحالية غير المحفوظة).</p>
        {testReply && <div className="mt-3 whitespace-pre-wrap rounded-xl border border-emerald-700/40 bg-emerald-950/50 p-3 text-sm leading-7">{testReply}</div>}
        {showPreview && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-6 text-slate-300">{data.preview[aud]}</pre>}
      </Card>
    </div>
  )
}
