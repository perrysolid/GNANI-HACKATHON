import { AnimatePresence, motion } from 'framer-motion'
import { CalendarCheck, Check, Clock, Minus, PhoneOutgoing, Plus, Sparkles, Store, UtensilsCrossed } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Errand, type PastErrand } from '../lib/api'
import { LANGUAGES } from '../lib/data'
import { useApp } from '../lib/store'
import { Backdrop, BackButton, ErrorText, Signal, Spinner, Toggle } from '../components/ui'

/** Special commands: what Haanji can phone someone to get done. */
const COMMANDS = [
  { id: 'table', label: 'Book a table', icon: UtensilsCrossed, hint: 'Restaurant, café' },
  { id: 'appointment', label: 'Book an appointment', icon: CalendarCheck, hint: 'Doctor, salon, service' },
  { id: 'open', label: 'Ask if they’re open', icon: Store, hint: 'Timings, stock, prices' },
  { id: 'custom', label: 'Anything else', icon: Sparkles, hint: 'Say it in your words' },
] as const
type Cmd = (typeof COMMANDS)[number]['id']

const FLEX = [['exact', 'Exact time'], ['30', '± 30 min'], ['60', '± 1 hour']]
const DAYS = [['today', 'Today'], ['tomorrow', 'Tomorrow']]

