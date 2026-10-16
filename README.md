# دفتر الغياب — Attendance Checker

Live: **https://omaralaa7.github.io/attendance-checker/**

Upload photos of a lecture's handwritten Arabic sign-in sheets, pick the date, and the app marks the course
roster Excel: ✓ present, ✗ absent, in a new column headed with the date. Unclear or faded names are highlighted
yellow for review, and every mark can be toggled before saving.

## How it works
- `index.html` + `app.js` + `core.js`: a static page (GitHub Pages). Excel is read and written in the browser with
  [ExcelJS](https://github.com/exceljs/exceljs), and the workbook is kept in the browser's localStorage.
- `worker/worker.js`: a Cloudflare Worker that holds the Gemini API key and forwards the photos and roster names to
  the free Gemini API. The key never appears in the page.

## Setup
1. **Gemini key**: [aistudio.google.com](https://aistudio.google.com) → Get API key (free tier).
2. **Worker**: Cloudflare → Workers & Pages → Create → Hello World → paste `worker/worker.js` → Deploy.
   Under Settings → Variables and Secrets add:
   - `GEMINI_API_KEY` (Secret)
   - `ALLOWED_ORIGINS` (Text): `https://omaralaa7.github.io`
3. **Page**: set `PROD_RELAY` in `app.js` to the Worker URL, then enable GitHub Pages
   (Settings → Pages → Deploy from branch → `main` / root).

## Development
```bash
npm install
npm test
```
To run it locally, create `.env` with `GEMINI_API_KEY=...`, then:
```bash
node worker/dev-server.mjs
```
```bash
python -m http.server 8000
```
Then open `http://localhost:8000/?relay=http://127.0.0.1:8787`.

`samples/` (real student data) is gitignored. Never commit it.
