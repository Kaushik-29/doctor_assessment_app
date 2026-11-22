import json
import os
from pathlib import Path

import pytest

os.environ["DA_SKIP_DEFAULT_APP"] = "1"
from fastapi.testclient import TestClient  # noqa: E402

from app.main import COOKIE_NAME, create_app  # noqa: E402

QUESTIONS = Path(__file__).resolve().parent.parent / "data" / "questions.json"
PW = "correct-horse-1"


@pytest.fixture
def app(tmp_path):
    return create_app(database_url=f"sqlite:///{(tmp_path / 't.db').as_posix()}", questions_path=QUESTIONS)


def new_client(app):
    return TestClient(app)


def register(client, email="dr.a@example.com", name="Dr A"):
    r = client.post("/api/auth/register", json={"email": email, "password": PW, "full_name": name,
                                                "specialty": "Internal Medicine"})
    assert r.status_code == 201, r.text
    return r.json()


def phase_qids(client, phase):
    r = client.get(f"/api/phases/{phase}")
    assert r.status_code == 200, r.text
    return [q["id"] for q in r.json()["questions"]]


def answer_all(client, phase, other_on=None):
    for i, qid in enumerate(phase_qids(client, phase)):
        if other_on is not None and i == other_on:
            body = {"is_other": True, "other_text": "Sarcoidosis"}
        else:
            body = {"selected_index": i % 3}
        assert client.put(f"/api/answers/{qid}", json=body).status_code == 200


# ---------------------------------------------------------------- auth
def test_register_login_logout_and_password_hashing(app):
    c = new_client(app)
    register(c)
    assert c.get("/api/auth/me").json()["email"] == "dr.a@example.com"
    cookie_header = None
    r = c.post("/api/auth/login", json={"email": "DR.A@example.com", "password": PW})
    assert r.status_code == 200
    cookie_header = r.headers["set-cookie"]
    assert COOKIE_NAME in cookie_header and "HttpOnly" in cookie_header and "samesite=lax" in cookie_header.lower()

    # password stored hashed, not in plain text
    from sqlalchemy import text
    with app.state.engine.connect() as conn:
        h = conn.execute(text("select password_hash from doctors")).scalar_one()
    assert h.startswith("$2") and PW not in h

    assert c.post("/api/auth/logout").status_code == 204
    assert c.get("/api/auth/me").status_code == 401


def test_logout_invalidates_server_side_session(app):
    c = new_client(app)
    register(c)
    token = c.cookies.get(COOKIE_NAME)
    c.post("/api/auth/logout")
    c2 = new_client(app)
    c2.cookies.set(COOKIE_NAME, token)
    assert c2.get("/api/auth/me").status_code == 401


def test_duplicate_email_and_bad_credentials(app):
    c = new_client(app)
    register(c)
    r = c.post("/api/auth/register", json={"email": "dr.a@example.com", "password": PW, "full_name": "Dup"})
    assert r.status_code == 409
    assert c.post("/api/auth/login", json={"email": "dr.a@example.com", "password": "wrong-pass"}).status_code == 401
    assert c.post("/api/auth/register", json={"email": "x@example.com", "password": "short", "full_name": "X Y"}).status_code == 422


def test_requires_auth(app):
    c = new_client(app)
    for method, url in [("get", "/api/progress"), ("get", "/api/phases/1"), ("put", "/api/answers/1"),
                        ("post", "/api/phases/1/submit"), ("get", "/api/summary")]:
        r = getattr(c, method)(url, json={}) if method in ("put", "post") else getattr(c, method)(url)
        assert r.status_code == 401, url


# ---------------------------------------------------------------- autosave & scoping
def test_autosave_update_and_clear(app):
    c = new_client(app)
    register(c)
    qid = phase_qids(c, 1)[0]
    r = c.put(f"/api/answers/{qid}", json={"selected_index": 2})
    assert r.json()["answer"]["selected_index"] == 2
    # change answer
    c.put(f"/api/answers/{qid}", json={"selected_index": 0})
    # switch to Other without text: saved as draft, not complete
    r = c.put(f"/api/answers/{qid}", json={"is_other": True, "other_text": "  "})
    assert r.json()["answer"]["is_other"] is True and r.json()["answer"]["is_complete"] is False
    r = c.put(f"/api/answers/{qid}", json={"is_other": True, "other_text": "Amyloidosis"})
    assert r.json()["answer"]["is_complete"] is True
    q = c.get("/api/phases/1").json()["questions"][0]
    assert q["answer"]["other_text"] == "Amyloidosis" and q["answer"]["selected_index"] is None
    assert "answer_index" not in q
    # clear
    r = c.put(f"/api/answers/{qid}", json={})
    assert r.json()["answer"] is None
    assert c.get("/api/phases/1").json()["questions"][0]["answer"] is None


