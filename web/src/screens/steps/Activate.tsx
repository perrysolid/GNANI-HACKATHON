import { motion } from 'framer-motion'
import { Copy, MessageCircle, PhoneForwarded } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { telLink } from '../../lib/data'
import { useApp } from '../../lib/store'
import { ErrorText, Spinner } from '../../components/ui'
import { StepFrame, type StepProps } from '../Onboarding'
import { who } from './Family'

/** Standard GSM busy-forwarding; works on Airtel, Vi, BSNL and most Jio numbers.
 *  If a carrier refuses the code, the phone's Settings > Call forwarding menu does the same thing. */
export const forwardCodes = (n: string) => [
  { carrier: 'When you’re busy', code: `**67*${n}#` },
  { carrier: 'When you don’t answer', code: `**61*${n}#` },
  { carrier: 'Turn forwarding off', code: '##002#' },
]

export function ForwardCard({ number, title, sub }: { number: string; title: string; sub: string }) {
  const [copied, setCopied] = useState('')
  const copy = async (c: string) => {
    try { await navigator.clipboard.writeText(c); setCopied(c); setTimeout(() => setCopied(''), 1500) } catch { /* no clipboard */ }
  }
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-white"><PhoneForwarded className="h-5 w-5" /></span>
        <div>
          <p className="text-[16px] font-semibold">{title}</p>
          <p className="text-[14px] text-muted">{sub}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {forwardCodes(number).map(({ carrier, code }) => (
          <div key={carrier} className="flex items-center gap-2 rounded-2xl bg-paper p-2 pl-4">
            <div className="flex-1">
              <p className="text-[12px] font-medium text-muted">{carrier}</p>
              <p className="font-mono text-[16px] font-semibold tracking-wide">{code}</p>
            </div>
            <button onClick={() => copy(code)} aria-label="Copy code" className="grid h-10 w-10 place-items-center rounded-xl active:bg-ink/5">
              {copied === code ? <span className="text-[12px] font-semibold text-leaf">Copied</span> : <Copy className="h-[18px] w-[18px]" />}
            </button>
            <a href={telLink(code)} className="rounded-xl bg-ink px-4 py-2.5 text-[14px] font-semibold text-white">Dial</a>
          </div>
        ))}
      </div>
    </div>
  )
}

export function parentInvite(me: { name: string }, parent: { relation: string; name: string; phone: string }, number: string) {
  const codes = forwardCodes(number).map((c) => `${c.carrier}: ${c.code}`).join('\n')
  const text = `${who(parent)}, please dial this once from your phone:\n${codes}\n\nAfter that, when you cut a call from an unknown number, Haanji will answer it and stop fraud callers.\n\n— ${me.name}`
  return `https://wa.me/91${parent.phone}?text=${encodeURIComponent(text)}`
}

export function ActivateStep({ draft }: StepProps) {
  const nav = useNavigate()
  const { me, setMe, haanjiNumber } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const parent = me?.family[0]

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
      title={'Switch Haanji on'}
      sub={haanjiNumber ? 'Dial once. After that, reject a call and Haanji answers it.' : 'Your setup is saved. Calling switches on as soon as your Haanji number is live, and the codes to dial appear here.'}
      footer={
        <>
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={busy} onClick={finish}>{busy ? <Spinner /> : 'Done'}</button>
        </>
      }
    >
      <div className="space-y-3">
        {haanjiNumber && draft.purposes.includes('away') && (
          <ForwardCard number={haanjiNumber} title="On your phone" sub="Calls you reject go to Haanji." />
        )}
        {draft.purposes.includes('family') && parent && (
          <div className="card p-5">
            <p className="text-[16px] font-semibold">On {who(parent)}’s phone</p>
            <p className="mt-1 text-[14px] text-muted">
              {haanjiNumber ? `Send ${who(parent)} the code on WhatsApp. They dial it once.` : `We’ll send ${who(parent)} a one-time setup once calling is live.`}
            </p>
            {haanjiNumber && me && (
              <a href={parentInvite(me, parent, haanjiNumber)} target="_blank" rel="noreferrer" className="btn mt-4 bg-[#1f8f4e]">
                <MessageCircle className="h-5 w-5" /> Send on WhatsApp
              </a>
            )}
          </div>
        )}
      </div>
    </StepFrame>
  )
}
