# Attendance Checker (دفتر الغياب)

A small web app for a university lecturer ("the doctor") in Egypt. Students sign a paper sheet in each lecture
by writing their names in Arabic handwriting. She photographs the sheet(s), picks the lecture date, and the app
marks the official Excel roster: **✓ present, ✗ absent**, in a new column headed with that date.
`SPEC.md` has the screens and the Excel rules.

## Architecture
- **Static site on GitHub Pages** (`https://omaralaa7.github.io/attendance-checker/`). No build step.
  - `index.html`: Arabic RTL UI. Loads ExcelJS 4.4.0 from cdnjs and `app.js` as a module.
  - `app.js`: UI, photo prep (EXIF rotate, long side ≤ 1568 px, JPEG), calls the relay, save/download.
  - `core.js`: pure logic shared with tests: roster parsing, writing the date column, layout fitting, prompt, JSON parsing.
  - `pdf.js`: one-lecture PDF report. Pages are drawn on a canvas (correct Arabic shaping), then placed into
    jsPDF 2.5.1 (cdnjs, loaded on first click) as JPEG images, A4 at 150 dpi.
  - The working workbook is kept in the doctor's browser (localStorage `ghiab_wb`, previous copy in `ghiab_wb_prev`).
- **Cloudflare Worker relay** (`worker/worker.js`, deployed as `attendance-relay.omaralaa20042004.workers.dev`).
  Holds `GEMINI_API_KEY` as a secret and only accepts requests from `ALLOWED_ORIGINS` (plus localhost).
  It calls the **free Gemini API** with low thinking, trying `gemini-3-flash-preview` → `gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-3.7-flash`
  for up to 3 rounds when they are overloaded (503); the page then retries twice more after 30 s. Lite models were
  measured at ~94% and mark erased names present, so they are deliberately excluded.
- Constraints: zero running cost, and the doctor is non-technical (no keys or setup on her side).
  The repo is **public**, so never commit `samples/`, `.env`, or any roster or student data.

## Dev
- `npm install` then `npm test` runs the Node tests (`tests/core.test.mjs`). They use `samples/` if present.
- Local run: `node worker/dev-server.mjs` (reads `GEMINI_API_KEY` from `.env`, port 8787), serve the folder on
  port 8000, and open `http://localhost:8000/?relay=http://127.0.0.1:8787`. The `?relay=` override only works on localhost.

## Test data (`samples/`, gitignored: real student names)
- `roster.xlsx`: faculty export, 98 students, header row 7 (`م | كود الطالب | اسم الطالب | برنامج الطالب`),
  cells padded with U+00A0, title block with merges in rows 1–6.
- `sheet_power_2026-10-11.jpg`, `sheet_communications_2026-10-11.jpg`: the handwritten sheets for 11 Oct 2026.
- `expected_2026-10-11.json`: 83 clearly present, 15 absent, serials 30 and 40 faded on paper. Rule since 2026-10-16:
  any name the model can read counts as present, so the correct result is **85 present, 13 absent**.
- `expected_output_2026-10-11.xlsx`: what the finished Excel should look like.

## Conventions
- On every release bump the `?v=` number in `index.html` (app.js), in `app.js` (core.js, pdf.js) and in `pdf.js` (core.js).
  GitHub Pages lets browsers cache files for 10 minutes; without the bump the doctor can run stale code.
- Commits are under the user's name only: no Claude co-author trailer.
