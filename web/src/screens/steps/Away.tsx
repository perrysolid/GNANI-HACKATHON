import { AnimatePresence, motion } from 'framer-motion'
import { Mic } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { langName, langNative, VOICES } from '../../lib/data'
import { playBase64, stopPlayback } from '../../lib/recorder'
import { ErrorText, MicButton, PlayButton, Spinner, Wave } from '../../components/ui'
import { StepFrame, type StepProps } from '../Onboarding'
import { useSave } from './Basics'

const FIELDS = [
  { key: 'house', label: 'House, flat and floor', placeholder: 'Flat 302, 3rd floor, Sai Residency' },
  { key: 'area', label: 'Street and area', placeholder: '4th Cross, HSR Layout Sector 2' },
  { key: 'landmark', label: 'Landmark', placeholder: 'Opposite Shani temple, blue gate' },
  { key: 'note', label: 'Anything else', placeholder: 'Lift not working, take the stairs' },
] as const

export function AddressStep({ draft, update, next }: StepProps) {
  const { busy, err, save } = useSave()
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')
  const [micErr, setMicErr] = useState('')
  const a = draft.address
  const ok = a.house.trim() && a.area.trim()

  const onAudio = async (wav: Blob) => {
    setListening(true); setMicErr('')
    try {
      const r = await api.transcribe(wav)
      if (!r.transcript) throw new Error('Didn’t catch that. Try again.')
      setHeard(r.transcript)
      update({ address: { ...a, landmark: a.landmark ? `${a.landmark}, ${r.transcript}` : r.transcript } })
    } catch (e: any) { setMicErr(e.message) } finally { setListening(false) }
  }

  return (
    <StepFrame
      tag="Your address"
      title={'How do riders\nfind you?'}
      sub="Write it the way you’d explain it on the phone. Haanji says it in the caller’s language."
      footer={
        <>
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={!ok || busy} onClick={() => save({ address: a }, next)}>{busy ? <Spinner /> : 'Continue'}</button>
        </>
      }
    >
      <div className="space-y-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1.5 block text-[14px] font-medium text-muted">{f.label}</span>
            <input className="field" placeholder={f.placeholder} value={a[f.key]} maxLength={f.key === 'house' ? 120 : 190} onChange={(e) => update({ address: { ...a, [f.key]: e.target.value } })} />
          </label>
        ))}
      </div>

      <div className="card mt-6 flex items-center gap-4 p-4">
        <MicButton size="sm" onAudio={onAudio} disabled={listening} />
        <div className="flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold"><Mic className="h-4 w-4" /> Or say the landmark</p>
          <p className="text-[14px] text-muted">{listening ? 'Understanding…' : 'In Hindi, English or any Indian language'}</p>
        </div>
        {listening && <Spinner className="text-muted" />}
      </div>
      <AnimatePresence>
        {heard && (
          <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 text-[14px] text-muted">
            Heard: <span className="text-ink">“{heard}”</span>
          </motion.p>
        )}
      </AnimatePresence>
      <div className="mt-2"><ErrorText>{micErr}</ErrorText></div>
    </StepFrame>
  )
}

export function PreviewStep({ draft, update, next }: StepProps) {
  const { save } = useSave()
  const [state, setState] = useState<'loading' | 'ready' | 'playing' | 'error'>('loading')
  const [preview, setPreview] = useState<{ text: string; audio: string } | null>(null)
  const [err, setErr] = useState('')

  const load = async (voice: string, autoplay: boolean) => {
    setState('loading'); setErr('')
    try {
      await api.updateMe({ voice })
      const p = await api.addressPreview()
      setPreview(p)
      if (autoplay) { setState('playing'); await playBase64(p.audio) }
      setState('ready')
    } catch (e: any) { setErr(e.message); setState('error') }
  }

  const started = useRef(false)
  useEffect(() => {
    if (!started.current) { started.current = true; load(draft.voice, false) } // once, even in StrictMode
    return stopPlayback
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const play = async () => {
    if (!preview) return
    if (state === 'playing') { stopPlayback(); setState('ready'); return }
    setState('playing'); await playBase64(preview.audio); setState('ready')
  }

  const pickVoice = (voice: string) => {
    if (voice === draft.voice) return
    stopPlayback(); update({ voice }); load(voice, true)
  }

  return (
    <StepFrame
      tag="Preview"
      title={'This is what\ncallers hear'}
      sub={<>A rider calls, you’re busy. Haanji answers in {langName(draft.localLang)}.</>}
      footer={<button className="btn" disabled={state === 'loading'} onClick={() => { stopPlayback(); save({ voice: draft.voice }, next) }}>Sounds right</button>}
    >
      <div className="flex gap-2">
        {VOICES.map((v) => (
          <button key={v.id} onClick={() => pickVoice(v.id)} className={clsx('flex-1 rounded-2xl border px-4 py-3 text-left transition-colors', draft.voice === v.id ? 'border-ink bg-ink text-white' : 'border-line bg-card')}>
            <p className="text-[16px] font-semibold">{v.label}</p>
            <p className={clsx('text-[13px]', draft.voice === v.id ? 'text-white/60' : 'text-muted')}>{v.hint}</p>
          </button>
        ))}
      </div>

      <motion.div layout className="mt-4 overflow-hidden rounded-3xl bg-ink p-5 text-white">
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-white/10 px-3 py-1 text-[13px] font-medium">{langNative(draft.localLang)} · {langName(draft.localLang)}</span>
          <span className="text-[12px] text-white/50">Gnani Timbre</span>
        </div>
        <div className="mt-5 flex items-center gap-4">
          <PlayButton playing={state === 'playing'} loading={state === 'loading'} onClick={play} className="bg-accent text-ink" />
          <Wave active={state === 'playing'} className="text-white/80" />
        </div>
        <AnimatePresence mode="wait">
          {preview && (
            <motion.p key={preview.text} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 text-[17px] leading-relaxed text-white/90">
              {preview.text}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
      <div className="mt-3"><ErrorText>{err}</ErrorText></div>
    </StepFrame>
  )
}
