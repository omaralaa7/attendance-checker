// Pure logic shared by the page and the tests: roster parsing, writing the date column,
// the prompt, and parsing the model's JSON. Works on ExcelJS worksheets; no DOM access.

export const PRESENT = "✓", ABSENT = "✗";
const GREEN_FONT = "FF006100", GREEN_FILL = "FFC6EFCE";
const RED_FONT = "FF9C0006", RED_FILL = "FFFFC7CE";
const YELLOW_FILL = "FFFFEB9C";

export function clean(v) {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getUTCDate()}/${v.getUTCMonth() + 1}/${v.getUTCFullYear()}`;
  if (typeof v === "object") {
    if (v.richText) return clean(v.richText.map(t => t.text).join(""));
    if (v.text != null) return clean(v.text);
    if (v.result != null) return clean(v.result);
    return "";
  }
  return String(v).replace(/ /g, " ").trim();
}

/** "2026-10-11" -> "11/10/2026" */
export function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${+d}/${+m}/${y}`;
}

export function headerToIso(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = clean(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export class RosterError extends Error {}

export function parseRoster(ws) {
  let headerRow = 0, nameCol = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 50) && !headerRow; r++) {
    ws.getRow(r).eachCell((c, ci) => {
      if (!headerRow && clean(c.value).includes("اسم الطالب")) { headerRow = r; nameCol = ci; }
    });
  }
  if (!headerRow) throw new RosterError('مش لاقي عمود "اسم الطالب" في الملف.');

  let serialCol = 1;
  const dateCols = {};
  ws.getRow(headerRow).eachCell((c, ci) => {
    if (clean(c.value) === "م") serialCol = ci;
    const iso = headerToIso(c.value);
    if (iso) dateCols[iso] = ci;
  });

  const students = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = clean(row.getCell(nameCol).value).split(/\s+/).join(" ");
    if (!name) continue;
    const s = clean(row.getCell(serialCol).value);
    students.push({ serial: /^\d+$/.test(s) ? +s : students.length + 1, row: r, name });
  }
  if (!students.length) throw new RosterError('الملف مفيهوش أسماء طلبة تحت عمود "اسم الطالب".');

  return { title: clean(ws.getCell("B2").value), headerRow, nameCol, serialCol, students, dateCols };
}

/** Marks stored for a date: {marks:{serial:"p"|"a"}, doubts:{serial:true}} */
export function readMarks(ws, roster, iso) {
  const col = roster.dateCols[iso];
  const marks = {}, doubts = {};
  if (!col) return { marks, doubts };
  for (const s of roster.students) {
    const c = ws.getRow(s.row).getCell(col);
    const v = clean(c.value);
    if (v === PRESENT) marks[s.serial] = "p";
    else if (v === ABSENT) marks[s.serial] = "a";
    if (/FFEB9C$/i.test(c.fill?.fgColor?.argb || "")) doubts[s.serial] = true;
  }
  return { marks, doubts };
}

const clone = o => (o == null ? undefined : JSON.parse(JSON.stringify(o)));

/** Write (or overwrite) the attendance column for `iso`. Returns the column index. */
export function writeColumn(ws, iso, marks, doubts = {}) {
  const roster = parseRoster(ws);
  const hdr = ws.getRow(roster.headerRow);
  let col = roster.dateCols[iso];
  if (!col) {
    let last = 0;
    hdr.eachCell((c, ci) => { if (clean(c.value)) last = Math.max(last, ci); });
    col = last + 1;
  }

  const ref = hdr.getCell(Math.max(1, col - 1));
  const hc = hdr.getCell(col);
  hc.value = fmtDate(iso);
  // assign a fresh style object: ExcelJS cells can share style objects
  hc.style = { ...clone(col > 1 ? ref.style : {}), alignment: { horizontal: "center", vertical: "middle" } };
  ws.getColumn(col).width = 14;

  for (const s of roster.students) {
    const row = ws.getRow(s.row);
    const c = row.getCell(col);
    const m = marks[s.serial];
    const border = clone(row.getCell(roster.nameCol).border);
    if (m !== "p" && m !== "a") {
      c.value = null;
      c.style = { border, alignment: { horizontal: "center", vertical: "middle" } };
      continue;
    }
    const present = m === "p";
    const fill = doubts[s.serial] ? YELLOW_FILL : present ? GREEN_FILL : RED_FILL;
    c.value = present ? PRESENT : ABSENT;
    c.style = {
      font: { bold: true, size: 14, color: { argb: present ? GREEN_FONT : RED_FONT } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: fill }, bgColor: { argb: fill } },
      border,
      alignment: { horizontal: "center", vertical: "middle" },
    };
  }
  return col;
}

