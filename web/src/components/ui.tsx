import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, CircleAlert, Loader2, Mic, Pause, Play, Square } from 'lucide-react'
import { clsx } from 'clsx'
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Recorder } from '../lib/recorder'

export const LazyStatusOrb = lazy(() => import('../three/VoiceOrb').then((m) => ({ default: m.StatusOrb })))

/** Faded square grid behind a screen. Deterministic, so it doesn't reshuffle on re-render. */
export function Backdrop({ dark }: { dark?: boolean }) {
  const cols = 19, rows = 26, size = 24
  const ink = dark ? '255,255,255' : '17,17,17'
  const filled: { x: number; y: number; o: number; d: number }[] = []
  for (let i = 0; i < cols * rows; i++) {
    const h = (i * 2654435761) % 997
    if (h % 23 === 0) filled.push({ x: i % cols, y: Math.floor(i / cols), o: 0.05 + (h % 7) / 100, d: (h % 50) / 10 })
  }
  return (
    <svg className="backdrop" width="100%" aria-hidden preserveAspectRatio="xMidYMin slice" viewBox={`0 0 ${cols * size} ${rows * size}`}>
      <defs>
        <pattern id={dark ? 'g-d' : 'g-l'} width={size} height={size} patternUnits="userSpaceOnUse">
          <path d={`M ${size} 0 L 0 0 0 ${size}`} fill="none" stroke={`rgba(${ink},${dark ? 0.07 : 0.07})`} strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${dark ? 'g-d' : 'g-l'})`} />
      {filled.map((c, i) => (
        <rect key={i} className="cell" x={c.x * size + 1} y={c.y * size + 1} width={size - 1} height={size - 1}
          fill={`rgb(${ink})`} style={{ ['--o' as string]: c.o, opacity: c.o, animationDelay: `${c.d}s` }} />
      ))}
    </svg>
  )
}

export function Orb(props: { color?: string; active?: boolean; className?: string }) {
  return (
    <div className={props.className}>
      <Suspense fallback={null}>
        <LazyStatusOrb color={props.color} active={props.active} />
      </Suspense>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin', className)} />
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Back" className="-ml-2 grid h-11 w-11 place-items-center rounded-full active:bg-ink/5">
      <ArrowLeft className="h-[22px] w-[22px]" />
    </button>
  )
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-ink/[0.07]">
      <motion.div className="h-full rounded-full bg-ink" animate={{ width: `${Math.max(4, value * 100)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
    </div>
  )
}

export function ErrorText({ children }: { children?: ReactNode }) {
  return (
    <AnimatePresence>
      {children ? (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-1.5 text-[14px] font-medium text-ink">
          <CircleAlert className="mt-[2px] h-4 w-4 shrink-0" />{children}
        </motion.p>
      ) : null}
    </AnimatePresence>
  )
}

export function Choice({ selected, onClick, children, className }: { selected: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={clsx(
        'relative rounded-2xl border bg-card text-left transition-colors',
        selected ? 'border-ink shadow-[inset_0_0_0_1px_rgb(17,17,17)]' : 'border-line',
        className,
      )}
    >
      {children}
      <AnimatePresence>
        {selected && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-ink text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  )
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full items-center gap-4 py-4 text-left">
      <div className="flex-1">
        <p className="text-[16px] font-semibold">{label}</p>
        {hint && <p className="mt-0.5 text-[14px] text-muted">{hint}</p>}
      </div>
      <span className={clsx('relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors', on ? 'bg-ink' : 'bg-ink/15')}>
        <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }} className={clsx('absolute top-[3px] h-6 w-6 rounded-full bg-white shadow', on ? 'right-[3px]' : 'left-[3px]')} />
      </span>
    </button>
  )
}

/** Tap to start, tap to stop. Hands back a 16 kHz WAV. */
export function MicButton({ onAudio, disabled, size = 'lg', label }: { onAudio: (wav: Blob) => void; disabled?: boolean; size?: 'lg' | 'sm'; label?: string }) {
  const rec = useRef<Recorder | null>(null)
  const [state, setState] = useState<'idle' | 'rec'>('idle')
  const [level, setLevel] = useState(0)
  const [err, setErr] = useState('')

  useEffect(() => () => rec.current?.cancel(), [])

  const stop = async () => {
    const r = rec.current
    if (!r) return
    rec.current = null
    setState('idle')
    setLevel(0)
    const { wav, seconds } = await r.stop()
    if (seconds < 0.6) { setErr('Too short. Tap, speak, then tap again.'); return }
    onAudio(wav)
  }

  const start = async () => {
    setErr('')
    const r = new Recorder()
    r.onLevel = setLevel
    r.onAutoStop = stop
    try {
      await r.start()
      rec.current = r
      setState('rec')
    } catch {
      setErr('Allow microphone access to speak.')
    }
  }

  const big = size === 'lg'
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative grid place-items-center">
        {state === 'rec' && (
          <motion.span className={clsx('absolute rounded-full bg-accent/50', big ? 'h-24 w-24' : 'h-14 w-14')} animate={{ scale: 1 + level * 0.9 }} transition={{ duration: 0.08 }} />
        )}
        <motion.button
          whileTap={{ scale: 0.92 }}
          disabled={disabled}
          onClick={state === 'rec' ? stop : start}
          aria-label={state === 'rec' ? 'Stop recording' : 'Start recording'}
          className={clsx('relative grid place-items-center rounded-full transition-colors disabled:opacity-30', big ? 'h-20 w-20' : 'h-12 w-12', state === 'rec' ? 'bg-accent text-ink' : 'bg-ink text-white')}
        >
          {state === 'rec' ? <Square className={big ? 'h-6 w-6' : 'h-4 w-4'} fill="currentColor" /> : <Mic className={big ? 'h-7 w-7' : 'h-5 w-5'} />}
        </motion.button>
      </div>
      {label && <p className="text-[13px] font-medium text-muted">{state === 'rec' ? 'Listening… tap to stop' : label}</p>}
      {err && <p className="text-[13px] font-medium text-ink/70">{err}</p>}
    </div>
  )
}

export function PlayButton({ playing, loading, onClick, className }: { playing: boolean; loading?: boolean; onClick: () => void; className?: string }) {
  return (
    <motion.button whileTap={{ scale: 0.92 }} onClick={onClick} aria-label={playing ? 'Pause' : 'Play'} className={clsx('grid h-12 w-12 shrink-0 place-items-center rounded-full', className ?? 'bg-ink text-white')}>
      {loading ? <Spinner /> : playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
    </motion.button>
  )
}

/** Animated bars that sit next to audio while it plays. */
export function Wave({ active, className }: { active: boolean; className?: string }) {
  return (
    <div className={clsx('flex h-6 items-center gap-[3px]', className)}>
      {Array.from({ length: 18 }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-current"
          animate={active ? { height: [4, 8 + ((i * 7) % 14), 4] } : { height: 4 }}
          transition={active ? { duration: 0.7 + (i % 5) * 0.12, repeat: Infinity, ease: 'easeInOut', delay: i * 0.03 } : { duration: 0.2 }}
        />
      ))}
    </div>
  )
}
