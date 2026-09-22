import react from 'react'
import { Route, Routes } from 'react-router-dom'
import SignUp from './components/register/SignUp'
import Login from './components/register/Login'

function App() {

  return (
    <>
     <Routes >
      <Route path="/" element={<SignUp />} />
      <Route path="/Login" element={<Login />} />
     </Routes>
    </>
  )
}

export default App
