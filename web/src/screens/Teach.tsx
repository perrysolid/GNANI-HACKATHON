import { AnimatePresence, motion } from 'framer-motion'
import { Briefcase, Car, Check, Clock, LocateFixed, MapPin, NotebookPen, Package } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Address, type Knowledge, type LiveLocation, type Profession, type Profile } from '../lib/api'
import { useApp } from '../lib/store'
import { Backdrop, BackButton, ErrorText, Spinner, Toggle } from '../components/ui'

/* ---------- what can be taught ------------------------------------------------ */

export const TYPES = [
  { id: 'places', label: 'Places', icon: MapPin, subs: [['home', 'Home'], ['work', 'Work'], ['now', 'Current'], ['other', 'Other']] },
  { id: 'business', label: 'Business', icon: Briefcase, subs: [] },
  { id: 'delivery', label: 'Deliveries', icon: Package, subs: [['food', 'Food'], ['grocery', 'Groceries'], ['parcel', 'Parcels']] },
  { id: 'rides', label: 'Rides', icon: Car, subs: [] },
  { id: 'status', label: 'Status', icon: Clock, subs: [] },
  { id: 'notes', label: 'Notes', icon: NotebookPen, subs: [] },
] as const
export type TypeId = (typeof TYPES)[number]['id']

const LEAVE = [['door', 'At the door'], ['guard', 'With security'], ['reception', 'At reception'], ['me', 'Hand it to me'], ['neighbour', 'With a neighbour']]
const PICKUP = [['home', 'Home'], ['work', 'Work'], ['now', 'Where I am'], ['custom', 'Somewhere else']]
const STATES = [['available', 'Free soon'], ['meeting', 'In a meeting'], ['driving', 'Driving'], ['travelling', 'Travelling'], ['sleeping', 'Sleeping'], ['busy', 'Busy']]

const PROF_LABEL: Record<string, string> = { clinic: 'Clinic', shop: 'Shop', tutor: 'Classes', services: 'Home services', salon: 'Salon', food: 'Food', other: 'Work' }

let professions: Promise<Profession[]> | null = null
const loadProfessions = () => (professions ??= api.catalog().then((c) => c.professions))

/** One-line summary per type, for the Home card. Empty string = nothing taught yet. */
export function summary(t: TypeId, p: Profile): string {
  const k = p.knowledge ?? {}
  const label = (list: string[][], v?: string) => list.find(([id]) => id === v)?.[1] ?? ''
  switch (t) {
    case 'places': {
      const n = [p.address?.house && 'Home', k.places?.work?.address && 'Work', (p.live?.at || k.places?.now?.address) && 'Current location', k.places?.other?.address && (k.places.other.name || 'Other')].filter(Boolean)
      return n.join(' · ')
    }
    case 'delivery': {
      const d = k.delivery ?? {}
      return [d.food?.leave && 'Food', d.grocery?.leave && 'Groceries', d.parcel?.leave && 'Parcels'].filter(Boolean).join(' · ')
    }
    case 'rides': return k.rides?.pickup ? `Pickup: ${k.rides.pickup === 'custom' ? k.rides.custom || 'custom' : label(PICKUP, k.rides.pickup)}` : ''
    case 'status': return k.status?.state ? label(STATES, k.status.state) + (k.status.back_at ? ` till ${k.status.back_at}` : '') : ''
    case 'notes': return k.notes?.say || k.notes?.never ? 'Added' : ''
    case 'business': return k.business?.kind ? (k.business.name || PROF_LABEL[k.business.kind] || 'Added') : ''
  }
}

/* ---------- screen ------------------------------------------------------------- */

const EMPTY_ADDR: Address = { house: '', area: '', landmark: '', note: '' }

