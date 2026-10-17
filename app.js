// Bump ?v= here and in index.html on every release so browsers never run a cached old copy.
import * as core from "./core.js?v=3";
import { buildPdf } from "./pdf.js?v=3";

// The Cloudflare Worker that holds the Gemini key. When the page is served from localhost
// (development only) it can be pointed elsewhere with ?relay=http://127.0.0.1:8787
const PROD_RELAY = "https://attendance-relay.omaralaa20042004.workers.dev";
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const RELAY = (isLocal && new URLSearchParams(location.search).get("relay")) || PROD_RELAY;

const MAX_SIDE = 1568, MAX_PHOTOS = 6, TIMEOUT_MS = 480000;
const BUSY_RETRIES = 2, BUSY_WAIT_S = 30;
const WB_KEY = "ghiab_wb", WB_PREV_KEY = "ghiab_wb_prev";

const $ = id => document.getElementById(id);
let wb = null, ws = null, roster = null;
let marks = {}, flags = {}, notes = {}, extraNames = [], curKey = "", photos = [], filter = "all", ctl = null, dirty = false;

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function setStatus(t, err, el = "status") { $(el).textContent = t; $(el).classList.toggle("err", !!err); }

function b64ToBuf(b) { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
function bufToB64(buf) { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); }
function store(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

// ---------- workbook ----------

async function openWorkbook(buf) {
  const w = new ExcelJS.Workbook();
  try { await w.xlsx.load(buf.slice(0)); }
  catch (e) { throw new core.RosterError("الملف ده مش ملف إكسل مقروء (.xlsx)."); }
  if (!w.worksheets.length) throw new core.RosterError("الملف فاضي.");
  const r = core.parseRoster(w.worksheets[0]);
  wb = w; ws = w.worksheets[0]; roster = r;
  showRoster();
}

function showRoster() {
  const dates = Object.keys(roster.dateCols).sort();
  $("sheetInfo").textContent = `${roster.title ? roster.title + " — " : ""}${roster.students.length} طالب • محاضرات متسجلة: ${dates.length ? dates.map(core.fmtDate).join("، ") : "لا يوجد"}`;
  $("listSec").hidden = false; $("takePanel").hidden = false; $("xlsxBox").open = false;
}

function showNoRoster(msg) {
  roster = null; $("listSec").hidden = true; $("takePanel").hidden = true; $("xlsxBox").open = true;
  $("sheetInfo").textContent = msg || "لسه مفيش ملف طلبة. ارفع كشف الطلبة (ملف إكسل) علشان تبدأ.";
  render();
}

function loadSession(iso) {
  curKey = iso; marks = {}; flags = {}; notes = {}; extraNames = []; dirty = false;
  $("curDate").textContent = core.fmtDate(iso);
  if (roster) {
    const j = core.readMarks(ws, roster, iso);
    marks = j.marks; flags = j.doubts;
  }
  render();
}

// ---------- list ----------

function render() {
  const students = roster ? roster.students : [];
  const P = students.filter(s => marks[s.serial] === "p").length, A = students.filter(s => marks[s.serial] === "a").length,
        F = students.filter(s => flags[s.serial]).length, U = students.length - P - A;
  const f = [["all", "الكل", students.length], ["p", "حاضر", P], ["a", "غايب", A], ["f", "للمراجعة", F]];
  $("filters").innerHTML = f.map(([k, l, c]) => `<button class="chip" data-f="${k}" aria-pressed="${filter === k}">${l} <b>${c}</b></button>`).join("");
  $("sum").innerHTML = !students.length ? "ارفع ملف الطلبة الأول"
    : (P + A) ? `<span class="ok">✓ ${P} حاضر</span> · <span class="no">✗ ${A} غايب</span>${U ? ` · ${U} بدون علامة` : ""}`
    : `لسه مفيش علامات لتاريخ ${core.fmtDate(curKey)}`;
  const rows = students.filter(s => filter === "all" || (filter === "f" ? flags[s.serial] : marks[s.serial] === filter));
  $("list").innerHTML = rows.map(s => {
    const m = marks[s.serial];
    return `<div class="st${flags[s.serial] ? " flag" : ""}"><span class="n">${s.serial}</span><span class="nm">${esc(s.name)}${notes[s.serial] ? `<small>${esc(notes[s.serial])}</small>` : ""}</span>
    <button class="mark ${m || ""}" data-s="${s.serial}" aria-label="${m === "p" ? "حاضر" : m === "a" ? "غايب" : "بدون علامة"} — اضغط للتغيير">${m === "p" ? "✓" : m === "a" ? "✗" : "–"}</button></div>`;
  }).join("") || `<div class="st"><span></span><span class="meta">مفيش أسماء هنا.</span><span></span></div>`;
  $("extra").hidden = !extraNames.length;
  if (extraNames.length) $("extra").innerHTML = `<strong>أسماء مكتوبة في الورقة ومش لاقيها في الكشف:</strong> ${extraNames.map(esc).join("، ")}`;
  $("save").disabled = !(P + A);
  $("pdf").disabled = !(P + A);
}

$("filters").onclick = e => { const b = e.target.closest("[data-f]"); if (!b) return; filter = b.dataset.f; render(); };
$("list").onclick = e => {
  const b = e.target.closest("[data-s]"); if (!b) return; const s = b.dataset.s;
  marks[s] = marks[s] === "p" ? "a" : "p"; delete flags[s]; dirty = true; render();
};
$("date").onchange = () => {
  const v = $("date").value; if (!v) return;
  if (dirty && !confirm("فيه تعديلات مش محفوظة. تسيبها وتفتح التاريخ ده؟")) { $("date").value = curKey; return; }
  loadSession(v);
};

// ---------- photos ----------

function addPhotos(files) {
  for (const f of files) { if (!f.type.startsWith("image/") && !/\.(heic|heif)$/i.test(f.name)) continue; photos.push({ f, url: URL.createObjectURL(f) }); }
  if (photos.length > MAX_PHOTOS) { photos.splice(MAX_PHOTOS).forEach(p => URL.revokeObjectURL(p.url)); setStatus(`أقصى عدد ${MAX_PHOTOS} صور في المرة.`, true); }
  drawThumbs();
}
function drawThumbs() { $("thumbs").innerHTML = photos.map((p, i) => `<div class="thumb"><img src="${p.url}" alt="صورة ${i + 1}"><button data-i="${i}" aria-label="شيل الصورة">×</button></div>`).join(""); }
$("photos").onchange = e => { addPhotos(e.target.files); e.target.value = ""; };
$("thumbs").onclick = e => { const b = e.target.closest("[data-i]"); if (!b) return; const [p] = photos.splice(+b.dataset.i, 1); URL.revokeObjectURL(p.url); drawThumbs(); };
const drop = $("drop");
["dragover", "dragenter"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => addPhotos(e.dataTransfer.files));

// apply EXIF rotation, shrink so the long side <= MAX_SIDE, re-encode as JPEG; returns base64
async function prepare(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (e) { throw new Error(`الصورة "${file.name}" مش مقروءة. لو من آيفون، غيّر إعداد الكاميرا لـ JPG أو ابعتها لنفسك على واتساب ونزّلها تاني.`); }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.9));
  return bufToB64(await blob.arrayBuffer());
}

