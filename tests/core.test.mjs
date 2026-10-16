import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import ExcelJS from "exceljs";
import * as core from "../core.js";

const S = new URL("../samples/", import.meta.url);
const hasSamples = existsSync(new URL("roster.xlsx", S));
const sample = { skip: !hasSamples && "samples/ not present" };

async function open(src) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(src instanceof URL ? readFileSync(src) : src);
  return wb;
}
const expected = () => JSON.parse(readFileSync(new URL("expected_2026-10-11.json", S), "utf8"));
function expectedMarks() {
  const e = expected(), present = new Set(e.present_serials);
  const marks = {}, doubts = {};
  for (let s = 1; s <= 98; s++) marks[s] = present.has(s) ? "p" : "a";
  for (const s of e.doubtful_serials_marked_absent) doubts[s] = true;
  return { marks, doubts };
}
const roundTrip = async wb => open(await wb.xlsx.writeBuffer());

test("parse roster", sample, async () => {
  const ws = (await open(new URL("roster.xlsx", S))).worksheets[0];
  const r = core.parseRoster(ws);
  assert.equal(r.students.length, 98);
  assert.deepEqual([r.headerRow, r.nameCol, r.serialCol], [7, 3, 1]);
  assert.deepEqual(r.students.map(s => s.serial), Array.from({ length: 98 }, (_, i) => i + 1));
  assert.equal(r.students[0].row, 8);
  assert.equal(r.students[0].name, "احمد جلال عبدالله عبيد عبدالله");
  assert.ok(r.students.every(s => !s.name.includes(" ") && s.name === s.name.trim()));
  assert.match(r.title, /القوى/);
  assert.deepEqual(r.dateCols, {});
});

test("write column matches expected output", sample, async () => {
  const before = (await open(new URL("roster.xlsx", S))).worksheets[0];
  const wb = await open(new URL("roster.xlsx", S));
  const { marks, doubts } = expectedMarks();
  assert.equal(core.writeColumn(wb.worksheets[0], "2026-10-11", marks, doubts), 5);

  const ws = (await roundTrip(wb)).worksheets[0];
  assert.equal(ws.getCell(7, 5).value, "11/10/2026");
  const vals = Array.from({ length: 98 }, (_, i) => ws.getCell(8 + i, 5).value);
  assert.equal(vals.filter(v => v === "✓").length, 83);
  assert.equal(vals.filter(v => v === "✗").length, 15);
  assert.match(ws.getCell(8, 5).fill.fgColor.argb, /C6EFCE$/);
  assert.match(ws.getCell(10, 5).fill.fgColor.argb, /FFC7CE$/);
  assert.match(ws.getCell(37, 5).fill.fgColor.argb, /FFEB9C$/);
  assert.equal(ws.getCell(37, 5).value, "✗");
  assert.equal(ws.getCell(8, 5).font.bold, true);
  assert.equal(ws.getCell(8, 5).font.size, 14);
  assert.equal(ws.getCell(7, 5).font.bold, true);
  assert.equal(ws.getCell(7, 5).fill.fgColor.argb, ws.getCell(7, 4).fill.fgColor.argb);
  assert.equal(ws.getColumn(5).width, 14);
  assert.equal(ws.getCell(8, 5).border.top.style, "thin");

  // title block, merges, original cells untouched; neighbouring cells didn't pick up the new style
  assert.deepEqual([...ws.model.merges].sort(), [...before.model.merges].sort());
  for (let r = 1; r <= 105; r++)
    for (let c = 1; c <= 4; c++)
      assert.deepEqual(ws.getCell(r, c).value, before.getCell(r, c).value, `cell ${r},${c}`);
  assert.equal(ws.getCell(8, 3).fill?.fgColor?.argb, before.getCell(8, 3).fill?.fgColor?.argb);
  assert.notEqual(ws.getCell(8, 3).font?.size, 14);

  // matches the hand-made reference workbook
  const ref = (await open(new URL("expected_output_2026-10-11.xlsx", S))).worksheets[0];
  for (let r = 7; r <= 105; r++) {
    assert.equal(ws.getCell(r, 5).value, ref.getCell(r, 5).value, `row ${r}`);
    assert.equal(ws.getCell(r, 5).fill.fgColor.argb.slice(-6), ref.getCell(r, 5).fill.fgColor.argb.slice(-6), `row ${r}`);
  }

  const r = core.parseRoster(ws);
  assert.deepEqual(r.dateCols, { "2026-10-11": 5 });
  const got = core.readMarks(ws, r, "2026-10-11");
  assert.equal(Object.values(got.marks).filter(v => v === "p").length, 83);
  assert.deepEqual(Object.keys(got.doubts).map(Number).sort((a, b) => a - b), [30, 40]);
});

