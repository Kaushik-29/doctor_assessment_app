import { ArrowRight, Check, Eye, Lock } from 'lucide-react'
import type { Doctor, PhaseProgress, Progress } from '../api'
import { formatDate } from '../api'
import { Button, ProgressRing } from '../components/ui'

function PhaseCard({ p, onOpen, delay }: { p: PhaseProgress; onOpen: () => void; delay: number }) {
  const locked = p.status === 'locked'
  const done = p.status === 'submitted'
  return (
    <article
      className={`anim-rise group relative flex flex-col rounded-[24px] p-6 transition-all duration-300 ${
        locked ? 'bg-white/60 ring-1 ring-black/5' : 'bg-white shadow-card hover:-translate-y-0.5 hover:shadow-lift'
      } ${p.status === 'active' ? 'ring-2 ring-accent/70' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
      aria-label={`Phase ${p.phase}: ${p.title}, ${p.status}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`text-[12px] font-semibold uppercase tracking-[0.1em] ${locked ? 'text-[#a1a1a6]' : 'text-accent'}`}>Phase {p.phase}</p>
          <h3 className={`mt-1 font-display text-[19px] font-semibold leading-snug tracking-tight ${locked ? 'text-[#86868b]' : ''}`}>{p.title}</h3>
        </div>
        {done ? (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
            <Check size={24} strokeWidth={2.6} aria-hidden />
          </span>
        ) : locked ? (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f0f0f3] text-[#a1a1a6]">
            <Lock size={20} aria-hidden />
          </span>
        ) : (
          <ProgressRing value={p.answered} max={p.total} size={56} stroke={5} label={`${p.answered} of ${p.total} answered`}>
            <span className="text-[13px] font-semibold tabular-nums">
              {p.answered}
              <span className="text-muted">/{p.total}</span>
            </span>
          </ProgressRing>
        )}
      </div>
      <p className={`mt-3 flex-1 text-[14px] leading-relaxed ${locked ? 'text-[#a1a1a6]' : 'text-muted'}`}>{p.description}</p>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-[13px] text-muted">
          {done ? `Submitted ${formatDate(p.submitted_at)}` : locked ? `Unlocks after Phase ${p.phase - 1}` : `${p.answered} of ${p.total} answered`}
        </span>
        {!locked && (
          <Button variant={done ? 'secondary' : 'primary'} onClick={onOpen} className="h-9 px-4 text-[14px]">
            {done ? (
              <>
                <Eye size={15} aria-hidden /> View
              </>
            ) : (
              <>
                {p.answered ? 'Continue' : 'Begin'} <ArrowRight size={15} aria-hidden />
              </>
            )}
          </Button>
        )}
      </div>
    </article>
  )
}

export default function Dashboard({
  doctor,
  progress,
  onOpenPhase,
  onViewSummary,
}: {
  doctor: Doctor
  progress: Progress
  onOpenPhase: (phase: number) => void
  onViewSummary: () => void
}) {
  const submittedCount = progress.phases.filter((p) => p.status === 'submitted').length
  const first = doctor.full_name.replace(/^dr\.?\s+/i, '').split(/\s+/)[0]
  const current = progress.current_phase
  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-10 sm:px-8">
      <section className="anim-rise flex flex-col gap-8 rounded-[28px] bg-white p-7 shadow-card sm:p-9 md:flex-row md:items-center">
        <ProgressRing value={progress.total_answered} max={progress.total_questions} size={132} stroke={10} label={`${progress.total_answered} of ${progress.total_questions} questions answered`}>
          <div className="text-center">
            <div className="font-display text-[30px] font-semibold tabular-nums leading-none">
              {Math.round((progress.total_answered / progress.total_questions) * 100)}%
            </div>
            <div className="mt-1 text-[12px] text-muted">overall</div>
          </div>
        </ProgressRing>
        <div className="flex-1">
          <p className="text-[14px] font-medium text-muted">{progress.is_new ? 'Welcome' : 'Welcome back'}, Dr. {first}</p>
          <h1 className="mt-1 font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] sm:text-[34px]">
            {progress.completed
              ? 'Assessment complete.'
              : progress.is_new
                ? 'Ready when you are.'
                : `You're on Phase ${current} of 4.`}
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
            {progress.completed
              ? 'Thank you. All four phases have been submitted and are now read-only.'
              : 'Each phase has ten short case vignettes. Choose the most likely diagnosis, or type your own if it is not listed. Submit a phase to unlock the next.'}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {progress.completed ? (
              <Button onClick={onViewSummary}>
                View summary <ArrowRight size={16} aria-hidden />
              </Button>
            ) : (
              <Button onClick={() => onOpenPhase(current!)}>
                {progress.is_new ? 'Begin Phase 1' : `Continue Phase ${current}`} <ArrowRight size={16} aria-hidden />
              </Button>
            )}
            <span className="text-[14px] text-muted tabular-nums">
              {submittedCount} of 4 phases submitted · {progress.total_answered} of {progress.total_questions} answered
            </span>
          </div>
        </div>
      </section>

      <div className="mt-10 mb-4 flex items-end justify-between">
        <h2 className="font-display text-[22px] font-semibold tracking-tight">Phases</h2>
        <div className="flex gap-1.5" aria-hidden>
          {progress.phases.map((p) => (
            <span
              key={p.phase}
              className={`h-1.5 w-8 rounded-full transition-colors duration-500 ${
                p.status === 'submitted' ? 'bg-success' : p.status === 'active' ? 'bg-accent' : 'bg-[#dcdce1]'
              }`}
            />
          ))}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {progress.phases.map((p, i) => (
          <PhaseCard key={p.phase} p={p} delay={80 + i * 60} onOpen={() => onOpenPhase(p.phase)} />
        ))}
      </div>
    </main>
  )
}
