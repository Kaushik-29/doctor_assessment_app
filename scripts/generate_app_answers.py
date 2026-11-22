"""Fill "app_answer" in backend/data/questions.json from MedResolve's local LLM.

MedResolve's full consultation pipeline deliberately does not name diagnoses (red-flag cases get an
emergency warning, others get record-based information), so its answers cannot be compared with a
doctor's choice. This script instead asks the same local model MedResolve uses (Ollama, default
llama3.2:3b) to pick one listed diagnosis per case, deterministically (temperature 0, fixed seed).

Run from the doctor_assessment_app folder with Ollama running:
    python scripts/generate_app_answers.py
Options: --model, --url, --only-missing. A record of every prompt and raw reply is written to
backend/data/app_answers_run.json.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = ROOT / "backend" / "data" / "questions.json"
RUN_LOG = ROOT / "backend" / "data" / "app_answers_run.json"

SYSTEM = ("You are a clinical decision-support model taking a diagnostic multiple-choice assessment. "
          "Read the case and choose the single most likely diagnosis from the listed options.")


def post(url: str, payload: dict, timeout: float = 300) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def model_digest(base: str, model: str) -> str:
    with urllib.request.urlopen(f"{base}/api/tags", timeout=5) as r:
        for m in json.load(r).get("models", []):
            if m["name"] == model:
                return m.get("digest", "")
    raise SystemExit(f"Model {model!r} is not installed in Ollama. Run: ollama pull {model}")


def ask(base: str, model: str, q: dict) -> tuple[int, str, str]:
    letters = [chr(65 + i) for i in range(len(q["options"]))]
    opts = "\n".join(f"{l}. {o}" for l, o in zip(letters, q["options"]))
    prompt = (f"Case: {q['vignette']}\n\nQuestion: {q.get('prompt', 'What is the most likely diagnosis?')}\n\n"
              f"Options:\n{opts}\n\nReply with JSON only, in the form {{\"answer\": \"<letter>\"}}.")
    payload = {
        "model": model, "system": SYSTEM, "prompt": prompt, "stream": False,
        "format": {"type": "object", "properties": {"answer": {"type": "string", "enum": letters}},
                   "required": ["answer"]},
        "options": {"temperature": 0, "seed": 7, "num_predict": 20, "num_ctx": 4096},
    }
    for _ in range(3):
        raw = post(f"{base}/api/generate", payload).get("response", "")
        try:
            letter = json.loads(raw)["answer"].strip().upper()[:1]
            return letters.index(letter), raw, prompt
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
    raise RuntimeError(f"Question {q['id']}: no valid answer from the model (last reply: {raw!r})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="llama3.2:3b", help="Ollama model (MedResolve's default: llama3.2:3b)")
    ap.add_argument("--url", default="http://localhost:11434")
    ap.add_argument("--only-missing", action="store_true", help="skip questions that already have an app_answer")
    args = ap.parse_args()
    base = args.url.rstrip("/")
    digest = model_digest(base, args.model)

    bank = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    log = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "model": args.model,
           "model_digest": digest, "method": "multiple-choice pick, temperature 0, seed 7", "system": SYSTEM,
           "cases": []}
    t0 = time.time()
    todo = [q for q in bank["questions"] if not (args.only_missing and q.get("app_answer"))]
    for n, q in enumerate(todo, 1):
        idx, raw, prompt = ask(base, args.model, q)
        q["app_answer"] = q["options"][idx]
        log["cases"].append({"id": q["id"], "phase": q["phase"], "position": q["position"], "prompt": prompt,
                             "raw_reply": raw, "chosen_index": idx, "app_answer": q["app_answer"]})
        print(f"[{n}/{len(todo)}] Q{q['id']}: {chr(65 + idx)}. {q['app_answer']}", flush=True)
        # save as we go so an interrupted run keeps its progress
        QUESTIONS.write_text(json.dumps(bank, indent=2, ensure_ascii=False), encoding="utf-8")
    log["seconds"] = round(time.time() - t0, 1)
    RUN_LOG.write_text(json.dumps(log, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Done in {log['seconds']} s. Wrote {QUESTIONS.relative_to(ROOT)} and {RUN_LOG.relative_to(ROOT)}.")


if __name__ == "__main__":
    sys.exit(main())
