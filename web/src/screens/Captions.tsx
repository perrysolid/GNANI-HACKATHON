import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Captions as CaptionsIcon, Headphones } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { token } from '../lib/api'
import { langNative } from '../lib/data'
import { CallLink, wsUrl } from '../lib/live'
import { useApp } from '../lib/store'
import { Backdrop, BackButton, ErrorText } from '../components/ui'

type Line = { id: number; who: 'caller' | 'haanji' | 'you'; text: string; lang?: string }
const QUICK = ['Please wait a minute', 'I’m coming down', 'Leave it at the gate', 'Call me back later', 'Yes', 'No']

const JOIN_KEY = 'haanji.join'
const readJoin = () => { try { return localStorage.getItem(JOIN_KEY) === '1' } catch { return false } }

/**
 * Calls to your Haanji number, live: captions as the caller speaks, typed replies spoken in
 * their language, and "on the call with me": you, Haanji and the caller talk together.
 */
export function Captions() {
  const nav = useNavigate()
  const { me, haanjiNumber } = useApp()
  const ws = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [inCall, setInCall] = useState(false)
  const [manual, setManual] = useState(() => { try { return localStorage.getItem('haanji.typing') === '1' } catch { return false } })
  const [lines, setLines] = useState<Line[]>([])
  const [ended, setEnded] = useState('')
  const [text, setText] = useState('')
  const seq = useRef(0)
  const end = useRef<HTMLDivElement>(null)
  const link = useRef<CallLink | null>(null)
  const [joined, setJoined] = useState(false)
  const [wantJoin] = useState(readJoin)
  const [level, setLevel] = useState(0)
  const [joinErr, setJoinErr] = useState('')

  useEffect(() => {
    let alive = true, retry: number
    const add = (l: Omit<Line, 'id'>) => setLines((ls) => [...ls, { ...l, id: ++seq.current }])
    const open = () => {
      const s = new WebSocket(wsUrl('/api/watch'))
      s.binaryType = 'arraybuffer'
      ws.current = s
      s.onopen = () => {
        s.send(JSON.stringify({ type: 'start', token: token.get() }))
        s.send(JSON.stringify({ type: 'mode', manual: manualRef.current }))
        if (link.current) s.send(JSON.stringify({ type: 'join', on: true }))
        setConnected(true)
      }
      s.onmessage = (m) => {
        if (typeof m.data !== 'string') { link.current?.play(m.data); return }
        const e = JSON.parse(m.data)
        if (e.type === 'watching') { setInCall(e.in_call); if (link.current) link.current.live = e.in_call }
        if (e.type === 'call_start') {
          setInCall(true); setEnded(''); setLines([])
          if (link.current) { link.current.live = true; link.current.chime(); navigator.vibrate?.([200, 100, 200]) }
        }
        if (e.type === 'interrupted') link.current?.flushHaanji()
        if (e.type === 'heard') add({ who: 'caller', text: e.text, lang: e.language })
        if (e.type === 'reply_start') add({ who: 'haanji', text: '' })
        if (e.type === 'reply_text') setLines((ls) => {
          const i = ls.map((l) => l.who).lastIndexOf('haanji')
          if (i < 0) return ls
          const next = [...ls]; next[i] = { ...next[i], text: next[i].text ? `${next[i].text} ${e.text}` : e.text }
          return next
        })
        if (e.type === 'typed') add({ who: 'you', text: e.text })
        if (e.type === 'call_end') { setInCall(false); setEnded(e.summary || 'Call ended'); if (link.current) link.current.live = false }
      }
      s.onclose = () => { setConnected(false); if (alive) retry = window.setTimeout(open, 3000) }
    }
    open()
    return () => { alive = false; window.clearTimeout(retry); ws.current?.close(); link.current?.stop() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const manualRef = useRef(manual)
  manualRef.current = manual

  const join = async (on: boolean) => {
    setJoinErr('')
    try { localStorage.setItem(JOIN_KEY, on ? '1' : '0') } catch { /* private mode */ }
    if (!on) {
      link.current?.stop(); link.current = null; setJoined(false); setLevel(0)
      ws.current?.send(JSON.stringify({ type: 'join', on: false }))
      return
    }
    const l = new CallLink()
    l.onLevel = setLevel
    try {
      await l.start((f) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(f) })
    } catch (e: any) {
      setJoinErr(e?.name === 'NotAllowedError' ? 'Allow the microphone to join calls.' : 'Couldn’t start the microphone.')
      l.stop(); return
    }
    l.live = inCall
    link.current = l
    setJoined(true)
    ws.current?.send(JSON.stringify({ type: 'join', on: true }))
  }

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [lines, ended])

  const setMode = (m: boolean) => {
    setManual(m)
    try { localStorage.setItem('haanji.typing', m ? '1' : '0') } catch { /* private mode */ }
    ws.current?.send(JSON.stringify({ type: 'mode', manual: m }))
  }
  const say = (t: string) => {
    const v = t.trim()
    if (!v || !inCall) return
    ws.current?.send(JSON.stringify({ type: 'say', text: v }))
    setText('')
  }
  const number = haanjiNumber.length === 11 ? `${haanjiNumber.slice(0, 3)} ${haanjiNumber.slice(3, 7)} ${haanjiNumber.slice(7)}` : haanjiNumber

  return (
    <div className="app">
      <Backdrop />
      <header className="flex items-center justify-between px-4 pt-3">
        <BackButton onClick={() => nav(-1)} />
        <span className="flex items-center gap-2 pr-2 text-[13px] font-medium text-muted">
          <span className={clsx('h-2 w-2 rounded-full', inCall ? 'animate-pulse bg-leaf' : connected ? 'bg-ink/30' : 'bg-ink/10')} />
          {inCall ? 'On a call' : connected ? 'Waiting' : 'Connecting'}
        </span>
      </header>

      <div className="px-6 pt-3">
        <h1 className="title">Live calls</h1>
        <div className="mt-5 flex rounded-2xl bg-ink/[0.06] p-1">
          {[[false, 'Haanji answers'], [true, 'I’ll type']].map(([m, label]) => (
            <button key={String(m)} onClick={() => setMode(m as boolean)} className={clsx('relative flex-1 rounded-xl py-2.5 text-[14px] font-semibold transition-colors', manual === m ? 'text-white' : 'text-ink/60')}>
              {manual === m && <motion.span layoutId="mode" className="absolute inset-0 rounded-xl bg-ink" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
              <span className="relative">{label as string}</span>
            </button>
          ))}
        </div>
        <button onClick={() => join(!joined)} className={clsx('mt-3 flex w-full items-center gap-4 rounded-3xl p-4 text-left transition-colors', joined ? 'bg-ink text-white' : 'border border-line bg-card')}>
          <span className={clsx('relative grid h-11 w-11 shrink-0 place-items-center rounded-xl', joined ? 'bg-accent text-ink' : 'bg-ink/[0.06]')}>
            {joined && inCall && <motion.span className="absolute inset-0 rounded-xl bg-accent/40" animate={{ scale: 1 + level * 0.5 }} transition={{ duration: 0.08 }} />}
            <Headphones className="relative h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-[16px] font-semibold">On the call with me</p>
            <p className={clsx('text-[13px]', joined ? 'text-white/60' : 'text-muted')}>
              {joined ? (inCall ? 'You’re on the call. Talk any time.' : 'You’ll join the next call here.') : wantJoin ? 'Tap to turn on again' : 'You, Haanji and the caller together'}
            </p>
          </div>
          <span className={clsx('relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors', joined ? 'bg-accent' : 'bg-ink/15')}>
            <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }} className={clsx('absolute top-[3px] h-6 w-6 rounded-full shadow', joined ? 'right-[3px] bg-ink' : 'left-[3px] bg-white')} />
          </span>
        </button>
        {joinErr && <div className="mt-2"><ErrorText>{joinErr}</ErrorText></div>}
        {joined && <p className="mt-2 px-1 text-[13px] leading-relaxed text-muted">Haanji steps back while you talk and picks up if you go quiet. Headphones stop echo.</p>}
      </div>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto px-5 pb-4">
        {!inCall && lines.length === 0 && !ended && (
          <div className="mt-10 flex flex-col items-center px-4 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink text-accent"><CaptionsIcon className="h-7 w-7" /></span>
            <p className="mt-5 text-[17px] font-semibold">Waiting for a call</p>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">
              {me?.owns_number && number ? `When someone calls ${number}, their words appear here as they speak.` : 'Calls to your Haanji number show up here as text.'}
            </p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {lines.filter((l) => l.text).map((l) => (
            <motion.div key={l.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={clsx('flex', l.who === 'caller' ? 'justify-start' : 'justify-end')}>
              <div className={clsx('max-w-[88%] rounded-3xl px-4 py-3', l.who === 'caller' ? 'rounded-bl-lg border border-line bg-card' : l.who === 'you' ? 'rounded-br-lg bg-accent text-ink' : 'rounded-br-lg bg-ink text-white')}>
                <p className={clsx('text-[11px] font-semibold uppercase tracking-wider', l.who === 'haanji' ? 'text-white/50' : 'text-ink/45')}>
                  {l.who === 'caller' ? `Caller${l.lang ? ` · ${langNative(l.lang)}` : ''}` : l.who === 'you' ? 'You typed' : 'Haanji said'}
                </p>
                <p className={clsx('mt-1 leading-snug', l.who === 'caller' ? 'text-[20px] font-medium' : 'text-[16px]')}>{l.text}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {ended && <p className="rounded-2xl bg-ink/[0.05] p-4 text-[14px] leading-relaxed">{ended}</p>}
        <div ref={end} />
      </div>

      {inCall && manual && (
        <footer className="space-y-3 border-t border-line bg-paper/90 px-4 pt-3 backdrop-blur bottom-safe">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {QUICK.map((q) => (
              <button key={q} onClick={() => say(q)} className="shrink-0 rounded-xl border border-line bg-card px-3 py-2 text-[14px] font-medium active:bg-ink/5">{q}</button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); say(text) }} className="flex items-center gap-2">
            <input className="field py-3" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type, Haanji will say it" maxLength={400} />
            <button type="submit" aria-label="Say it" disabled={!text.trim()} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-ink text-white disabled:opacity-25">
              <ArrowUp className="h-5 w-5" />
            </button>
          </form>
        </footer>
      )}
    </div>
  )
}
