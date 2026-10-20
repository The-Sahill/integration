// src/pages/Chat.jsx — صفحة المحادثات (مطوّرة من Chat.jsx القديم): مرحلة العميل، إيقاف/تشغيل الـ AI، صوت وصور
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Bot, User, Send, MessageSquare, CheckCheck, Check, ArrowRight, Mic, TriangleAlert, Users, Clock } from 'lucide-react'
import { api, getSocket, mediaUrl, errMsg } from '../lib/api'
import { STAGES, stageOf, fmtTime, fmtDate } from '../lib/labels'
import { Badge, Select, Toggle } from '../components/ui'

function MessageBubble({ m }) {
  const incoming = m.direction === 'in'
  const tone = incoming
    ? 'bg-slate-800 border border-slate-700 rounded-tr-none'
    : m.sender === 'ai'
      ? 'bg-emerald-950/70 border border-emerald-700/40 rounded-tl-none'
      : m.sender === 'agent'
        ? 'bg-blue-600 rounded-tl-none'
        : 'bg-slate-700/60 border border-slate-600 rounded-tl-none'
  const who = { ai: 'المساعد الذكي', agent: m.agentName || 'موظف', system: 'آلي', staff: 'موظف', customer: '' }[m.sender]
  const analysis = m.meta?.analysis
  return (
    <div className={`flex flex-col ${incoming ? 'items-start' : 'items-end'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm sm:max-w-[70%] ${tone}`}>
        {!incoming && who && (
          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold opacity-80">
            {m.sender === 'ai' ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />} {who}
            {m.type === 'template' && <span className="opacity-70">· قالب</span>}
          </div>
        )}
        {m.type === 'audio' && m.mediaPath && (
          <div className="mb-1">
            <audio controls src={mediaUrl(m.mediaPath)} className="h-9 w-56 max-w-full" preload="none" />
          </div>
        )}
        {(m.type === 'image' || (m.type === 'document' && m.mimeType?.startsWith('image/'))) && m.mediaPath && (
          <a href={mediaUrl(m.mediaPath)} target="_blank" rel="noreferrer">
            <img src={mediaUrl(m.mediaPath)} alt="" className="mb-1 max-h-60 rounded-lg" loading="lazy" />
          </a>
        )}
        {m.type === 'document' && !m.mimeType?.startsWith('image/') && m.mediaPath && (
          <a href={mediaUrl(m.mediaPath)} target="_blank" rel="noreferrer" className="mb-1 block text-xs underline">📎 فتح الملف</a>
        )}
        {m.transcript && (
          <p className="whitespace-pre-wrap"><Mic className="ml-1 inline h-3 w-3 opacity-70" />{m.transcript}</p>
        )}
        {m.text && !(m.type === 'audio' && m.transcript === m.text) && <p className="whitespace-pre-wrap">{m.text}</p>}
        {analysis?.is_receipt && (
          <div className="mt-1 rounded bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200">
            💳 إيصال: {analysis.amount ?? '؟'} {analysis.currency || ''} — {analysis.payer_name || ''}
          </div>
        )}
        {m.meta?.buttons?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {m.meta.buttons.map((b) => <span key={b.id} className="rounded border border-white/20 px-2 py-0.5 text-[11px]">{b.title}</span>)}
          </div>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-60">
          <span>{fmtTime(m.createdAt)}</span>
          {!incoming && (m.status === 'read' ? <CheckCheck className="h-3 w-3 text-sky-300" /> : m.status === 'delivered' ? <CheckCheck className="h-3 w-3" /> : m.status === 'failed' ? <TriangleAlert className="h-3 w-3 text-rose-300" /> : <Check className="h-3 w-3" />)}
        </div>
        {m.status === 'failed' && m.meta?.error && <div className="mt-1 text-[10px] text-rose-200">فشل: {m.meta.error}</div>}
      </div>
    </div>
  )
}

export default function Chat() {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(() => new URLSearchParams(location.search).get('c'))
  const [messages, setMessages] = useState([])
  const [search, setSearch] = useState('')
  const [type, setType] = useState('guest')
  const [stageFilter, setStageFilter] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)
  const activeRef = useRef(null)
  activeRef.current = activeId

  const loadConversations = async () => {
    try {
      const { data } = await api.get('/conversations', { params: { type: type === 'all' ? 'all' : type === 'staff' ? 'staff' : undefined } })
      setConversations(data)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  useEffect(() => { loadConversations() }, [type])

  useEffect(() => {
    const s = getSocket()
    const onConv = (c) => {
      if (!c) return
      setConversations((prev) => {
        const i = prev.findIndex((x) => x._id === c._id)
        if (i === -1) return [c, ...prev]
        const next = [...prev]
        next[i] = c
        return next.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
      })
    }
    const onMsg = ({ conversationId, message }) => {
      if (conversationId === activeRef.current) setMessages((prev) => (prev.some((m) => m._id === message._id) ? prev : [...prev, message]))
    }
    const onStatus = ({ conversationId, messageId, status }) => {
      if (conversationId === activeRef.current) setMessages((prev) => prev.map((m) => (m._id === messageId ? { ...m, status } : m)))
    }
    s.on('conversation_updated', onConv)
    s.on('message', onMsg)
    s.on('message_status', onStatus)
    return () => {
      s.off('conversation_updated', onConv)
      s.off('message', onMsg)
      s.off('message_status', onStatus)
    }
  }, [])

  useEffect(() => {
    if (!activeId) return
    setMessages([])
    api.get(`/conversations/${activeId}/messages`, { params: { limit: 80 } }).then(({ data }) => setMessages(data))
    api.post(`/conversations/${activeId}/read`).catch(() => {})
  }, [activeId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const active = conversations.find((c) => c._id === activeId)
  const filtered = useMemo(
    () => conversations.filter((c) => (!stageFilter || c.stage === stageFilter) && (!search || (c.customerName || '').includes(search) || (c.customerPhone || '').includes(search))),
    [conversations, search, stageFilter]
  )

  const patch = async (body) => {
    const { data } = await api.patch(`/conversations/${active._id}`, body)
    setConversations((prev) => prev.map((c) => (c._id === data._id ? data : c)))
  }

  const send = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    try {
      await api.post(`/conversations/${active._id}/send`, { text })
      setText('')
    } catch (err) {
      alert(errMsg(err))
    } finally {
      setSending(false)
    }
  }

  const windowOpen = active?.lastInboundAt && Date.now() - new Date(active.lastInboundAt).getTime() < 24 * 3600 * 1000
  const st = active?.state || {}

  return (
    <div className="flex h-full" dir="rtl">
      {/* القائمة */}
      <div className={`${activeId ? 'hidden md:flex' : 'flex'} w-full flex-col border-l border-slate-800 bg-slate-900 md:w-80 lg:w-96`}>
        <div className="space-y-2 border-b border-slate-800 p-3">
          <div className="flex gap-1 rounded-lg bg-slate-950 p-1 text-xs">
            {[['guest', 'العملاء'], ['staff', 'الموظفون'], ['all', 'الكل']].map(([k, l]) => (
              <button key={k} onClick={() => setType(k)} className={`flex-1 rounded-md py-1.5 ${type === k ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>{l}</button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الرقم..." className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-3 pr-9 text-xs focus:border-emerald-500 focus:outline-none" />
          </div>
          <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} options={[{ value: '', label: 'كل المراحل' }, ...STAGES.map((s) => ({ value: s.key, label: s.label }))]} className="!py-1.5 text-xs" />
        </div>
        {error && <div className="bg-rose-500/10 p-2 text-center text-xs text-rose-300">{error}</div>}
        <div className="flex-1 divide-y divide-slate-800/60 overflow-y-auto">
          {filtered.length === 0 && <div className="p-6 text-center text-xs text-slate-500">لا توجد محادثات</div>}
          {filtered.map((c) => {
            const stg = stageOf(c.stage)
            return (
              <button key={c._id} onClick={() => setActiveId(c._id)} className={`flex w-full items-start gap-3 p-3 text-right hover:bg-slate-800/50 ${c._id === activeId ? 'border-r-4 border-emerald-500 bg-slate-800/70' : ''}`}>
                <div className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-bold">
                  {c.isStaff ? <Users className="h-4 w-4" /> : (c.customerName || '؟').slice(0, 1)}
                  {c.aiEnabled && <span className="absolute -left-1 -top-1 rounded-full bg-emerald-500 p-0.5 text-slate-950"><Bot className="h-3 w-3" /></span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{c.customerName || 'عميل'}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{fmtTime(c.lastMessageAt)}</span>
                  </div>
                  <div className="ltr text-right text-[11px] text-slate-500">+{c.customerPhone}</div>
                  <div className="mt-1 truncate text-xs text-slate-400">{c.lastMessage}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {!c.isStaff && <Badge color={stg.color}>{stg.label}</Badge>}
                    {c.handoff?.active && !c.aiEnabled && <Badge color="rose">بانتظار موظف</Badge>}
                    {!c.aiEnabled && !c.handoff?.active && <Badge color="amber">يدوي</Badge>}
                    {c.unread > 0 && <Badge color="emerald">{c.unread}</Badge>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* المحادثة */}
      {active ? (
        <div className="flex min-w-0 flex-1 flex-col bg-slate-950">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <button className="rounded p-1 hover:bg-slate-800 md:hidden" onClick={() => setActiveId(null)}><ArrowRight className="h-5 w-5" /></button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-bold">{active.customerName}</h2>
                  <span className="ltr text-xs text-slate-400">+{active.customerPhone}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
                  {st.checkIn && <span>📅 {st.checkIn} ← {st.checkOut}</span>}
                  {st.unitName && <span>🏠 {st.unitName}</span>}
                  {st.agreedPrice ? <span>💰 متفق {st.agreedPrice}</span> : st.quotedPrice ? <span>💰 معروض {st.quotedPrice}</span> : null}
                  {st.roomNumber && <span>🚪 غرفة {st.roomNumber}</span>}
                  {st.activeBookingRef && <span>🧾 {st.activeBookingRef}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!active.isStaff && (
                <Select value={active.stage} onChange={(e) => patch({ stage: e.target.value })} options={STAGES.map((s) => ({ value: s.key, label: s.label }))} className="!w-auto !py-1 text-xs" />
              )}
              <Toggle checked={active.aiEnabled} onChange={(v) => patch({ aiEnabled: v })} label={<span className="text-xs">{active.aiEnabled ? 'الـ AI يرد' : 'الـ AI متوقف'}</span>} />
            </div>
          </div>

          {active.handoff?.active && !active.aiEnabled && (
            <div className="flex items-center gap-2 border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
              <TriangleAlert className="h-4 w-4" /> حُوّلت لموظف: {active.handoff.reason} — {fmtDate(active.handoff.at)}
            </div>
          )}
          {active.summary && (
            <details className="border-b border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-400">
              <summary className="cursor-pointer">ملخص المحادثة</summary>
              <p className="mt-1 whitespace-pre-wrap leading-6">{active.summary}</p>
            </details>
          )}

          <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
            {messages.map((m) => <MessageBubble key={m._id} m={m} />)}
            <div ref={endRef} />
          </div>

          <div className="border-t border-slate-800 bg-slate-900 p-3">
            {!windowOpen ? (
              <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200">
                <Clock className="h-4 w-4" /> مرّت 24 ساعة على آخر رسالة من العميل — المراسلة الحرة مغلقة حسب قواعد واتساب (تعمل القوالب الآلية فقط).
              </div>
            ) : (
              <form onSubmit={send} className="flex items-center gap-2">
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={active.aiEnabled ? 'اكتب كموظف (الـ AI ما زال مفعلاً)...' : 'اكتب ردك كموظف...'} className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none" />
                <button disabled={!text.trim() || sending} className="rounded-xl bg-blue-600 p-2.5 text-white hover:bg-blue-500 disabled:opacity-40"><Send className="h-4 w-4 rotate-180" /></button>
              </form>
            )}
          </div>
        </div>
      ) : (
        <div className="hidden flex-1 items-center justify-center text-sm text-slate-500 md:flex">
          <MessageSquare className="ml-2 h-5 w-5" /> اختر محادثة لعرض الرسائل
        </div>
      )}
    </div>
  )
}
