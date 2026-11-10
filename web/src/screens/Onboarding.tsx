import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, token, type Address } from '../lib/api'
import { useApp } from '../lib/store'
import { Backdrop, BackButton, Progress } from '../components/ui'
import { NameStep, OtpStep, PhoneStep } from './steps/Auth'
import { CityStep, LanguageStep, PurposeStep } from './steps/Basics'
import { AddressStep, PreviewStep } from './steps/Away'
import { ParentLanguageStep, ParentStep, ProtectStep } from './steps/Family'
import { ActivateStep } from './steps/Activate'

export type Draft = {
  name: string
  phone: string
  purposes: ('general' | 'away' | 'family')[]
  myLang: string
  city: string
  localLang: string
  address: Address
  voice: string
  parent: {
    relation: string; name: string; phone: string; language: string
    screen_unknown: boolean; block_scams: boolean; translate: boolean; checkin: boolean; checkin_time: string
  }
}

export type StepProps = {
  draft: Draft
  update: (patch: Partial<Draft>) => void
  next: () => void
}

type StepId = 'name' | 'phone' | 'otp' | 'purpose' | 'language' | 'city' | 'address' | 'preview' | 'parent' | 'parentLang' | 'protect' | 'activate'

const EMPTY: Draft = {
  name: '',
  phone: '',
  purposes: [],
  myLang: '',
  city: '',
  localLang: '',
  address: { house: '', area: '', landmark: '', note: '' },
  voice: 'Shivani',
  parent: { relation: 'Mummy', name: '', phone: '', language: '', screen_unknown: true, block_scams: true, translate: true, checkin: false, checkin_time: '09:00' },
}

export function Onboarding() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const login = params.get('login') === '1'
  const { me, setMe } = useApp()

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [authed, setAuthed] = useState(!!token.get() && !!me)
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState(1)

  // Signed in already (refresh mid-way): prefill from the server and skip auth.
  useEffect(() => {
    if (!me) return
    const p = me.profile
    setDraft((d) => ({
      ...d,
      name: me.name || d.name,
      phone: me.phone,
      purposes: p.purposes ?? d.purposes,
      myLang: p.my_language ?? d.myLang,
      city: p.city ?? d.city,
      localLang: p.local_language ?? d.localLang,
      address: p.address ?? d.address,
      voice: p.voice ?? d.voice,
    }))
    setAuthed(true)
  }, [me])

  const steps = useMemo<StepId[]>(() => {
    const s: StepId[] = authed ? [] : login ? ['phone', 'otp'] : ['name', 'phone', 'otp']
    s.push('purpose', 'language')
    if (draft.purposes.includes('away') || draft.purposes.includes('general')) s.push('city', 'address', 'preview')
    if (draft.purposes.includes('family') && !me?.family.length) s.push('parent', 'parentLang', 'protect')
    s.push('activate')
    return s
  }, [authed, login, draft.purposes, me?.family.length])

  const step = steps[Math.min(index, steps.length - 1)]
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const next = () => { setDir(1); setIndex((i) => Math.min(i + 1, steps.length - 1)) }
  const back = () => {
    if (index === 0 || step === 'purpose') { nav('/'); return }
    setDir(-1); setIndex((i) => i - 1)
  }

  // After OTP: returning users who finished setup go straight home.
  const onSignedIn = async (onboarded: boolean) => {
    const fresh = await api.me()
    setMe(fresh)
    if (onboarded) { nav('/home', { replace: true }); return }
    setAuthed(true)
    setDir(1)
    setIndex(0) // steps list shrinks to start at 'purpose'
  }

  const props: StepProps = { draft, update, next }
  const screens: Record<StepId, ReactNode> = {
    name: <NameStep {...props} />,
    phone: <PhoneStep {...props} />,
    otp: <OtpStep {...props} onSignedIn={onSignedIn} />,
    purpose: <PurposeStep {...props} />,
    language: <LanguageStep {...props} />,
    city: <CityStep {...props} />,
    address: <AddressStep {...props} />,
    preview: <PreviewStep {...props} />,
    parent: <ParentStep {...props} />,
    parentLang: <ParentLanguageStep {...props} />,
    protect: <ProtectStep {...props} />,
    activate: <ActivateStep {...props} />,
  }

  return (
    <div className="app">
      <Backdrop />
      <header className="flex items-center gap-3 px-4 pt-3">
        <BackButton onClick={back} />
        <div className="flex-1 pr-3">
          <Progress value={(index + 1) / steps.length} />
        </div>
      </header>
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d * 36, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d * -36, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-1 flex-col"
          >
            {screens[step]}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Shared layout for one onboarding question. */
export function StepFrame({ tag, title, sub, children, footer }: { tag: string; title: ReactNode; sub?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-6">
        <p className="tag">{tag}</p>
        <h1 className="title mt-3 whitespace-pre-line">{title}</h1>
        {sub && <p className="mt-3 text-[16px] leading-relaxed text-muted">{sub}</p>}
        <div className="mt-8">{children}</div>
      </div>
      {footer && <div className="space-y-2 px-6 pt-3 bottom-safe">{footer}</div>}
    </>
  )
}
