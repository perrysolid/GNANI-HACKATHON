/**
 * Browser side of a live Haanji call.
 * - Mic: captured, downsampled to 16 kHz PCM16, sent in 1024-byte frames (Gnani's frame size).
 * - Haanji's voice: 16 kHz PCM16 chunks, each prefixed with a 1-byte turn id, played back gaplessly.
 * - Barge-in: when the server says the caller started speaking and the mic really is loud
 *   (not Haanji's own echo), playback stops at once and the server cancels the reply.
 */
import { token } from './api'

const RATE = 16000
const FRAME_BYTES = 1024
const BARGE_LEVEL = 0.02

export type LiveEvent =
  | { type: 'ready'; language: string; speaking_for: string }
  | { type: 'speech_start' }
  | { type: 'thinking' }
  | { type: 'heard'; text: string; language: string }
  | { type: 'reply_start'; turn: number; language: string }
  | { type: 'reply_text'; turn: number; text: string }
  | { type: 'reply_end'; turn: number }
  | { type: 'interrupted' }
  | { type: 'shield'; level: string }
  | { type: 'summary'; text: string }
  | { type: 'ended'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'verdict'; level: 'scam' | 'suspicious' | 'no_signs'; signals: { category: string; phrase: string }[]; note: string }
  | { type: 'alarm'; language: string; text: string }

export function wsUrl(path: string) {
  const base = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000'
  return base.replace(/^http/, 'ws') + path
}

/** Mic as 16 kHz PCM16 in Gnani-sized frames. Echo cancellation keeps played-back audio out. */
export async function openMic(onFrame: (frame: ArrayBuffer) => void, onLevel: (level: number) => void = () => {}) {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const ctx = new AudioContext()
  await ctx.resume()
  const src = ctx.createMediaStreamSource(mic)
  const proc = ctx.createScriptProcessor(2048, 1, 1)
  const ratio = ctx.sampleRate / RATE
  const per = FRAME_BYTES / 2
  let pending = new Int16Array(0)
  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    let sum = 0
    const out = new Int16Array(Math.floor(input.length / ratio))
    for (let i = 0; i < out.length; i++) {
      const v = input[Math.floor(i * ratio)]
      sum += v * v
      out[i] = Math.max(-1, Math.min(1, v)) * 0x7fff
    }
    onLevel(Math.sqrt(sum / Math.max(1, out.length)))
    const merged = new Int16Array(pending.length + out.length)
    merged.set(pending); merged.set(out, pending.length)
    let o = 0
    for (; o + per <= merged.length; o += per) onFrame(merged.slice(o, o + per).buffer)
    pending = merged.slice(o)
  }
  src.connect(proc)
  proc.connect(ctx.destination)
  return {
    stop() {
      proc.disconnect()
      mic.getTracks().forEach((t) => t.stop())
      ctx.close().catch(() => {})
    },
  }
}

/**
 * You on a phone call with Haanji and the caller: hear both (mixed), and your voice goes
 * to the caller. Audio in: 1-byte source (0 caller, 1 Haanji) + 16 kHz PCM16.
 */
export class CallLink {
  onLevel: (level: number) => void = () => {}
  private ctx?: AudioContext
  private mic?: { stop(): void }
  private heads = [0, 0]
  private sources: Set<AudioBufferSourceNode>[] = [new Set(), new Set()]
  live = false // send the mic only while a call is on

  /** Call from a tap: browsers only allow audio after a user gesture. */
  async start(send: (frame: ArrayBuffer) => void) {
    this.ctx = new AudioContext({ sampleRate: RATE })
    await this.ctx.resume()
    this.mic = await openMic((f) => { if (this.live) send(f) }, (l) => this.onLevel(Math.min(1, l * 6)))
  }

  play(buf: ArrayBuffer) {
    const ctx = this.ctx
    const bytes = new Uint8Array(buf)
    if (!ctx || bytes.length < 3 || bytes[0] > 1) return
    const who = bytes[0]
    const pcm = new Int16Array(buf.slice(1, 1 + ((bytes.length - 1) & ~1)))
    const audio = ctx.createBuffer(1, pcm.length, RATE)
    const ch = audio.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
    const node = ctx.createBufferSource()
    node.buffer = audio
    node.connect(ctx.destination)
    // Caller audio arrives in real time: keep a small jitter buffer, never let it drift behind.
    const lead = who === 0 ? 0.12 : 0.03
    let at = Math.max(ctx.currentTime + lead, this.heads[who])
    if (who === 0 && at > ctx.currentTime + 0.6) at = ctx.currentTime + lead
    node.start(at)
    this.heads[who] = at + audio.duration
    this.sources[who].add(node)
    node.onended = () => this.sources[who].delete(node)
  }

