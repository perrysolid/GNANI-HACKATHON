import { Languages, PhoneForwarded, Search, ShieldCheck } from 'lucide-react'
import { clsx } from 'clsx'
import { useState } from 'react'
import { api } from '../../lib/api'
import { CITIES, LANGUAGES, langName, langNative } from '../../lib/data'
import { useApp } from '../../lib/store'
import { Choice, ErrorText, Spinner } from '../../components/ui'
import { StepFrame, type StepProps } from '../Onboarding'

function useSave() {
  const setMe = useApp((s) => s.setMe)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async (patch: Parameters<typeof api.updateMe>[0], then: () => void) => {
    setBusy(true); setErr('')
    try { setMe(await api.updateMe(patch)); then() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return { busy, err, save }
}

export { useSave }

type Purpose = 'general' | 'away' | 'family'

const PURPOSES = [
  {
    id: 'general' as const,
    icon: PhoneForwarded,
    title: 'Answer when I can’t pick up',
    sub: 'Directions, where you are, when you’ll be free. You choose what it can say.',
  },
  {
    id: 'away' as const,
    icon: Languages,
    title: 'Callers who speak another language',
    sub: 'Riders, drivers and landlords in a new city get answers in their own language.',
  },
  {
    id: 'family' as const,
    icon: ShieldCheck,
    title: 'Protect my parents from scam calls',
    sub: 'Unknown numbers get screened, and fraud calls get cut.',
  },
]

export function PurposeStep({ draft, update, next }: StepProps) {
  const { busy, err, save } = useSave()
  const toggle = (id: Purpose) =>
    update({ purposes: draft.purposes.includes(id) ? draft.purposes.filter((p) => p !== id) : [...draft.purposes, id] })

  return (
    <StepFrame
      tag="What you need"
      title={`${draft.name.split(' ')[0] ? `Hi ${draft.name.split(' ')[0]}. ` : ''}What should\nHaanji do?`}
      sub="Pick any. You can change this later."
      footer={
        <>
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={!draft.purposes.length || busy} onClick={() => save({ purposes: draft.purposes }, next)}>
            {busy ? <Spinner /> : 'Continue'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {PURPOSES.map(({ id, icon: Icon, title, sub }) => (
          <Choice key={id} selected={draft.purposes.includes(id)} onClick={() => toggle(id)} className="w-full p-5">
            <span className={clsx('grid h-11 w-11 place-items-center rounded-xl transition-colors', draft.purposes.includes(id) ? 'bg-ink text-white' : 'bg-ink/[0.06]')}>
              <Icon className="h-[22px] w-[22px]" />
            </span>
            <p className="mt-4 pr-6 text-[18px] font-semibold leading-snug">{title}</p>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">{sub}</p>
          </Choice>
        ))}
      </div>
    </StepFrame>
  )
}

export function LanguageGrid({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {LANGUAGES.map((l) => (
        <Choice key={l.code} selected={value === l.code} onClick={() => onChange(l.code)} className="px-4 py-3.5">
          <p className="text-[19px] font-semibold leading-tight">{l.native}</p>
          <p className="mt-0.5 text-[13px] text-muted">{l.name}</p>
        </Choice>
      ))}
    </div>
  )
}

export function LanguageStep({ draft, update, next }: StepProps) {
  const { busy, err, save } = useSave()
  return (
    <StepFrame
      tag="Your language"
      title={'Which language\ndo you speak?'}
      sub="Haanji tells you what happened on each call in this language."
      footer={
        <>
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={!draft.myLang || busy} onClick={() => save({ my_language: draft.myLang, name: draft.name || undefined }, next)}>
            {busy ? <Spinner /> : 'Continue'}
          </button>
        </>
      }
    >
      <LanguageGrid value={draft.myLang} onChange={(myLang) => update({ myLang })} />
    </StepFrame>
  )
}

export function CityStep({ draft, update, next }: StepProps) {
  const { busy, err, save } = useSave()
  const [q, setQ] = useState('')
  const [changing, setChanging] = useState(false)
  const matches = CITIES.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
  const custom = q.trim().length > 2 && !CITIES.some((c) => c.name.toLowerCase() === q.trim().toLowerCase())

  const pick = (name: string, lang?: string) => {
    update({ city: name, localLang: lang ?? draft.localLang })
    setQ('')
    setChanging(!lang)
  }

  return (
    <StepFrame
      tag="Where you live"
      title={'Which city are\nyou in now?'}
      sub="So Haanji knows which language your callers speak."
      footer={
        <>
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={!draft.city || !draft.localLang || busy} onClick={() => save({ city: draft.city, local_language: draft.localLang }, next)}>
            {busy ? <Spinner /> : 'Continue'}
          </button>
        </>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input className="field pl-12" placeholder="Search city" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {matches.map((c) => (
          <button
            key={c.name}
            onClick={() => pick(c.name, c.lang)}
            className={clsx('rounded-full border px-4 py-2.5 text-[15px] font-medium transition-colors', draft.city === c.name ? 'border-ink bg-ink text-white' : 'border-line bg-card')}
          >
            {c.name}
          </button>
        ))}
        {custom && (
          <button onClick={() => pick(q.trim())} className="rounded-full border border-dashed border-ink/40 px-4 py-2.5 text-[15px] font-medium">
            Use “{q.trim()}”
          </button>
        )}
      </div>

      {draft.city && (
        <div className="card mt-6 p-5">
          <p className="text-[14px] text-muted">People in {draft.city} mostly speak</p>
          {draft.localLang && !changing ? (
            <div className="mt-1 flex items-end justify-between">
              <p className="font-display text-[28px] font-bold leading-tight">
                {langNative(draft.localLang)} <span className="text-[16px] font-medium text-muted">{langName(draft.localLang)}</span>
              </p>
              <button className="pb-1 text-[14px] font-semibold underline underline-offset-4" onClick={() => setChanging(true)}>Change</button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {LANGUAGES.map((l) => (
                <button key={l.code} onClick={() => { update({ localLang: l.code }); setChanging(false) }} className={clsx('rounded-full border px-3.5 py-2 text-[15px]', draft.localLang === l.code ? 'border-ink bg-ink text-white' : 'border-line')}>
                  {l.native}
                </button>
              ))}
            </div>
          )}
          {draft.localLang && draft.localLang === draft.myLang && !changing && (
            <p className="mt-3 text-[14px] text-muted">Same as yours. Haanji will still pick up when you can’t.</p>
          )}
        </div>
      )}
    </StepFrame>
  )
}
