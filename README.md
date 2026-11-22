# Doctor Diagnostic Assessment

A standalone web app where doctors register and complete a 40-case diagnostic assessment in four phases of ten.
It sits inside the MedResolve folder but shares no code or data with MedResolve and uses no patient data.

- **Backend:** Python 3.11, FastAPI, SQLite (SQLAlchemy), bcrypt. Code in `backend/`.
- **Frontend:** React, TypeScript, Vite and Tailwind CSS. Code in `frontend/`.
- Everything runs locally. It makes no external API calls and needs no GPU.

> **Sample content.** The 40 cases in `backend/data/questions.json` are illustrative demo cases written for this app.
> They are **not validated assessment material**. Your clinical supervisor must review or replace them
> before the app is used with participating doctors.

## Features

- **Accounts:** register, sign in and sign out, one account per email. Passwords are hashed with bcrypt.
  The session is a random token in an `HttpOnly`, `SameSite=Lax` cookie, and the server stores only its SHA-256 hash, so signing out really ends the session.
  Every API call is limited to the signed-in doctor's own data.
- **40 cases in 4 phases.** Each case has a short vignette, multiple-choice diagnoses and an **Other / Not listed** option. Choosing Other opens a text box, and the answer counts only once a diagnosis is typed.
- **Navigation:** Previous and Next buttons, a 1–10 jump bar and a Review screen. Earlier answers can be changed until the phase is submitted.
  Keyboard: `A`–`F` chooses an option, `←`/`→` moves between cases, and all controls are reachable with Tab and show a focus ring.
- **Autosave:** a choice is saved as soon as it is made, and typed text about 0.7 s after typing stops. Failed saves are retried, and a status pill shows *Saving…*, *Saved* or *Not saved*.
- **Review & Submit** at the end of each phase lists all ten answers and flags any that are missing or incomplete. Submitting needs all ten answers.
  It locks the phase in the database, unlocks the next phase with a short animation, and leaves locked phases viewable but read-only (the server rejects edits with 409).
- **Progress and resume:** the overview shows an overall progress ring and a card for each phase (locked, active or submitted). When a doctor signs in again, the app reopens the exact case, or the review screen, they were last on.
- **Completion screen:** phases completed, questions answered, number of Other answers, completion time and a phase timeline.
  **No score is shown** unless you add an answer key (see below).

## Run it (Windows, PowerShell)

You need Python 3.11+ and Node 20+. Do the one-time setup first:

```powershell
cd D:\MedResolve\doctor_assessment_app\backend; python -m pip install -r requirements.txt
```

```powershell
cd D:\MedResolve\doctor_assessment_app\frontend; npm install
```

Then start each part in its own terminal.

