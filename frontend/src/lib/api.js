// src/lib/api.js — اتصال موحّد بالباك إند مع التوكن
import axios from 'axios'
import { io } from 'socket.io-client'

export const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export const getToken = () => localStorage.getItem('token') || ''
export const setSession = (token, user) => {
  localStorage.setItem('token', token)
  localStorage.setItem('user', JSON.stringify(user))
}
export const clearSession = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}
export const currentUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')
  } catch {
    return null
  }
}

export const api = axios.create({ baseURL: `${BASE_URL}/api` })
api.interceptors.request.use((cfg) => {
  const t = getToken()
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.startsWith('/login')) {
      clearSession()
      location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export const errMsg = (e) => e?.response?.data?.message || e?.message || 'حدث خطأ'

export const mediaUrl = (file) => `${BASE_URL}/api/media/${encodeURIComponent(file)}?token=${encodeURIComponent(getToken())}`

let socket = null
export function getSocket() {
  if (!socket) socket = io(BASE_URL || undefined, { auth: { token: getToken() }, transports: ['websocket', 'polling'] })
  return socket
}
export function closeSocket() {
  socket?.disconnect()
  socket = null
}