  /** Haanji was cut off (you or the caller started talking). */
  flushHaanji() {
    this.sources[1].forEach((n) => { try { n.stop() } catch { /* already stopped */ } })
    this.sources[1].clear()
    this.heads[1] = 0
  }

  chime() {
    const ctx = this.ctx
    if (!ctx) return
    ;[0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = i ? 880 : 660
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.17)
    })
  }

  stop() {
    this.live = false
    this.mic?.stop()
    this.sources.forEach((set) => set.forEach((n) => { try { n.stop() } catch { /* stopped */ } }))
    this.ctx?.close().catch(() => {})
    this.mic = undefined; this.ctx = undefined
  }
}

export class LiveCall {
  onEvent: (e: LiveEvent) => void = () => {}
  onSpeaking: (speaking: boolean) => void = () => {}
  onLevel: (level: number) => void = () => {}

  private ws?: WebSocket
  private mic?: { stop(): void }
  private outCtx?: AudioContext
  private sources = new Set<AudioBufferSourceNode>()
  private playhead = 0
  private turn = -1
  private recentLevel = 0
  private speaking = false
  private speakTimer?: number
  closed = false

  /** path: /api/live for a practice call, /api/guard to listen to a call on speaker. */
  async start(persona: 'rider' | 'screen', path = '/api/live') {
    this.outCtx = new AudioContext({ sampleRate: RATE })
    await this.outCtx.resume()

    const ws = new WebSocket(wsUrl(path))
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('Could not connect the call'))
    })
    ws.send(JSON.stringify({ type: 'start', token: token.get(), persona }))
    ws.onmessage = (m) => (typeof m.data === 'string' ? this.handle(JSON.parse(m.data)) : this.play(m.data))
    ws.onclose = () => { if (!this.closed) this.onEvent({ type: 'ended', reason: 'disconnected' }); this.teardown() }

    this.mic = await openMic(
      (frame) => { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame) },
      (level) => {
        this.recentLevel = Math.max(level, this.recentLevel * 0.85)
        this.onLevel(Math.min(1, level * 6))
      },
    )
  }

  private handle(e: LiveEvent) {
    if (e.type === 'reply_start') this.turn = e.turn
    if (e.type === 'speech_start' && this.isPlaying() && this.recentLevel > BARGE_LEVEL) this.bargeIn()
    if (e.type === 'interrupted') this.flush()
    this.onEvent(e)
  }

  private isPlaying() {
    return !!this.outCtx && this.playhead > this.outCtx.currentTime + 0.05
  }

  /** Caller talked over Haanji: go quiet now, tell the server to drop the reply. */
  bargeIn() {
    this.flush()
    this.turn = -1
    this.ws?.send(JSON.stringify({ type: 'interrupt' }))
  }

  private flush() {
    this.sources.forEach((s) => { try { s.stop() } catch { /* already stopped */ } })
    this.sources.clear()
    this.playhead = 0
    this.setSpeaking(false)
  }

  private play(buf: ArrayBuffer) {
    const ctx = this.outCtx
    if (!ctx) return
    const bytes = new Uint8Array(buf)
    if (bytes[0] !== this.turn || bytes.length < 3) return // stale audio from a cancelled reply
    const pcm = new Int16Array(buf.slice(1, 1 + ((bytes.length - 1) & ~1)))
    const audio = ctx.createBuffer(1, pcm.length, RATE)
    const ch = audio.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
    const node = ctx.createBufferSource()
    node.buffer = audio
    node.connect(ctx.destination)
    const at = Math.max(ctx.currentTime + 0.03, this.playhead)
    node.start(at)
    this.playhead = at + audio.duration
    this.sources.add(node)
    node.onended = () => this.sources.delete(node)
    this.setSpeaking(true)
    window.clearTimeout(this.speakTimer)
    this.speakTimer = window.setTimeout(() => this.setSpeaking(false), (this.playhead - ctx.currentTime) * 1000 + 80)
  }

  private setSpeaking(v: boolean) {
    if (v !== this.speaking) { this.speaking = v; this.onSpeaking(v) }
  }

  hangup(kind: 'hangup' | 'stop' = 'hangup') {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: kind }))
    this.flush()
    this.stopMic()
  }

  private stopMic() {
    this.mic?.stop()
    this.mic = undefined
  }

  teardown() {
    this.closed = true
    this.flush()
    this.stopMic()
    this.outCtx?.close().catch(() => {})
    try { this.ws?.close() } catch { /* closed */ }
  }
}
