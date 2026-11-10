import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Phone, PhoneCall, ShieldCheck, ShieldX } from 'lucide-react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { useState } from 'react'
import { api, type ShieldResult } from '../lib/api'
import { SIGNAL_LABEL } from '../lib/data'
import { useApp } from '../lib/store'
import { ErrorText, MicButton, Spinner } from '../components/ui'
import { PageHeader } from './Shell'
import { who } from './steps/Family'

const LOOK = {
  scam: { icon: ShieldX, title: 'This is a scam', tone: 'bg-alarm text-white', advice: 'Cut the call. Don’t share any OTP, PIN or money. Real police, CBI or banks never ask for these on a call.' },
  suspicious: { icon: AlertTriangle, title: 'Be careful', tone: 'bg-warn text-white', advice: 'Don’t act on this call. Hang up and call back on the official number yourself.' },
  no_signs: { icon: ShieldCheck, title: 'No scam signs heard', tone: 'bg-ink text-white', advice: 'Nothing we know of, but never share OTPs or PINs with anyone on a call.' },
}

export function ShieldTab() {
  const me = useApp((s) => s.me)
  const [mode, setMode] = useState<'speak' | 'type'>('speak')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<ShieldResult | null>(null)

  const run = async (input: { text?: string; audio?: Blob }) => {
    setBusy(true); setErr(''); setResult(null)
    try { setResult(await api.shieldCheck(input)) } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const look = result ? LOOK[result.level] : null

  return (
    <div>
      <PageHeader title="Shield" sub="Got a strange call? Tell Haanji what they said." />

      <div className="px-5">
        <Link to="/practice?as=screen" className="mt-3 flex items-center gap-4 rounded-3xl bg-ink p-5 text-white active:scale-[0.98] transition">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10"><PhoneCall className="h-5 w-5" /></span>
          <div className="flex-1">
            <p className="text-[16px] font-semibold">Test it with a live call</p>
            <p className="text-[13px] text-white/60">Pretend to be a scammer. Haanji ends the call.</p>
          </div>
        </Link>
        <p className="tag mt-7 px-1">Or check a call you got</p>
        <div className="mt-3 flex rounded-2xl bg-ink/[0.06] p-1">
          {(['speak', 'type'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className="relative flex-1 py-2.5 text-[15px] font-semibold">
              {mode === m && <motion.span layoutId="seg" className="absolute inset-0 rounded-xl bg-card shadow-sm" />}
              <span className="relative">{m === 'speak' ? 'Say it' : 'Type it'}</span>
            </button>
          ))}
        </div>

        <div className="card mt-4 p-6">
          {mode === 'speak' ? (
            <div className="flex flex-col items-center py-4 text-center">
              <MicButton onAudio={(audio) => run({ audio })} disabled={busy} label="Tap and repeat what the caller said" />
              <p className="mt-4 text-[13px] text-muted">Any Indian language. Mixed is fine.</p>
            </div>
          ) : (
            <>
              <textarea
                className="field min-h-[130px] resize-none"
                placeholder="e.g. Main CBI se bol raha hoon, aapke naam pe parcel mein drugs mile hain…"
                value={text}
                maxLength={3000}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="btn mt-3" disabled={busy || text.trim().length < 6} onClick={() => run({ text })}>{busy ? <Spinner /> : 'Check'}</button>
            </>
          )}
          {busy && mode === 'speak' && <div className="mt-2 flex justify-center text-muted"><Spinner /></div>}
          <ErrorText>{err}</ErrorText>
        </div>

        <AnimatePresence>
          {result && look && (
            <motion.section initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }} className="mt-4 overflow-hidden rounded-3xl border border-line bg-card">
              <div className={clsx('flex items-center gap-3 p-5', look.tone)}>
                <motion.span initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
                  <look.icon className="h-8 w-8" />
                </motion.span>
                <p className="font-display text-[24px] font-bold">{look.title}</p>
              </div>
              <div className="p-5">
                <p className="text-[15px] leading-relaxed">{look.advice}</p>
                {result.signals.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {result.signals.map((s, i) => (
                      <motion.li key={s.category} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.06 }} className="flex gap-3 rounded-2xl bg-paper p-3">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-[2px] bg-current" />
                        <span className="text-[14px]"><span className="font-semibold">{SIGNAL_LABEL[s.category]}</span><span className="text-muted"> · “{s.phrase}”</span></span>
                      </motion.li>
                    ))}
                  </ul>
                )}
                {result.model_note && <p className="mt-3 text-[14px] text-muted">{result.model_note}</p>}
                <p className="mt-4 text-[13px] text-muted">Heard: “{result.text}”</p>
                {result.level !== 'no_signs' && (
                  <a href="tel:1930" className="btn mt-4"><Phone className="h-5 w-5" /> Report to cyber helpline 1930</a>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {me && me.family.length > 0 && (
          <section className="mt-8">
            <p className="tag px-1">Protected family</p>
            <div className="mt-3 space-y-2">
              {me.family.map((f) => (
                <div key={f.id} className="card p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-ink font-display font-bold text-white">{who(f)[0]}</span>
                    <div>
                      <p className="text-[16px] font-semibold">{who(f)}</p>
                      <p className="text-[13px] text-muted">+91 {f.phone.slice(0, 5)} {f.phone.slice(5)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[f.block_scams && 'Stops scam calls', f.screen_unknown && 'Answers unknown numbers', f.translate && 'Explains calls', f.checkin && `Check-in at ${f.checkin_time}`].filter(Boolean).map((t) => (
                      <span key={t as string} className="rounded-full bg-paper px-3 py-1.5 text-[12px] font-medium">{t}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
