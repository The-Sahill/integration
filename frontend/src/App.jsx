import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { getToken } from './lib/api'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Chat from './pages/Chat'
import Pipeline from './pages/Pipeline'
import Payments from './pages/Payments'
import Tickets from './pages/Tickets'
import Services from './pages/Services'
import Pricing from './pages/Pricing'
import Inventory from './pages/Inventory'
import Staff from './pages/Staff'
import SettingsPage from './pages/Settings'
import Audit from './pages/Audit'
import Analytics from './pages/Analytics'
import AiPrompt from './pages/AiPrompt'

function Protected({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Overview />} />
        <Route path="chat" element={<Chat />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="payments" element={<Payments />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="services" element={<Services />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="staff" element={<Staff />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<Audit />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="ai" element={<AiPrompt />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
