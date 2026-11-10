import { motion } from 'framer-motion'
import { Home, PhoneCall, ShieldCheck, User } from 'lucide-react'
import { clsx } from 'clsx'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Backdrop } from '../components/ui'

const TABS = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/calls', label: 'Calls', icon: PhoneCall },
  { to: '/shield', label: 'Shield', icon: ShieldCheck },
  { to: '/you', label: 'You', icon: User },
]

export function Shell() {
  const { pathname } = useLocation()
  return (
    <div className="app">
      <Backdrop />
      <motion.main key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="flex-1 pb-28">
        <Outlet />
      </motion.main>
      <nav className="fixed bottom-0 left-1/2 z-20 w-full max-w-[440px] -translate-x-1/2 border-t border-line bg-paper/90 backdrop-blur-xl" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
        <div className="flex">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className="relative flex flex-1 flex-col items-center gap-1 pb-1 pt-2.5">
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="tab" className="absolute top-0 h-[3px] w-8 rounded-full bg-ink" />}
                  <Icon className={clsx('h-[22px] w-[22px]', isActive ? 'text-ink' : 'text-ink/35')} strokeWidth={isActive ? 2.4 : 2} />
                  <span className={clsx('text-[11px] font-semibold', isActive ? 'text-ink' : 'text-ink/40')}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

export function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="px-6 pb-2 pt-6">
      <h1 className="font-display text-[32px] font-bold tracking-[-0.03em]">{title}</h1>
      {sub && <p className="mt-1 text-[15px] text-muted">{sub}</p>}
    </header>
  )
}
