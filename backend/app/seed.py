"""Load the editable question bank (data/questions.json) into the database."""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

from .models import Question

PHASE_COUNT = 4
QUESTIONS_PER_PHASE = 10


class QuestionBankError(ValueError):
    pass


def load_bank(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        bank = json.load(fh)
    phases = bank.get("phases", [])
    questions = bank.get("questions", [])
    if len(phases) != PHASE_COUNT:
        raise QuestionBankError(f"Expected {PHASE_COUNT} phases, found {len(phases)}")
    ids = set()
    for q in questions:
        for key in ("id", "phase", "position", "vignette", "options"):
            if key not in q:
                raise QuestionBankError(f"Question {q.get('id')} is missing '{key}'")
        if q["id"] in ids:
            raise QuestionBankError(f"Duplicate question id {q['id']}")
        ids.add(q["id"])
        if not 1 <= q["phase"] <= PHASE_COUNT:
            raise QuestionBankError(f"Question {q['id']} has invalid phase {q['phase']}")
        if not isinstance(q["options"], list) or len(q["options"]) < 2:
            raise QuestionBankError(f"Question {q['id']} needs at least 2 options")
        ai = q.get("answer_index")
        if ai is not None and not 0 <= ai < len(q["options"]):
            raise QuestionBankError(f"Question {q['id']} answer_index out of range")
    for p in range(1, PHASE_COUNT + 1):
        n = sum(1 for q in questions if q["phase"] == p)
        if n != QUESTIONS_PER_PHASE:
            raise QuestionBankError(f"Phase {p} must have {QUESTIONS_PER_PHASE} questions, found {n}")
    return bank


def sync_questions(db: Session, bank: dict) -> None:
    """Upsert questions by id so edits to the JSON file take effect on restart."""
    existing = {q.id: q for q in db.query(Question).all()}
    for q in bank["questions"]:
        row = existing.get(q["id"]) or Question(id=q["id"])
        row.phase = q["phase"]
        row.position = q["position"]
        row.specialty = q.get("specialty", "")
        row.title = q.get("title", "")
        row.vignette = q["vignette"]
        row.prompt = q.get("prompt", "What is the most likely diagnosis?")
        row.options = list(q["options"])
        row.answer_index = q.get("answer_index")
        db.add(row)
    db.commit()
