// One-lecture attendance report as a PDF. Pages are drawn on a canvas (the browser shapes the Arabic
// text correctly there) and placed into the PDF as images with jsPDF, which is loaded on first use.
import { fmtDate } from "./core.js?v=3"; // keep ?v= in step with app.js

const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const W = 1240, H = 1754;                 // A4 at 150 dpi
const M = 80;                              // page margin
const ROW = 40, HEAD_ROW = 46;
const FONT = '"IBM Plex Sans Arabic", Tahoma, "Segoe UI", sans-serif';
const C = { ink: "#1b2440", muted: "#5c6684", line: "#c9d0de", head: "#dcedf5", ok: "#006100", okBg: "#c6efce",
            no: "#9c0006", noBg: "#ffc7ce", warnBg: "#ffeb9c", zebra: "#f7f9fc" };

let jspdfReady = null;
function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  jspdfReady ??= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = JSPDF_URL;
    s.onload = () => (window.jspdf ? res(window.jspdf) : rej(new Error("jsPDF missing")));
    s.onerror = () => { jspdfReady = null; rej(new Error("مكتبة الـ PDF ماتحملتش. اتأكد من النت وجرب تاني.")); };
    document.head.appendChild(s);
  });
  return jspdfReady;
}

function newPage() {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.direction = "rtl"; g.textBaseline = "middle";
  return { c, g };
}

function text(g, s, x, y, { size = 22, weight = 400, color = C.ink, align = "right", maxWidth } = {}) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color; g.textAlign = align;
  if (maxWidth) {
    // shrink long names instead of letting them run into the next column
    let sz = size;
    while (sz > 12 && g.measureText(s).width > maxWidth) { sz -= 1; g.font = `${weight} ${sz}px ${FONT}`; }
  }
  g.fillText(s, x, y);
}

/** Draw the report pages. Returns canvases (also used for previews). */
export async function renderPages({ title, iso, students, marks, flags }) {
  try { await document.fonts.load(`600 22px "IBM Plex Sans Arabic"`); await document.fonts.load(`400 22px "IBM Plex Sans Arabic"`); } catch (e) {}

  const P = students.filter(s => marks[s.serial] === "p").length;
  const A = students.filter(s => marks[s.serial] === "a").length;

  // columns, right to left: serial | name | status
  const right = W - M, left = M;
  const serialW = 90, statusW = 160;
  const xSerial = right, xName = right - serialW, xStatus = left + statusW;

  const pages = [];
  let page, y, i = 0;
  const firstTop = M + 190, otherTop = M + 40;
  const perPage = top => Math.floor((H - M - 60 - top - HEAD_ROW) / ROW);
  let total = 0, remaining = students.length;
  do { remaining -= perPage(total ? otherTop : firstTop); total++; } while (remaining > 0);

  const header = top => {
    const g = page.g;
    g.fillStyle = C.head; g.fillRect(left, top, right - left, HEAD_ROW);
    g.strokeStyle = C.line; g.lineWidth = 1.5; g.strokeRect(left, top, right - left, HEAD_ROW);
    const my = top + HEAD_ROW / 2;
    text(g, "م", xSerial - serialW / 2, my, { size: 22, weight: 600, align: "center" });
    text(g, "اسم الطالب", xName - 20, my, { size: 22, weight: 600 });
    text(g, "الحضور", xStatus - statusW / 2, my, { size: 22, weight: 600, align: "center" });
    return top + HEAD_ROW;
  };

  const footer = n => {
    text(page.g, `صفحة ${n} من ${total}`, W / 2, H - M / 2 - 10, { size: 18, color: C.muted, align: "center" });
  };

  while (i < students.length || !pages.length) {
    page = newPage(); pages.push(page);
    const g = page.g;
    let top = otherTop;
    if (pages.length === 1) {
      text(g, "تقرير الحضور", right, M + 20, { size: 40, weight: 600 });
      if (title) text(g, title, right, M + 75, { size: 24, color: C.muted, maxWidth: right - left });
      text(g, `تاريخ المحاضرة: ${fmtDate(iso)}`, right, M + 120, { size: 26, weight: 600 });
      text(g, `✓ ${P} حاضر   ·   ✗ ${A} غايب   ·   الإجمالي ${students.length}`, left, M + 120, { size: 24, align: "left" });
      top = firstTop;
    }
    y = header(top);
    const n = perPage(top);
    for (let k = 0; k < n && i < students.length; k++, i++) {
      const s = students[i], m = marks[s.serial];
      if (flags[s.serial]) { g.fillStyle = C.warnBg; g.fillRect(left, y, right - left, ROW); }
      else if (k % 2) { g.fillStyle = C.zebra; g.fillRect(left, y, right - left, ROW); }
      const my = y + ROW / 2;
      text(g, String(s.serial), xSerial - serialW / 2, my, { size: 20, color: C.muted, align: "center" });
      text(g, s.name, xName - 20, my, { size: 22, maxWidth: xName - xStatus - 40 });
      if (m === "p" || m === "a") {
        g.fillStyle = m === "p" ? C.okBg : C.noBg;
        g.fillRect(left + 1, y + 1, statusW - 2, ROW - 2);
        text(g, m === "p" ? "✓" : "✗", xStatus - statusW / 2, my + 1, { size: 26, weight: 600, color: m === "p" ? C.ok : C.no, align: "center" });
      }
      g.strokeStyle = C.line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(left, y + ROW); g.lineTo(right, y + ROW); g.stroke();
      y += ROW;
    }
    // column separators and outer border for this page's table
    g.strokeStyle = C.line; g.lineWidth = 1.5;
    g.strokeRect(left, top, right - left, y - top);
    for (const x of [xName, xStatus]) { g.beginPath(); g.moveTo(x, top); g.lineTo(x, y); g.stroke(); }
    footer(pages.length);
  }
  return pages.map(p => p.c);
}

/** Build the PDF and return it as a Blob. */
export async function buildPdf(data) {
  const [{ jsPDF }, pages] = await Promise.all([loadJsPDF(), renderPages(data)]);
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
  pages.forEach((c, n) => {
    if (n) doc.addPage();
    doc.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pw, ph);
  });
  return doc.output("blob");
}
