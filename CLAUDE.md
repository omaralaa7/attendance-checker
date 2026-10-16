# Attendance App (دفتر الغياب) — build brief for Claude Code

You are building a small **local** web app for a university lecturer's assistant in Egypt.
Students sign a paper sheet in each lecture by writing their own names in Arabic handwriting.
The user photographs the sheet(s), picks the lecture date, and the app marks the official
Excel roster: **✓ for present, ✗ for absent**, in a new column headed with that date.

Read `SPEC.md` for the full requirements. Work through it, then follow "Finish" below.

## Stack (decided — don't re-ask)
- **Python 3.10+**, **FastAPI** + **uvicorn** backend, **openpyxl** for Excel, official **anthropic** Python SDK for reading the handwriting.
- Frontend: one static `index.html` (+ optional `app.js` / `app.css`) served by FastAPI. No build step, no Node.
- Arabic, right-to-left UI. `reference/prototype.html` is a working browser prototype of the same app
  (it used a different runtime for the AI call and for downloads). Reuse its UX, layout, wording and prompt; replace
  `claude.use("sample")` with a call to the backend, and `claude.use("downloads")` with a normal file download.
- Config via `.env` (load with python-dotenv): `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (default `claude-opus-5-5`).
  Ship `.env.example`; never commit `.env`.
- Start command: `python run.py` → starts uvicorn on `127.0.0.1:8000` and opens the browser.
  Also add `start.bat` (Windows) and `start.sh` that create a venv, install `requirements.txt`, and run it.

## Project layout to create
```
app/main.py          FastAPI routes
app/excel.py         roster parsing + writing the date column
app/vision.py        image preprocessing + Claude call + JSON parsing + matching
app/static/index.html
data/                working workbook lives here (gitignored)
tests/               pytest
run.py, requirements.txt, start.bat, start.sh, .env.example, .gitignore, README.md
```

## Test data (in `samples/`)
- `roster.xlsx` — real roster export from the faculty system (98 students). Header row is row 7:
  `م | كود الطالب | اسم الطالب | برنامج الطالب`. Cells contain non-breaking spaces (U+00A0) — strip them.
  Rows 1–6 are a title block with merged cells; keep them intact.
- `sheet_power_2026-10-11.jpg`, `sheet_communications_2026-10-11.jpg` — the two handwritten sheets for the 11 Oct 2026 lecture.
- `expected_2026-10-11.json` — the hand-verified correct answer: 83 present, 15 absent; serials 30 and 40 are
  faded/erased on the paper and must come back as "doubtful" (marked absent, highlighted yellow).
- `expected_output_2026-10-11.xlsx` — what the finished Excel should look like.

## Tests you must write
1. `test_excel.py` (no network): parse `roster.xlsx` → 98 students, NBSP stripped; write a date column from the expected
   JSON → re-open, header cell is `11/10/2026`, 83 ✓ and 15 ✗, title block/merged cells unchanged; writing the same date
   twice overwrites the same column instead of adding a new one.
2. `test_vision.py`: unit-test the JSON extraction/validation with canned model output (no network).
3. `test_live.py`, marked `@pytest.mark.live`, skipped unless `ANTHROPIC_API_KEY` is set: run both sample photos through
   the real pipeline and compare with `expected_2026-10-11.json`. Report precision/recall; require ≥ 95% agreement.
   If the user has given you a key, run it and tune the prompt / image slicing until it passes.

## Finish
1. Run the offline tests until green. Run the app once and check the page loads.
2. Write `README.md` **in Egyptian Arabic**: what it does, how to get an API key, how to put it in `.env`, how to start it
   on Windows and Mac, how to use it, and that the key costs money per use.
3. Git: `git init`, commit, then create the GitHub repo with the `gh` CLI:
   `gh repo create attendance-app --private --source . --push`.
   **The repo must be private** and **`samples/` must be in `.gitignore`** — those files contain real students' names and
   handwriting. Also ignore `data/`, `.env`, `.venv/`, `__pycache__/`.
   If `gh` isn't installed or not logged in, tell the user to run `gh auth login` and stop there; don't put tokens in files.
4. Tell the user the repo URL and the one command to start the app.