const RELAY_ERRORS = {
  quota: "الحد المجاني لقراءة الصور خلص النهارده. جرب تاني بعد شوية أو بكرة.",
  busy: "خدمة القراءة عليها ضغط كبير دلوقتي. جرب تاني بعد ربع ساعة كده — الصور والتاريخ هيفضلوا زي ما هم.",
  upstream_unreachable: "خدمة القراءة مش بترد دلوقتي. جرب تاني بعد شوية.",
  missing_key: "خدمة القراءة لسه مش متظبطة (المفتاح ناقص). كلّم اللي عمل البرنامج.",
  forbidden_origin: "خدمة القراءة مش قابلة الطلب من الموقع ده. كلّم اللي عمل البرنامج.",
  key_or_request: "خدمة القراءة رفضت الطلب. جرب صور أصغر أو أقل، ولو اتكررت كلّم اللي عمل البرنامج.",
  too_large: "الصور كبيرة أوي. جرب عدد صور أقل.",
  empty: "مقدرش يقرأ حاجة من الصور. صوّر الورقة أوضح وجرب تاني.",
};

async function askRelay(images, prompt, signal) {
  let r;
  try {
    r = await fetch(RELAY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images, prompt }), signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error("مفيش اتصال بالإنترنت أو خدمة القراءة مش بترد. اتأكد من النت وجرب تاني.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.text) {
    const e = new Error(RELAY_ERRORS[j.error] || `حصلت مشكلة في خدمة القراءة (${r.status}). جرب تاني بعد شوية.`);
    e.code = j.error;
    throw e;
  }
  return j.text;
}

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("aborted", "AbortError")); }, { once: true });
});

// The free models are often busy: wait and try again a couple of times before giving up.
async function askRelayPatiently(images, prompt, signal) {
  for (let attempt = 0; ; attempt++) {
    try { return await askRelay(images, prompt, signal); }
    catch (e) {
      if (e.code !== "busy" || attempt >= BUSY_RETRIES) throw e;
      for (let s = BUSY_WAIT_S; s > 0; s--) {
        setStatus(`خدمة القراءة عليها ضغط. هيحاول تاني لوحده بعد ${s} ثانية… (محاولة ${attempt + 2} من ${BUSY_RETRIES + 1})`);
        await sleep(1000, signal);
      }
      setStatus("بيقرأ الأسماء من الصور ويطابقها مع الكشف… ده غالباً بياخد أقل من دقيقة، سيب الصفحة مفتوحة.");
    }
  }
}