def test_answer_validation(app):
    c = new_client(app)
    register(c)
    qid = phase_qids(c, 1)[0]
    assert c.put(f"/api/answers/{qid}", json={"selected_index": 99}).status_code == 422
    assert c.put(f"/api/answers/{qid}", json={"selected_index": 1, "is_other": True, "other_text": "x"}).status_code == 422
    assert c.put("/api/answers/9999", json={"selected_index": 0}).status_code == 404


def test_answers_are_scoped_per_doctor(app):
    a, b = new_client(app), new_client(app)
    register(a, "a@example.com", "Dr A")
    register(b, "b@example.com", "Dr B")
    qid = phase_qids(a, 1)[0]
    a.put(f"/api/answers/{qid}", json={"selected_index": 1})
    assert b.get("/api/phases/1").json()["questions"][0]["answer"] is None
    assert a.get("/api/progress").json()["phases"][0]["answered"] == 1
    assert b.get("/api/progress").json()["phases"][0]["answered"] == 0


# ---------------------------------------------------------------- phase submission & locking
def test_locked_phases_cannot_be_read_or_answered(app):
    c = new_client(app)
    register(c)
    assert c.get("/api/phases/2").status_code == 403
    assert c.put("/api/answers/11", json={"selected_index": 0}).status_code == 403
    assert c.post("/api/phases/2/submit").status_code == 403
    prog = c.get("/api/progress").json()
    assert [p["status"] for p in prog["phases"]] == ["active", "locked", "locked", "locked"]


def test_submit_requires_all_answers(app):
    c = new_client(app)
    register(c)
    qids = phase_qids(c, 1)
    for qid in qids[:8]:
        c.put(f"/api/answers/{qid}", json={"selected_index": 0})
    c.put(f"/api/answers/{qids[8]}", json={"is_other": True, "other_text": ""})  # other w/o text
    r = c.post("/api/phases/1/submit")
    assert r.status_code == 422
    assert r.json()["detail"]["incomplete_positions"] == [9, 10]


def test_submit_locks_phase_and_unlocks_next(app):
    c = new_client(app)
    register(c)
    answer_all(c, 1)
    r = c.post("/api/phases/1/submit")
    assert r.status_code == 200 and r.json()["next_phase"] == 2
    qid = phase_qids(c, 1)[0]
    # read-only now
    assert c.put(f"/api/answers/{qid}", json={"selected_index": 1}).status_code == 409
    assert c.post("/api/phases/1/submit").status_code == 409
    phase1 = c.get("/api/phases/1").json()
    assert phase1["status"] == "submitted" and all(q["answer"] for q in phase1["questions"])
    assert c.get("/api/phases/2").status_code == 200
    prog = c.get("/api/progress").json()
    assert [p["status"] for p in prog["phases"]] == ["submitted", "active", "locked", "locked"]
    assert prog["resume"] == {"view": "question", "phase": 2, "question_id": phase_qids(c, 2)[0]}


def test_full_completion_summary_without_answer_key(app):
    c = new_client(app)
    register(c)
    for p in range(1, 5):
        answer_all(c, p, other_on=p - 1)
        r = c.post(f"/api/phases/{p}/submit")
        assert r.status_code == 200
    assert r.json()["completed"] is True
    prog = c.get("/api/progress").json()
    assert prog["completed"] and prog["resume"]["view"] == "complete" and prog["total_answered"] == 40
    s = c.get("/api/summary").json()
    assert s["phases_completed"] == 4 and s["questions_answered"] == 40 and s["other_count"] == 4
    assert s["score"] is None and s["duration_seconds"] >= 0


def test_summary_unavailable_until_complete(app):
    c = new_client(app)
    register(c)
    assert c.get("/api/summary").status_code == 409


def test_score_shown_only_with_answer_key(tmp_path):
    bank = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    for q in bank["questions"]:
        q["answer_index"] = 0
    keyed = tmp_path / "keyed.json"
    keyed.write_text(json.dumps(bank), encoding="utf-8")
    app = create_app(database_url=f"sqlite:///{(tmp_path / 'k.db').as_posix()}", questions_path=keyed)
    c = new_client(app)
    register(c)
    for p in range(1, 5):
        for qid in phase_qids(c, p):
            c.put(f"/api/answers/{qid}", json={"selected_index": 0})
        c.post(f"/api/phases/{p}/submit")
    assert c.get("/api/summary").json()["score"] == {"correct": 40, "keyed_questions": 40}


