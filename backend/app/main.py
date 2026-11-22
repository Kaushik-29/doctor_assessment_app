"""Doctor Diagnostic Assessment API (FastAPI + SQLite).

Run from the backend/ folder:
    python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import time
from datetime import timedelta
from pathlib import Path
from typing import Literal, Optional

import bcrypt
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from .models import Answer, AuthSession, Base, Doctor, PhaseSubmission, Question, utcnow
from .seed import PHASE_COUNT, load_bank, sync_questions

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB = BACKEND_DIR / "data" / "assessment.db"
DEFAULT_QUESTIONS = BACKEND_DIR / "data" / "questions.json"
COOKIE_NAME = "da_session"
SESSION_DAYS = 7
LOGIN_MAX_FAILURES = 10
LOGIN_WINDOW_S = 15 * 60
EMAIL_RE =re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# --------------------------------------------------------------------------- schemas
class RegisterIn(BaseModel):
    email: str = Field(max_length=254)
    password: str
    full_name: str = Field(min_length=2, max_length=120)
    specialty: str = Field(default="", max_length=120)
    registration_number: str = Field(default="", max_length=60)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes")
        return v

    @field_validator("full_name", "specialty", "registration_number")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class LoginIn(BaseModel):
    email: str
    password: str


class AnswerIn(BaseModel):
    selected_index: Optional[int] = None
    is_other: bool = False
    other_text: str = Field(default="", max_length=500)


class PositionIn(BaseModel):
    phase: int
    question_id: Optional[int] = None
    view: Literal["question", "review"] = "question"


# --------------------------------------------------------------------------- helpers
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode())
    except ValueError:
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def iso(dt) -> Optional[str]:
    return dt.isoformat() + "Z" if dt else None


def doctor_out(d: Doctor) -> dict:
    return {
        "id": d.id,
        "email": d.email,
        "full_name": d.full_name,
        "specialty": d.specialty,
        "registration_number": d.registration_number,
        "created_at": iso(d.created_at),
    }


def submitted_phases(db: Session, doctor_id: int) -> dict[int, PhaseSubmission]:
    rows = db.query(PhaseSubmission).filter_by(doctor_id=doctor_id).all()
    return {r.phase: r for r in rows}


def active_phase(submitted: dict) -> Optional[int]:
    """First phase not yet submitted (None when all are done)."""
    for p in range(1, PHASE_COUNT + 1):
        if p not in submitted:
            return p
    return None


def phase_status(phase: int, submitted: dict) -> str:
    if phase in submitted:
        return "submitted"
    return "active" if phase == active_phase(submitted) else "locked"


# --------------------------------------------------------------------------- app factory
def create_app(
    database_url: Optional[str] = None,
    questions_path: Optional[Path] = None,
    cookie_secure: Optional[bool] = None,
) -> FastAPI:
    database_url = (
        database_url
        or os.environ.get("DA_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or f"sqlite:///{DEFAULT_DB.as_posix()}"
    )
    # Hosted Postgres providers hand out postgres:// URLs; SQLAlchemy wants postgresql://
    if database_url.startswith("postgres://"):
        database_url = "postgresql://" + database_url.removeprefix("postgres://")
    questions_path = Path(questions_path or os.environ.get("DA_QUESTIONS_PATH") or DEFAULT_QUESTIONS)
    if cookie_secure is None:
        cookie_secure = os.environ.get("DA_COOKIE_SECURE", "0") == "1"

    is_sqlite = database_url.startswith("sqlite")
    if database_url.startswith("sqlite:///"):
        Path(database_url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    if is_sqlite:
        engine = create_engine(database_url, connect_args={"check_same_thread": False})

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(conn, _):  # pragma: no cover - trivial
            cur = conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
    else:
        engine = create_engine(database_url, pool_pre_ping=True, pool_recycle=300)

    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(engine)
    bank = load_bank(questions_path)
    with SessionLocal() as db:
        sync_questions(db, bank)
    phase_meta = {p["number"]: p for p in bank["phases"]}

    app = FastAPI(title="Doctor Diagnostic Assessment API", version="1.0.0")
    app.state.engine = engine

    def get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def current_doctor(request: Request, db: Session = Depends(get_db)) -> Doctor:
        token = request.cookies.get(COOKIE_NAME)
        if not token:
            raise HTTPException(401, "Not signed in")
        sess = db.query(AuthSession).filter_by(token_hash=_token_hash(token)).first()
        if not sess or sess.expires_at < utcnow():
            raise HTTPException(401, "Session expired, please sign in again")
        doctor = db.get(Doctor, sess.doctor_id)
        if not doctor:
            raise HTTPException(401, "Not signed in")
        return doctor

    def start_session(db: Session, response: Response, doctor: Doctor) -> None:
        token = secrets.token_urlsafe(32)
        db.add(AuthSession(token_hash=_token_hash(token), doctor_id=doctor.id,
                           expires_at=utcnow() + timedelta(days=SESSION_DAYS)))
        db.commit()
        response.set_cookie(COOKIE_NAME, token, max_age=SESSION_DAYS * 86400, httponly=True,
                            secure=cookie_secure, samesite="lax", path="/")

    def require_phase_access(db: Session, doctor: Doctor, phase: int) -> dict:
        if not 1 <= phase <= PHASE_COUNT:
            raise HTTPException(404, "Phase not found")
        submitted = submitted_phases(db, doctor.id)
        if phase_status(phase, submitted) == "locked":
            raise HTTPException(403, f"Phase {phase} is locked. Submit the previous phase first.")
        return submitted

    def answer_out(a: Optional[Answer]) -> Optional[dict]:
        if a is None:
            return None
        return {
            "selected_index": a.selected_index,
            "is_other": a.is_other,
            "other_text": a.other_text,
            "is_complete": a.is_complete,
            "updated_at": iso(a.updated_at),
        }

    def phase_answers(db: Session, doctor_id: int, phase: int) -> tuple[list[Question], dict[int, Answer]]:
        qs = db.query(Question).filter_by(phase=phase).order_by(Question.position).all()
        ids = [q.id for q in qs]
        ans = db.query(Answer).filter(Answer.doctor_id == doctor_id, Answer.question_id.in_(ids)).all()
        return qs, {a.question_id: a for a in ans}

    # ------------------------------------------------------------------ auth
    @app.post("/api/auth/register", status_code=201)
    def register(body: RegisterIn, response: Response, db: Session = Depends(get_db)):
        if db.query(Doctor).filter_by(email=body.email).first():
            raise HTTPException(409, "An account with this email already exists")
        doctor = Doctor(email=body.email, full_name=body.full_name, specialty=body.specialty,
                        registration_number=body.registration_number,
                        password_hash=hash_password(body.password))
        db.add(doctor)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "An account with this email already exists")
        start_session(db, response, doctor)
        return doctor_out(doctor)

    failed_logins: dict[str, list[float]] = {}

    @app.post("/api/auth/login")
    def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
        email = body.email.strip().lower()
        now = time.monotonic()
        recent = [t for t in failed_logins.get(email, []) if now - t < LOGIN_WINDOW_S]
        if len(recent) >= LOGIN_MAX_FAILURES:
            raise HTTPException(429, "Too many failed sign-in attempts. Please wait 15 minutes and try again.")
        doctor = db.query(Doctor).filter_by(email=email).first()
        if not doctor or not verify_password(body.password, doctor.password_hash):
            failed_logins[email] = recent + [now]
            raise HTTPException(401, "Incorrect email or password")
        failed_logins.pop(email, None)
        start_session(db, response, doctor)
        return doctor_out(doctor)

    @app.post("/api/auth/logout", status_code=204)
    def logout(request: Request, response: Response, db: Session = Depends(get_db)):
        token = request.cookies.get(COOKIE_NAME)
        if token:
            db.query(AuthSession).filter_by(token_hash=_token_hash(token)).delete()
            db.commit()
        response.delete_cookie(COOKIE_NAME, path="/")
        response.status_code = 204
        return response

    @app.get("/api/auth/me")
    def me(doctor: Doctor = Depends(current_doctor)):
        return doctor_out(doctor)

    # ------------------------------------------------------------------ progress
    @app.get("/api/progress")
    def progress(doctor: Doctor = Depends(current_doctor), db: Session = Depends(get_db)):
        submitted = submitted_phases(db, doctor.id)
        phases = []
        total_answered = 0
        for p in range(1, PHASE_COUNT + 1):
            qs, ans = phase_answers(db, doctor.id, p)
            answered = sum(1 for q in qs if q.id in ans and ans[q.id].is_complete)
            total_answered += answered
            meta = phase_meta.get(p, {})
            phases.append({
                "phase": p,
                "title": meta.get("title", f"Phase {p}"),
                "description": meta.get("description", ""),
                "status": phase_status(p, submitted),
                "answered": answered,
                "total": len(qs),
                "submitted_at": iso(submitted[p].submitted_at) if p in submitted else None,
            })
        current = active_phase(submitted)
        # Work out where to resume.
        if current is None:
            resume = {"view": "complete", "phase": PHASE_COUNT, "question_id": None}
        elif doctor.last_phase == current:
            qid = doctor.last_question_id
            if qid is None or not db.query(Question).filter_by(id=qid, phase=current).first():
                qid = db.query(Question.id).filter_by(phase=current).order_by(Question.position).first()[0]
            resume = {"view": doctor.last_view, "phase": current, "question_id": qid}
        else:
            first = db.query(Question.id).filter_by(phase=current).order_by(Question.position).first()[0]
            resume = {"view": "question", "phase": current, "question_id": first}
        total_q = sum(ph["total"] for ph in phases)
        return {
            "phases": phases,
            "current_phase": current,
            "completed": current is None,
            "total_answered": total_answered,
            "total_questions": total_q,
            "started_at": iso(doctor.started_at),
            "completed_at": iso(doctor.completed_at),
            "resume": resume,
            "is_new": doctor.started_at is None,
        }

    @app.put("/api/progress/position", status_code=204)
    def save_position(body: PositionIn, doctor: Doctor = Depends(current_doctor), db: Session = Depends(get_db)):
        require_phase_access(db, doctor, body.phase)
        if body.question_id is not None and not db.query(Question).filter_by(id=body.question_id, phase=body.phase).first():
            raise HTTPException(422, "Question does not belong to this phase")
        doctor.last_phase = body.phase
        if body.question_id is not None:
            doctor.last_question_id = body.question_id
        doctor.last_view = body.view
        db.commit()
        return Response(status_code=204)

    # ------------------------------------------------------------------ questions & answers
    @app.get("/api/phases/{phase}")
    def get_phase(phase: int, doctor: Doctor = Depends(current_doctor), db: Session = Depends(get_db)):
        submitted = require_phase_access(db, doctor, phase)
        qs, ans = phase_answers(db, doctor.id, phase)
        meta = phase_meta.get(phase, {})
        return {
            "phase": phase,
            "title": meta.get("title", f"Phase {phase}"),
            "description": meta.get("description", ""),
            "status": phase_status(phase, submitted),
            "submitted_at": iso(submitted[phase].submitted_at) if phase in submitted else None,
            "questions": [
                {
                    "id": q.id,
                    "phase": q.phase,
                    "position": q.position,
                    "specialty": q.specialty,
                    "title": q.title,
                    "vignette": q.vignette,
                    "prompt": q.prompt,
                    "options": q.options,
                    "answer": answer_out(ans.get(q.id)),
                }
                for q in qs
            ],
        }

    @app.put("/api/answers/{question_id}")
    def save_answer(question_id: int, body: AnswerIn, doctor: Doctor = Depends(current_doctor),
                    db: Session = Depends(get_db)):
        q = db.get(Question, question_id)
        if not q:
            raise HTTPException(404, "Question not found")
        submitted = require_phase_access(db, doctor, q.phase)
        if q.phase in submitted:
            raise HTTPException(409, f"Phase {q.phase} has been submitted and is read-only")
        if body.is_other:
            if body.selected_index is not None:
                raise HTTPException(422, "Choose either a listed option or 'Other', not both")
        elif body.selected_index is not None and not 0 <= body.selected_index < len(q.options):
            raise HTTPException(422, "Option out of range")

        ans = db.query(Answer).filter_by(doctor_id=doctor.id, question_id=q.id).first()
        if not body.is_other and body.selected_index is None:
            # Clearing an answer.
            if ans:
                db.delete(ans)
            ans = None
        else:
            if ans is None:
                ans = Answer(doctor_id=doctor.id, question_id=q.id)
                db.add(ans)
            ans.selected_index = None if body.is_other else body.selected_index
            ans.is_other = body.is_other
            ans.other_text = body.other_text.strip()[:500] if body.is_other else ""
            ans.updated_at = utcnow()
            if doctor.started_at is None:
                doctor.started_at = utcnow()
        doctor.last_phase = q.phase
        doctor.last_question_id = q.id
        doctor.last_view = "question"
        db.commit()
        return {"question_id": q.id, "answer": answer_out(ans)}

    @app.post("/api/phases/{phase}/submit")
    def submit_phase(phase: int, doctor: Doctor = Depends(current_doctor), db: Session = Depends(get_db)):
        submitted = require_phase_access(db, doctor, phase)
        if phase in submitted:
            raise HTTPException(409, f"Phase {phase} has already been submitted")
        qs, ans = phase_answers(db, doctor.id, phase)
        incomplete = [q.position for q in qs if q.id not in ans or not ans[q.id].is_complete]
        if incomplete:
            raise HTTPException(422, {"message": "Answer every question before submitting this phase.",
                                      "incomplete_positions": incomplete})
        db.add(PhaseSubmission(doctor_id=doctor.id, phase=phase))
        finished = phase == PHASE_COUNT
        if finished:
            doctor.completed_at = utcnow()
        else:
            nxt = db.query(Question.id).filter_by(phase=phase + 1).order_by(Question.position).first()[0]
            doctor.last_phase = phase + 1
            doctor.last_question_id = nxt
            doctor.last_view = "question"
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, f"Phase {phase} has already been submitted")
        return {"phase": phase, "submitted": True, "next_phase": None if finished else phase + 1,
                "completed": finished}

    # ------------------------------------------------------------------ summary
    @app.get("/api/summary")
    def summary(doctor: Doctor = Depends(current_doctor), db: Session = Depends(get_db)):
        submitted = submitted_phases(db, doctor.id)
        if active_phase(submitted) is not None:
            raise HTTPException(409, "Complete all phases to see the summary")
        questions = {q.id: q for q in db.query(Question).all()}
        answers = db.query(Answer).filter_by(doctor_id=doctor.id).all()
        phases = []
        for p in range(1, PHASE_COUNT + 1):
            pa = [a for a in answers if questions[a.question_id].phase == p]
            phases.append({
                "phase": p,
                "title": phase_meta.get(p, {}).get("title", f"Phase {p}"),
                "answered": sum(1 for a in pa if a.is_complete),
                "other_count": sum(1 for a in pa if a.is_other),
                "submitted_at": iso(submitted[p].submitted_at),
            })
        start = doctor.started_at or doctor.created_at
        end = doctor.completed_at or utcnow()
        result = {
            "doctor": doctor_out(doctor),
            "phases_completed": len(submitted),
            "total_phases": PHASE_COUNT,
            "questions_answered": sum(1 for a in answers if a.is_complete),
            "total_questions": len(questions),
            "other_count": sum(1 for a in answers if a.is_other),
            "started_at": iso(start),
            "completed_at": iso(doctor.completed_at),
            "duration_seconds": int((end - start).total_seconds()),
            "phases": phases,
            "score": None,
        }
        keyed = [q for q in questions.values() if q.answer_index is not None]
        if keyed:
            by_q = {a.question_id: a for a in answers}
            correct = sum(1 for q in keyed if q.id in by_q and not by_q[q.id].is_other
                          and by_q[q.id].selected_index == q.answer_index)
            result["score"] = {"correct": correct, "keyed_questions": len(keyed)}
        return result

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    # ------------------------------------------------------------------ built frontend (production)
    static_dir = Path(os.environ.get("DA_STATIC_DIR") or BACKEND_DIR.parent / "frontend" / "dist")
    if (static_dir / "index.html").is_file():
        root = static_dir.resolve()

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "Not found")
            target = (root / path).resolve()
            if path and target.is_file() and root in target.parents:
                headers = {"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("assets/") else None
                return FileResponse(target, headers=headers)
            return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app() if os.environ.get("DA_SKIP_DEFAULT_APP") != "1" else None