$("read").onclick = async () => {
  if (!roster) { setStatus("ارفع ملف الطلبة الأول.", true); return; }
  if (!photos.length) { setStatus("ارفع صورة ورقة الحضور الأول.", true); return; }
  const iso = $("date").value;
  if (!iso) { setStatus("اختار تاريخ المحاضرة.", true); return; }
  if (dirty && Object.keys(marks).length && !confirm("القراءة الجديدة هتمسح التعديلات اللي مش محفوظة. تكمّل؟")) return;

  $("read").disabled = true; $("stop").hidden = false; ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("timeout"), TIMEOUT_MS);
  try {
    setStatus("بيجهّز الصور…");
    const images = [];
    for (const p of photos) images.push(await prepare(p.f));
    const prompt = core.buildPrompt(roster.students, photos.length);
    setStatus("بيقرأ الأسماء من الصور ويطابقها مع الكشف… ده غالباً بياخد أقل من دقيقة، سيب الصفحة مفتوحة.");
    let res;
    for (let attempt = 0; ; attempt++) {
      const text = await askRelayPatiently(images, prompt, ctl.signal);
      try { res = core.applyResult(core.extractJson(text), roster.students); break; }
      catch (e) { if (!(e instanceof SyntaxError) || attempt) throw new Error("الرد مكانش مفهوم. جرب تاني أو صوّر الورقة أوضح."); }
    }
    curKey = iso; $("curDate").textContent = core.fmtDate(iso);
    marks = res.marks; flags = {}; notes = {};
    for (const [s, n] of Object.entries(res.doubts)) { flags[s] = true; notes[s] = n; }
    extraNames = res.unmatched; filter = "all"; dirty = true; render();
    const n = Object.values(res.marks).filter(m => m === "p").length;
    setStatus(`اتقرأ ${n} اسم حاضر. راجع السطور الصفرا وبعدين احفظ الملف.`);
  } catch (e) {
    if (e?.name === "AbortError" || ctl.signal.aborted) setStatus(ctl.signal.reason === "timeout" ? "القراءة خدت وقت أطول من اللازم. جرب تاني." : "اتلغى.", ctl.signal.reason === "timeout");
    else setStatus(e.message || "حصلت مشكلة في قراءة الصور.", true);
  } finally { clearTimeout(timer); $("read").disabled = false; $("stop").hidden = true; ctl = null; }
};
$("stop").onclick = () => ctl?.abort("user");

// ---------- save ----------

$("save").onclick = async () => {
  $("save").disabled = true;
  try {
    const doubts = {}; for (const s of Object.keys(flags)) if (flags[s]) doubts[s] = true;
    const prev = load(WB_KEY); if (prev) store(WB_PREV_KEY, prev);
    core.writeColumn(ws, curKey, marks, doubts);
    const buf = await wb.xlsx.writeBuffer();
    const saved = store(WB_KEY, bufToB64(buf));
    await openWorkbook(buf);
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `الغياب ${core.fmtDate(curKey).replace(/\//g, "-")}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    dirty = false;
    setStatus(saved ? "اتحفظ الملف ونزل عندك. كل محاضرة بتتضاف كعمود جديد في نفس الملف."
                    : "الملف نزل عندك، بس المتصفح مقدرش يحتفظ بنسخة. المرة الجاية ارفع الملف اللي نزل ده.", !saved);
  } catch (e) { setStatus("الملف ماتحفظش: " + (e.message || e), true); }
  finally { render(); }
};

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$("pdf").onclick = async () => {
  const btn = $("pdf"); btn.disabled = true;
  setStatus("بيجهّز ملف الـ PDF…");
  try {
    const blob = await buildPdf({ title: roster.title, iso: curKey, students: roster.students, marks, flags });
    download(blob, `الحضور ${core.fmtDate(curKey).replace(/\//g, "-")}.pdf`);
    setStatus(dirty ? "الـ PDF نزل عندك. متنساش تدوس \"حفظ ملف الإكسل\" كمان علشان العلامات تتسجل في الملف."
                    : "الـ PDF نزل عندك.");
  } catch (e) { setStatus("الـ PDF ماتعملش: " + (e.message || e), true); }
  finally { render(); }
};

$("xlsx").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const b = await f.arrayBuffer();
    await openWorkbook(b);
    const prev = load(WB_KEY); if (prev) store(WB_PREV_KEY, prev);
    store(WB_KEY, bufToB64(b));
    setStatus("اتحمل ملف الطلبة.", false, "sheetStatus");
    loadSession($("date").value || today());
  } catch (err) { setStatus(err.message || "الملف ده مش مقروء.", true, "sheetStatus"); }
};

window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

(async () => {
  $("date").value = today();
  if (typeof ExcelJS === "undefined") { showNoRoster("مكتبة الإكسل ماتحملتش. اتأكد من النت واعمل تحديث للصفحة."); return; }
  const saved = load(WB_KEY);
  if (saved) {
    try { await openWorkbook(b64ToBuf(saved)); }
    catch (e) { showNoRoster("النسخة المحفوظة من الملف بايظة. ارفع كشف الطلبة تاني."); return; }
    loadSession(today());
  } else showNoRoster();
})();