// ---------- reading the sheets ----------

export function buildPrompt(students, nPages) {
  const roster = students.map(s => `${s.serial}|${s.name}`).join("\n");
  return `أنت بتقرأ ورق حضور محاضرة في كلية هندسة مصرية، مكتوب بخط اليد بالعربي. الطلبة كتبوا أساميهم بنفسهم في الورقة.
الصور المرفقة هي ${nPages} ورقة.
اقرأ كل اسم مكتوب، وطابقه مع كشف الطلبة الرسمي ده (الصيغة: رقم_الطالب|الاسم الكامل). الاسم المكتوب غالباً أقصر (اسم الطالب + الأب + الجد أو اللقب)، والإملاء ممكن يختلف (ه/ة، ى/ي، أ/ا، عبد الله/عبدالله).
المطابقة لازم تبدأ بالاسم الأول واسم الأب: متطابقش طالب لمجرد إن الجد أو اللقب شبه بعض. لو الاسم الأول مختلف يبقى مش هو.
لو اسم متشطب أو ممسوح أو باهت جداً اعتبره "مشكوك" (doubt=true).
الكشف:
${roster}

رد بـ JSON فقط بالشكل ده بدون أي كلام تاني:
{"present":[{"serial":رقم_الطالب,"written":"الاسم كما هو مكتوب","doubt":false}],"unmatched":["اسم مكتوب مش لاقي له مقابل"]}
متكررش نفس serial. لو مش متأكد من المطابقة بين طالبين حط doubt=true.`;
}

/** Pull the outermost {...} out of the model text (tolerates code fences / chatter). */
export function extractJson(text) {
  let t = String(text || "").trim();
  if (t.startsWith("```")) t = t.replace(/^```[^\n]*\n?/, "").replace(/```\s*$/, "");
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i < 0 || j <= i) throw new SyntaxError("no JSON object in response");
  const obj = JSON.parse(t.slice(i, j + 1));
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new SyntaxError("JSON is not an object");
  return obj;
}

/** Model JSON -> {marks:{serial:"p"|"a"}, doubts:{serial:note}, unmatched:[]} */
export function applyResult(obj, students) {
  const valid = new Set(students.map(s => s.serial));
  const marks = {}, doubts = {}, seen = new Set();
  for (const s of students) marks[s.serial] = "a";
  for (const p of Array.isArray(obj.present) ? obj.present : []) {
    if (!p || typeof p !== "object") continue;
    const serial = Number(String(p.serial ?? p.row ?? "").trim());
    if (!Number.isInteger(serial) || !valid.has(serial) || seen.has(serial)) continue;
    seen.add(serial);
    const written = String(p.written || "").trim();
    if (p.doubt === true || p.doubt === "true" || p.doubt === 1) {
      marks[serial] = "a";
      doubts[serial] = written ? `مكتوب: ${written} (باهت/متشطب أو مش واضح)` : "مش واضح في الورقة";
    } else {
      marks[serial] = "p";
    }
  }
  const unmatched = (Array.isArray(obj.unmatched) ? obj.unmatched : [])
    .filter(u => typeof u === "string" && u.trim()).map(u => u.trim());
  return { marks, doubts, unmatched };
}
