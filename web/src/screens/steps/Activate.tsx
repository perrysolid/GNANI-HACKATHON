import { motion } from 'framer-motion'
import { Copy, PhoneCall } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { telLink } from '../../lib/data'
import { useApp } from '../../lib/store'
import { ErrorText, Spinner } from '../../components/ui'
import { StepFrame, type StepProps } from '../Onboarding'

export const spacedNumber = (n: string) => (n.length === 11 ? `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}` : n)

/** Demo: the shared Haanji number answers as whoever set up last. Nothing to dial or forward. */
export function DemoNumberCard({ number, title, sub }: { number: string; title: string; sub: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(number); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* no clipboard */ }
  }
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-accent"><PhoneCall className="h-5 w-5" /></span>
        <div>
          <p className="text-[16px] font-semibold">{title}</p>
          <p className="text-[14px] text-muted">{sub}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-2xl bg-paper p-2 pl-4">
        <p className="min-w-0 flex-1 whitespace-nowrap font-display text-[21px] font-bold tracking-[-0.01em] tabular-nums">{spacedNumber(number)}</p>
        <button onClick={copy} aria-label="Copy number" className="grid h-10 w-10 place-items-center rounded-xl active:bg-ink/5">
          {copied ? <span className="text-[12px] font-semibold text-leaf">Copied</span> : <Copy className="h-[18px] w-[18px]" />}
        </button>
        <a href={telLink(number)} className="rounded-xl bg-ink px-4 py-2.5 text-[14px] font-semibold text-white">Call</a>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted">Call it from another phone. No call forwarding needed for the demo.</p>
    </div>
  )
}

export function ActivateStep(_: StepProps) {
  const nav = useNavigate()
  const { setMe, haanjiNumber } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const finish = async () => {
    setBusy(true); setErr('')
    try {
      setMe(await api.updateMe({ onboarded: true }))
      setDone(true)
      setTimeout(() => nav('/home', { replace: true }), 1300)
    } catch (e: any) { setErr(e.message); setBusy(false) }
  }

  if (done) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} className="grid h-24 w-24 place-items-center rounded-full bg-ink">
          <motion.svg viewBox="0 0 24 24" className="h-11 w-11" fill="none" stroke="#C8F24A" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.45 }} />
          </motion.svg>
        </motion.div>
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="title mt-8">Haanji is ready</motion.p>
      </div>
    )
  }

  return (
    <StepFrame
      tag="Last step"
      title={'Haanji is set up'}
      sub={haanjiNumber ? 'Gnani is set up for you. Tap Done, then call your Haanji number from another phone.' : 'Your setup is saved. Calling switches on as soon as the Haanji number is live.'}
      footer={
        <>
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={busy} onClick={finish}>{busy ? <Spinner /> : 'Done'}</button>
        </>
      }
    >
      {haanjiNumber && (
        <DemoNumberCard number={haanjiNumber} title="Your Haanji number" sub="Answers as your Haanji, in the caller’s language." />
      )}
    </StepFrame>
  )
}
