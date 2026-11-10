/**
 * Records the mic as 16 kHz mono WAV, the format Gnani Prisma takes.
 * Browsers record WebM/MP4 natively, which Prisma doesn't accept, so we
 * capture raw samples and write the WAV ourselves.
 */

const TARGET_RATE = 16000
export const MAX_SECONDS = 25

export class Recorder {
  private ctx?: AudioContext
  private stream?: MediaStream
  private node?: ScriptProcessorNode
  private chunks: Float32Array[] = []
  private timer?: number
  onLevel?: (level: number) => void
  onAutoStop?: () => void

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    this.ctx = new AudioContext()
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.node = this.ctx.createScriptProcessor(4096, 1, 1)
    this.chunks = []
    this.node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0)
      this.chunks.push(new Float32Array(data))
      let sum = 0
      for (let i = 0; i < data.length; i += 16) sum += data[i] * data[i]
      this.onLevel?.(Math.min(1, Math.sqrt(sum / (data.length / 16)) * 4))
    }
    src.connect(this.node)
    this.node.connect(this.ctx.destination)
    this.timer = window.setTimeout(() => this.onAutoStop?.(), MAX_SECONDS * 1000)
  }

  async stop(): Promise<{ wav: Blob; seconds: number }> {
    window.clearTimeout(this.timer)
    const rate = this.ctx?.sampleRate ?? 48000
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => {})
    const merged = merge(this.chunks)
    const pcm = downsample(merged, rate, TARGET_RATE)
    return { wav: encodeWav(pcm, TARGET_RATE), seconds: pcm.length / TARGET_RATE }
  }

  cancel() {
    window.clearTimeout(this.timer)
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ctx?.close().catch(() => {})
  }
}

function merge(chunks: Float32Array[]) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

function downsample(input: Float32Array, from: number, to: number) {
  if (from === to) return input
  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

function encodeWav(samples: Float32Array, rate: number) {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

let current: HTMLAudioElement | null = null

/** Plays base64 WAV from the API; resolves when playback ends. */
export function playBase64(b64: string): Promise<void> {
  current?.pause()
  const audio = new Audio(`data:audio/wav;base64,${b64}`)
  current = audio
  return new Promise((resolve) => {
    audio.onended = () => resolve()
    audio.onerror = () => resolve()
    audio.play().catch(() => resolve())
  })
}

export function stopPlayback() {
  current?.pause()
  current = null
}