export function Teach() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const { me, setMe } = useApp()
  const type = (TYPES.find((t) => t.id === params.get('t'))?.id ?? 'places') as TypeId
  const def = TYPES.find((t) => t.id === type)!
  const [sub, setSub] = useState<string>(def.subs[0]?.[0] ?? '')
  const [k, setK] = useState<Knowledge>(me?.profile.knowledge ?? {})
  const [addr, setAddr] = useState<Address>({ ...EMPTY_ADDR, ...me?.profile.address })
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [err, setErr] = useState('')
  const timer = useRef<number>()
  const dirty = useRef(false)

  useEffect(() => { setSub(def.subs[0]?.[0] ?? '') }, [type]) // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave, debounced. The latest state always wins.
  useEffect(() => {
    if (!dirty.current) return
    window.clearTimeout(timer.current)
    setSave('saving')
    timer.current = window.setTimeout(async () => {
      try {
        setMe(await api.updateMe({ knowledge: k, address: addr }))
        setSave('saved'); setErr('')
      } catch (e: any) { setSave('error'); setErr(e.message) }
    }, 650)
    return () => window.clearTimeout(timer.current)
  }, [k, addr]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Set a nested value: set('delivery.food.leave', 'guard') */
  const set = (path: string, value: unknown) => {
    dirty.current = true
    setK((prev) => {
      const next: any = structuredClone(prev)
      const keys = path.split('.')
      let o = next
      keys.slice(0, -1).forEach((key) => { o[key] = o[key] ?? {}; o = o[key] })
      o[keys[keys.length - 1]] = value
      return next
    })
  }
  const get = (path: string): any => path.split('.').reduce<any>((o, key) => o?.[key], k)
  const setA = (patch: Partial<Address>) => { dirty.current = true; setAddr((a) => ({ ...a, ...patch })) }

  if (!me) return null

  return (
    <div className="app">
      <Backdrop />
      <header className="flex items-center justify-between px-4 pt-3">
        <BackButton onClick={() => nav(-1)} />
        <SaveState state={save} />
      </header>

      <div className="px-6 pt-3">
        <h1 className="title">Teach Haanji</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">What it may tell callers. It won’t share anything you haven’t added here.</p>
      </div>

      {/* types */}
      <nav className="no-scrollbar mt-6 flex gap-1.5 overflow-x-auto px-4">
        {TYPES.map(({ id, label, icon: Icon }) => {
          const on = id === type
          const has = !!summary(id, { ...me.profile, knowledge: k, address: addr })
          return (
            <button key={id} onClick={() => setParams({ t: id }, { replace: true })} className={clsx('relative flex w-[74px] shrink-0 flex-col items-center gap-1.5 rounded-2xl py-3 transition-colors', on ? 'bg-ink text-white' : 'text-ink/60 active:bg-ink/5')}>
              <Icon className="h-[20px] w-[20px]" strokeWidth={on ? 2.3 : 2} />
              <span className="text-[11.5px] font-semibold">{label}</span>
              {has && !on && <span className="absolute right-2.5 top-2 h-1.5 w-1.5 rounded-[2px] bg-ink" />}
            </button>
          )
        })}
      </nav>

      {/* subtypes */}
      {def.subs.length > 0 && (
        <div className="mt-5 flex gap-5 border-b border-line px-6">
          {def.subs.map(([id, label]) => (
            <button key={id} onClick={() => setSub(id)} className={clsx('relative pb-3 text-[15px] font-semibold transition-colors', sub === id ? 'text-ink' : 'text-ink/40')}>
              {label}
              {sub === id && <motion.span layoutId="sub" className="absolute inset-x-0 -bottom-px h-[2px] bg-ink" />}
            </button>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.section key={type + sub} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="flex-1 space-y-5 px-6 pb-16 pt-6">
          {type === 'places' && sub === 'home' && (
            <>
              <Field label="Flat, floor, building" value={addr.house} onChange={(v) => setA({ house: v })} placeholder="302, 3rd floor, Sai Residency" />
              <Field label="Street and area" value={addr.area} onChange={(v) => setA({ area: v })} placeholder="4th Cross, HSR Layout Sector 2" />
              <Field label="Landmark" value={addr.landmark} onChange={(v) => setA({ landmark: v })} placeholder="Opposite the Shani temple, blue gate" />
              <Field label="Anything a rider should know" value={addr.note} onChange={(v) => setA({ note: v })} placeholder="Lift is off after 10 pm, take the stairs" />
            </>
          )}
          {type === 'places' && (sub === 'work' || sub === 'other') && (
            <>
              {sub === 'other' && <Field label="What is it" value={get('places.other.name')} onChange={(v) => set('places.other.name', v)} placeholder="Gym, PG, parents’ home" />}
              <Field label="Address" value={get(`places.${sub}.address`)} onChange={(v) => set(`places.${sub}.address`, v)} placeholder={sub === 'work' ? 'Embassy Tech Village, Block C' : 'Address'} />
              <Field label="Landmark" value={get(`places.${sub}.landmark`)} onChange={(v) => set(`places.${sub}.landmark`, v)} placeholder="Gate 3, next to the food court" />
              <Field label="Note" value={get(`places.${sub}.note`)} onChange={(v) => set(`places.${sub}.note`, v)} placeholder="Ask for me at reception" />
            </>
          )}
          {type === 'places' && sub === 'now' && <RightNow value={k.places?.now} onChange={(v) => set('places.now', v)} />}

          {type === 'delivery' && sub && (
            <>
              <Chips label="Where should they leave it" options={LEAVE} value={get(`delivery.${sub}.leave`)} onChange={(v) => set(`delivery.${sub}.leave`, v)} />
              <div className="border-y border-line">
                <Toggle on={!!get(`delivery.${sub}.call_first`)} onChange={(v) => set(`delivery.${sub}.call_first`, v)} label="Call me before reaching" hint="Haanji tells the rider to ring you" />
              </div>
              <Field label="Note for the rider" value={get(`delivery.${sub}.note`)} onChange={(v) => set(`delivery.${sub}.note`, v)} placeholder={sub === 'parcel' ? 'Cash on delivery is fine' : 'Don’t ring the bell, the baby is asleep'} />
            </>
          )}

          {type === 'rides' && (
            <>
              <Chips label="Usual pickup" options={PICKUP} value={k.rides?.pickup} onChange={(v) => set('rides.pickup', v)} />
              {k.rides?.pickup === 'custom' && <Field label="Pickup point" value={k.rides?.custom} onChange={(v) => set('rides.custom', v)} placeholder="Metro station, exit B" />}
              <Field label="How the driver spots you" value={k.rides?.identify} onChange={(v) => set('rides.identify', v)} placeholder="Grey hoodie, standing by the ATM" />
              <Field label="Note for the driver" value={k.rides?.note} onChange={(v) => set('rides.note', v)} placeholder="Two bags, need the boot" />
            </>
          )}

          {type === 'status' && (
            <>
              <Chips label="Right now I’m" options={STATES} value={k.status?.state} onChange={(v) => set('status.state', v)} />
              <Field label="Free after" value={k.status?.back_at} onChange={(v) => set('status.back_at', v)} placeholder="6 pm" />
              <Field area label="Message for callers" value={k.status?.message} onChange={(v) => set('status.message', v)} placeholder="Text me if it’s urgent" />
            </>
          )}

          {type === 'business' && <Business value={k.business} set={set} />}

          {type === 'notes' && (
            <>
              <Field area label="Haanji may tell callers" value={k.notes?.say} onChange={(v) => set('notes.say', v)} placeholder="My office closes at 7. The landlord can come on Sunday." />
              <Field area label="Never tell anyone" value={k.notes?.never} onChange={(v) => set('notes.never', v)} placeholder="That I live alone. When I’m travelling." />
            </>
          )}
          <ErrorText>{err}</ErrorText>
        </motion.section>
      </AnimatePresence>
    </div>
  )
}

/* ---------- pieces ------------------------------------------------------------- */

function Business({ value, set }: { value?: Knowledge['business']; set: (path: string, v: unknown) => void }) {
  const [list, setList] = useState<Profession[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { loadProfessions().then(setList).catch((e) => setErr(e.message)) }, [])
  const prof = list?.find((p) => p.id === value?.kind)
  if (err) return <ErrorText>{err}</ErrorText>
  if (!list) return <div className="flex justify-center py-10 text-muted"><Spinner /></div>
  return (
    <>
      <Chips label="What do you do" options={list.map((p) => [p.id, p.label])} value={value?.kind}
        onChange={(v) => set('business', v ? { kind: v, name: value?.name ?? '', answers: value?.kind === v ? value.answers ?? {} : {} } : {})} />
      {prof && (
        <motion.div key={prof.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <p className="rounded-2xl bg-ink/[0.04] px-4 py-3 text-[14px] leading-relaxed text-ink/70">
            Callers asking about your {prof.label.toLowerCase()} get these answers. Bookings come to you as call notes.
          </p>
          <Field label="Name" value={value?.name} onChange={(v) => set('business.name', v)} placeholder={prof.id === 'clinic' ? 'Sharma Clinic' : 'Name people know it by'} />
          {prof.questions.map((q) => (
            <Field key={q.id} area label={q.text} value={value?.answers?.[q.id]} onChange={(v) => set(`business.answers.${q.id}`, v)} />
          ))}
        </motion.div>
      )}
    </>
  )
}

function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  return (
    <AnimatePresence mode="wait">
      {state !== 'idle' && (
        <motion.span key={state} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 pr-2 text-[13px] font-medium text-muted">
          {state === 'saving' ? <><Spinner className="h-3.5 w-3.5" /> Saving</> : state === 'saved' ? <><Check className="h-3.5 w-3.5" /> Saved</> : 'Not saved'}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

function Field({ label, value, onChange, placeholder, area }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; area?: boolean }) {
  const cls = 'field'
  return (
    <label className="block">
      <span className="mb-1.5 block text-[14px] font-medium text-muted">{label}</span>
      {area ? (
        <textarea rows={3} maxLength={300} className={clsx(cls, 'resize-none leading-snug')} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input maxLength={300} className={cls} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  )
}

function Chips({ label, options, value, onChange }: { label: string; options: string[][]; value?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-[14px] font-medium text-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(([id, text]) => (
          <motion.button whileTap={{ scale: 0.95 }} key={id} onClick={() => onChange(value === id ? '' : id)} className={clsx('rounded-xl border px-3.5 py-2.5 text-[15px] font-medium transition-colors', value === id ? 'border-ink bg-ink text-white' : 'border-line bg-card')}>
            {text}
          </motion.button>
        ))}
      </div>
    </div>
  )
}

/** Current location: one tap takes a GPS fix; orders and rides are guided there by nearby landmarks. */
function RightNow({ value, onChange }: { value?: { label?: string; address?: string; at?: string }; onChange: (v: { label?: string; address?: string; at?: string }) => void }) {
  const me = useApp((s) => s.me)
  const [loc, setLoc] = useState<LiveLocation | null>(me?.profile.live ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const time = loc?.at ? new Date(loc.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''

  const take = () => {
    if (!navigator.geolocation) { setErr('This browser can’t share location.'); return }
    setBusy(true); setErr('')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try { setLoc(await api.shareLocation(coords.latitude, coords.longitude, coords.accuracy)) }
        catch (e: any) { setErr(e.message) } finally { setBusy(false) }
      },
      (e) => { setBusy(false); setErr(e.code === e.PERMISSION_DENIED ? 'Location is blocked. Allow it for this site in your browser settings.' : 'Can’t get your location right now. Try again outside or near a window.') },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    )
  }
  const clear = async () => { setLoc(null); await api.stopLocation().catch(() => {}) }

  return (
    <>
      <div className="overflow-hidden rounded-3xl bg-ink text-white">
        <div className="flex items-center gap-4 p-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-ink"><LocateFixed className="h-5 w-5" /></span>
          <div className="flex-1">
            <p className="text-[16px] font-semibold">{loc ? 'Your current location' : 'Use my current location'}</p>
            <p className="text-[13px] text-white/60">{loc ? `Shared at ${time}. Orders and rides come here.` : 'For an order or a ride to where you are now'}</p>
          </div>
        </div>
        {loc?.place && (
          <div className="border-t border-white/10 px-5 py-4">
            <p className="text-[15px] font-medium">{loc.place}</p>
            {loc.near.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {loc.near.slice(0, 4).map((l) => (
                  <li key={l.name} className="flex items-baseline gap-2 text-[13px] text-white/70">
                    <span className="h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-[2px] bg-accent" />
                    <span className="flex-1 truncate">{l.name}</span>
                    <span className="tabular-nums text-white/45">{l.m} m {l.dir}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex gap-2 px-5 pb-5">
          <motion.button whileTap={{ scale: 0.97 }} onClick={take} disabled={busy} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent text-[15px] font-semibold text-ink disabled:opacity-60">
            {busy ? <Spinner /> : loc ? 'Update location' : 'Use my current location'}
          </motion.button>
          {loc && <button onClick={clear} className="h-12 rounded-2xl bg-white/10 px-4 text-[15px] font-semibold">Remove</button>}
        </div>
      </div>
      {err && <ErrorText>{err}</ErrorText>}
      {loc && <p className="text-[13px] leading-relaxed text-muted">Haanji uses it for 12 hours, then goes back to your home address.</p>}

      <label className="block">
        <span className="mb-1.5 block text-[14px] font-medium text-muted">Extra instructions (optional)</span>
        <input className="field" maxLength={300} value={value?.label ?? ''} placeholder="Upstairs, table by the window" onChange={(e) => onChange({ ...value, label: e.target.value })} />
      </label>
      {!loc && (
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-medium text-muted">Or type where you are</span>
          <input className="field" maxLength={300} value={value?.address ?? ''} placeholder="Third Wave Coffee, 12th Main, Indiranagar"
            onChange={(e) => onChange({ ...value, address: e.target.value, at: new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) })} />
        </label>
      )}
    </>
  )
}
