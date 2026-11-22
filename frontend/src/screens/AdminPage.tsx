import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Download, LogOut, RefreshCw, Search, ShieldCheck, Stethoscope } from 'lucide-react'
import { api, ApiError, formatDate, type AdminComparison, type AdminDoctor, type AdminOverview } from '../api'
import { Button, Spinner } from '../components/ui'
import AnswerComparison from './AnswerComparison'

type State = 'loading' | 'login' | 'ready' | 'unconfigured'

function statusOf(d: AdminDoctor, totalPhases: number) {
  if (d.completed_at) return { label: 'Completed', cls: 'bg-[#e3f6e8] text-[#1a7f37]' }
  if (d.started_at) return { label: `Phase ${Math.min(d.phases_submitted + 1, totalPhases)} of ${totalPhases}`, cls: 'bg-accent-soft text-accent' }
  return { label: 'Not started', cls: 'bg-[#f0f0f3] text-muted' }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[20px] border border-line bg-white px-5 py-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 font-display text-[30px] font-semibold tracking-[-0.02em]">{value}</p>
    </div>
  )
}

function DownloadLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <a
      href={href}
      download
      className="group flex items-center gap-4 rounded-[20px] border border-line bg-white p-5 transition hover:border-accent/40 hover:shadow-[0_4px_20px_rgba(0,0,0,0.05)]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition group-hover:bg-accent-strong">
        <Download size={19} aria-hidden />
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        <span className="block text-[13px] text-muted">{hint}</span>
      </span>
    </a>
  )
}