const ampm = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`
}

export function Errands() {
  const nav = useNavigate()
  const me = useApp((s) => s.me)
  const [cmd, setCmd] = useState<Cmd>('table')
  const [toName, setToName] = useState('')
  const [toPhone, setToPhone] = useState('')
  const [people, setPeople] = useState(2)
  const [day, setDay] = useState('today')
  const [time, setTime] = useState('20:00')
  const [flex, setFlex] = useState('30')
  const [what, setWhat] = useState('')
  const [extra, setExtra] = useState('')
  const [custom, setCustom] = useState('')
  const [bookName, setBookName] = useState(me?.name ?? '')
  const [lang, setLang] = useState('en-IN')
  const [share, setShare] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [live, setLive] = useState<Errand | null>(null)
  const [past, setPast] = useState<PastErrand[]>([])

  const langs = ['en-IN', 'hi-IN', 'kn-IN', me?.profile.local_language].filter((v, i, a): v is string => !!v && a.indexOf(v) === i)

  const refresh = () => api.errands().then((r) => { setPast(r.past); if (r.active[0]) setLive((l) => l ?? r.active[0]) }).catch(() => {})
  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the call while it runs.
  useEffect(() => {
    if (!live || !['dialing', 'on_call'].includes(live.status)) return
    const t = window.setInterval(async () => {
      try {
        const e = await api.errand(live.id)
        setLive(e)
        if (!['dialing', 'on_call'].includes(e.status)) refresh()
      } catch { /* keep trying */ }
    }, 1500)
    return () => window.clearInterval(t)
  }, [live?.id, live?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const when = `${day} at ${ampm(time)}${flex === 'exact' ? ' (exact time only)' : `; ${flex === '30' ? '30 minutes' : 'an hour'} earlier or later is fine`}`
  const task =
    cmd === 'table' ? `Book a table for ${people} ${people === 1 ? 'person' : 'people'} ${when}. Name for the booking: ${bookName || me?.name}.${extra ? ` Also: ${extra}.` : ''}`
      : cmd === 'appointment' ? `Book an appointment${what ? ` for ${what}` : ''} ${when}. Name: ${bookName || me?.name}.${extra ? ` Also: ${extra}.` : ''}`
      : cmd === 'open' ? `Ask if they are open now and until what time.${extra ? ` Also ask: ${extra}.` : ''} Don't book or order anything.`
      : custom.trim()
  const ok = /^[6-9]\d{9}$/.test(toPhone) && task.length >= 5 && (cmd !== 'appointment' || what.trim())

  const call = async () => {
    setBusy(true); setErr('')
    try { setLive(await api.startErrand({ to_phone: toPhone, to_name: toName.trim(), task, language: lang, share_number: share })) }
    catch (e: any) { setErr(e.message) }
    setBusy(false)
  }

  const running = live && ['dialing', 'on_call'].includes(live.status)

  return (
    <div className="app">
      <Backdrop />
      <header className="px-4 pt-3"><BackButton onClick={() => nav(-1)} /></header>
      <div className="px-6 pt-2">
        <h1 className="title">Haanji calls for you</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">Tell it who to call and what to get done. It talks to them in their language and tells you how it went.</p>
      </div>

      <AnimatePresence>{live && <LiveErrand e={live} onClose={() => setLive(null)} />}</AnimatePresence>

      {!running && (
        <div className="space-y-6 px-6 pb-16 pt-6">
          <div className="grid grid-cols-2 gap-2.5">
            {COMMANDS.map(({ id, label, icon: Icon, hint }) => (
              <motion.button key={id} whileTap={{ scale: 0.97 }} onClick={() => setCmd(id)}
                className={clsx('flex flex-col items-start rounded-2xl border p-3.5 text-left transition-colors', cmd === id ? 'border-ink bg-ink text-white' : 'border-line bg-card')}>
                <Icon className={clsx('h-5 w-5', cmd === id ? 'text-accent' : 'text-ink/70')} />
                <span className="mt-3 text-[15px] font-semibold leading-tight">{label}</span>
                <span className={clsx('mt-0.5 text-[12px]', cmd === id ? 'text-white/55' : 'text-muted')}>{hint}</span>
              </motion.button>
            ))}
          </div>

          <section className="space-y-3">
            <p className="tag">Who to call</p>
            <input className="field" value={toName} onChange={(e) => setToName(e.target.value)} maxLength={60} placeholder={cmd === 'table' ? 'Truffles, Koramangala' : cmd === 'appointment' ? 'Dr. Rao’s clinic' : 'Name'} />
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-card px-4 focus-within:border-ink">
              <span className="text-[17px] font-medium text-ink/40">+91</span>
              <input value={toPhone} onChange={(e) => setToPhone(e.target.value.replace(/\D/g, '').slice(-10))} inputMode="numeric" placeholder="98765 43210" className="w-full bg-transparent py-4 text-[17px] font-medium outline-none placeholder:text-ink/25" />
            </div>
          </section>

          <section className="space-y-3">
            <p className="tag">{cmd === 'custom' ? 'What should Haanji do' : 'Details'}</p>
            {cmd === 'custom' && (
              <textarea className="field min-h-[120px] resize-none" maxLength={600} value={custom} onChange={(e) => setCustom(e.target.value)}
                placeholder="Ask the tailor if my blazer is ready and what I owe. If it is, say I’ll pick it up tomorrow evening." />
            )}
            {cmd === 'appointment' && <input className="field" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={80} placeholder="What for: haircut, general check-up" />}
            {cmd === 'table' && (
              <div className="flex items-center justify-between rounded-2xl border border-line bg-card px-4 py-3">
                <span className="text-[16px] font-medium">People</span>
                <div className="flex items-center gap-4">
                  <button onClick={() => setPeople((n) => Math.max(1, n - 1))} aria-label="Fewer" className="grid h-9 w-9 place-items-center rounded-full bg-ink/[0.06]"><Minus className="h-4 w-4" /></button>
                  <span className="w-6 text-center font-display text-[20px] font-bold tabular-nums">{people}</span>
                  <button onClick={() => setPeople((n) => Math.min(20, n + 1))} aria-label="More" className="grid h-9 w-9 place-items-center rounded-full bg-ink/[0.06]"><Plus className="h-4 w-4" /></button>
                </div>
              </div>
            )}
            {(cmd === 'table' || cmd === 'appointment') && (
              <>
                <div className="flex gap-2">
                  {DAYS.map(([id, l]) => <Pill key={id} on={day === id} onClick={() => setDay(id)}>{l}</Pill>)}
                  <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-card px-3">
                    <Clock className="h-4 w-4 text-ink/50" />
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value || '20:00')} className="w-full min-w-0 bg-transparent py-2.5 text-[15px] font-semibold outline-none" />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">{FLEX.map(([id, l]) => <Pill key={id} on={flex === id} onClick={() => setFlex(id)}>{l}</Pill>)}</div>
                <input className="field" value={bookName} onChange={(e) => setBookName(e.target.value)} maxLength={40} placeholder="Name for the booking" />
              </>
            )}
            {cmd !== 'custom' && (
              <input className="field" value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={160}
                placeholder={cmd === 'open' ? 'Also ask: do you have paneer today?' : cmd === 'table' ? 'Outdoor seating, a birthday' : 'Anything else to mention'} />
            )}
          </section>

          <section className="space-y-3">
            <p className="tag">Start in</p>
            <div className="flex flex-wrap gap-2">
              {langs.map((c) => <Pill key={c} on={lang === c} onClick={() => setLang(c)}>{LANGUAGES.find((l) => l.code === c)?.native ?? c}</Pill>)}
            </div>
            <div className="border-y border-line">
              <Toggle on={share} onChange={setShare} label="Share my number if they ask" hint="For the booking. Never your OTPs or card." />
            </div>
          </section>

          {cmd !== 'custom' && <p className="rounded-2xl bg-ink/[0.05] p-4 text-[14px] leading-relaxed text-ink/75">Haanji will: {task}</p>}
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={!ok || busy} onClick={call}>{busy ? <Spinner /> : <><PhoneOutgoing className="h-5 w-5" /> Call {toName.trim() || 'now'}</>}</button>
          <p className="-mt-3 text-center text-[12px] text-muted">On the demo line, only numbers verified with the phone provider can be called.</p>

          {past.length > 0 && (
            <section className="space-y-2 pt-2">
              <p className="tag">Done for you</p>
              {past.map((p) => (
                <div key={p.id} className="card p-4">
                  <p className="text-[13px] font-semibold text-muted">{p.to} · {new Date(p.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
                  <p className="mt-1 text-[15px] leading-snug">{p.result}</p>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button whileTap={{ scale: 0.95 }} onClick={onClick} className={clsx('rounded-xl border px-3.5 py-2.5 text-[15px] font-medium transition-colors', on ? 'border-ink bg-ink text-white' : 'border-line bg-card')}>
      {children}
    </motion.button>
  )
}

/** The call in progress, then its outcome. */
function LiveErrand({ e, onClose }: { e: Errand; onClose: () => void }) {
  const on = e.status === 'on_call'
  const over = !['dialing', 'on_call'].includes(e.status)
  const title = e.status === 'dialing' ? `Calling ${e.to_name || e.to_phone}…` : on ? `On the call with ${e.to_name || e.to_phone}` : e.status === 'done' ? 'How it went' : e.status === 'no_answer' ? 'No answer' : 'Couldn’t call'
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mx-5 mt-6 overflow-hidden rounded-[28px] bg-ink text-white">
      <div className="flex items-center gap-4 p-5">
        {over ? (
          <span className={clsx('grid h-12 w-12 place-items-center rounded-2xl', e.status === 'done' ? 'bg-accent text-ink' : 'bg-white/10')}>{e.status === 'done' ? <Check className="h-6 w-6" /> : <PhoneOutgoing className="h-5 w-5" />}</span>
        ) : <Signal className="w-12" active={on} />}
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold">{title}</p>
          <p className="truncate text-[13px] text-white/55">{e.task}</p>
        </div>
      </div>
      {e.transcript.length > 0 && (
        <div className="max-h-[300px] space-y-2 overflow-y-auto border-t border-white/10 px-5 py-4">
          {e.transcript.map((t, i) => (
            <p key={i} className={clsx('text-[14px] leading-snug', t.who === 'haanji' ? 'text-accent' : 'text-white/85')}>
              <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">{t.who === 'haanji' ? 'Haanji' : 'Them'}</span>{t.text}
            </p>
          ))}
        </div>
      )}
      {over && (
        <div className="border-t border-white/10 p-5">
          <p className="text-[16px] leading-relaxed">{e.result || (e.status === 'no_answer' ? 'They didn’t pick up. Try again in a bit.' : 'The call didn’t go through.')}</p>
          <button onClick={onClose} className="mt-4 h-11 w-full rounded-2xl bg-white/10 text-[15px] font-semibold">New call</button>
        </div>
      )}
    </motion.section>
  )
}
