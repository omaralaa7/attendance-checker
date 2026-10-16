# SPEC — دفتر الغياب (local attendance marker)

## User and job
One user (lecturer's assistant), on a laptop, after each lecture. Takes 1–4 phone photos of handwritten
sign-in sheets (usually one sheet per section, e.g. "قوى" and "اتصالات"), and wants the official roster Excel
updated with that lecture's attendance. They review the result before saving. Everything runs on their machine;
only the images + roster names leave the browser (to Gemini, via the relay).

## Screens (single page, Arabic, RTL, works on phone width too)
1. **Lecture panel**: date picker (defaults to today), photo picker (multiple, drag-and-drop, thumbnails with remove ×),
   button "اقرأ الأسماء وعلّم الغياب", progress text, Cancel button while running.
2. **Roster panel**: shows course title (cell B2), student count, and the dates already recorded.
   "تغيير ملف الإكسل" uploads a new roster; it becomes the working workbook (kept in the browser's localStorage).
   On first start, if no working workbook exists, ask the user to upload one (do not ship real data as a default).
3. **Review list**: every student — serial, name, and a big toggle button (✓ green / ✗ red / – none). Clicking toggles.
   Filter chips with counts: الكل / حاضر / غايب / للمراجعة. Doubtful rows have a yellow background and show what was
   written on paper. Names read from paper that matched nobody are listed in a yellow box above the list.
   Picking a date that already has a column loads its marks for editing.
4. **Sticky bottom bar**: "✓ N حاضر · ✗ M غايب" and "حفظ ملف الإكسل" → writes the column into the working workbook
   and downloads `الغياب <d-m-yyyy>.xlsx`. The previous version is kept as a backup in localStorage.

## Excel rules
- Find the header row by the cell containing "اسم الطالب"; serial column is the header "م".
- Student rows: every row below the header with a non-empty name. Strip U+00A0 and whitespace.
- Attendance column: header text `d/m/yyyy` (e.g. `11/10/2026`). If a column with that date header exists, overwrite it;
  otherwise append after the last used header column. Copy the header style from the column to its left. Width 14.
- Cells: "✓" bold 14pt font #006100 on fill #C6EFCE; "✗" bold 14pt #9C0006 on #FFC7CE; doubtful → fill #FFEB9C.
  Centered, same border as the name cell. Never touch other cells, merges, or the title block.

## Reading the handwriting
- In the browser: apply EXIF orientation, resize so the long side is at most 1568 px, JPEG ~0.9. Whole photos are sent
  (splitting into halves was tested and was slower and slightly less accurate with Gemini).
- One request with all photos plus the roster as `serial|full name` lines, sent to the Cloudflare Worker, which forwards it to Gemini
  with JSON output. The prompt (Arabic, in `core.js`) keeps these rules: names on paper are shorter, spelling varies
  (ه/ة, ى/ي, أ/ا, عبد الله/عبدالله), a match must start with the first name and the father's name,
  and crossed-out, erased or very faded names get doubt=true.
- JSON: `{"present":[{"serial":n,"written":"…","doubt":false}],"unmatched":["…"]}`. Parse defensively (strip fences,
  take the outermost {…}), drop unknown or duplicate serials, and retry once on invalid JSON.
- Result: matched and not doubtful → ✓; doubtful → ✗ + yellow + note; everyone else → ✗.
- Show clear Arabic errors for: model busy, daily free quota used up, relay misconfigured, network failure.

## Relay API (Cloudflare Worker)
- `POST /` JSON `{images:[base64 jpeg…], prompt}` (max 6 images) → `{text, model}` or `{error, detail}`.
  The error codes are `busy`, `quota`, `key_or_request`, `missing_key`, `forbidden_origin`, `too_large`, `empty`, and `upstream_unreachable`.

## Out of scope
Logins, multiple users, databases, paid APIs.