**Backend** (http://127.0.0.1:8100):

```powershell
cd D:\MedResolve\doctor_assessment_app\backend; python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
```

**Frontend** (http://127.0.0.1:5180; it forwards `/api` to the backend):

```powershell
cd D:\MedResolve\doctor_assessment_app\frontend; npm run dev
```

Open http://127.0.0.1:5180 and register a doctor account.

In Claude Code's preview, the launch configurations `doctor-assessment-api` and `doctor-assessment-web` start the same two servers.

### Tests

```powershell
cd D:\MedResolve\doctor_assessment_app\backend; python -m pytest -q
```

There are 18 tests. They cover registration, login and logout (including server-side session invalidation), password hashing, auth required on every endpoint, per-doctor data isolation, autosave (create, change, Other drafts, clear), validation, locked-phase access, submit rules, locking after submit, unlocking the next phase, resume (including the review screen) after logout and login, the completion summary, the optional answer key, the login rate limit, and serving the built frontend.

## Put it online so doctors can use a link

In production a single service runs everything: the FastAPI server also serves the built React app. The repo includes a `Dockerfile` and a `render.yaml`.

**Important:** free hosts wipe their disk on every restart or redeploy, so the SQLite file is **not** safe online and doctors' answers would be lost. Use a free hosted Postgres database instead.

1. **Database (Neon, free):** sign up at https://neon.tech, create a project, and copy its connection string (`postgresql://...`).
2. **Web service (Render, free):** sign up at https://render.com and choose **New → Blueprint**. Pick this GitHub repo; Render reads `render.yaml`.
   When it asks for `DATABASE_URL`, paste the Neon connection string. Then deploy (the first build takes about 5 minutes).
3. Share the Render URL (for example `https://doctor-assessment.onrender.com`) with the doctors.

Notes:

- On Render's free plan the service sleeps after 15 minutes without visitors, and the first visit after that takes about 30–60 seconds to load. A paid plan removes this.
- The tables are created and the questions are loaded automatically on start. Editing `questions.json` and pushing to GitHub redeploys the app with the updated questions.
- The session cookie is marked `Secure` in production (`DA_COOKIE_SECURE=1`, set in the Dockerfile).
- After 10 failed sign-ins for the same email within 15 minutes, further attempts for that email are refused for a while.
- To run the production image locally: `docker build -t doctor-assessment .`, then `docker run -p 8000:8000 doctor-assessment`, and open http://localhost:8000.

## Editing the questions

All content is in **`backend/data/questions.json`**. The backend loads it at startup and updates questions by `id`, so **restart the backend after editing**.

```json
{
  "phases": [
    { "number": 1, "title": "Core Clinical Reasoning", "description": "Shown on the phase card." }
  ],
  "questions": [
    {
      "id": 1,
      "phase": 1,
      "position": 1,
      "specialty": "Cardiology",
      "title": "Chest pain in a smoker",
      "vignette": "A 58-year-old man ...",
      "prompt": "What is the most likely diagnosis?",
      "options": ["Option A", "Option B", "Option C", "Option D", "Option E"]
    }
  ]
}
```

Rules, which are checked at startup (the server refuses to start if any is broken):

- There must be exactly 4 phases, each with exactly 10 questions. `position` (1–10) sets the order within a phase.
- Each question needs at least 2 options. Up to 9 options work with the keyboard shortcuts. The app adds **Other / Not listed** automatically, so do not put it in `options`.
- `id` values must be unique and must **not be reused** for a different case once doctors have started, because saved answers are linked to the question `id` and the option index.
  If you change cases after doctors have answered, delete `backend/data/assessment.db` to start fresh.

### Optional answer key (scoring)

Add `"answer_index": <0-based index into options>` to a question. If any question has one, the completion screen adds a *Matched answer key* tile, counting only the keyed questions; an Other answer never counts as a match.
Answer keys are never sent to the browser while a doctor is answering.

## Data and configuration

- The database is `backend/data/assessment.db` (SQLite), created automatically. It is git-ignored. Delete it to reset all accounts and answers.
- Environment variables (all optional):
  - `DA_DATABASE_URL` points to another database (default: `sqlite:///.../backend/data/assessment.db`).
  - `DA_QUESTIONS_PATH` points to another question file.
  - `DA_COOKIE_SECURE=1` marks the session cookie `Secure`. Set it when serving over HTTPS.
- Export the answers for analysis with any SQLite tool. The tables are `doctors`, `answers` (`selected_index` or `is_other`/`other_text`), `phase_submissions` and `questions`.

## Project layout

```
doctor_assessment_app/
├─ backend/
│  ├─ app/main.py        # FastAPI app: auth, progress, answers, submission, summary
│  ├─ app/models.py      # SQLAlchemy models
│  ├─ app/seed.py        # questions.json validation + upsert
│  ├─ data/questions.json
│  └─ tests/test_api.py
└─ frontend/
   └─ src/
      ├─ App.tsx                      # view state, resume, unlock transition
      ├─ api.ts                       # typed API client
      ├─ screens/AuthScreen.tsx
      ├─ screens/Dashboard.tsx
      ├─ screens/PhaseWorkspace.tsx   # questions, autosave, review & submit
      ├─ screens/CompleteScreen.tsx
      └─ components/                  # progress ring, modal, top bar, unlock overlay
```
