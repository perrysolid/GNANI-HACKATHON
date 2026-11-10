/**
 * Live location: while sharing is on and the app is open, send the position when it
 * moves ~25 m, or every 2 minutes when still. Browsers pause this when the app is closed.
 */
import { create } from 'zustand'
import { api, type LiveLocation } from './api'

const KEY = 'haanji.live'
const MIN_MOVE_M = 25
const HEARTBEAT_MS = 120_000

const meters = (a: GeolocationCoordinates, b: { lat: number; lng: number }) => {
  const r = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.latitude), dLng = toRad(b.lng - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(h))
}

type State = {
  on: boolean
  last: LiveLocation | null
  error: string
  start: () => void
  stop: () => Promise<void>
}

let watchId: number | null = null
let sent: { lat: number; lng: number; t: number } | null = null
let inFlight = false

export const useLive = create<State>((set, get) => ({
  on: (() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })(),
  last: null,
  error: '',
  start() {
    if (!navigator.geolocation) { set({ error: 'This browser can’t share location.' }); return }
    try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
    set({ on: true, error: '' })
    if (watchId !== null) return
    watchId = navigator.geolocation.watchPosition(
      async ({ coords }) => {
        const due = !sent || meters(coords, sent) > MIN_MOVE_M || Date.now() - sent.t > HEARTBEAT_MS
        if (!due || inFlight || !get().on) return
        inFlight = true
        try {
          const last = await api.shareLocation(coords.latitude, coords.longitude, coords.accuracy)
          sent = { lat: coords.latitude, lng: coords.longitude, t: Date.now() }
          set({ last, error: '' })
        } catch (e: any) { set({ error: e.message }) } finally { inFlight = false }
      },
      (e) => set({ error: e.code === e.PERMISSION_DENIED ? 'Location is blocked. Allow it for this site in your browser settings.' : 'Can’t get your location right now.' }),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    )
  },
  async stop() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId)
    watchId = null; sent = null
    try { localStorage.removeItem(KEY) } catch { /* private mode */ }
    set({ on: false, last: null })
    await api.stopLocation().catch(() => {})
  },
}))
