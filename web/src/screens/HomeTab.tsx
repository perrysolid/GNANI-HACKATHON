import { motion } from 'framer-motion'
import { Captions, ChevronRight, Ear, Headphones, ShieldAlert, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { langName, langNative } from '../lib/data'
import { playBase64, stopPlayback } from '../lib/recorder'
import { useApp } from '../lib/store'
import { ErrorText, Orb, Spinner, Wave } from '../components/ui'
import { who } from './steps/Family'
import { summary, TYPES } from './Teach'

const item = (i: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.05 + i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] },
})

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function HomeTab() {
  const { me, haanjiNumber, setMe } = useApp()
  const [claiming, setClaiming] = useState(false)
  const [audio, setAudio] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [err, setErr] = useState('')
  if (!me) return null
  const p = me.profile
  const away = p.purposes?.includes('away')
  const first = me.name.split(' ')[0]
  const number = haanjiNumber.length === 11 ? `${haanjiNumber.slice(0, 3)} ${haanjiNumber.slice(3, 7)} ${haanjiNumber.slice(7)}` : haanjiNumber
  const claim = async () => {
    setClaiming(true); setErr('')
    try { setMe(await api.claimNumber()) } catch (e: any) { setErr(e.message) }
    setClaiming(false)
  }

  const hearAddress = async () => {
    if (audio === 'playing') { stopPlayback(); setAudio('idle'); return }
    setAudio('loading'); setErr('')
    try {
      const r = await api.addressPreview()
      setAudio('playing'); await playBase64(r.audio)
    } catch (e: any) { setErr(e.message) }
    setAudio('idle')
  }

  return (
    <div className="px-5 pt-5">
      <motion.div {...item(0)} className="px-1">
        <p className="text-[15px] text-muted">{greeting()}</p>
        <h1 className="font-display text-[32px] font-bold tracking-[-0.03em]">{first}</h1>
      </motion.div>

      <motion.section {...item(1)} className="relative mt-5 overflow-hidden rounded-[28px] bg-ink p-6 text-white">
        <Orb className="absolute -right-6 -top-6 h-44 w-44" active={me.owns_number} color={me.owns_number ? '#C8F24A' : '#8a8a8a'} />
        <div className="relative max-w-[62%]">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold">
            <span className={me.owns_number ? 'h-2 w-2 rounded-full bg-leaf' : 'h-2 w-2 rounded-full bg-white/40'} />
            {!haanjiNumber ? 'Calling not live yet' : me.owns_number ? 'Answering calls' : 'Number in use'}
          </span>
          <p className="mt-4 font-display text-[24px] font-bold leading-tight">
            {p.local_language ? <>Ready for callers in {langNative(p.local_language)}</> : <>Ready when you can’t pick up</>}
          </p>
          <p className="mt-2 text-[14px] text-white/60">
            {!haanjiNumber ? 'Your setup is saved. Try a call in the browser meanwhile.'
              : me.owns_number ? 'This number is assigned to you. Use another phone to call it.'
              : 'This number is answering for someone else right now.'}
          </p>
        </div>
        {haanjiNumber && (me.owns_number ? (
          <p className="relative mt-5 flex h-12 items-center justify-center rounded-2xl bg-accent font-display text-[20px] font-bold tracking-wide text-ink">
            {number}
          </p>
        ) : (
          <button onClick={claim} disabled={claiming} className="relative mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-semibold text-ink active:scale-[0.98] transition disabled:opacity-60">
            {claiming ? <Spinner /> : <>Answer {number} for me</>}
          </button>
        ))}
      </motion.section>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <motion.div {...item(2)}>
          <Link to="/practice?as=rider" className="card flex h-full flex-col p-5 active:scale-[0.98] transition">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-ink"><Headphones className="h-[22px] w-[22px]" /></span>
            <p className="mt-6 text-[16px] font-semibold leading-snug">Try a call</p>
            <p className="mt-1 text-[13px] text-muted">Talk to it as any caller</p>
          </Link>
        </motion.div>
        <motion.div {...item(3)}>
          <Link to="/guard" className="card flex h-full flex-col p-5 active:scale-[0.98] transition">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-ink text-accent"><Ear className="h-[22px] w-[22px]" /></span>
            <p className="mt-6 text-[16px] font-semibold leading-snug">Guard a call</p>
            <p className="mt-1 text-[13px] text-muted">Put it on speaker, Haanji listens</p>
          </Link>
        </motion.div>
        <motion.div {...item(4)}>
          <Link to="/captions" className="card flex h-full flex-col p-5 active:scale-[0.98] transition">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-ink/[0.06] text-ink"><Captions className="h-[22px] w-[22px]" /></span>
            <p className="mt-6 text-[16px] font-semibold leading-snug">Live captions</p>
            <p className="mt-1 text-[13px] text-muted">Read calls, type replies</p>
          </Link>
        </motion.div>
        <motion.div {...item(5)}>
          <Link to="/shield" className="card flex h-full flex-col p-5 active:scale-[0.98] transition">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-ink/[0.06] text-ink"><ShieldAlert className="h-[22px] w-[22px]" /></span>
            <p className="mt-6 text-[16px] font-semibold leading-snug">Check a call</p>
            <p className="mt-1 text-[13px] text-muted">Paste or say it</p>
          </Link>
        </motion.div>
      </div>

      <motion.section {...item(4)} className="card mt-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 pb-1 pt-5">
          <div>
            <p className="text-[17px] font-semibold">What Haanji can tell callers</p>
            <p className="text-[13px] text-muted">Tap to teach it more</p>
          </div>
          {p.address?.house && (
            <button onClick={hearAddress} aria-label="Hear how callers hear your address" className="grid h-10 w-10 place-items-center rounded-full bg-ink/[0.06] active:bg-ink/10">
              {audio === 'idle' ? <Volume2 className="h-[18px] w-[18px]" /> : <Wave active={audio === 'playing'} className="h-4 scale-50" />}
            </button>
          )}
        </div>
        <div className="mt-2 divide-y divide-line">
          {TYPES.map(({ id, label, icon: Icon }) => {
            const s = summary(id, p)
            return (
              <Link key={id} to={`/teach?t=${id}`} className="flex items-center gap-3.5 px-5 py-3.5 active:bg-ink/[0.03]">
                <span className={s ? 'grid h-9 w-9 place-items-center rounded-lg bg-ink text-white' : 'grid h-9 w-9 place-items-center rounded-lg border border-dashed border-ink/25 text-ink/50'}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{label}</p>
                  <p className="truncate text-[13px] text-muted">{s || 'Not set'}</p>
                </div>
                <ChevronRight className="h-[18px] w-[18px] text-ink/30" />
              </Link>
            )
          })}
        </div>
        {err && <div className="px-5 pb-4"><ErrorText>{err}</ErrorText></div>}
        {away && p.local_language && <p className="border-t border-line px-5 py-3 text-[13px] text-muted">Spoken to callers in {langName(p.local_language)} or whatever language they use.</p>}
      </motion.section>

      {me.family.length > 0 && (
        <motion.section {...item(5)} className="mt-6">
          <p className="tag px-1">Protected</p>
          <div className="mt-3 space-y-2">
            {me.family.map((f) => (
              <Link key={f.id} to="/shield" className="card flex items-center gap-4 p-4">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-ink font-display text-[18px] font-bold text-white">{who(f)[0]}</span>
                <div className="flex-1">
                  <p className="text-[16px] font-semibold">{who(f)}</p>
                  <p className="text-[13px] text-muted">{[f.block_scams && 'Scam shield', f.screen_unknown && 'Screens unknown', f.checkin && `Check-in ${f.checkin_time}`].filter(Boolean).join(' · ')}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted" />
              </Link>
            ))}
          </div>
        </motion.section>
      )}
    </div>
  )
}
