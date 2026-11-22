import { useEffect, useState } from 'react'
import { Check, Clock, Layers, ListChecks, PenLine, Target } from 'lucide-react'
import { api, ApiError, formatDate, formatDuration, type Summary } from '../api'
import { Button, Spinner } from '../components/ui'

export default function CompleteScreen({ onOverview, onLogout }: { onOverview: () => void; onLogout: () => void }) {
  const [s, setS] = useState<Summary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.summary().then(setS).catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load summary'))
  }, [])

  if (error) return <p className="py-24 text-center text-[15px] text-[#c4161c]">{error}</p>
  if (!s)
    return (
      <div className="flex justify-center py-32 text-accent">
        <Spinner className="h-6 w-6" />
      </div>
    )

  const stats = [
    { icon: Layers, label: 'Phases completed', value: `${s.phases_completed}/${s.total_phases}` },
    { icon: ListChecks, label: 'Questions answered', value: `${s.questions_answered}/${s.total_questions}` },
    { icon: PenLine, label: '“Other” diagnoses', value: String(s.other_count) },
    { icon: Clock, label: 'Completion time', value: formatDuration(s.duration_seconds) },
  ]
  if (s.score) stats.push({ icon: Target, label: 'Matched answer key', value: `${s.score.correct}/${s.score.keyed_questions}` })

  return (
    <main className="mx-auto max-w-3xl px-5 pb-24 pt-14 sm:px-8">
      <section className="text-center">
        <div className="relative mx-auto h-28 w-28">
          <svg viewBox="0 0 112 112" className="h-28 w-28 -rotate-90" aria-hidden>
            <circle cx="56" cy="56" r="50" fill="none" stroke="#e8f7ee" strokeWidth="8" />
            <circle
              cx="56"
              cy="56"
              r="50"
              fill="none"
              stroke="var(--color-success)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="314.2"
              style={{ ['--len' as string]: 314.2, animation: 'draw 1.1s cubic-bezier(0.2,0.8,0.2,1) both' }}
            />
          </svg>
          <span className="anim-pop absolute inset-0 flex items-center justify-center text-success" style={{ animationDelay: '0.7s' }}>
            <Check size={46} strokeWidth={2.6} aria-hidden />
          </span>
        </div>
        <p className="anim-rise mt-7 text-[13px] font-semibold uppercase tracking-[0.12em] text-success" style={{ animationDelay: '0.5s' }}>
          Assessment complete
        </p>
        <h1 className="anim-rise mt-2 font-display text-[36px] font-semibold leading-tight tracking-[-0.025em] sm:text-[42px]" style={{ animationDelay: '0.6s' }}>
          Thank you, {s.doctor.full_name}.
        </h1>
        <p className="anim-rise mx-auto mt-3 max-w-lg text-[16px] leading-relaxed text-muted" style={{ animationDelay: '0.7s' }}>
          All four phases have been submitted. Your responses are recorded and locked for the study team.
        </p>
      </section>

      <section className={`mt-10 grid gap-4 ${stats.length === 5 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {stats.map(({ icon: Icon, label, value }, i) => (
          <div key={label} className="anim-rise rounded-[20px] bg-white p-5 shadow-card" style={{ animationDelay: `${0.85 + i * 0.08}s` }}>
            <Icon size={18} className="text-accent" aria-hidden />
            <div className="mt-3 font-display text-[26px] font-semibold tabular-nums tracking-tight">{value}</div>
            <div className="text-[13px] text-muted">{label}</div>
          </div>
        ))}
      </section>

      <section className="anim-rise mt-6 rounded-[24px] bg-white p-6 shadow-card sm:p-7" style={{ animationDelay: '1.2s' }}>
        <h2 className="font-display text-[17px] font-semibold">Phase timeline</h2>
        <ol className="mt-4 grid gap-3">
          {s.phases.map((p) => (
            <li key={p.phase} className="flex items-center gap-3.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-soft text-success">
                <Check size={15} strokeWidth={2.8} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">
                  Phase {p.phase} · {p.title}
                </p>
                <p className="text-[13px] text-muted">
                  {p.answered} answered{p.other_count ? ` · ${p.other_count} “Other”` : ''}
                </p>
              </div>
              <span className="shrink-0 text-[13px] text-muted">{formatDate(p.submitted_at)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-5 border-t border-line pt-4 text-[13px] text-muted">
          Started {formatDate(s.started_at)} · Completed {formatDate(s.completed_at)}
        </p>
      </section>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button variant="secondary" onClick={onOverview}>
          Review submitted answers
        </Button>
        <Button variant="ghost" onClick={onLogout}>
          Sign out
        </Button>
      </div>
    </main>
  )
}
