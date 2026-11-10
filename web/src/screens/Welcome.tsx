import { motion } from 'framer-motion'
import { AnimatePresence } from 'framer-motion'
import { PhoneIncoming, ShieldX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Backdrop, Signal } from '../components/ui'

/** What a call sounds like: the caller in their language, Haanji answering in the same one. */
const SCENES = [
  { who: 'Delivery rider', lang: 'ಕನ್ನಡ', ask: 'ಮನೆ ಎಲ್ಲಿದೆ ಸಾರ್?', reply: 'ಶನಿ ದೇವಸ್ಥಾನದ ಎದುರು, ನೀಲಿ ಗೇಟ್. ಮೂರನೇ ಮಹಡಿ.' },
  { who: 'Cab driver', lang: 'हिन्दी', ask: 'भैया, कौन सा गेट है?', reply: 'शनि मंदिर के सामने, नीला गेट। मैं नीचे आ रहा हूँ।' },
  { who: 'Unknown caller', lang: 'English', ask: 'Your SIM will be blocked. Share the OTP now.', reply: 'This looks like a scam. I’m ending the call.', scam: true },
]

function CallPreview() {
  const [i, setI] = useState(0)
  useEffect(() => { const t = window.setInterval(() => setI((n) => (n + 1) % SCENES.length), 4200); return () => window.clearInterval(t) }, [])
  const s = SCENES[i]
  return (
    <div className="relative mx-6">
      <div className="absolute inset-x-5 -bottom-3 h-full rounded-[28px] border border-line bg-card/70" />
      <div className="absolute inset-x-2.5 -bottom-1.5 h-full rounded-[28px] border border-line bg-card/90" />
      <div className="relative overflow-hidden rounded-[28px] bg-ink p-5 text-white shadow-[0_30px_60px_-30px_rgba(17,17,17,0.6)]">
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><PhoneIncoming className="h-5 w-5" /></span>
              <div className="flex-1">
                <p className="text-[15px] font-semibold">{s.who}</p>
                <p className="text-[12px] text-white/50">Calling you · {s.lang}</p>
              </div>
              <Signal className="w-10" active color={s.scam ? 'rgb(var(--alarm))' : undefined} />
            </div>
            <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="mt-5 w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2.5 text-[15px] leading-snug">
              {s.ask}
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5 }} className={`ml-auto mt-2 w-fit max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-ink ${s.scam ? 'bg-white' : 'bg-accent'}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/50">Haanji</p>
              <p className="text-[15px] font-medium leading-snug">{s.reply}</p>
            </motion.div>
            {s.scam && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.4 }} className="mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-[#ff6b6b]">
                <ShieldX className="h-4 w-4" /> Scam call cut · family alerted
              </motion.p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

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

      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} className="flex min-h-[300px] flex-1 flex-col justify-center py-6">
        <CallPreview />
      </motion.div>

      <div className="px-6 bottom-safe">
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