export default function AdminPage() {
  const [state, setState] = useState<State>('loading')
  const [data, setData] = useState<AdminOverview | null>(null)
  const [comparison, setComparison] = useState<AdminComparison | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const [overview, cmp] = await Promise.all([api.adminOverview(), api.adminComparison()])
      setData(overview)
      setComparison(cmp)
      setState('ready')
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setState('unconfigured')
      else if (err instanceof ApiError && err.status === 401) setState('login')
      else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong')
        setState('login')
      }
    }
  }, [])

  useEffect(() => {
    document.title = 'Admin · Diagnostic Assessment'
    load()
  }, [load])

  async function login(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.adminLogin(password)
      setPassword('')
      await load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setState('unconfigured')
      else setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    await api.adminLogout().catch(() => undefined)
    setData(null)
    setState('login')
  }

  async function refresh() {
    setBusy(true)
    await load()
    setBusy(false)
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = data?.doctors ?? []
    return q ? list.filter((d) => `${d.full_name} ${d.email} ${d.specialty}`.toLowerCase().includes(q)) : list
  }, [data, query])

  const brand = (
    <div className="flex items-center gap-2.5 font-display text-[15px] font-semibold">
      <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-accent text-white">
        <Stethoscope size={18} aria-hidden />
      </span>
      Diagnostic Assessment
      <span className="rounded-full bg-[#f0f0f3] px-2.5 py-0.5 text-[12px] font-medium text-muted">Admin</span>
    </div>
  )

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (state === 'unconfigured' || state === 'login') {
    return (
      <main className="flex min-h-screen items-center justify-center px-5 py-12">
        <div className="anim-rise w-full max-w-[400px]">
          <div className="mb-8">{brand}</div>
          {state === 'unconfigured' ? (
            <>
              <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Admin access is off</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                Set an <code className="rounded bg-[#f0f0f3] px-1.5 py-0.5 text-[13px] text-ink">DA_ADMIN_PASSWORD</code>{' '}
                environment variable on the server (on Render: <em>Environment</em> tab), then reload this page.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Admin sign-in</h1>
              <p className="mt-1.5 text-[15px] text-muted">View progress and download the doctors' answers.</p>
              <form onSubmit={login} className="mt-7 grid gap-4">
                <div>
                  <label htmlFor="admin_pw" className="mb-1.5 block text-[13px] font-medium text-ink-2">
                    Admin password
                  </label>
                  <input
                    id="admin_pw"
                    type="password"
                    autoComplete="current-password"
                    required
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 w-full rounded-[14px] border border-line bg-white px-4 text-[15px] text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                  />
                </div>
                {error && (
                  <p role="alert" className="rounded-[12px] bg-[#fff1f0] px-4 py-3 text-[14px] text-[#c4161c]">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy || !password} className="h-12 w-full">
                  {busy ? <Spinner className="text-white" /> : <ShieldCheck size={17} aria-hidden />}
                  Sign in
                </Button>
              </form>
            </>
          )}
        </div>
      </main>
    )
  }

  const d = data!
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          {brand}
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={refresh} disabled={busy} className="h-9 px-3.5 text-[14px]">
              <RefreshCw size={15} aria-hidden className={busy ? 'animate-spin' : ''} />
              Refresh
            </Button>
            <Button variant="ghost" onClick={logout} className="h-9 px-3.5 text-[14px]">
              <LogOut size={15} aria-hidden />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="anim-rise mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <h1 className="font-display text-[34px] font-semibold tracking-[-0.025em]">Responses</h1>
        <p className="mt-1 text-[15px] text-muted">Everyone who has registered, and how far they have got.</p>

        <section className="mt-7 grid grid-cols-3 gap-3 sm:gap-4">
          <Stat label="Registered" value={d.registered} />
          <Stat label="Started" value={d.started} />
          <Stat label="Completed" value={d.completed} />
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 sm:gap-4" aria-label="Downloads">
          <DownloadLink
            href="/api/admin/export/answers.csv"
            label="Download answers (CSV)"
            hint="One row per doctor per question, with the doctor's and the application's answer"
          />
          <DownloadLink
            href="/api/admin/export/doctors.csv"
            label="Download doctors (CSV)"
            hint="One row per doctor, with progress and completion time"
          />
        </section>

        <section className="mt-8 overflow-hidden rounded-[22px] border border-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="text-[16px] font-semibold">Doctors</h2>
            <label className="relative">
              <span className="sr-only">Search doctors</span>
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="search"
                placeholder="Search name, email, specialty"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 w-64 rounded-full border border-line bg-[#fafafa] pl-9 pr-3 text-[14px] outline-none transition focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/15"
              />
            </label>
          </div>
          {rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-[15px] text-muted">
              {d.registered === 0 ? 'No doctors have registered yet.' : 'No doctors match your search.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[14px]">
                <thead className="bg-[#fafafa] text-[12px] uppercase tracking-[0.06em] text-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">Doctor</th>
                    <th className="px-5 py-3 font-medium">Specialty</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Answered</th>
                    <th className="px-5 py-3 font-medium">Registered</th>
                    <th className="px-5 py-3 font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const s = statusOf(r, d.total_phases)
                    return (
                      <tr key={r.id} className="transition hover:bg-[#fafafa]">
                        <td className="px-5 py-3.5">
                          <div className="font-medium text-ink">{r.full_name}</div>
                          <div className="text-[13px] text-muted">{r.email}</div>
                        </td>
                        <td className="px-5 py-3.5 text-ink-2">
                          {r.specialty || '—'}
                          {r.registration_number && <div className="text-[12px] text-muted">Reg. {r.registration_number}</div>}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-block rounded-full px-2.5 py-1 text-[12px] font-medium ${s.cls}`}>{s.label}</span>
                        </td>
                        <td className="px-5 py-3.5 tabular-nums text-ink-2">
                          {r.questions_answered} / {d.total_questions}
                        </td>
                        <td className="px-5 py-3.5 text-ink-2">{formatDate(r.created_at)}</td>
                        <td className="px-5 py-3.5 text-ink-2">{formatDate(r.completed_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {comparison && <AnswerComparison data={comparison} />}
      </main>
    </div>
  )
}
