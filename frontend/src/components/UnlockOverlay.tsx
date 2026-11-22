import { ArrowRight } from 'lucide-react'
import { useEffect, useRef } from 'react'

export default function UnlockOverlay({
  phase,
  title,
  onContinue,
}: {
  phase: number
  title: string
  onContinue: () => void
}) {
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const t = setTimeout(() => btn.current?.focus(), 900)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onContinue()
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
    }
  }, [onContinue])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(245,245,247,0.82)] p-6 backdrop-blur-xl anim-fade"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-title"
    >
      <div className="text-center">
        <div className="anim-pop anim-glow mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-accent text-white shadow-lift">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4.5" y="11" width="15" height="10" rx="2.5" />
            <path className="anim-shackle" d="M8 11V7.5a4 4 0 0 1 8 0V11" />
          </svg>
        </div>
        <p className="anim-rise mt-8 text-[13px] font-semibold uppercase tracking-[0.14em] text-accent" style={{ animationDelay: '0.9s' }}>
          Phase {phase - 1} submitted
        </p>
        <h2 id="unlock-title" className="anim-rise mt-2 font-display text-[38px] font-semibold tracking-[-0.025em]" style={{ animationDelay: '1s' }}>
          Phase {phase} unlocked
        </h2>
        <p className="anim-rise mt-2 text-[17px] text-muted" style={{ animationDelay: '1.1s' }}>
          {title}
        </p>
        <div className="anim-rise mt-6 flex justify-center gap-2" style={{ animationDelay: '1.15s' }} aria-hidden>
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className={`h-1.5 w-10 rounded-full ${n < phase ? 'bg-success' : n === phase ? 'bg-accent' : 'bg-[#dcdce1]'}`} />
          ))}
        </div>
        <button
          ref={btn}
          onClick={onContinue}
          className="anim-rise group mt-9 inline-flex h-12 items-center gap-2 rounded-full bg-accent px-7 text-[15px] font-medium text-white transition hover:bg-accent-strong active:scale-[0.98] cursor-pointer"
          style={{ animationDelay: '1.25s' }}
        >
          Start Phase {phase} <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
