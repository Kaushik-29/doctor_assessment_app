"""SQLAlchemy models for the Doctor Diagnostic Assessment app."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    specialty: Mapped[str] = mapped_column(String(120), default="")
    registration_number: Mapped[str] = mapped_column(String(60), default="")
    password_hash: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Resume pointer: last place the doctor was looking at.
    last_phase: Mapped[int] = mapped_column(Integer, default=1)
    last_question_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_view: Mapped[str] = mapped_column(String(20), default="question")

    answers: Mapped[list["Answer"]] = relationship(back_populates="doctor", cascade="all, delete-orphan")
    submissions: Mapped[list["PhaseSubmission"]] = relationship(cascade="all, delete-orphan")
    sessions: Mapped[list["AuthSession"]] = relationship(cascade="all, delete-orphan")


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    phase: Mapped[int] = mapped_column(Integer, index=True)
    position: Mapped[int] = mapped_column(Integer)
    specialty: Mapped[str] = mapped_column(String(80), default="")
    title: Mapped[str] = mapped_column(String(200), default="")
    vignette: Mapped[str] = mapped_column(Text)
    prompt: Mapped[str] = mapped_column(String(300), default="What is the most likely diagnosis?")
    options: Mapped[list] = mapped_column(JSON)
    # Optional answer key (index into options). Never sent to the client.
    answer_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # The application's own diagnosis for this case, for the admin comparison. Never sent to doctors.
    app_answer: Mapped[str] = mapped_column(Text, default="")


class Answer(Base):
    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("doctor_id", "question_id", name="uq_answer_doctor_question"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    selected_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_other: Mapped[bool] = mapped_column(default=False)
    other_text: Mapped[str] = mapped_column(String(500), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    doctor: Mapped[Doctor] = relationship(back_populates="answers")

    @property
    def is_complete(self) -> bool:
        if self.is_other:
            return bool(self.other_text.strip())
        return self.selected_index is not None


class PhaseSubmission(Base):
    __tablename__ = "phase_submissions"
    __table_args__ = (UniqueConstraint("doctor_id", "phase", name="uq_submission_doctor_phase"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id", ondelete="CASCADE"), index=True)
    phase: Mapped[int] = mapped_column(Integer)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
