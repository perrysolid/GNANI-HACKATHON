import { AnimatePresence, motion } from 'framer-motion'
import { Car, Check, Clock, LocateFixed, MapPin, NotebookPen, Package, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Address, type Knowledge, type Profile } from '../lib/api'
import { useApp } from '../lib/store'
import { Backdrop, BackButton, ErrorText, Spinner, Toggle } from '../components/ui'

/* ---------- what can be taught ------------------------------------------------ */

export const TYPES = [
  { id: 'places', label: 'Places', icon: MapPin, subs: [['home', 'Home'], ['work', 'Work'], ['now', 'Right now'], ['other', 'Other']] },
  { id: 'delivery', label: 'Deliveries', icon: Package, subs: [['food', 'Food'], ['grocery', 'Groceries'], ['parcel', 'Parcels']] },
  { id: 'rides', label: 'Rides', icon: Car, subs: [] },
  { id: 'status', label: 'Status', icon: Clock, subs: [] },
  { id: 'notes', label: 'Notes', icon: NotebookPen, subs: [] },
] as const
export type TypeId = (typeof TYPES)[number]['id']

const LEAVE = [['door', 'At the door'], ['guard', 'With security'], ['reception', 'At reception'], ['me', 'Hand it to me'], ['neighbour', 'With a neighbour']]
const PICKUP = [['home', 'Home'], ['work', 'Work'], ['now', 'Where I am'], ['custom', 'Somewhere else']]
const STATES = [['available', 'Free soon'], ['meeting', 'In a meeting'], ['driving', 'Driving'], ['travelling', 'Travelling'], ['sleeping', 'Sleeping'], ['busy', 'Busy']]

/** One-line summary per type, for the Home card. Empty string = nothing taught yet. */
export function summary(t: TypeId, p: Profile): string {
  const k = p.knowledge ?? {}
  const label = (list: string[][], v?: string) => list.find(([id]) => id === v)?.[1] ?? ''
  switch (t) {
    case 'places': {
      const n = [p.address?.house && 'Home', k.places?.work?.address && 'Work', k.places?.now?.address && 'Right now', k.places?.other?.address && (k.places.other.name || 'Other')].filter(Boolean)
      return n.join(' · ')
    }
    case 'delivery': {
      const d = k.delivery ?? {}
      return [d.food?.leave && 'Food', d.grocery?.leave && 'Groceries', d.parcel?.leave && 'Parcels'].filter(Boolean).join(' · ')
    }
    case 'rides': return k.rides?.pickup ? `Pickup: ${k.rides.pickup === 'custom' ? k.rides.custom || 'custom' : label(PICKUP, k.rides.pickup)}` : ''
    case 'status': return k.status?.state ? label(STATES, k.status.state) + (k.status.back_at ? ` till ${k.status.back_at}` : '') : ''
    case 'notes': return k.notes?.say || k.notes?.never ? 'Added' : ''
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
      <nav className="mt-6 grid grid-cols-5 gap-1.5 px-4">
        {TYPES.map(({ id, label, icon: Icon }) => {
          const on = id === type
          const has = !!summary(id, { ...me.profile, knowledge: k, address: addr })
          return (
            <button key={id} onClick={() => setParams({ t: id }, { replace: true })} className={clsx('relative flex flex-col items-center gap-1.5 rounded-2xl py-3 transition-colors', on ? 'bg-ink text-white' : 'text-ink/60 active:bg-ink/5')}>
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

/** Current location: from GPS (reverse-geocoded) or typed. Callers hear it with the time it was shared. */
function RightNow({ value, onChange }: { value?: { label?: string; address?: string; at?: string }; onChange: (v: { label?: string; address?: string; at?: string } | Record<string, never>) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const stamp = () => new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

  const locate = () => {
    if (!navigator.geolocation) { setErr('This browser can’t share location.'); return }
    setBusy(true); setErr('')
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=en&lat=${coords.latitude}&lon=${coords.longitude}`)
        const j = await r.json()
        const a = j.address ?? {}
        const line = [a.amenity || a.building || a.shop, a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road, a.neighbourhood || a.suburb, a.city || a.town || a.county].filter(Boolean).join(', ')
        onChange({ ...value, address: line || j.display_name?.split(',').slice(0, 4).join(',') || '', at: stamp() })
      } catch { setErr('Found you, but couldn’t name the place. Type it below.') }
      setBusy(false)
    }, () => { setErr('Location is off. Allow it in the browser, or type where you are.'); setBusy(false) }, { enableHighAccuracy: true, timeout: 12000 })
  }

  return (
    <>
      <button onClick={locate} disabled={busy} className="flex w-full items-center gap-4 rounded-2xl bg-ink p-4 text-left text-white active:scale-[0.99] transition">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-ink">{busy ? <Spinner /> : <LocateFixed className="h-5 w-5" />}</span>
        <span className="flex-1">
          <span className="block text-[16px] font-semibold">Use my location</span>
          <span className="block text-[13px] text-white/60">{value?.at ? `Updated ${value.at}` : 'Callers hear the place, not coordinates'}</span>
        </span>
      </button>
      {err && <ErrorText>{err}</ErrorText>}
      <label className="block">
        <span className="mb-1.5 block text-[14px] font-medium text-muted">Place</span>
        <input className="field" maxLength={300} value={value?.address ?? ''} placeholder="Third Wave Coffee, 12th Main, Indiranagar" onChange={(e) => onChange({ ...value, address: e.target.value, at: stamp() })} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[14px] font-medium text-muted">How to find me there</span>
        <input className="field" maxLength={300} value={value?.label ?? ''} placeholder="Table by the window, upstairs" onChange={(e) => onChange({ ...value, label: e.target.value })} />
      </label>
      {(value?.address || value?.label) && (
        <button onClick={() => onChange({})} className="flex items-center gap-1.5 text-[14px] font-semibold text-ink/60"><X className="h-4 w-4" /> Clear, I’ve left</button>
      )}
    </>
  )
}

