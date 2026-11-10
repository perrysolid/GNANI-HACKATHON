import { clsx } from 'clsx'
import { useState } from 'react'
import { api } from '../../lib/api'
import { RELATIONS } from '../../lib/data'
import { useApp } from '../../lib/store'
import { ErrorText, Spinner, Toggle } from '../../components/ui'
import { StepFrame, type StepProps } from '../Onboarding'
import { LanguageGrid } from './Basics'

export const who = (p: { relation: string; name: string }) => (p.relation === 'Other' ? p.name || 'them' : p.relation)

export function ParentStep({ draft, update, next }: StepProps) {
  const p = draft.parent
  const set = (patch: Partial<typeof p>) => update({ parent: { ...p, ...patch } })
  const ok = /^[6-9]\d{9}$/.test(p.phone) && p.phone !== draft.phone && (p.relation !== 'Other' || p.name.trim())

  return (
    <StepFrame
      tag="Family"
      title={'Who should\nHaanji protect?'}
      sub="Haanji answers unknown callers on their phone and stops scammers."
      footer={<button className="btn" disabled={!ok} onClick={next}>Continue</button>}
    >
      <div className="flex flex-wrap gap-2">
        {RELATIONS.map((r) => (
          <button key={r} onClick={() => set({ relation: r })} className={clsx('rounded-full border px-4 py-2.5 text-[15px] font-medium transition-colors', p.relation === r ? 'border-ink bg-ink text-white' : 'border-line bg-card')}>
            {r}
          </button>
        ))}
      </div>
      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-medium text-muted">{p.relation === 'Other' ? 'Their name' : 'Their name (optional)'}</span>
          <input className="field" placeholder="Sunita Sharma" value={p.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-medium text-muted">Their mobile number</span>
          <div className="flex gap-2">
            <div className="field flex w-[84px] shrink-0 items-center justify-center px-0">+91</div>
            <input className="field" inputMode="numeric" placeholder="98765 43210" value={p.phone} onChange={(e) => set({ phone: e.target.value.replace(/\D/g, '').slice(-10) })} />
          </div>
        </label>
        {p.phone.length === 10 && p.phone === draft.phone && <ErrorText>That’s your own number. Add theirs.</ErrorText>}
      </div>
    </StepFrame>
  )
}

export function ParentLanguageStep({ draft, update, next }: StepProps) {
  const p = draft.parent
  return (
    <StepFrame
      tag="Their language"
      title={`Which language\ndoes ${who(p)} speak?`}
      sub="Haanji explains calls to them in this language."
      footer={<button className="btn" disabled={!p.language} onClick={next}>Continue</button>}
    >
      <LanguageGrid value={p.language} onChange={(language) => update({ parent: { ...p, language } })} />
    </StepFrame>
  )
}

export function ProtectStep({ draft, update, next }: StepProps) {
  const p = draft.parent
  const set = (patch: Partial<typeof p>) => update({ parent: { ...p, ...patch } })
  const setMe = useApp((s) => s.setMe)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      await api.addFamily({ ...p, name: p.name.trim() })
      setMe(await api.me())
      next()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <StepFrame
      tag="Protection"
      title={`How should Haanji\nlook after ${who(p)}?`}
      footer={
        <>
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? <Spinner /> : `Protect ${who(p)}`}</button>
        </>
      }
    >
      <div className="card divide-y divide-line px-5">
        <Toggle on={p.screen_unknown} onChange={(v) => set({ screen_unknown: v })} label="Answer unknown numbers first" hint="Haanji asks who’s calling and why." />
        <Toggle on={p.block_scams} onChange={(v) => set({ block_scams: v })} label="Stop scam calls and alert me" hint="Fake police, KYC, OTP and digital arrest." />
        <Toggle on={p.translate} onChange={(v) => set({ translate: v })} label="Explain calls they don’t understand" hint="Bank or hospital calls in another language." />
        <Toggle on={p.checkin} onChange={(v) => set({ checkin: v })} label="Daily check-in call" hint="A short chat every morning. You get a summary." />
        {p.checkin && (
          <label className="flex items-center justify-between py-4">
            <span className="text-[16px] font-semibold">Call at</span>
            <input type="time" value={p.checkin_time} onChange={(e) => set({ checkin_time: e.target.value })} className="rounded-xl border border-line bg-paper px-3 py-2 text-[16px] font-medium" />
          </label>
        )}
      </div>
    </StepFrame>
  )
}
