import { useMemo, useState } from 'react'
import { Check, Info, Minus, X } from 'lucide-react'
import type { AdminComparison, ComparisonRow } from '../api'

type Filter = 'all' | 'agree' | 'differ' | 'none'

const selectCls =
  'h-9 rounded-full border border-line bg-[#fafafa] px-3.5 text-[14px] text-ink outline-none transition focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/15 cursor-pointer'

function Result({ row }: { row: ComparisonRow }) {
  if (row.matches_app === true)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#e3f6e8] px-2.5 py-1 text-[12px] font-medium text-[#1a7f37]">
        <Check size={13} aria-hidden /> Agree
      </span>
    )
  if (row.matches_app === false)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fff1f0] px-2.5 py-1 text-[12px] font-medium text-[#c4161c]">
        <X size={13} aria-hidden /> Differ
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#f0f0f3] px-2.5 py-1 text-[12px] font-medium text-muted">
      <Minus size={13} aria-hidden /> {row.app_answer ? 'Blank' : 'No app answer'}
    </span>
  )
}

function DoctorAnswer({ row }: { row: ComparisonRow }) {
  if (row.answer_type === 'other_blank') return <span className="italic text-muted">Other (no text yet)</span>
  return (
    <span>
      {row.answer_type === 'other' ? (
        <span className="mr-1.5 rounded bg-[#f0f0f3] px-1.5 py-0.5 text-[11px] font-semibold text-muted">OTHER</span>
      ) : (
        <span className="mr-1.5 font-semibold text-muted">{row.option_letter}.</span>
      )}
      {row.answer_text}
    </span>
  )
}

export default function AnswerComparison({ data }: { data: AdminComparison }) {
  const doctors = useMemo(() => {
    const m = new Map<number, string>()
    data.rows.forEach((r) => m.set(r.doctor_id, `${r.full_name} (${r.email})`))
    return [...m.entries()]
  }, [data])
  const [doctor, setDoctor] = useState<string>('all')
  const [filter, setFilter] = useState<Filter>('all')

  const byDoctor = useMemo(
    () => (doctor === 'all' ? data.rows : data.rows.filter((r) => String(r.doctor_id) === doctor)),
    [data, doctor],
  )
  const rows = byDoctor.filter((r) =>
    filter === 'all' ? true : filter === 'agree' ? r.matches_app === true : filter === 'differ' ? r.matches_app === false : r.matches_app === null,
  )
  const compared = byDoctor.filter((r) => r.matches_app !== null).length
  const agreed = byDoctor.filter((r) => r.matches_app === true).length
  const multiDoctor = doctor === 'all' && doctors.length > 1

  return (
    <section className="mt-8 overflow-hidden rounded-[22px] border border-line bg-white" aria-labelledby="cmp-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="cmp-title" className="text-[16px] font-semibold">
            Doctor vs application
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {compared > 0
              ? `${agreed} of ${compared} compared answers agree (${Math.round((agreed / compared) * 100)}%)`
              : 'No answers to compare yet'}
            {' · '}application answers set for {data.app_answers_set} of {data.total_questions} cases
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label>
            <span className="sr-only">Doctor</span>
            <select value={doctor} onChange={(e) => setDoctor(e.target.value)} className={`${selectCls} max-w-[260px]`}>
              <option value="all">All doctors</option>
              {doctors.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Result</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className={selectCls}>
              <option value="all">All results</option>
              <option value="agree">Agree</option>
              <option value="differ">Differ</option>
              <option value="none">Not compared</option>
            </select>
          </label>
        </div>
      </div>

      {data.app_answers_set === 0 && (
        <div className="flex gap-3 border-b border-line bg-[#f5f9ff] px-5 py-3.5 text-[13px] leading-relaxed text-ink-2">
          <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />
          <p>
            No application answers have been added yet, so nothing can be compared. Add an{' '}
            <code className="rounded bg-white px-1 py-0.5 text-[12px]">"app_answer"</code> to each case in{' '}
            <code className="rounded bg-white px-1 py-0.5 text-[12px]">backend/data/questions.json</code> and push to GitHub.
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-12 text-center text-[15px] text-muted">
          {data.rows.length === 0 ? 'No answers have been saved yet.' : 'No answers match these filters.'}
        </p>
      ) : (
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full min-w-[860px] text-left text-[14px]">
            <thead className="sticky top-0 z-10 bg-[#fafafa] text-[12px] uppercase tracking-[0.06em] text-muted">
              <tr>
                {multiDoctor && <th className="px-5 py-3 font-medium">Doctor</th>}
                <th className="px-5 py-3 font-medium">Case</th>
                <th className="px-5 py-3 font-medium">Doctor's answer</th>
                <th className="px-5 py-3 font-medium">Application's answer</th>
                <th className="px-5 py-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={`${r.doctor_id}-${r.question_id}`} className="align-top transition hover:bg-[#fafafa]">
                  {multiDoctor && (
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-ink">{r.full_name}</div>
                      <div className="text-[12px] text-muted">{r.email}</div>
                    </td>
                  )}
                  <td className="px-5 py-3.5">
                    <div className="text-[12px] font-medium text-muted">
                      Phase {r.phase} · Q{r.position}
                      {!r.phase_submitted && <span className="ml-1.5 text-[#b25000]">(draft)</span>}
                    </div>
                    <div className="text-ink">{r.question_title}</div>
                  </td>
                  <td className="px-5 py-3.5 text-ink">
                    <DoctorAnswer row={r} />
                  </td>
                  <td className="px-5 py-3.5 text-ink">{r.app_answer || <span className="text-muted">—</span>}</td>
                  <td className="px-5 py-3.5">
                    <Result row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
