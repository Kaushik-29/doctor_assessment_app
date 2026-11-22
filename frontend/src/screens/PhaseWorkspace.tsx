import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  ClipboardCheck,
  Lock,
  Pencil,
  PenLine,
} from 'lucide-react'
import { api, ApiError, formatDate, isComplete, type Answer, type PhaseData, type Question } from '../api'
import { Button, Modal, Spinner } from '../components/ui'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type Body = { selected_index: number | null; is_other: boolean; other_text: string }
const LETTERS = 'ABCDEFGHIJ'

function answerLabel(q: Question, a: Answer | null | undefined): string | null {
  if (!a) return null
  if (a.is_other) return a.other_text.trim() ? a.other_text.trim() : null
  return a.selected_index !== null ? q.options[a.selected_index] : null
}

function SaveIndicator({ state, readOnly }: { state: SaveState; readOnly: boolean }) {
  let content: React.ReactNode = null
  if (readOnly)
    content = (
      <>
        <Lock size={13} aria-hidden /> Read-only
      </>
    )
  else if (state === 'saving')
    content = (
      <>
        <Spinner className="h-3 w-3 border-[1.5px]" /> Saving…
      </>
    )
  else if (state === 'saved')
    content = (
      <>
        <Check size={14} strokeWidth={2.6} className="text-success" aria-hidden /> Saved
      </>
    )
  else if (state === 'error')
    content = (
      <span className="flex items-center gap-1.5 text-[#c4161c]">
        <CloudOff size={14} aria-hidden /> Not saved — retrying
      </span>
    )
  else content = <span className="text-[#a1a1a6]">Autosave on</span>
  return (
    <div className="flex h-8 items-center gap-1.5 rounded-full bg-white/80 px-3 text-[13px] text-muted ring-1 ring-black/5" aria-live="polite">
      {content}
    </div>
  )
}