# ---------------------------------------------------------------- resume
def test_resume_after_logout_login(app):
    c = new_client(app)
    register(c)
    qids = phase_qids(c, 1)
    c.put(f"/api/answers/{qids[0]}", json={"selected_index": 0})
    c.put(f"/api/answers/{qids[1]}", json={"selected_index": 1})
    assert c.put("/api/progress/position", json={"phase": 1, "question_id": qids[4], "view": "question"}).status_code == 204
    c.post("/api/auth/logout")

    c2 = new_client(app)
    c2.post("/api/auth/login", json={"email": "dr.a@example.com", "password": PW})
    prog = c2.get("/api/progress").json()
    assert prog["resume"] == {"view": "question", "phase": 1, "question_id": qids[4]}
    assert prog["phases"][0]["answered"] == 2 and prog["is_new"] is False
    answers = [q["answer"] for q in c2.get("/api/phases/1").json()["questions"]]
    assert answers[1]["selected_index"] == 1


def test_resume_on_review_screen(app):
    c = new_client(app)
    register(c)
    answer_all(c, 1)
    c.put("/api/progress/position", json={"phase": 1, "view": "review"})
    assert c.get("/api/progress").json()["resume"]["view"] == "review"


def test_position_rejects_locked_phase(app):
    c = new_client(app)
    register(c)
    assert c.put("/api/progress/position", json={"phase": 3, "question_id": 21}).status_code == 403


# ---------------------------------------------------------------- production extras
def test_login_rate_limit(app):
    c = new_client(app)
    register(c)
    for _ in range(10):
        assert c.post("/api/auth/login", json={"email": "dr.a@example.com", "password": "wrong-pass"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "dr.a@example.com", "password": PW}).status_code == 429


def test_serves_built_frontend(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "assets" / "a.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")
    monkeypatch.setenv("DA_STATIC_DIR", str(dist))
    app = create_app(database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}", questions_path=QUESTIONS)
    c = new_client(app)
    assert c.get("/").text == "<html>app</html>"
    assert c.get("/some/deep/link").text == "<html>app</html>"
    assert c.get("/assets/a.js").text == "console.log(1)"
    assert "nope" not in c.get("/..%2Fsecret.txt").text
    assert c.get("/api/does-not-exist").status_code == 404
    assert c.get("/api/health").json() == {"status": "ok"}


# ---------------------------------------------------------------- admin
ADMIN_PW = "admin-secret-99"


@pytest.fixture
def admin_app(tmp_path):
    return create_app(database_url=f"sqlite:///{(tmp_path / 'a.db').as_posix()}", questions_path=QUESTIONS,
                      admin_password=ADMIN_PW)


def admin_client(app):
    c = new_client(app)
    assert c.post("/api/admin/login", json={"password": ADMIN_PW}).status_code == 204
    return c


def test_admin_disabled_without_password(app):
    c = new_client(app)
    assert c.post("/api/admin/login", json={"password": "anything"}).status_code == 503
    assert c.get("/api/admin/overview").status_code == 503


def test_admin_requires_correct_password(admin_app):
    c = new_client(admin_app)
    for url in ["/api/admin/overview", "/api/admin/export/answers.csv", "/api/admin/export/doctors.csv"]:
        assert c.get(url).status_code == 401
    assert c.post("/api/admin/login", json={"password": "wrong"}).status_code == 401
    # a doctor session is not an admin session
    register(c)
    assert c.get("/api/admin/overview").status_code == 401
    # forged cookie
    c.cookies.set("da_admin", "9999999999.deadbeef", path="/api/admin")
    assert c.get("/api/admin/overview").status_code == 401


def test_admin_login_rate_limit(admin_app):
    c = new_client(admin_app)
    for _ in range(10):
        assert c.post("/api/admin/login", json={"password": "wrong"}).status_code == 401
    assert c.post("/api/admin/login", json={"password": ADMIN_PW}).status_code == 429


def test_admin_overview_and_logout(admin_app):
    d = new_client(admin_app)
    register(d)
    answer_all(d, 1)
    d.post("/api/phases/1/submit")
    register(new_client(admin_app), "b@example.com", "Dr B")
    a = admin_client(admin_app)
    ov = a.get("/api/admin/overview").json()
    assert ov["registered"] == 2 and ov["started"] == 1 and ov["completed"] == 0
    row = next(r for r in ov["doctors"] if r["email"] == "dr.a@example.com")
    assert row["phases_submitted"] == 1 and row["questions_answered"] == 10
    assert "password_hash" not in row
    assert a.post("/api/admin/logout").status_code == 204
    assert a.get("/api/admin/overview").status_code == 401


