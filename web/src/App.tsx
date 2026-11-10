import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useApp } from './lib/store'
import { useLive } from './lib/location'
import { Spinner } from './components/ui'
import { Welcome } from './screens/Welcome'
import { Onboarding } from './screens/Onboarding'
import { Shell } from './screens/Shell'
import { HomeTab } from './screens/HomeTab'
import { CallsTab } from './screens/CallsTab'
import { ShieldTab } from './screens/ShieldTab'
import { YouTab } from './screens/YouTab'
import { Practice } from './screens/Practice'
import { Teach } from './screens/Teach'
import { Guard } from './screens/Guard'
import { Captions } from './screens/Captions'

function Gate({ children, need }: { children: ReactNode; need: 'guest' | 'user' }) {
  const me = useApp((s) => s.me)
  if (need === 'guest' && me) return <Navigate to={me.onboarded ? '/home' : '/start'} replace />
  if (need === 'user' && !me) return <Navigate to="/" replace />
  if (need === 'user' && me && !me.onboarded) return <Navigate to="/start" replace />
  return <>{children}</>
}

export default function App() {
  const { loading, load, me } = useApp()
  useEffect(() => { load() }, [load])
  // Resume live location sharing whenever a signed-in user opens the app.
  useEffect(() => { if (me?.onboarded && useLive.getState().on) useLive.getState().start() }, [me?.onboarded])

  if (loading) {
    return <div className="app items-center justify-center"><Spinner className="text-muted" /></div>
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Gate need="guest"><Welcome /></Gate>} />
        <Route path="/start" element={<Onboarding />} />
        <Route element={<Gate need="user"><Shell /></Gate>}>
          <Route path="/home" element={<HomeTab />} />
          <Route path="/calls" element={<CallsTab />} />
          <Route path="/shield" element={<ShieldTab />} />
          <Route path="/you" element={<YouTab />} />
        </Route>
        <Route path="/practice" element={<Gate need="user"><Practice /></Gate>} />
        <Route path="/teach" element={<Gate need="user"><Teach /></Gate>} />
        <Route path="/guard" element={<Gate need="user"><Guard /></Gate>} />
        <Route path="/captions" element={<Gate need="user"><Captions /></Gate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
