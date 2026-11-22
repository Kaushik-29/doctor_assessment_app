import { useState, type FormEvent } from 'react'
import { ArrowRight, Layers, Lock, ShieldCheck, Stethoscope } from 'lucide-react'
import { api, ApiError, type Doctor } from '../api'
import { Spinner } from '../components/ui'

function Field({
  id,
  label,
  hint,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      <input
        id={id}
        className="h-12 w-full rounded-[14px] border border-line bg-white px-4 text-[15px] text-ink outline-none transition placeholder:text-[#a1a1a6] focus:border-accent focus:ring-4 focus:ring-accent/15"
        {...rest}
      />
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  )
}

export default function AuthScreen({ onAuthed }: { onAuthed: (d: Doctor) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [regNo, setRegNo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const d =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register({ email, password, full_name: fullName, specialty, registration_number: regNo })
      onAuthed(d)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: 'login' | 'register') => {
    setMode(m)
    setError('')
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Left: brand panel */}
      <aside className="relative hidden overflow-hidden bg-[linear-gradient(160deg,#f8fbff_0%,#e9f1fe_55%,#dce9fd_100%)] lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="flex items-center gap-2.5 font-display text-[15px] font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-accent text-white">
            <Stethoscope size={18} aria-hidden />
          </span>
          Diagnostic Assessment
        </div>
        <div className="anim-rise max-w-md">
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-accent">Clinician portal</p>
          <h1 className="font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
            Forty cases.
            <br />
            Four phases.
            <br />
            <span className="text-accent">Your clinical judgement.</span>
          </h1>
          <p className="mt-5 text-[17px] leading-relaxed text-ink-2">
            Read each case vignette and record the diagnosis you consider most likely. Your answers save automatically, so
            you can stop and resume at any time.
          </p>
        </div>
        <ul className="grid gap-4 text-[14px] text-ink-2">
          {[
            [Layers, 'Four phases of ten cases, unlocked one after another'],
            [ShieldCheck, 'Autosaved progress, private to your account'],
            [Lock, 'Each phase is locked once you submit it'],
          ].map(([Icon, text], i) => {
            const I = Icon as typeof Layers
            return (
              <li key={i} className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-accent shadow-sm">
                  <I size={17} aria-hidden />
                </span>
                {text as string}
              </li>
            )
          })}
        </ul>
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/50 blur-3xl" />
      </aside>

      {/* Right: form */}
      <main className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[420px] anim-rise">
          <div className="mb-8 lg:hidden flex items-center gap-2.5 font-display text-[15px] font-semibold">
            <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-accent text-white">
              <Stethoscope size={18} aria-hidden />
            </span>
            Diagnostic Assessment
          </div>
          <h2 className="font-display text-[32px] font-semibold tracking-[-0.02em]">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-1.5 text-[15px] text-muted">
            {mode === 'login' ? 'Sign in to continue your assessment.' : 'One account per doctor. It takes under a minute.'}
          </p>

          <div role="tablist" aria-label="Sign in or register" className="mt-7 grid grid-cols-2 rounded-full bg-[#e9e9ee] p-1 text-[14px] font-medium">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`h-9 rounded-full transition-all duration-200 cursor-pointer ${mode === m ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {m === 'login' ? 'Sign in' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-6 grid gap-4" noValidate={false}>
            {mode === 'register' && (
              <>
                <Field id="full_name" label="Full name" placeholder="Dr. Priya Raman" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} autoComplete="name" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="specialty" label="Specialty" placeholder="General Medicine" value={specialty} onChange={(e) => setSpecialty(e.target.value)} autoComplete="organization-title" />
                  <Field id="reg_no" label="Registration no." placeholder="Optional" value={regNo} onChange={(e) => setRegNo(e.target.value)} />
                </div>
              </>
            )}
            <Field id="email" label="Email" type="email" placeholder="name@hospital.org" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            <Field
              id="password"
              label="Password"
              type="password"
              placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : undefined}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
            {error && (
              <p role="alert" className="rounded-[12px] bg-[#fff1f0] px-4 py-3 text-[14px] text-[#c4161c] anim-fade">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="group mt-2 flex h-12 items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-medium text-white transition hover:bg-accent-strong active:scale-[0.99] disabled:opacity-60 cursor-pointer"
            >
              {busy ? <Spinner /> : null}
              {mode === 'login' ? 'Sign in' : 'Create account'}
              {!busy && <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden />}
            </button>
          </form>
          <p className="mt-6 text-center text-[14px] text-muted">
            {mode === 'login' ? 'New here? ' : 'Already registered? '}
            <button type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')} className="font-medium text-accent hover:underline cursor-pointer">
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
