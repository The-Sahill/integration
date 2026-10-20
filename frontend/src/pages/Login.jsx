// src/pages/Login.jsx — تسجيل دخول بسيط (نفس التصميم الزجاجي للنسخة السابقة)
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Lock, LoaderCircle } from 'lucide-react'
import registerBg from '../assets/images/Register.jpg'
import { api, setSession, errMsg } from '../lib/api'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { username, password })
      setSession(data.token, data.user)
      navigate('/')
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center bg-cover bg-center p-4" style={{ backgroundImage: `url(${registerBg})` }}>
      <div className="absolute inset-0 bg-slate-950/50" />
      <form onSubmit={submit} className="relative z-10 w-full max-w-md space-y-5 rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
        <h2 className="mb-6 text-center text-2xl font-bold text-white">تسجيل الدخول للوحة</h2>
        <div className="group relative flex items-center">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="اسم المستخدم" autoComplete="username" className="w-full rounded-2xl border border-white/10 bg-white/5 py-3.5 pl-4 pr-12 text-white placeholder-gray-400 focus:border-emerald-400/60 focus:outline-none" />
          <User className="absolute right-4 h-5 w-5 text-gray-400" />
        </div>
        <div className="group relative flex items-center">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور" autoComplete="current-password" className="w-full rounded-2xl border border-white/10 bg-white/5 py-3.5 pl-4 pr-12 text-white placeholder-gray-400 focus:border-emerald-400/60 focus:outline-none" />
          <Lock className="absolute right-4 h-5 w-5 text-gray-400" />
        </div>
        {error && <p className="rounded-lg bg-rose-500/15 px-3 py-2 text-center text-sm text-rose-200">{error}</p>}
        <button disabled={loading || !username || !password} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-lg font-bold text-slate-950 hover:bg-emerald-50 disabled:opacity-60">
          {loading && <LoaderCircle className="h-5 w-5 animate-spin" />} دخول
        </button>
      </form>
    </div>
  )
}
