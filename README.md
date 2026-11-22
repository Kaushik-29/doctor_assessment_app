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
- **Admin page** at `/admin`, protected by one admin password: counts of registered, started and completed doctors, a searchable table of every doctor's progress, a **Doctor vs application** table that puts each doctor's answer next to the application's answer for the same case, and **Download answers (CSV)** / **Download doctors (CSV)** buttons.
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

There are 26 tests. They cover registration, login and logout (including server-side session invalidation), password hashing, auth required on every endpoint, per-doctor data isolation, autosave (create, change, Other drafts, clear), validation, locked-phase access, submit rules, locking after submit, unlocking the next phase, resume (including the review screen) after logout and login, the completion summary, the optional answer key, the login rate limit, serving the built frontend, and the admin page (password required, rate limit, overview, both CSV exports, spreadsheet formula escaping), the doctor-vs-application comparison, and upgrading an older database.

## Put it online so doctors can use a link

In production a single service runs everything: the FastAPI server also serves the built React app. The repo includes a `Dockerfile` and a `render.yaml`.

**Important:** free hosts wipe their disk on every restart or redeploy, so the SQLite file is **not** safe online and doctors' answers would be lost. Use a free hosted Postgres database instead.

1. **Database (Neon, free):** sign up at https://neon.tech, create a project, and copy its connection string (`postgresql://...`).
2. **Web service (Render, free):** sign up at https://render.com and choose **New → Blueprint**. Pick this GitHub repo; Render reads `render.yaml`.
   When it asks for `DATABASE_URL`, paste the Neon connection string. For `DA_ADMIN_PASSWORD`, choose a long password for the admin page. Then deploy (the first build takes about 5 minutes).
3. Share the Render URL (for example `https://doctor-assessment.onrender.com`) with the doctors.

## Getting the doctors' answers

Open `<your app URL>/admin` (for example `https://doctor-assessment.onrender.com/admin`) and sign in with the admin password.
The page shows who has registered and how far each doctor has got, and has two download buttons:

- **Answers CSV:** one row per doctor per question: doctor details, phase, question number and title, `answer_type` (`option`, `other`, or `other_blank` for an Other answer with no text yet), the option letter, the diagnosis text, `app_answer` and `matches_app` (see below), whether that phase has been submitted, and when the answer was saved. With an answer key, a `matches_answer_key` column is added.
  Answers in phases a doctor has not submitted yet are included; filter on `phase_submitted = yes` for final answers only.
- **Doctors CSV:** one row per doctor with registration, start and completion times, phases submitted and questions answered.

Both open directly in Excel.

### Comparing doctors with the application

Add the application's diagnosis for each case as `"app_answer"` in `backend/data/questions.json`, then push to GitHub (Render redeploys):

```json
{ "id": 1, "phase": 1, "position": 1, "title": "Chest pain in a smoker", "options": ["..."],
  "app_answer": "Acute inferior ST-elevation myocardial infarction" }
```

**The current `app_answer` values come from MedResolve's local model.** MedResolve's full consultation pipeline is designed not to name diagnoses (for these cases it gives emergency warnings or record-based information instead), so its output cannot be compared with a doctor's choice.
`scripts/generate_app_answers.py` asks the same local model MedResolve uses (Ollama `llama3.2:3b`) to pick one listed option for each case, at temperature 0 with a fixed seed. Every prompt and raw reply is saved in `backend/data/app_answers_run.json`.
To regenerate them (Ollama must be running), run `python scripts/generate_app_answers.py` from the `doctor_assessment_app` folder, then push.

The admin page's **Doctor vs application** table then shows, for every saved answer: the doctor, the case, the doctor's answer, the application's answer, and **Agree** or **Differ**, with the overall agreement percentage. Filter it by doctor or by result.

- Answers agree when the texts are the same, ignoring capital letters, spaces and punctuation. Use the exact option wording in `app_answer` so that picking that option counts as agreement. An *Other* answer is compared by its typed text, so a differently worded but equivalent diagnosis shows as **Differ**: check those by hand.
- Cases with no `app_answer`, and *Other* answers with no text yet, show as not compared.
- `app_answer` is never sent to doctors. It is separate from `answer_index` (below), which also shows a score to doctors on their completion screen.
- Answers marked *(draft)* are in a phase the doctor has not submitted yet. Cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so typed text cannot run as a spreadsheet formula.

Admin access:

- Set the password with the `DA_ADMIN_PASSWORD` environment variable (on Render: the service's **Environment** tab; saving it restarts the service). If it is not set, the admin page is switched off.
- An admin sign-in lasts 12 hours. Changing the password signs the admin out everywhere.
- After 10 wrong admin passwords within 15 minutes, admin sign-in is refused for a while.
- The CSV files contain doctors' names and emails. Store them securely.

Notes:

- On Render's free plan the service sleeps after 15 minutes without visitors, and the first visit after that takes about 30–60 seconds to load. A paid plan removes this.
- **Keep-awake:** Render sleeps the free service after 15 minutes without a visit. Two things prevent that:
  1. **An external uptime monitor (recommended, reliable).** Create a free monitor at https://uptimerobot.com (or https://cron-job.org) for `https://doctor-assessment.onrender.com/api/health`, as an HTTP(s) check every 5 minutes.
  2. **GitHub Actions backup.** `.github/workflows/keep-alive.yml` asks GitHub to ping `/api/health` every 5 minutes. GitHub runs scheduled workflows on a best-effort basis, often late and sometimes skipped, so on its own it cannot guarantee the app stays awake.
     To ping a different address, set a repository variable `APP_URL` (Settings → Secrets and variables → Actions → Variables). To wake the app by hand: **Actions** tab → **Keep app awake** → **Run workflow**.
     GitHub pauses scheduled workflows in a repository with no commits for 60 days; re-enable it on the Actions tab.
  Running one free service around the clock uses about 744 of Render's 750 free instance hours a month, so do not run a second free service on the same Render account.
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
  - `DA_ADMIN_PASSWORD` turns on the `/admin` page and sets its password.
  - `DA_COOKIE_SECURE=1` marks the session cookie `Secure`. Set it when serving over HTTPS.
- Export the answers from the `/admin` page, or query the database directly. The tables are `doctors`, `answers` (`selected_index` or `is_other`/`other_text`), `phase_submissions` and `questions`.

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
      ├─ screens/AdminPage.tsx        # /admin: progress table and CSV downloads
      └─ components/                  # progress ring, modal, top bar, unlock overlay
```
