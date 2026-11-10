import { create } from 'zustand'
import { api, token, type Me } from './api'

type State = {
  me: Me | null
  loading: boolean
  haanjiNumber: string
  load: () => Promise<Me | null>
  setMe: (me: Me) => void
  signOut: () => void
}

export const useApp = create<State>((set) => ({
  me: null,
  loading: true,
  haanjiNumber: '',
  async load() {
    api.config().then((c) => set({ haanjiNumber: c.haanji_number })).catch(() => {})
    if (!token.get()) { set({ loading: false }); return null }
    try {
      const me = await api.me()
      set({ me, loading: false })
      return me
    } catch {
      set({ me: null, loading: false })
      return null
    }
  },
  setMe: (me) => set({ me }),
  signOut() {
    token.set(null)
    set({ me: null })
  },
}))
