export type Doctor = {
  id: number
  email: string
  full_name: string
  specialty: string
  registration_number: string
  created_at: string
}

export type PhaseStatus = 'locked' | 'active' | 'submitted'

export type PhaseProgress = {
  phase: number
  title: string
  description: string
  status: PhaseStatus
  answered: number
  total: number
  submitted_at: string | null
}

export type Resume = { view: 'question' | 'review' | 'complete'; phase: number; question_id: number | null }

export type Progress = {
  phases: PhaseProgress[]
  current_phase: number | null
  completed: boolean
  total_answered: number
  total_questions: number
  started_at: string | null
  completed_at: string | null
  resume: Resume
  is_new: boolean
}

export type Answer = {
  selected_index: number | null
  is_other: boolean
  other_text: string
  is_complete: boolean
  updated_at?: string | null
}

export type Question = {
  id: number
  phase: number
  position: number
  specialty: string
  title: string
  vignette: string
  prompt: string
  options: string[]
  answer: Answer | null
}

export type PhaseData = {
  phase: number
  title: string
  description: string
  status: PhaseStatus
  submitted_at: string | null
  questions: Question[]
}

export type Summary = {
  doctor: Doctor
  phases_completed: number
  total_phases: number
  questions_answered: number
  total_questions: number
  other_count: number
  started_at: string
  completed_at: string | null
  duration_seconds: number
  phases: { phase: number; title: string; answered: number; other_count: number; submitted_at: string }[]
  score: { correct: number; keyed_questions: number } | null
}

export type AdminDoctor = Doctor & {
  started_at: string | null
  completed_at: string | null
  phases_submitted: number
  questions_answered: number
}

export type AdminOverview = {
  total_phases: number
  total_questions: number
  registered: number
  started: number
  completed: number
  doctors: AdminDoctor[]
}

export type ComparisonRow = {
  doctor_id: number
  full_name: string
  email: string
  phase: number
  position: number
  question_id: number
  question_title: string
  answer_type: 'option' | 'other' | 'other_blank'
  option_letter: string
  answer_text: string
  app_answer: string
  matches_app: boolean | null
  phase_submitted: boolean
}

export type AdminComparison = {
  app_answers_set: number
  total_questions: number
  compared: number
  agreed: number
  rows: ComparisonRow[]
}

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, message: string, detail: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

function messageFrom(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string }
    return (first.msg ?? fallback).replace(/^Value error, /, '')
  }
  if (detail && typeof detail === 'object' && 'message' in detail) return String((detail as { message: string }).message)
  return fallback
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(method: string, url: string, body?: unknown, opts: { quiet401?: boolean } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that the backend is running.', null)
  }
  if (res.status === 204) return undefined as T
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail
    if (res.status === 401 && !opts.quiet401 && onUnauthorized) onUnauthorized()
    throw new ApiError(res.status, messageFrom(detail, `Request failed (${res.status})`), detail)
  }
  return data as T
}

export const api = {
  me: () => request<Doctor>('GET', '/api/auth/me', undefined, { quiet401: true }),
  login: (email: string, password: string) =>
    request<Doctor>('POST', '/api/auth/login', { email, password }, { quiet401: true }),
  register: (body: { email: string; password: string; full_name: string; specialty: string; registration_number: string }) =>
    request<Doctor>('POST', '/api/auth/register', body, { quiet401: true }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  progress: () => request<Progress>('GET', '/api/progress'),
  phase: (n: number) => request<PhaseData>('GET', `/api/phases/${n}`),
  saveAnswer: (qid: number, body: { selected_index?: number | null; is_other?: boolean; other_text?: string }) =>
    request<{ question_id: number; answer: Answer | null }>('PUT', `/api/answers/${qid}`, body),
  savePosition: (phase: number, question_id: number | null, view: 'question' | 'review') =>
    request<void>('PUT', '/api/progress/position', { phase, question_id, view }),
  submitPhase: (n: number) =>
    request<{ phase: number; next_phase: number | null; completed: boolean }>('POST', `/api/phases/${n}/submit`),
  summary: () => request<Summary>('GET', '/api/summary'),
  adminLogin: (password: string) => request<void>('POST', '/api/admin/login', { password }, { quiet401: true }),
  adminLogout: () => request<void>('POST', '/api/admin/logout', undefined, { quiet401: true }),
  adminOverview: () => request<AdminOverview>('GET', '/api/admin/overview', undefined, { quiet401: true }),
  adminComparison: () => request<AdminComparison>('GET', '/api/admin/comparison', undefined, { quiet401: true }),
}

export function isComplete(a: Answer | null | undefined): boolean {
  if (!a) return false
  return a.is_other ? a.other_text.trim().length > 0 : a.selected_index !== null
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
