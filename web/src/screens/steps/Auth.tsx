import { motion } from 'framer-motion'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { api, token } from '../../lib/api'
import { useApp } from '../../lib/store'
import { ErrorText, Spinner } from '../../components/ui'
import { StepFrame, type StepProps } from '../Onboarding'

const CODE_LENGTH = 6

// Shared between the phone and OTP steps.
const otpState = { sessionId: '', devCode: '' as string | null }

export function NameStep({ draft, update, next }: StepProps) {
  const ok = draft.name.trim().length >= 2
  return (
    <StepFrame
      tag="Your name"
      title={'What should we\ncall you?'}
      sub="Haanji uses it when it answers for you."
      footer={<button className="btn" disabled={!ok} onClick={next}>Continue</button>}
    >
      <input
        autoFocus
        className="field"
        placeholder="Full name"
        autoComplete="name"
        value={draft.name}
        maxLength={60}
        onChange={(e) => update({ name: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && ok && next()}
      />
    </StepFrame>
  )
}

export function PhoneStep({ draft, update, next, onSignedIn }: StepProps & { onSignedIn: (onboarded: boolean) => void }) {
  const demoLogin = useApp((s) => s.demoLogin)
  const [busy, setBusy] = useState<'' | 'sms' | 'demo'>('')
  const [err, setErr] = useState('')
  const ok = /^[6-9]\d{9}$/.test(draft.phone)

  const send = async () => {
    setBusy('sms'); setErr('')
    try {
      const r = await api.sendCode(draft.phone, 'sms')
      Object.assign(otpState, { sessionId: r.session_id, devCode: r.dev_code })
      next()
    } catch (e: any) {
      setErr(e.message)
    } finally { setBusy('') }
  }

  // Demo: skip the SMS. The number is still the account and the caller ID Haanji knows.
  const demo = async () => {
    setBusy('demo'); setErr('')
    try {
      const r = await api.demoSignIn(draft.phone, draft.name)
      token.set(r.token)
      if (r.name) update({ name: r.name })
      await onSignedIn(r.onboarded)
    } catch (e: any) {
      setErr(e.message)
    } finally { setBusy('') }
  }

  return (
    <StepFrame
      tag="Phone number"
      title={'What’s your\nnumber?'}
      sub={demoLogin ? 'Use your real number. Haanji recognises you when you call from it.' : 'We’ll text you a 6-digit code.'}
      footer={
        <div className="space-y-2.5">
          <button className="btn" disabled={!ok || !!busy} onClick={send}>{busy === 'sms' ? <Spinner /> : 'Send code'}</button>
          {demoLogin && (
            <button className="btn-ghost w-full py-3 text-[15px] font-semibold disabled:opacity-40" disabled={!ok || !!busy} onClick={demo}>
              {busy === 'demo' ? <Spinner /> : 'Continue without OTP (demo)'}
            </button>
          )}
        </div>
      }
    >
      <div className="flex gap-2">
        <div className="field flex w-[84px] shrink-0 items-center justify-center gap-1.5 px-0">
          +91
        </div>
        <input
          autoFocus
          className="field tracking-[0.04em]"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          value={draft.phone}
          onChange={(e) => update({ phone: e.target.value.replace(/\D/g, '').slice(-10) })}
          onKeyDown={(e) => e.key === 'Enter' && ok && send()}
        />
      </div>
      <div className="mt-3"><ErrorText>{err}</ErrorText></div>
    </StepFrame>
  )
}

export function OtpStep({ draft, update, onSignedIn }: StepProps & { onSignedIn: (onboarded: boolean) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shake, setShake] = useState(0)
  const [wait, setWait] = useState(30)
  const [devCode, setDevCode] = useState(otpState.devCode)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const verify = async (value: string) => {
    setBusy(true); setErr('')
    try {
      const r = await api.verifyCode(otpState.sessionId, value, draft.name)
      token.set(r.token)
      if (r.name) update({ name: r.name })
      onSignedIn(r.onboarded)
    } catch (e: any) {
      setErr(e.message); setCode(''); setShake((s) => s + 1)
      input.current?.focus()
    } finally { setBusy(false) }
  }

  const resend = async () => {
    setErr('')
    try {
      const r = await api.sendCode(draft.phone, 'sms')
      Object.assign(otpState, { sessionId: r.session_id, devCode: r.dev_code })
      setDevCode(r.dev_code); setWait(30); setCode('')
      input.current?.focus()
    } catch (e: any) { setErr(e.message) }
  }

  const onChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(digits)
    if (digits.length === CODE_LENGTH) verify(digits)
  }

  return (
    <StepFrame
      tag="Verification"
      title={'Enter the code'}
      sub={
        <>
          Sent to{' '}
          <span className="font-semibold text-ink">+91 {draft.phone.slice(0, 5)} {draft.phone.slice(5)}</span>
        </>
      }
      footer={
        <button className="btn" disabled={code.length < 4 || busy} onClick={() => verify(code)}>
          {busy ? <Spinner /> : 'Verify'}
        </button>
      }
    >
      <motion.label key={shake} animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : {}} transition={{ duration: 0.4 }} className="relative flex gap-2" onClick={() => input.current?.focus()}>
        {Array.from({ length: CODE_LENGTH }).map((_, i) => {
          const filled = i < code.length
          const active = i === code.length && !busy
          return (
            <motion.div
              key={i}
              animate={{ scale: filled ? [1, 1.08, 1] : 1 }}
              transition={{ duration: 0.18 }}
              className={clsx('grid h-[60px] min-w-0 flex-1 place-items-center rounded-xl border bg-card font-display text-[26px] font-bold transition-colors', active ? 'border-ink' : filled ? 'border-ink/30' : 'border-line')}
            >
              {code[i] ?? (active ? <span className="h-6 w-[2px] animate-pulse bg-ink" /> : '')}
            </motion.div>
          )
        })}
        <input
          ref={input}
          autoFocus
          value={code}
          onChange={(e) => onChange(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Verification code"
          className="absolute inset-0 opacity-0"
        />
      </motion.label>

      <div className="mt-4 min-h-[24px]"><ErrorText>{err}</ErrorText></div>
      {devCode && <p className="text-[13px] text-muted">Test mode: the code is {devCode}</p>}

      <div className="mt-6">
        {wait > 0 ? (
          <p className="py-2 text-[15px] tabular-nums text-muted">Resend in 0:{String(wait).padStart(2, '0')}</p>
        ) : (
          <button className="py-2 text-[15px] font-semibold underline decoration-ink/30 underline-offset-4" onClick={resend}>Resend code</button>
        )}
      </div>
    </StepFrame>
  )
}
