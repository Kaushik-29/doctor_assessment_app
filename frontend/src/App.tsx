import { useCallback, useEffect, useState } from 'react'
import { api, setUnauthorizedHandler, type Doctor, type Progress } from './api'
import { Spinner, TopBar } from './components/ui'
import UnlockOverlay from './components/UnlockOverlay'
import AuthScreen from './screens/AuthScreen'
import CompleteScreen from './screens/CompleteScreen'
import Dashboard from './screens/Dashboard'
import PhaseWorkspace from './screens/PhaseWorkspace'

type View =
  | { kind: 'loading' }
  | { kind: 'auth' }
  | { kind: 'dashboard' }
  | { kind: 'phase'; phase: number; mode: 'question' | 'review'; questionId: number | null; key: number }
  | { kind: 'complete' }

export default function App() {
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [unlock, setUnlock] = useState<{ phase: number; title: string } | null>(null)
  const [toast, setToast] = useState('')

  const signedOut = useCallback(() => {
    setDoctor(null)
    setProgress(null)
    setUnlock(null)
    setView({ kind: 'auth' })
  }, [])

  useEffect(() => setUnauthorizedHandler(signedOut), [signedOut])

  const refresh = useCallback(async () => {
    const p = await api.progress()
    setProgress(p)
    return p
  }, [])

  /** After sign-in: go straight back to where the doctor left off. */
  const resume = useCallback(
    async (d: Doctor) => {
      setDoctor(d)
      const p = await refresh()
      if (p.completed) setView({ kind: 'complete' })
      else if (p.is_new) setView({ kind: 'dashboard' })
      else {
        const r = p.resume
        setView({ kind: 'phase', phase: r.phase, mode: r.view === 'review' ? 'review' : 'question', questionId: r.question_id, key: Date.now() })
        setToast(`Welcome back — resuming Phase ${r.phase}${r.view === 'review' ? ' review' : ''}`)
      }
    },
    [refresh],
  )

  useEffect(() => {
    api
      .me()
      .then(resume)
      .catch(() => setView({ kind: 'auth' }))
  }, [resume])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const logout = async () => {
    try {
      await api.logout()
    } finally {
      signedOut()
    }
  }

  const openPhase = (phase: number) => {
    const p = progress?.phases.find((x) => x.phase === phase)
    const sameAsResume = progress?.resume.phase === phase
    setView({
      kind: 'phase',
      phase,
      mode: sameAsResume && progress?.resume.view === 'review' ? 'review' : 'question',
      questionId: sameAsResume && p?.status === 'active' ? progress!.resume.question_id : null,
      key: Date.now(),
    })
  }

  const goDashboard = async () => {
    await refresh().catch(() => {})
    setView({ kind: 'dashboard' })
  }

  const onSubmitted = async (r: { next_phase: number | null; completed: boolean }) => {
    const p = await refresh()
    if (r.completed) {
      setView({ kind: 'complete' })
    } else if (r.next_phase) {
      const meta = p.phases.find((x) => x.phase === r.next_phase)
      setUnlock({ phase: r.next_phase, title: meta?.title ?? '' })
      setView({ kind: 'phase', phase: r.next_phase, mode: 'question', questionId: null, key: Date.now() })
    }
  }

  if (view.kind === 'loading')
    return (
      <div className="flex min-h-screen items-center justify-center text-accent">
        <Spinner className="h-6 w-6" />
      </div>
    )
  if (view.kind === 'auth' || !doctor) return <AuthScreen onAuthed={(d) => void resume(d)} />

  return (
    <div className="min-h-screen">
      <TopBar doctor={doctor} onLogout={logout}>
        {progress && (
          <div className="hidden items-center gap-1.5 sm:flex" aria-label={`${progress.phases.filter((p) => p.status === 'submitted').length} of 4 phases submitted`}>
            {progress.phases.map((p) => (
              <span
                key={p.phase}
                title={`Phase ${p.phase}: ${p.status}`}
                className={`h-1.5 w-7 rounded-full transition-colors duration-700 ${p.status === 'submitted' ? 'bg-success' : p.status === 'active' ? 'bg-accent' : 'bg-[#dcdce1]'}`}
              />
            ))}
          </div>
        )}
      </TopBar>

      {view.kind === 'dashboard' && progress && (
        <Dashboard doctor={doctor} progress={progress} onOpenPhase={openPhase} onViewSummary={() => setView({ kind: 'complete' })} />
      )}
      {view.kind === 'phase' && (
        <PhaseWorkspace
          key={view.key}
          phase={view.phase}
          initialMode={view.mode}
          initialQuestionId={view.questionId}
          onExit={goDashboard}
          onSubmitted={onSubmitted}
        />
      )}
      {view.kind === 'complete' && <CompleteScreen onOverview={goDashboard} onLogout={logout} />}

      {unlock && <UnlockOverlay phase={unlock.phase} title={unlock.title} onContinue={() => setUnlock(null)} />}

      {toast && (
        <div role="status" className="anim-rise fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink/90 px-5 py-2.5 text-[14px] font-medium text-white shadow-lift backdrop-blur">
          {toast}
        </div>
      )}
    </div>
  )
}
