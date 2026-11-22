import { useEffect, useRef, type ReactNode } from 'react'
import { LogOut, Stethoscope } from 'lucide-react'
import type { Doctor } from '../api'

export function ProgressRing({
  value,
  max,
  size = 64,
  stroke = 6,
  color = 'var(--color-accent)',
  track = '#e8e8ed',
  children,
  label,
}: {
  value: number
  max: number
  size?: number
  stroke?: number
  color?: string
  track?: string
  children?: ReactNode
  label?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `${value} of ${max}`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full px-5 h-11 text-[15px] font-medium transition-all duration-200 select-none disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] cursor-pointer'
  const styles = {
    primary: 'bg-accent text-white hover:bg-accent-strong shadow-[0_1px_2px_rgba(10,102,228,0.3)]',
    secondary: 'bg-white text-ink border border-line hover:bg-[#fafafa] hover:border-[#d2d2d7]',
    ghost: 'text-accent hover:bg-accent-soft',
    danger: 'bg-[#d70015] text-white hover:bg-[#b80012]',
  }[variant]
  return (
    <button className={`${base} ${styles} ${className}`} {...rest}>
      {children}
    </button>
  )
}

export function TopBar({ doctor, onLogout, children }: { doctor: Doctor; onLogout: () => void; children?: ReactNode }) {
  const initials = doctor.full_name
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-8">
        <div className="flex items-center gap-2.5 font-display text-[15px] font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-white">
            <Stethoscope size={17} strokeWidth={2.2} aria-hidden />
          </span>
          <span className="hidden sm:inline">Diagnostic Assessment</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right md:block">
            <div className="text-[13px] font-medium leading-tight">{doctor.full_name}</div>
            {doctor.specialty && <div className="text-[12px] text-muted leading-tight">{doctor.specialty}</div>}
          </div>
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#5e9bff] to-accent text-[13px] font-semibold text-white"
            aria-hidden
          >
            {initials || 'Dr'}
          </span>
          <button
            onClick={onLogout}
            className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted transition hover:bg-black/5 hover:text-ink cursor-pointer"
          >
            <LogOut size={15} aria-hidden /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  )
}

export function Modal({
  title,
  children,
  onClose,
  labelledBy = 'modal-title',
}: {
  title: string
  children: ReactNode
  onClose: () => void
  labelledBy?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('button')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {
        const els = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, textarea'))
        if (!els.length) return
        const a = els[0]
        const b = els[els.length - 1]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          b.focus()
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm anim-fade" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="w-full max-w-md rounded-[24px] bg-white p-7 shadow-lift anim-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={labelledBy} className="font-display text-[21px] font-semibold tracking-tight">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden
    />
  )
}
