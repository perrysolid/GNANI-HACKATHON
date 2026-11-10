import { AnimatePresence, motion } from 'framer-motion'
import { Ear, PhoneOff, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LiveCall, type LiveEvent } from '../lib/live'
import { SIGNAL_LABEL } from '../lib/data'
import { Backdrop, Spinner } from '../components/ui'

type Level = 'no_signs' | 'suspicious' | 'scam'
type Phase = 'idle' | 'starting' | 'listening' | 'done'

const LOOK: Record<Level, { title: string; sub: string; icon: typeof ShieldCheck }> = {
  no_signs: { title: 'Listening', sub: 'No scam signs so far.', icon: Ear },
  suspicious: { title: 'Be careful', sub: 'Don’t share anything yet.', icon: TriangleAlert },
  scam: { title: 'Fraud call. Cut it now.', sub: 'Don’t share any OTP, PIN or money.', icon: ShieldX },
}

/** Sits beside a call on speaker and warns out loud the moment it hears a scam. */
export function Guard() {
  const nav = useNavigate()
  const call = useRef<LiveCall | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [level, setLevel] = useState<Level>('no_signs')
  const [signals, setSignals] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [summary, setSummary] = useState('')
  const [err, setErr] = useState('')
  const [mic, setMic] = useState(0)

  useEffect(() => () => call.current?.teardown(), [])

  const onEvent = (e: LiveEvent) => {
    if (e.type === 'ready') setPhase('listening')
    if (e.type === 'heard') setLines((l) => [...l.slice(-5), e.text])
    if (e.type === 'verdict') {
      setLevel(e.level); setNote(e.note)
      setSignals([...new Set(e.signals.map((s) => s.category))])
    }
    if (e.type === 'alarm') navigator.vibrate?.([400, 150, 400, 150, 800])
    if (e.type === 'summary') { setSummary(e.text); setPhase('done') }
    if (e.type === 'ended') setPhase((p) => (p === 'listening' ? 'done' : p))
    if (e.type === 'error') { setErr(e.message); setPhase('idle') }
  }

  const start = async () => {
    setErr(''); setLevel('no_signs'); setSignals([]); setLines([]); setSummary(''); setNote('')
    setPhase('starting')
    const c = new LiveCall()
    c.onEvent = onEvent
    c.onLevel = setMic
    call.current = c
    try { await c.start('rider', '/api/guard') } catch (e: any) {
      setErr(e?.name === 'NotAllowedError' ? 'Allow the microphone so Haanji can listen.' : e.message || 'Couldn’t start')
      setPhase('idle'); c.teardown()
    }
  }

  const stop = () => { call.current?.hangup('stop'); setPhase('done') }

  const look = LOOK[level]
  const Icon = look.icon
  const alarm = level === 'scam'

  return (
    <div className={clsx('app text-white transition-colors duration-500', alarm ? 'bg-alarm' : 'bg-[#0F0F10]')}>
      {!alarm && <Backdrop dark />}
      <header className="flex items-center justify-between px-5 pt-4">
        <button onClick={() => { call.current?.teardown(); nav(-1) }} className="rounded-full px-3 py-2 text-[15px] font-medium text-white/70 active:bg-white/10">Close</button>
      </header>

      <section className="flex flex-1 flex-col px-6 pt-6">
        {phase === 'idle' || phase === 'starting' ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em]">Call guard</h1>
            <p className="mt-3 text-[16px] leading-relaxed text-white/60">Put the call on speaker and keep this screen open. Haanji listens to both sides and warns out loud if it’s a scam.</p>
            <ol className="mt-8 space-y-4">
              {['Answer the unknown call', 'Turn on speaker', 'Tap Start listening below'].map((t, i) => (
                <li key={t} className="flex items-center gap-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 font-display text-[15px] font-bold">{i + 1}</span>
                  <span className="text-[16px]">{t}</span>
                </li>
              ))}
            </ol>
            <p className="mt-8 text-[13px] leading-relaxed text-white/40">Phones don’t let apps hang up other calls, so Haanji tells you to. Calls to your Haanji number are cut by Haanji itself.</p>
          </motion.div>
        ) : (
          <>
            <AnimatePresence mode="wait">
              <motion.div key={level} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }} className="flex flex-col items-center pt-6 text-center">
                <div className="relative grid h-28 w-28 place-items-center">
                  {phase === 'listening' && (
                    <motion.span className={clsx('absolute inset-0 rounded-[28px]', alarm ? 'bg-white/25' : level === 'suspicious' ? 'bg-warn/40' : 'bg-accent/25')}
                      animate={{ scale: alarm ? [1, 1.25, 1] : 1 + mic * 0.4, opacity: alarm ? [1, 0.4, 1] : 1 }}
                      transition={alarm ? { duration: 0.8, repeat: Infinity } : { duration: 0.1 }} />
                  )}
                  <span className={clsx('relative grid h-20 w-20 place-items-center rounded-[22px]', alarm ? 'bg-white text-alarm' : level === 'suspicious' ? 'bg-warn text-white' : 'bg-accent text-ink')}>
                    <Icon className="h-9 w-9" />
                  </span>
                </div>
                <h2 className={clsx('mt-6 font-display font-bold leading-tight tracking-[-0.02em]', alarm ? 'text-[34px]' : 'text-[28px]')}>{look.title}</h2>
                <p className="mt-2 text-[16px] text-white/75">{phase === 'done' && level === 'no_signs' ? 'Stopped. No scam signs heard.' : look.sub}</p>
              </motion.div>
            </AnimatePresence>

            {signals.length > 0 && (
              <ul className="mt-8 space-y-2">
                {signals.map((s) => (
                  <li key={s} className="flex items-start gap-3 rounded-2xl bg-white/10 px-4 py-3 text-[15px]">
                    <span className="mt-[7px] h-2 w-2 shrink-0 rounded-[2px] bg-current" />{SIGNAL_LABEL[s] ?? s}
                  </li>
                ))}
                {note && <li className="px-1 text-[13px] text-white/60">{note}</li>}
              </ul>
            )}

            {lines.length > 0 && !alarm && (
              <div className="mt-8 space-y-2">
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/35">Heard</p>
                {lines.slice(-3).map((l, i) => <p key={i} className="text-[15px] leading-snug text-white/70">{l}</p>)}
              </div>
            )}
            {summary && <p className="mt-6 rounded-2xl bg-white/10 p-4 text-[14px] text-white/80">{summary} It’s saved in Calls.</p>}
          </>
        )}
        {err && <p className="mt-4 text-[14px] font-medium text-white/80">{err}</p>}
      </section>

      <footer className="px-6 pt-3 bottom-safe">
        {phase === 'listening' ? (
          <motion.button whileTap={{ scale: 0.97 }} onClick={stop} className={clsx('flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold', alarm ? 'bg-white text-alarm' : 'bg-white/10')}>
            <PhoneOff className="h-5 w-5" /> {alarm ? 'I’ve cut the call' : 'Stop listening'}
          </motion.button>
        ) : (
          <motion.button whileTap={{ scale: 0.97 }} onClick={start} disabled={phase === 'starting'} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[16px] font-semibold text-ink disabled:opacity-60">
            {phase === 'starting' ? <Spinner /> : <><Ear className="h-5 w-5" /> {phase === 'done' ? 'Listen to another call' : 'Start listening'}</>}
          </motion.button>
        )}
      </footer>
    </div>
  )
}
