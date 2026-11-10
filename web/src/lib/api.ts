const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000'

const TOKEN_KEY = 'haanji.token'

export const token = {
  get(): string | null {
    try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
  },
  set(v: string | null) {
    try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
  },
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

function messageFrom(body: any, status: number): string {
  const d = body?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, '')
  if (status >= 500) return 'Something went wrong on our side. Try again.'
  return 'That didn’t work. Try again.'
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const t = token.get()
  if (t) headers.set('Authorization', `Bearer ${t}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers })
  } catch {
    throw new ApiError('No connection. Check your internet.', 0)
  }
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (!res.ok) {
    if (res.status === 401) token.set(null)
    throw new ApiError(messageFrom(body, res.status), res.status)
  }
  return body as T
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export type Lang = string
export type Address = { house: string; area: string; landmark: string; note: string }
export type Place = { name?: string; address?: string; landmark?: string; note?: string }
export type Drop = { leave?: string; call_first?: boolean; note?: string }
export type Knowledge = {
  places?: { work?: Place; other?: Place; now?: { label?: string; address?: string; at?: string } }
  delivery?: { food?: Drop; grocery?: Drop; parcel?: Drop }
  rides?: { pickup?: string; custom?: string; identify?: string; note?: string }
  status?: { state?: string; back_at?: string; message?: string }
  notes?: { say?: string; never?: string }
}
export type Profile = {
  purposes?: ('general' | 'away' | 'family')[]
  my_language?: Lang
  city?: string
  local_language?: Lang
  address?: Address
  voice?: string
  knowledge?: Knowledge
}
export type FamilyMember = {
  id: number; relation: string; name: string; phone: string; language: Lang
  screen_unknown: boolean; block_scams: boolean; translate: boolean; checkin: boolean; checkin_time: string
}
export type Me = { id: number; name: string; phone: string; onboarded: boolean; profile: Profile; family: FamilyMember[] }
export type CallRow = {
  id: number; direction: 'in' | 'out'; kind: string; counterpart: string; language: Lang
  verdict: string; summary: string; created_at: string
}
export type ShieldResult = {
  text: string; heard_language: string; level: 'scam' | 'suspicious' | 'no_signs'
  signals: { category: string; phrase: string }[]; model_note: string
}

export const api = {
  config: () => request<{ haanji_number: string; otp_dev_mode: boolean }>('/api/auth/config'),
  sendCode: (phone: string, channel: 'sms' | 'voice') =>
    request<{ session_id: string; dev_code: string | null }>('/api/auth/send', json('POST', { phone, channel })),
  verifyCode: (session_id: string, code: string, name: string) =>
    request<{ token: string; onboarded: boolean; name: string }>('/api/auth/verify', json('POST', { session_id, code, name })),
  me: () => request<Me>('/api/me'),
  updateMe: (patch: Partial<Profile> & { name?: string; onboarded?: boolean }) => request<Me>('/api/me', json('PATCH', patch)),
  addFamily: (f: Omit<FamilyMember, 'id'>) => request<FamilyMember>('/api/family', json('POST', f)),
  updateFamily: (id: number, f: Omit<FamilyMember, 'id'>) => request<FamilyMember>(`/api/family/${id}`, json('PATCH', f)),
  removeFamily: (id: number) => request<{ ok: true }>(`/api/family/${id}`, json('DELETE')),
  calls: () => request<CallRow[]>('/api/calls'),
  transcribe: (wav: Blob) => {
    const fd = new FormData(); fd.append('audio', wav, 'speech.wav')
    return request<{ transcript: string; language: Lang }>('/api/voice/transcribe', { method: 'POST', body: fd })
  },
  addressPreview: () =>
    request<{ text: string; language: Lang; mode: string; audio: string }>('/api/voice/address-preview', json('POST')),
  shieldCheck: (input: { text?: string; audio?: Blob }) => {
    const fd = new FormData()
    if (input.audio) fd.append('audio', input.audio, 'call.wav')
    else fd.append('text', input.text || '')
    return request<ShieldResult>('/api/shield/check', { method: 'POST', body: fd })
  },
}