test("same date overwrites the same column", sample, async () => {
  let wb = await open(new URL("roster.xlsx", S));
  const all = v => Object.fromEntries(Array.from({ length: 98 }, (_, i) => [i + 1, v]));
  core.writeColumn(wb.worksheets[0], "2026-10-11", all("a"));
  wb = await roundTrip(wb);
  core.writeColumn(wb.worksheets[0], "2026-10-18", all("p"));
  wb = await roundTrip(wb);
  assert.equal(core.writeColumn(wb.worksheets[0], "2026-10-11", all("p")), 5);
  const ws = (await roundTrip(wb)).worksheets[0];
  assert.equal(ws.getCell(7, 6).value, "18/10/2026");
  assert.equal(ws.getCell(7, 7).value, null);
  for (let r = 8; r <= 105; r++) assert.equal(ws.getCell(r, 5).value, "✓");
});

test("bad workbook has no name column", async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("x").getCell("A1").value = "hello";
  assert.throws(() => core.parseRoster(wb.worksheets[0]), core.RosterError);
});

test("dates", () => {
  assert.equal(core.fmtDate("2026-10-11"), "11/10/2026");
  assert.equal(core.headerToIso("11/10/2026"), "2026-10-11");
  assert.equal(core.headerToIso(" 1/2/2027 "), "2027-02-01");
  assert.equal(core.headerToIso(new Date(Date.UTC(2026, 9, 11))), "2026-10-11");
  assert.equal(core.headerToIso("كود الطالب"), null);
  assert.equal(core.headerToIso("40/13/2026"), null);
});

const STUDENTS = [1, 2, 3, 4, 5].map(i => ({ serial: i, row: i + 7, name: `طالب ${i}` }));

test("extractJson tolerates fences and chatter", () => {
  assert.deepEqual(core.extractJson('{"present":[],"unmatched":[]}'), { present: [], unmatched: [] });
  assert.equal(core.extractJson('ده الرد:\n```json\n{"present":[{"serial":1}]}\n```\nشكراً').present[0].serial, 1);
  assert.deepEqual(core.extractJson('```json\n{"unmatched":["س"]}\n```').unmatched, ["س"]);
  assert.throws(() => core.extractJson("no json"), SyntaxError);
  assert.throws(() => core.extractJson('{"present": [1, 2,'), SyntaxError);
});

test("applyResult rules", () => {
  const r = core.applyResult({
    present: [
      { serial: 1, written: "طالب", doubt: false },
      { serial: "2", written: "ط", doubt: true },
      { serial: 1, written: "dup", doubt: true },
      { serial: 99, written: "unknown" },
      { serial: "abc" },
      { row: 4, written: "old key" },
      "not a dict",
    ],
    unmatched: ["محمد مجهول", "", null],
  }, STUDENTS);
  assert.deepEqual(r.marks, { 1: "p", 2: "a", 3: "a", 4: "p", 5: "a" });
  assert.deepEqual(Object.keys(r.doubts), ["2"]);
  assert.match(r.doubts[2], /ط/);
  assert.deepEqual(r.unmatched, ["محمد مجهول"]);
  const empty = core.applyResult({}, STUDENTS);
  assert.ok(Object.values(empty.marks).every(m => m === "a"));
});

test("prompt contains the roster", () => {
  const p = core.buildPrompt(STUDENTS, 2);
  assert.match(p, /3\|طالب 3/);
  assert.match(p, /2 ورقة/);
});

test("prompt rules: readable means present, three names are enough", () => {
  const p = core.buildPrompt(STUDENTS, 1);
  assert.match(p, /3 أسماء/);
  assert.match(p, /حتى لو الخط باهت/);
  assert.doesNotMatch(p, /متشطب أو ممسوح/);
});

test("layout is fitted so text isn't clipped, and stays stable on re-save", sample, async () => {
  const before = (await open(new URL("roster.xlsx", S))).worksheets[0];
  let wb = await open(new URL("roster.xlsx", S));
  const { marks, doubts } = expectedMarks();
  core.writeColumn(wb.worksheets[0], "2026-10-11", marks, doubts);
  wb = await roundTrip(wb);
  const ws = wb.worksheets[0];
  const width = c => ws.getColumn(c).width, height = r => ws.getRow(r).height;
  assert.ok(width(1) >= 8, "serial column fits");
  assert.ok(width(4) >= 28, "program column fits 'هندسة الاتصالات والالكترونيات'");
  assert.ok(width(3) >= before.getColumn(3).width, "name column never shrinks");
  assert.ok(height(8) >= 19 && height(105) >= 19, "student rows fit a 13pt line");
  assert.ok(height(5) > 50, "lecturer title wraps onto several lines");
  for (let r = 1; r <= 105; r++)
    for (let c = 1; c <= 4; c++)
      assert.deepEqual(ws.getCell(r, c).value, before.getCell(r, c).value, `cell ${r},${c}`);

  const snapshot = () => JSON.stringify([[1, 2, 3, 4, 5].map(width), [1, 2, 3, 5, 6, 7, 8, 105].map(height)]);
  const first = snapshot();
  core.writeColumn(ws, "2026-10-18", marks, doubts);
  const again = (await roundTrip(wb)).worksheets[0];
  assert.equal(JSON.stringify([[1, 2, 3, 4, 5].map(c => again.getColumn(c).width), [1, 2, 3, 5, 6, 7, 8, 105].map(r => again.getRow(r).height)]), first);
});
