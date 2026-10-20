// src/components/Layout.jsx — الإطار العام: قائمة جانبية (درج على الجوال)
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, MessageSquare, SquareKanban, Ticket, BadgeDollarSign, Users, Package, Settings, ScrollText,
  CreditCard, Truck, LogOut, Menu, X, Hotel, ChartColumn, Sparkles,
} from 'lucide-react'
import { clearSession, currentUser, closeSocket } from '../lib/api'

const NAV = [
  { to: '/', label: 'الرئيسية', icon: LayoutDashboard, end: true },
  { to: '/chat', label: 'المحادثات', icon: MessageSquare },
  { to: '/analytics', label: 'التحليلات والمخاطر', icon: ChartColumn, roles: ['owner', 'manager', 'finance'] },
  { to: '/pipeline', label: 'الحجوزات المحتملة', icon: SquareKanban },
  { to: '/payments', label: 'الحجوزات والدفع', icon: CreditCard },
  { to: '/tickets', label: 'الطلبات والصيانة', icon: Ticket },
  { to: '/services', label: 'الديلفري والدراي كلين', icon: Truck },
  { to: '/pricing', label: 'الأسعار والتفاوض', icon: BadgeDollarSign },
  { to: '/inventory', label: 'المخزون', icon: Package },
  { to: '/staff', label: 'الموظفون والصلاحيات', icon: Users },
  { to: '/ai', label: 'الـ AI والـ Prompt', icon: Sparkles, roles: ['owner', 'manager'] },
  { to: '/settings', label: 'الإعدادات', icon: Settings },
  { to: '/audit', label: 'سجل التدقيق', icon: ScrollText },
]

export default function Layout() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const user = currentUser()

  const logout = () => {
    clearSession()
    closeSocket()
    navigate('/login')
  }

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-4">
        <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-400"><Hotel className="h-5 w-5" /></div>
        <div>
          <div className="text-sm font-bold">The Sahill Stays</div>
          <div className="text-[11px] text-slate-400">لوحة التشغيل</div>
        </div>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.filter((n) => !n.roles || n.roles.includes(user?.role)).map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? 'bg-emerald-600/15 text-emerald-300' : 'text-slate-300 hover:bg-slate-800'}`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </div>
      <div className="border-t border-slate-800 p-3">
        <div className="mb-2 px-1 text-xs text-slate-400">{user?.name || user?.username}</div>
        <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10">
          <LogOut className="h-4 w-4" /> تسجيل الخروج
        </button>
      </div>
    </nav>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-l border-slate-800 bg-slate-900 lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <aside className="absolute right-0 top-0 h-full w-64 bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <button className="absolute left-3 top-4 p-1 text-slate-400" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded p-1 hover:bg-slate-800"><Menu className="h-5 w-5" /></button>
          <span className="text-sm font-semibold">The Sahill Stays</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
