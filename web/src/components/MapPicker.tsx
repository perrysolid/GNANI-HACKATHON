/**
 * Pick a spot on a Google map: search a place, jump to where you are, then drag the map so
 * the pin sits on your gate. Returns the point, a short street address and the place name.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { LocateFixed, MapPin, Search, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/store'
import { Spinner } from './ui'

export type Picked = { lat: number; lng: number; address: string; label: string }
type Suggestion = { id: string; main: string; rest: string; pred: any }

const BENGALURU = { lat: 12.9716, lng: 77.5946 }
let loading: Promise<any> | null = null

/** Google Maps JS, loaded once. */
function loadMaps(key: string): Promise<any> {
  const w = window as any
  if (w.google?.maps?.Map) return Promise.resolve(w.google.maps)
  loading ??= new Promise((resolve, reject) => {
    w.__haanjiMaps = () => resolve(w.google.maps)
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places&loading=async&region=IN&language=en&callback=__haanjiMaps`
    s.async = true
    s.onerror = () => { loading = null; reject(new Error('Couldn’t load the map')) }
    document.head.appendChild(s)
  })
  return loading
}

/** "1024, 24th Main Rd, HSR Layout, Bengaluru, Karnataka 560102, India" -> without state, PIN and country. */
export function shortAddress(full: string) {
  const parts = full.split(',').map((p) => p.trim())
  return parts.filter((p, i) => i === 0 || (p !== parts[i - 1] && p !== 'India' && !/\d{6}$/.test(p))).join(', ')
}

function gps(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser can’t share location.'))
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location is blocked. Allow it for this site in your browser settings.' : 'Can’t get your location right now.')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
  })
}

export function MapPicker({ open, title, start, locate, onClose, onPick }: {
  open: boolean
  title: string
  start?: { lat: number; lng: number }
  locate?: boolean // start from the phone's GPS
  onClose: () => void
  onPick: (p: Picked) => void | Promise<void>
}) {
  const key = useApp((s) => s.mapsKey)
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<any>(null)
  const maps = useRef<any>(null)
  const token = useRef<any>(null)
  const [moving, setMoving] = useState(false)
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [finding, setFinding] = useState(false)
  const [locating, setLocating] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Suggestion[]>([])
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const skipSearch = useRef(false)

  const goToMe = async () => {
    setLocating(true); setErr('')
    try {
      const p = await gps()
      map.current?.panTo(p); map.current?.setZoom(18)
    } catch (e: any) { setErr(e.message) }
    setLocating(false)
  }

  useEffect(() => {
    if (!open) return
    setQ(''); setResults([]); setErr(''); setLabel(''); setAddress('')
    if (!key) { setErr('The map isn’t set up yet.'); return }
    let gone = false
    loadMaps(key).then((g) => {
      if (gone || !el.current) return
      maps.current = g
      const m = new g.Map(el.current, {
        center: start ?? BENGALURU, zoom: start ? 18 : 12, disableDefaultUI: true, clickableIcons: false,
        gestureHandling: 'greedy', keyboardShortcuts: false,
      })
      map.current = m
      const geocoder = new g.Geocoder()
      m.addListener('dragstart', () => { setMoving(true); setResults([]); setLabel('') })
      m.addListener('idle', () => {
        setMoving(false)
        const c = m.getCenter()
        if (!c || m.getZoom() < 14) { setAddress(''); return }
        setFinding(true)
        geocoder.geocode({ location: c }).then((r: any) => {
          const best = r.results.find((x: any) => !x.types.includes('plus_code')) ?? r.results[0]
          setAddress(best ? shortAddress(best.formatted_address) : '')
        }).catch(() => setAddress('')).finally(() => setFinding(false))
      })
      if (locate && !start) goToMe()
    }).catch((e) => setErr(e.message))
    return () => { gone = true; map.current = null }
  }, [open, key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Place search, debounced.
  useEffect(() => {
    const g = maps.current
    if (skipSearch.current) { skipSearch.current = false; return }
    if (!g || q.trim().length < 2) { setResults([]); return }
    const t = window.setTimeout(async () => {
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } = await g.importLibrary('places')
        token.current ??= new AutocompleteSessionToken()
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q, sessionToken: token.current, includedRegionCodes: ['in'],
          locationBias: map.current?.getCenter() ?? BENGALURU, language: 'en',
        })
        setResults(suggestions.filter((s: any) => s.placePrediction).slice(0, 5).map((s: any) => ({
          id: s.placePrediction.placeId, main: s.placePrediction.mainText?.text ?? s.placePrediction.text.text,
          rest: s.placePrediction.secondaryText?.text ?? '', pred: s.placePrediction,
        })))
      } catch { setResults([]) }
    }, 250)
    return () => window.clearTimeout(t)
  }, [q])

  const choose = async (s: Suggestion) => {
    skipSearch.current = true
    setResults([]); setQ(s.main); (document.activeElement as HTMLElement)?.blur()
    try {
      const place = s.pred.toPlace()
      await place.fetchFields({ fields: ['location', 'displayName'] })
      token.current = null
      setLabel(place.displayName ?? s.main)
      map.current?.panTo(place.location); map.current?.setZoom(18)
    } catch { setErr('Couldn’t open that place.') }
  }

  const confirm = async () => {
    const c = map.current?.getCenter()
    if (!c) return
    setSaving(true)
    try { await onPick({ lat: c.lat(), lng: c.lng(), address, label }); onClose() }
    catch (e: any) { setErr(e.message || 'Couldn’t save') }
    setSaving(false)
  }
  const ready = !!address && !moving && !finding

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          className="fixed inset-y-0 left-0 right-0 z-50 mx-auto flex w-full max-w-[440px] flex-col bg-paper" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <header className="flex items-center gap-2 px-4 pb-3 pt-3">
            <button onClick={onClose} aria-label="Close" className="-ml-1 grid h-11 w-11 place-items-center rounded-full active:bg-ink/5"><X className="h-[22px] w-[22px]" /></button>
            <p className="text-[17px] font-semibold">{title}</p>
          </header>

          <div className="relative z-10 px-4 pb-3">
            <label className="flex items-center gap-2.5 rounded-2xl border border-line bg-card px-4 focus-within:border-ink">
              <Search className="h-[18px] w-[18px] shrink-0 text-ink/40" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a building, shop or area" className="h-12 w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-ink/30" />
              {q && <button onClick={() => { setQ(''); setResults([]) }} aria-label="Clear"><X className="h-4 w-4 text-ink/40" /></button>}
            </label>
            {results.length > 0 && (
              <ul className="absolute inset-x-4 top-[calc(100%-4px)] overflow-hidden rounded-2xl border border-line bg-card shadow-[0_20px_40px_-20px_rgba(0,0,0,0.3)]">
                {results.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => choose(r)} className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-ink/[0.04]">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" />
                      <span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{r.main}</span><span className="block truncate text-[13px] text-muted">{r.rest}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="relative flex-1 overflow-hidden border-y border-line bg-ink/[0.04]">
            <div ref={el} className="absolute inset-0" />
            {/* The pin stays in the middle; the map moves under it. */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
              <motion.div animate={{ y: moving ? -12 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 28 }} className="flex flex-col items-center">
                <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-ink shadow-lg"><span className="h-3 w-3 rounded-[3px] bg-accent" /></span>
                <span className="h-3 w-[3px] rounded-b bg-ink" />
              </motion.div>
            </div>
            <motion.span animate={{ scale: moving ? 0.6 : 1, opacity: moving ? 0.25 : 0.4 }} className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-4 -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-ink" />
            <button onClick={goToMe} disabled={locating} aria-label="Go to my location" className="absolute bottom-4 right-4 flex h-12 items-center gap-2 rounded-2xl bg-card px-4 text-[14px] font-semibold shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)] active:scale-[0.97] transition">
              {locating ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-[18px] w-[18px]" />} My location
            </button>
          </div>

          <footer className="space-y-3 px-5 pt-4 bottom-safe">
            <div className="min-h-[52px]">
              <p className="tag">Pin is at</p>
              <p className={clsx('mt-1 text-[16px] font-semibold leading-snug', !ready && 'text-ink/35')}>
                {label && <span>{label} · </span>}
                {moving ? 'Moving…' : finding ? 'Finding the address…' : address || 'Move the map to put the pin on your gate'}
              </p>
            </div>
            {err && <p className="text-[14px] font-medium">{err}</p>}
            <button className="btn" disabled={!ready || saving} onClick={confirm}>{saving ? <Spinner /> : 'Confirm this spot'}</button>
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
