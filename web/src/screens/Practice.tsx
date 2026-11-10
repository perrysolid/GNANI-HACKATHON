import { AnimatePresence, motion } from 'framer-motion'
import { Phone, PhoneOff, ShieldX } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LiveCall, type LiveEvent } from '../lib/live'
import { langName, langNative } from '../lib/data'
import { useApp } from '../lib/store'
import { Backdrop, Orb, Spinner } from '../components/ui'
import { who } from './steps/Family'

type Line = { id: number; who: 'caller' | 'haanji'; text: string; lang: string; cut?: boolean }
type Phase = 'idle' | 'connecting' | 'live' | 'ending' | 'done'

const COPY = {
  rider: {
    title: 'Try a call',
    you: 'Call as anyone',
    hint: 'A rider looking for your gate, a driver at the wrong pickup, a friend asking if you’re free. Haanji answers from what you taught it.',
    callerLabel: 'You',
  },
  screen: {
    title: 'Test the scam shield',
    you: 'You’re an unknown caller',
    hint: 'Pretend to be a fraudster: say you’re from CBI, the bank or customs, or ask for an OTP. Watch Haanji end the call.',
    callerLabel: 'You'
  },
}

export function Practice() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const persona = params.get('as') === 'screen' ? 'screen' : 'rider'
  const me = useApp((s) => s.me)
  const copy = COPY[persona]

  const call = useRef<LiveCall | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [lines, setLines] = useState<Line[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [userTalking, setUserTalking] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [level, setLevel] = useState(0)
  const [scam, setScam] = useState(false)
  const [summary, setSummary] = useState('')
  const [err, setErr] = useState('')
  const [secs, setSecs] = useState(0)
  const [lang, setLang] = useState('')
  const seq = useRef(0)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => () => call.current?.teardown(), [])
  useEffect(() => {
    if (phase !== 'live') return
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [lines, summary, scam])

  const onEvent = (e: LiveEvent) => {
    switch (e.type) {
      case 'ready': setPhase('live'); setLang(e.language); break
      case 'speech_start': setUserTalking(true); break
      case 'thinking': setUserTalking(false); setThinking(true); break
      case 'heard':
        setUserTalking(false); setThinking(true); setLang(e.language)
        setLines((ls) => [...ls, { id: ++seq.current, who: 'caller', text: e.text, lang: e.language }])
        break
      case 'reply_start':
        setLines((ls) => [...ls, { id: ++seq.current, who: 'haanji', text: '', lang: e.language }])
        break
      case 'reply_text':
        setThinking(false)
        setLines((ls) => {
          const last = ls[ls.length - 1]
          if (!last || last.who !== 'haanji') return ls
          return [...ls.slice(0, -1), { ...last, text: last.text ? `${last.text} ${e.text}` : e.text }]
        })
        break
      case 'interrupted':
        setLines((ls) => {
          const last = ls[ls.length - 1]
          return last?.who === 'haanji' ? [...ls.slice(0, -1), { ...last, cut: true }] : ls
        })
        break
      case 'shield': setScam(true); break
      case 'summary': setSummary(e.text); setPhase('done'); break
      case 'ended': setPhase((p) => (p === 'done' ? p : 'ending')); call.current?.hangup(); break
      case 'error': setErr(e.message); setThinking(false); break
    }
  }

  const start = async () => {
    setErr(''); setPhase('connecting'); setLines([]); setSummary(''); setScam(false); setSecs(0)
    const c = new LiveCall()
    c.onEvent = onEvent
    c.onSpeaking = setSpeaking
    c.onLevel = setLevel
    call.current = c
    try {
      await c.start(persona)
    } catch (e: any) {
      setErr(e?.name === 'NotAllowedError' ? 'Allow microphone access to start the call.' : e.message || 'Could not start the call')
      setPhase('idle'); c.teardown()
    }
  }

  const hangup = () => {
    call.current?.hangup()
    setPhase('ending')
    setTimeout(() => setPhase((p) => (p === 'ending' ? 'done' : p)), 12000)
  }

  const status =
    phase === 'connecting' ? 'Connecting…'
      : phase === 'ending' ? 'Writing your call notes…'
      : phase === 'done' ? 'Call ended'
      : speaking ? 'Haanji is speaking'
      : userTalking ? 'Listening to you'
      : thinking ? 'Thinking…'
      : 'Your turn: just talk'

  const target = persona === 'screen' ? (me?.family[0] ? who(me.family[0]) : 'your parent') : me?.name.split(' ')[0]

  return (
    <div className="app text-white" style={{ background: '#0F0F10' }}>
      <Backdrop dark />
      <header className="flex items-center justify-between px-5 pt-4">
        <button onClick={() => { call.current?.teardown(); nav(-1) }} className="rounded-full px-3 py-2 text-[15px] font-medium text-white/60 active:bg-white/10">Close</button>
        {phase === 'live' && (
          <span className="flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-[13px] font-medium tabular-nums">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#3ddc84]" />
            {String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}
          </span>
        )}
      </header>

      <section className="flex flex-col items-center px-6 pt-2 text-center">
        <div className="relative h-48 w-48">
          <Orb className="absolute inset-0" color={scam ? '#D63031' : '#C8F24A'} active={speaking || thinking} />
        </div>
        <p className="font-display text-[26px] font-bold">Haanji</p>
        <p className="text-[14px] text-white/50">
          {phase === 'idle' ? `Answering for ${target ?? 'you'}` : lang ? `${status} · ${langNative(lang)}` : status}
        </p>
        {phase === 'live' && (
          <div className="mt-3 flex h-5 items-end gap-[3px]">
            {Array.from({ length: 12 }).map((_, i) => (
              <motion.span key={i} className={clsx('w-[3px] rounded-full', userTalking ? 'bg-white' : 'bg-white/25')} animate={{ height: 3 + level * (6 + ((i * 5) % 14)) }} transition={{ duration: 0.08 }} />
            ))}
          </div>
        )}
      </section>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto px-5 pb-4">
        {phase === 'idle' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white/[0.06] p-5">
            <p className="text-[18px] font-semibold">{copy.you}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-white/60">{copy.hint}</p>
            {persona === 'rider' && me?.profile.local_language && (
              <p className="mt-3 text-[14px] text-white/40">It greets in {langName(me.profile.local_language)}, then switches to whatever language you speak.</p>
            )}
            <p className="mt-3 text-[13px] text-white/40">Headphones keep interruptions clean.</p>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {lines.filter((l) => l.text).map((l) => (
            <motion.div key={l.id} layout initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }} className={clsx('flex', l.who === 'caller' ? 'justify-end' : 'justify-start')}>
              <div className={clsx('max-w-[86%] rounded-3xl px-4 py-3', l.who === 'caller' ? 'rounded-br-lg bg-white text-ink' : 'rounded-bl-lg bg-white/[0.08]')}>
                <p className={clsx('text-[11px] font-semibold uppercase tracking-wider', l.who === 'caller' ? 'text-muted' : 'text-accent')}>
                  {l.who === 'caller' ? copy.callerLabel : 'Haanji'} · {langNative(l.lang) || l.lang}
                </p>
                <p className="mt-1 text-[16px] leading-snug">{l.text}{l.cut && <span className="text-white/40"> —</span>}</p>
                {l.cut && <p className="mt-1 text-[11px] font-medium text-white/40">You interrupted. Haanji stopped and listened.</p>}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {thinking && !speaking && phase === 'live' && (
          <div className="flex items-center gap-2 px-1 text-[14px] text-white/40"><Spinner className="h-4 w-4" /> Haanji is thinking</div>
        )}

        <AnimatePresence>
          {scam && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex items-start gap-3 rounded-3xl bg-alarm p-5">
              <ShieldX className="mt-0.5 h-7 w-7 shrink-0" />
              <div>
                <p className="font-display text-[20px] font-bold">Scam stopped</p>
                <p className="mt-1 text-[14px] text-white/85">Haanji ended the call politely. In real use, you’d get an alert right away.</p>
              </div>
            </motion.div>
          )}
          {summary && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white p-5 text-ink">
              <p className="tag">Your call notes</p>
              <p className="mt-2 text-[16px] leading-relaxed">{summary}</p>
            </motion.div>
          )}
        </AnimatePresence>
        {err && <p className="text-[14px] font-medium text-white/70">{err}</p>}
        <div ref={end} />
      </div>

      <footer className="flex justify-center px-6 pt-3 bottom-safe">
        {phase === 'idle' || phase === 'done' ? (
          <motion.button whileTap={{ scale: 0.94 }} onClick={start} className="flex h-16 items-center gap-3 rounded-full bg-[#1fae5b] px-8 text-[17px] font-semibold">
            <Phone className="h-6 w-6" fill="currentColor" /> {phase === 'done' ? 'Call again' : 'Start call'}
          </motion.button>
        ) : (
          <motion.button whileTap={{ scale: 0.92 }} onClick={hangup} disabled={phase === 'ending'} aria-label="End call" className="grid h-16 w-16 place-items-center rounded-full bg-alarm disabled:opacity-40">
            {phase === 'connecting' || phase === 'ending' ? <Spinner /> : <PhoneOff className="h-7 w-7" />}
          </motion.button>
        )}
      </footer>
    </div>
  )
}
