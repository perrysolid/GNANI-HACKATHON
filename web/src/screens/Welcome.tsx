import { motion } from 'framer-motion'
import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { Backdrop } from '../components/ui'

const HeroScene = lazy(() => import('../three/VoiceOrb'))

const rise = (d: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: d, duration: 0.6, ease: [0.22, 1, 0.36, 1] },
})

export function Welcome() {
  const nav = useNavigate()
  return (
    <div className="app overflow-hidden">
      <Backdrop />
      <header className="flex items-center justify-between px-6 pt-5">
        <motion.span {...rise(0)} className="font-display text-[26px] font-extrabold tracking-[-0.04em]">
          haanji<span className="ml-0.5 inline-block h-[9px] w-[9px] rounded-[2px] bg-accent ring-1 ring-ink/80" />
        </motion.span>
      </header>

      <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} className="relative h-[46dvh] min-h-[300px] w-full">
        <Suspense fallback={null}>
          <HeroScene />
        </Suspense>
      </motion.div>

      <div className="mt-auto px-6 bottom-safe">
        <motion.h1 {...rise(0.15)} className="font-display text-[42px] font-bold leading-[0.98] tracking-[-0.04em]">
          Every call.
          <br />
          Every language.
        </motion.h1>
        <motion.p {...rise(0.25)} className="mt-4 text-[17px] leading-relaxed text-muted">
          It answers your phone in the caller’s language, gives directions to your gate, and hangs up on scammers calling your parents.
        </motion.p>
        <motion.div {...rise(0.35)} className="mt-8 space-y-2">
          <button className="btn" onClick={() => nav('/start')}>Get started</button>
          <button className="btn-ghost" onClick={() => nav('/start?login=1')}>I already have an account</button>
        </motion.div>
      </div>
    </div>
  )
}
