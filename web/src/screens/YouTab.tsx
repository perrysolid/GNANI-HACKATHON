import { ChevronRight, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { langName, langNative } from '../lib/data'
import { useApp } from '../lib/store'
import { PageHeader } from './Shell'
import { ForwardCard } from './steps/Activate'

export function YouTab() {
  const nav = useNavigate()
  const { me, signOut, haanjiNumber } = useApp()
  if (!me) return null
  const p = me.profile

  const rows = [
    { label: 'Your language', value: p.my_language ? `${langNative(p.my_language)} · ${langName(p.my_language)}` : '—' },
    { label: 'City', value: p.city ? `${p.city} · ${langName(p.local_language)}` : '—' },
    { label: 'Voice', value: p.voice || 'Shivani' },
    { label: 'Address', value: [p.address?.house, p.address?.area].filter(Boolean).join(', ') || '—' },
  ]

  return (
    <div>
      <PageHeader title="You" />
      <div className="px-5">
        <div className="card flex items-center gap-4 p-5">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-ink font-display text-[22px] font-bold text-white">{me.name[0]?.toUpperCase() || 'H'}</span>
          <div>
            <p className="text-[18px] font-semibold">{me.name}</p>
            <p className="text-[14px] text-muted">+91 {me.phone.slice(0, 5)} {me.phone.slice(5)}</p>
          </div>
        </div>

        <button onClick={() => nav('/start')} className="card mt-3 w-full divide-y divide-line text-left">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-muted">{r.label}</p>
                <p className="truncate text-[15px] font-medium">{r.value}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
            </div>
          ))}
        </button>

        {haanjiNumber && (
          <div className="mt-3">
            <ForwardCard number={haanjiNumber} title="Call forwarding" sub="Dial once on your phone." />
          </div>
        )}

        <button onClick={() => { signOut(); nav('/', { replace: true }) }} className="btn-ghost mt-6 text-ink/60">
          <LogOut className="h-5 w-5" /> Sign out
        </button>
        <p className="mt-2 text-center text-[12px] text-muted">Voice by Gnani Prisma and Timbre</p>
      </div>
    </div>
  )
}
