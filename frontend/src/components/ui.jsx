// src/components/ui.jsx — مكونات واجهة صغيرة مشتركة
import { useEffect } from 'react'
import { X, LoaderCircle } from 'lucide-react'
import { COLOR } from '../lib/labels'

export function Badge({ color = 'slate', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${COLOR[color] || COLOR.slate} ${className}`}>{children}</span>
}

export function Button({ variant = 'primary', size = 'md', loading, children, className = '', ...props }) {
  const v = {
    primary: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700',
    danger: 'bg-rose-600 hover:bg-rose-500 text-white',
    ghost: 'hover:bg-slate-800 text-slate-300',
    warning: 'bg-amber-600 hover:bg-amber-500 text-white',
  }[variant]
  const s = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' }[size]
  return (
    <button {...props} disabled={loading || props.disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v} ${s} ${className}`}>
      {loading && <LoaderCircle className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Card({ children, className = '', title, actions }) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/70 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  )
}

const fieldCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none'

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  )
}

export const Input = (p) => <input {...p} className={`${fieldCls} ${p.className || ''}`} />
export const Textarea = (p) => <textarea {...p} className={`${fieldCls} ${p.className || ''}`} />
export function Select({ options = [], ...p }) {
  return (
    <select {...p} className={`${fieldCls} ${p.className || ''}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2 text-sm text-slate-300">
      <span className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-emerald-600' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'right-0.5' : 'right-[18px]'}`} />
      </span>
      {label}
    </button>
  )
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-900 sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export function Table({ columns, rows, empty = 'لا توجد بيانات', onRowClick }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-slate-900 text-xs text-slate-400">
          <tr>{columns.map((c) => <th key={c.key} className="px-3 py-2.5 text-right font-medium">{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">{empty}</td></tr>
          ) : (
            rows.map((r, i) => (
              <tr key={r._id || i} onClick={() => onRowClick?.(r)} className={`bg-slate-950/40 ${onRowClick ? 'cursor-pointer hover:bg-slate-800/40' : ''}`}>
                {columns.map((c) => <td key={c.key} className="px-3 py-2.5 align-top text-slate-200">{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function Stat({ label, value, icon: Icon, color = 'emerald', hint }) {
  const tone = { emerald: 'text-emerald-400', amber: 'text-amber-400', rose: 'text-rose-400', sky: 'text-sky-400', violet: 'text-violet-400' }[color]
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        {Icon && <Icon className={`h-4 w-4 ${tone}`} />}
      </div>
      <div className={`mt-2 text-2xl font-bold ${tone}`}>{value ?? '—'}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

export function Spinner({ text = 'جاري التحميل...' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
      <LoaderCircle className="h-5 w-5 animate-spin" /> {text}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-1">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${value === t.value ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
          {t.label}{t.count != null && <span className="mr-1 text-xs opacity-70">({t.count})</span>}
        </button>
      ))}
    </div>
  )
}