export default function PhaseWorkspace({
  phase,
  initialMode,
  initialQuestionId,
  onExit,
  onSubmitted,
}: {
  phase: number
  initialMode: 'question' | 'review'
  initialQuestionId: number | null
  onExit: () => void
  onSubmitted: (result: { next_phase: number | null; completed: boolean }) => void
}) {
  const [data, setData] = useState<PhaseData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [answers, setAnswers] = useState<Record<number, Answer | null>>({})
  const [mode, setMode] = useState<'question' | 'review'>(initialMode)
  const [index, setIndex] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [flagged, setFlagged] = useState<number[]>([])
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const otherRef = useRef<HTMLTextAreaElement>(null)

  // ---- load
  useEffect(() => {
    let alive = true
    api
      .phase(phase)
      .then((d) => {
        if (!alive) return
        setData(d)
        setAnswers(Object.fromEntries(d.questions.map((q) => [q.id, q.answer])))
        const i = d.questions.findIndex((q) => q.id === initialQuestionId)
        setIndex(i >= 0 ? i : 0)
      })
      .catch((e) => alive && setLoadError(e instanceof ApiError ? e.message : 'Failed to load phase'))
    return () => {
      alive = false
    }
  }, [phase, initialQuestionId])

  const readOnly = data?.status === 'submitted'
  const questions = data?.questions ?? []
  const q = questions[index]

  // ---- autosave machinery (per-question sequential queue + debounce for typed text)
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const pending = useRef<Record<number, Body>>({})
  const chains = useRef<Record<number, Promise<void>>>({})
  const inflight = useRef(0)
  const hadError = useRef(false)

  const send = useCallback((qid: number): Promise<void> => {
    const body = pending.current[qid]
    if (!body) return chains.current[qid] ?? Promise.resolve()
    delete pending.current[qid]
    clearTimeout(timers.current[qid])
    inflight.current++
    setSaveState('saving')
    const run = async () => {
      try {
        await api.saveAnswer(qid, body)
        hadError.current = false
      } catch (e) {
        if (e instanceof ApiError && (e.status === 409 || e.status === 403 || e.status === 401)) return
        hadError.current = true
        if (!pending.current[qid]) pending.current[qid] = body
        timers.current[qid] = setTimeout(() => void send(qid), 3000)
      } finally {
        inflight.current--
        if (inflight.current === 0) setSaveState(hadError.current ? 'error' : 'saved')
      }
    }
    const next = (chains.current[qid] ?? Promise.resolve()).then(run)
    chains.current[qid] = next
    return next
  }, [])

  const schedule = useCallback(
    (qid: number, body: Body, delay: number) => {
      pending.current[qid] = body
      clearTimeout(timers.current[qid])
      if (delay <= 0) void send(qid)
      else timers.current[qid] = setTimeout(() => void send(qid), delay)
    },
    [send],
  )

  const flush = useCallback(async () => {
    const ids = Object.keys(pending.current).map(Number)
    await Promise.all(ids.map((id) => send(id)))
    await Promise.all(Object.values(chains.current))
  }, [send])

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      void flush()
    }
  }, [flush])

  const update = (qid: number, body: Body, delay = 0) => {
    if (readOnly) return
    setAnswers((prev) => ({
      ...prev,
      [qid]: body.selected_index === null && !body.is_other ? null : { ...body, is_complete: body.is_other ? !!body.other_text.trim() : true },
    }))
    const pos = questions.find((x) => x.id === qid)?.position
    setFlagged((f) => f.filter((p) => p !== pos))
    schedule(qid, body, delay)
  }

  const choose = (i: number) => q && update(q.id, { selected_index: i, is_other: false, other_text: '' })
  const chooseOther = () => {
    if (!q) return
    const cur = answers[q.id]
    update(q.id, { selected_index: null, is_other: true, other_text: cur?.is_other ? cur.other_text : '' })
    setTimeout(() => otherRef.current?.focus(), 60)
  }

  // ---- position tracking (resume)
  useEffect(() => {
    if (!data || readOnly) return
    const qid = mode === 'question' ? questions[index]?.id ?? null : null
    api.savePosition(phase, qid, mode).catch(() => {})
  }, [data, readOnly, mode, index, phase, questions])

  const goTo = (i: number) => {
    void flush()
    setMode('question')
    setIndex(Math.max(0, Math.min(questions.length - 1, i)))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const goReview = () => {
    void flush()
    setMode('review')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const next = () => (index === questions.length - 1 ? goReview() : goTo(index + 1))
  const prev = () => index > 0 && goTo(index - 1)

  // ---- keyboard shortcuts
  useEffect(() => {
    if (mode !== 'question' || !q) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'radio') || e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector('[role="dialog"]')) return
      const isRadio = t.tagName === 'INPUT'
      if (e.key === 'ArrowRight' && !isRadio) {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft' && !isRadio) {
        e.preventDefault()
        prev()
      } else if (!readOnly && /^[a-j]$/i.test(e.key)) {
        const i = LETTERS.indexOf(e.key.toUpperCase())
        if (i < q.options.length) choose(i)
        else if (i === q.options.length) {
          e.preventDefault()
          chooseOther()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const completeCount = useMemo(() => questions.filter((x) => isComplete(answers[x.id])).length, [questions, answers])
  const incompletePositions = questions.filter((x) => !isComplete(answers[x.id])).map((x) => x.position)

  async function doSubmit() {
    setSubmitting(true)
    setSubmitError('')
    try {
      await flush()
      const r = await api.submitPhase(phase)
      setConfirming(false)
      onSubmitted(r)
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const d = e.detail as { incomplete_positions?: number[] }
        setFlagged(d.incomplete_positions ?? [])
      }
      setSubmitError(e instanceof ApiError ? e.message : 'Submission failed')
      setSubmitting(false)
    }
  }

  if (loadError)
    return (
      <main className="mx-auto max-w-xl px-5 py-24 text-center">
        <AlertCircle className="mx-auto text-[#c4161c]" aria-hidden />
        <p className="mt-3 text-[15px]">{loadError}</p>
        <Button variant="secondary" className="mt-6" onClick={onExit}>
          Back to overview
        </Button>
      </main>
    )
  if (!data || !q)
    return (
      <div className="flex justify-center py-32 text-accent">
        <Spinner className="h-6 w-6" />
      </div>
    )

  const a = answers[q.id]
  const otherSelected = !!a?.is_other
  const otherMissing = otherSelected && !a!.other_text.trim()

  return (
    <main className="mx-auto max-w-3xl px-5 pb-24 pt-6 sm:px-8">
      {/* Sub-header */}
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => { void flush(); onExit() }} className="flex h-9 items-center gap-1 rounded-full pl-2 pr-3 text-[14px] font-medium text-accent transition hover:bg-accent-soft cursor-pointer">
          <ChevronLeft size={18} aria-hidden /> Overview
        </button>
        <SaveIndicator state={saveState} readOnly={readOnly} />
      </div>

      <div className="mt-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-accent">Phase {phase} of 4</p>
        <h1 className="mt-0.5 font-display text-[26px] font-semibold tracking-[-0.02em]">{data.title}</h1>
      </div>

      {readOnly && (
        <div className="mt-4 flex items-center gap-2.5 rounded-[16px] bg-success-soft px-4 py-3 text-[14px] text-[#17643a]">
          <Lock size={16} aria-hidden /> Submitted {formatDate(data.submitted_at)}. Answers in this phase are locked and read-only.
        </div>
      )}

      {/* Phase progress + navigator */}
      <div className="mt-5 rounded-[20px] bg-white p-4 shadow-card sm:p-5">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-medium text-ink-2">
            {mode === 'review' ? 'Review & submit' : `Case ${index + 1} of ${questions.length}`}
          </span>
          <span className="tabular-nums text-muted">
            {completeCount}/{questions.length} answered
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#ececf0]" role="progressbar" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={completeCount} aria-label="Answered in this phase">
          <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${(completeCount / questions.length) * 100}%` }} />
        </div>
        <nav className="mt-4 flex flex-wrap items-center gap-2" aria-label="Questions in this phase">
          {questions.map((x, i) => {
            const done = isComplete(answers[x.id])
            const draft = !!answers[x.id] && !done
            const current = mode === 'question' && i === index
            const flag = flagged.includes(x.position)
            return (
              <button
                key={x.id}
                onClick={() => goTo(i)}
                aria-current={current ? 'step' : undefined}
                aria-label={`Question ${x.position}${done ? ', answered' : draft ? ', incomplete' : ', not answered'}`}
                className={`relative h-9 w-9 rounded-full text-[13px] font-semibold tabular-nums transition-all duration-200 cursor-pointer ${
                  current
                    ? 'scale-110 bg-ink text-white shadow-md'
                    : done
                      ? 'bg-accent-soft text-accent hover:bg-[#dbe8fd]'
                      : flag || draft
                        ? 'bg-warn-soft text-warn ring-1 ring-[#f3c27d]'
                        : 'bg-[#f2f2f5] text-muted hover:bg-[#e8e8ed]'
                }`}
              >
                {x.position}
                {done && !current && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-accent" aria-hidden />}
              </button>
            )
          })}
          <button
            onClick={goReview}
            aria-current={mode === 'review' ? 'step' : undefined}
            className={`ml-auto flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition cursor-pointer ${
              mode === 'review' ? 'bg-ink text-white' : 'bg-[#f2f2f5] text-ink-2 hover:bg-[#e8e8ed]'
            }`}
          >
            <ClipboardCheck size={15} aria-hidden /> Review
          </button>
        </nav>
      </div>

      {mode === 'question' ? (
        <>
          <article key={q.id} className="anim-rise mt-5 rounded-[24px] bg-white p-6 shadow-card sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent">{q.specialty}</span>
              <span className="text-[13px] text-muted">Case {q.position}</span>
            </div>
            <h2 className="mt-3 font-display text-[22px] font-semibold tracking-tight">{q.title}</h2>
            <p className="mt-3 text-[16px] leading-[1.65] text-ink-2">{q.vignette}</p>

            <fieldset className="mt-7" disabled={readOnly}>
              <legend className="mb-3 text-[15px] font-semibold">{q.prompt}</legend>
              <div className="grid gap-2.5" role="radiogroup" aria-label={q.prompt}>
                {q.options.map((opt, i) => {
                  const sel = !otherSelected && a?.selected_index === i
                  return (
                    <label
                      key={i}
                      className={`group flex min-h-[54px] items-center gap-3.5 rounded-[16px] border px-4 py-3 transition-all duration-200 has-[input:focus-visible]:ring-4 has-[input:focus-visible]:ring-accent/25 ${
                        readOnly ? 'cursor-default' : 'cursor-pointer'
                      } ${sel ? 'border-accent bg-accent-soft/70 shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line bg-white hover:border-[#c7c7cc] hover:bg-[#fbfbfd]'} ${readOnly && !sel ? 'opacity-60' : ''}`}
                    >
                      <input type="radio" name={`q-${q.id}`} className="sr-only" checked={sel} onChange={() => choose(i)} />
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-semibold transition-colors ${sel ? 'bg-accent text-white' : 'bg-[#f2f2f5] text-muted group-hover:bg-[#e8e8ed]'}`}>
                        {sel ? <Check size={15} strokeWidth={3} className="anim-check" aria-hidden /> : LETTERS[i]}
                      </span>
                      <span className={`text-[15px] leading-snug ${sel ? 'font-medium text-ink' : 'text-ink-2'}`}>{opt}</span>
                    </label>
                  )
                })}
                <div
                  className={`rounded-[16px] border transition-all duration-200 has-[input:focus-visible]:ring-4 has-[input:focus-visible]:ring-accent/25 ${
                    otherSelected ? (otherMissing ? 'border-[#e8a33d] bg-warn-soft/50 shadow-[0_0_0_1px_#e8a33d]' : 'border-accent bg-accent-soft/70 shadow-[0_0_0_1px_var(--color-accent)]') : 'border-line border-dashed bg-white hover:border-[#c7c7cc]'
                  } ${readOnly && !otherSelected ? 'opacity-60' : ''}`}
                >
                  <label className={`group flex min-h-[54px] items-center gap-3.5 px-4 py-3 ${readOnly ? '' : 'cursor-pointer'}`}>
                    <input type="radio" name={`q-${q.id}`} className="sr-only" checked={otherSelected} onChange={chooseOther} />
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] transition-colors ${otherSelected ? 'bg-accent text-white' : 'bg-[#f2f2f5] text-muted'}`}>
                      <PenLine size={14} aria-hidden />
                    </span>
                    <span className={`text-[15px] ${otherSelected ? 'font-medium' : 'text-ink-2'}`}>Other / Not listed</span>
                    <span className="ml-auto hidden text-[12px] text-[#a1a1a6] sm:inline">{LETTERS[q.options.length]}</span>
                  </label>
                  <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${otherSelected ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="px-4 pb-4">
                        <label htmlFor={`other-${q.id}`} className="mb-1.5 block text-[13px] font-medium text-ink-2">
                          Your diagnosis <span className="text-[#c4161c]">*</span>
                        </label>
                        <textarea
                          id={`other-${q.id}`}
                          ref={otherRef}
                          rows={2}
                          maxLength={500}
                          required={otherSelected}
                          aria-invalid={otherMissing}
                          aria-describedby={`other-help-${q.id}`}
                          tabIndex={otherSelected ? 0 : -1}
                          value={a?.is_other ? a.other_text : ''}
                          onChange={(e) => update(q.id, { selected_index: null, is_other: true, other_text: e.target.value }, 700)}
                          onBlur={() => void flush()}
                          placeholder="Type the diagnosis you consider most likely"
                          className="w-full resize-none rounded-[12px] border border-line bg-white px-3.5 py-2.5 text-[15px] outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:bg-[#fafafa]"
                        />
                        <p id={`other-help-${q.id}`} className={`mt-1 text-[12px] ${otherMissing ? 'text-warn' : 'text-muted'}`}>
                          {otherMissing ? 'Required — enter a diagnosis to count this answer.' : 'Saved automatically as you type.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </fieldset>
            {!readOnly && a && (
              <button onClick={() => update(q.id, { selected_index: null, is_other: false, other_text: '' })} className="mt-3 text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline cursor-pointer">
                Clear answer
              </button>
            )}
          </article>

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button variant="secondary" onClick={prev} disabled={index === 0}>
              <ArrowLeft size={16} aria-hidden /> Previous
            </Button>
            <p className="hidden text-center text-[12px] text-[#a1a1a6] md:block">
              Keys: {LETTERS[0]}–{LETTERS[q.options.length]} to choose · ← → to move
            </p>
            <Button onClick={next}>
              {index === questions.length - 1 ? (
                <>
                  {readOnly ? 'Review answers' : 'Review & Submit'} <ClipboardCheck size={16} aria-hidden />
                </>
              ) : (
                <>
                  Next <ArrowRight size={16} aria-hidden />
                </>
              )}
            </Button>
          </div>
        </>
      ) : (
        /* ---------------------------------------------------------------- Review */
        <section className="anim-rise mt-5">
          <div className="rounded-[24px] bg-white p-6 shadow-card sm:p-8">
            <h2 className="font-display text-[22px] font-semibold tracking-tight">{readOnly ? 'Your submitted answers' : 'Review your answers'}</h2>
            <p className="mt-1.5 text-[15px] text-muted">
              {readOnly
                ? 'This phase has been submitted and cannot be changed.'
                : incompletePositions.length
                  ? `${incompletePositions.length} question${incompletePositions.length > 1 ? 's' : ''} still need${incompletePositions.length > 1 ? '' : 's'} an answer before you can submit.`
                  : 'All ten cases are answered. Check them below, then submit to lock this phase and unlock the next.'}
            </p>
            <ol className="mt-6 divide-y divide-line">
              {questions.map((x, i) => {
                const label = answerLabel(x, answers[x.id])
                const ans = answers[x.id]
                const flag = !label
                return (
                  <li key={x.id} className="flex items-center gap-4 py-3.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${flag ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent'}`}>
                      {x.position}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-muted">{x.title}</p>
                      {label ? (
                        <p className="truncate text-[15px] font-medium">
                          {ans?.is_other && <span className="mr-1.5 rounded-md bg-[#f2f2f5] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Other</span>}
                          {label}
                        </p>
                      ) : (
                        <p className="flex items-center gap-1.5 text-[15px] font-medium text-warn">
                          <AlertCircle size={15} aria-hidden /> {ans?.is_other ? '“Other” selected — diagnosis not typed' : 'Not answered'}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => goTo(i)}
                      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-accent transition hover:bg-accent-soft cursor-pointer"
                      aria-label={`${readOnly ? 'View' : 'Edit'} question ${x.position}`}
                    >
                      {readOnly ? 'View' : <><Pencil size={14} aria-hidden /> Edit</>}
                      <ChevronRight size={15} aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
          {!readOnly && (
            <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="secondary" onClick={() => goTo(questions.length - 1)}>
                <ArrowLeft size={16} aria-hidden /> Back to questions
              </Button>
              <Button onClick={() => { setSubmitError(''); setConfirming(true) }} disabled={incompletePositions.length > 0}>
                <Lock size={15} aria-hidden /> Submit Phase {phase}
              </Button>
            </div>
          )}
          {readOnly && (
            <div className="mt-6 flex justify-end">
              <Button variant="secondary" onClick={onExit}>
                Back to overview
              </Button>
            </div>
          )}
        </section>
      )}

      {confirming && (
        <Modal title={`Submit Phase ${phase}?`} onClose={() => !submitting && setConfirming(false)}>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Your {questions.length} answers will be locked and can no longer be changed.{' '}
            {phase < 4 ? `Phase ${phase + 1} will unlock immediately.` : 'This completes the assessment.'}
          </p>
          {submitError && (
            <p role="alert" className="mt-4 rounded-[12px] bg-[#fff1f0] px-4 py-3 text-[14px] text-[#c4161c]">
              {submitError}
            </p>
          )}
          <div className="mt-7 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={submitting}>
              Keep reviewing
            </Button>
            <Button onClick={doSubmit} disabled={submitting} data-autofocus>
              {submitting ? <Spinner /> : <Lock size={15} aria-hidden />} Submit &amp; lock
            </Button>
          </div>
        </Modal>
      )}
    </main>
  )
}
