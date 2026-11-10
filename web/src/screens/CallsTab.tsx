import { motion } from 'framer-motion'
import { PhoneIncoming, PhoneOutgoing } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CallRow } from '../lib/api'
import { langNative } from '../lib/data'
import { ErrorText, Spinner } from '../components/ui'
import { PageHeader } from './Shell'

const VERDICT: Record<string, string> = { scam: 'bg-alarm/10 text-alarm', suspicious: 'bg-warn/10 text-warn', ok: 'bg-leaf/10 text-leaf' }

export function CallsTab() {
  const [calls, setCalls] = useState<CallRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.calls().then(setCalls).catch((e) => setErr(e.message)) }, [])

  return (
    <div>
      <PageHeader title="Calls" sub="Every call Haanji handled, in your language." />
      <div className="px-5">
        <ErrorText>{err}</ErrorText>
        {!calls && !err && <div className="flex justify-center py-16 text-muted"><Spinner /></div>}
        {calls?.length === 0 && (
          <div className="mt-10 flex flex-col items-center px-6 text-center">
            <div className="relative h-24 w-24">
              <motion.span className="absolute inset-0 rounded-full border-2 border-ink/10" animate={{ scale: [1, 1.35], opacity: [1, 0] }} transition={{ duration: 2, repeat: Infinity }} />
              <span className="absolute inset-3 grid place-items-center rounded-full bg-ink text-white"><PhoneIncoming className="h-7 w-7" /></span>
            </div>
            <p className="mt-6 text-[18px] font-semibold">No calls yet</p>
            <p className="mt-1 text-[15px] text-muted">When Haanji picks up for you, a short summary shows up here.</p>
            <Link to="/practice?as=rider" className="btn mt-6 w-auto px-6">Try a practice call</Link>
          </div>
        )}
        <div className="space-y-2">
          {calls?.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-paper">
                  {c.direction === 'in' ? <PhoneIncoming className="h-[18px] w-[18px]" /> : <PhoneOutgoing className="h-[18px] w-[18px]" />}
                </span>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold">{c.kind === 'practice-screen' ? 'Scam test call' : c.kind === 'practice-rider' ? 'Test call' : c.counterpart || 'Unknown number'}</p>
                  <p className="text-[12px] text-muted">{new Date(c.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {langNative(c.language)}</p>
                </div>
                {c.verdict && <span className={clsx('rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize', VERDICT[c.verdict])}>{c.verdict}</span>}
              </div>
              {c.summary && <p className="mt-3 text-[14px] leading-relaxed">{c.summary}</p>}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
