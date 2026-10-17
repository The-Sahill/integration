import react from 'react'
import { Route, Routes } from 'react-router-dom'
import SignUp from './components/register/SignUp'
import Login from './components/register/Login'
import Test from './components/test/Test'
import Chat from './components/chat/Chat'

function App() {

  return (
    <>
     <Routes >
      <Route path="/" element={<SignUp />} />
      <Route path="/Login" element={<Login />} />
      <Route path="/test" element={<Test />} />
      <Route path="/chat" element={<Chat />} />
     </Routes>
    </>
  )
}

export default App