def test_admin_csv_exports(admin_app):
    import csv as csvmod
    import io
    d = new_client(admin_app)
    register(d, name="=HYPERLINK(evil)")
    answer_all(d, 1, other_on=2)
    d.post("/api/phases/1/submit")
    qid2 = phase_qids(d, 2)[0]
    d.put(f"/api/answers/{qid2}", json={"selected_index": 1})
    a = admin_client(admin_app)

    r = a.get("/api/admin/export/answers.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="answers.csv"' in r.headers["content-disposition"]
    rows = list(csvmod.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert len(rows) == 11
    assert rows[0]["full_name"] == "'=HYPERLINK(evil)"  # formula injection defused
    other = [x for x in rows if x["answer_type"] == "other"]
    assert len(other) == 1 and other[0]["answer_text"] == "Sarcoidosis"
    first = rows[0]
    q = d.get("/api/phases/1").json()["questions"][0]
    assert first["option_letter"] == "A" and first["answer_text"] == q["options"][0]
    assert first["phase_submitted"] == "yes" and rows[-1]["phase_submitted"] == "no"
    assert "matches_answer_key" not in first

    r = a.get("/api/admin/export/doctors.csv")
    docs = list(csvmod.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert len(docs) == 1 and docs[0]["phases_submitted"] == "1" and docs[0]["questions_answered"] == "11"


def _bank_with_app_answers(tmp_path):
    bank = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    for q in bank["questions"]:
        q.pop("app_answer", None)
        if q["phase"] == 1 and q["position"] <= 5:
            q["app_answer"] = q["options"][0].upper() + "  "  # case/spacing should not matter
    path = tmp_path / "app_answers.json"
    path.write_text(json.dumps(bank), encoding="utf-8")
    return path


def test_admin_comparison_with_app_answers(tmp_path):
    import csv as csvmod
    import io
    app = create_app(database_url=f"sqlite:///{(tmp_path / 'c.db').as_posix()}",
                     questions_path=_bank_with_app_answers(tmp_path), admin_password=ADMIN_PW)
    d = new_client(app)
    register(d)
    qs = d.get("/api/phases/1").json()["questions"]
    assert all("app_answer" not in q for q in qs)  # never sent to doctors
    d.put(f"/api/answers/{qs[0]['id']}", json={"selected_index": 0})        # agrees
    d.put(f"/api/answers/{qs[1]['id']}", json={"selected_index": 1})        # disagrees
    d.put(f"/api/answers/{qs[2]['id']}", json={"is_other": True, "other_text": qs[2]["options"][0].lower() + "."})  # agrees
    d.put(f"/api/answers/{qs[3]['id']}", json={"is_other": True, "other_text": ""})  # blank: not compared
    d.put(f"/api/answers/{qs[6]['id']}", json={"selected_index": 0})        # no app answer: not compared

    a = admin_client(app)
    c = a.get("/api/admin/comparison").json()
    assert c["app_answers_set"] == 5 and c["total_questions"] == 40
    assert c["compared"] == 3 and c["agreed"] == 2
    by_pos = {r["position"]: r for r in c["rows"]}
    assert by_pos[1]["matches_app"] is True and by_pos[2]["matches_app"] is False
    assert by_pos[3]["matches_app"] is True and by_pos[4]["matches_app"] is None
    assert by_pos[7]["matches_app"] is None and by_pos[7]["app_answer"] == ""
    assert by_pos[1]["app_answer"] == qs[0]["options"][0].upper()

    rows = list(csvmod.DictReader(io.StringIO(a.get("/api/admin/export/answers.csv").content.decode("utf-8-sig"))))
    assert [r["matches_app"] for r in rows] == ["yes", "no", "yes", "", ""]


def test_comparison_requires_admin(admin_app):
    assert new_client(admin_app).get("/api/admin/comparison").status_code == 401


def test_existing_database_gets_app_answer_column(tmp_path):
    import sqlite3
    db = tmp_path / "old.db"
    create_app(database_url=f"sqlite:///{db.as_posix()}", questions_path=QUESTIONS)
    con = sqlite3.connect(db)  # simulate a database made before app_answer existed
    con.execute("ALTER TABLE questions DROP COLUMN app_answer")
    con.commit()
    con.close()
    app = create_app(database_url=f"sqlite:///{db.as_posix()}", questions_path=_bank_with_app_answers(tmp_path),
                     admin_password=ADMIN_PW)
    assert admin_client(app).get("/api/admin/comparison").json()["app_answers_set"] == 5
