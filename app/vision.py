"""Reading the handwritten sheets: image preprocessing, the Claude call, JSON parsing and matching."""
from __future__ import annotations

import base64
import io
import json
import os
from dataclasses import dataclass, field

import anthropic
from PIL import Image, ImageOps

from .excel import Student

DEFAULT_MODEL = "claude-opus-5-5"
MAX_SIDE = 1568
OVERLAP = 0.06
JPEG_QUALITY = 90
MAX_TOKENS = 32000


class VisionError(RuntimeError):
    """Raised with an Arabic, user-facing message."""


# ---------- images ----------

def _encode(im: Image.Image) -> bytes:
    if max(im.size) > MAX_SIDE:
        im = im.copy()
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=JPEG_QUALITY)
    return buf.getvalue()


def preprocess(data: bytes, split: bool = True) -> list[bytes]:
    """EXIF-rotate, split a tall page into 2 overlapping halves, shrink, re-encode as JPEG."""
    try:
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
    except Exception as e:  # noqa: BLE001
        raise VisionError("في صورة مش مقروءة. اتأكد إنها JPG أو PNG.") from e
    w, h = im.size
    if not split or h <= w:
        return [_encode(im)]
    out = []
    step, ov = h / 2, h * OVERLAP
    for i in range(2):
        y0 = max(0, int(i * step - ov))
        y1 = min(h, int((i + 1) * step + ov))
        out.append(_encode(im.crop((0, y0, w, y1))))
    return out


# ---------- prompt ----------

def build_prompt(students: list[Student], n_pages: int, n_images: int) -> str:
    roster = "\n".join(f"{s.serial}|{s.name}" for s in students)
    halves = ""
    if n_images > n_pages:
        halves = "، كل ورقة متقسمة لنصين فوق وتحت بتداخل بسيط، فممكن نفس الاسم يظهر في صورتين — احسبه مرة واحدة"
    return f"""أنت بتقرأ ورق حضور محاضرة في كلية هندسة مصرية، مكتوب بخط اليد بالعربي. الطلبة كتبوا أساميهم بنفسهم في الورقة.
الصور المرفقة ({n_images} صورة) هي {n_pages} ورقة{halves}.
اقرأ كل اسم مكتوب، وطابقه مع كشف الطلبة الرسمي ده (الصيغة: رقم_الطالب|الاسم الكامل). الاسم المكتوب غالباً أقصر (اسم الطالب + الأب + الجد أو اللقب)، والإملاء ممكن يختلف (ه/ة، ى/ي، أ/ا، عبد الله/عبدالله).
لو اسم متشطب أو ممسوح أو باهت جداً اعتبره "مشكوك" (doubt=true).
الكشف:
{roster}

رد بـ JSON فقط بالشكل ده بدون أي كلام تاني:
{{"present":[{{"serial":رقم_الطالب,"written":"الاسم كما هو مكتوب","doubt":false}}],"unmatched":["اسم مكتوب مش لاقي له مقابل"]}}
متكررش نفس serial. لو مش متأكد من المطابقة بين طالبين حط doubt=true."""


# ---------- parsing ----------

@dataclass
class ReadResult:
    marks: dict[int, str] = field(default_factory=dict)   # serial -> "p" | "a"
    doubts: dict[int, str] = field(default_factory=dict)  # serial -> note
    unmatched: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {"marks": self.marks, "doubts": self.doubts, "unmatched": self.unmatched}


def extract_json(text: str) -> dict:
    """Pull the outermost {...} object out of the model text (tolerates code fences / chatter)."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        t = t.rsplit("```", 1)[0]
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j <= i:
        raise ValueError("no JSON object in response")
    obj = json.loads(t[i:j + 1])
    if not isinstance(obj, dict):
        raise ValueError("JSON is not an object")
    return obj


def apply_result(obj: dict, students: list[Student]) -> ReadResult:
    valid = {s.serial for s in students}
    res = ReadResult(marks={s.serial: "a" for s in students})
    seen: set[int] = set()
    for p in obj.get("present") or []:
        if not isinstance(p, dict):
            continue
        raw = p.get("serial", p.get("row"))
        try:
            serial = int(str(raw).strip())
        except (TypeError, ValueError):
            continue
        if serial not in valid or serial in seen:
            continue
        seen.add(serial)
        written = str(p.get("written") or "").strip()
        if p.get("doubt") in (True, "true", "True", 1):
            res.marks[serial] = "a"
            res.doubts[serial] = f"مكتوب: {written} (باهت/متشطب أو مش واضح)" if written else "مش واضح في الورقة"
        else:
            res.marks[serial] = "p"
    res.unmatched = [str(u).strip() for u in (obj.get("unmatched") or [])
                     if isinstance(u, str) and u.strip()]
    return res


# ---------- Claude call ----------

def _client() -> anthropic.Anthropic:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise VisionError("مفيش مفتاح API. حط ANTHROPIC_API_KEY في ملف .env وشغّل البرنامج تاني.")
    return anthropic.Anthropic(api_key=key, max_retries=2, timeout=300)


def _call(client: anthropic.Anthropic, model: str, content: list) -> str:
    try:
        with client.beta.messages.stream(
            model=model,
            max_tokens=MAX_TOKENS,
            output_config={"effort": "high"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": content}],
        ) as stream:
            msg = stream.get_final_message()
    except anthropic.AuthenticationError as e:
        raise VisionError("مفتاح الـ API غلط أو اتلغى. راجع ANTHROPIC_API_KEY في ملف .env.") from e
    except anthropic.PermissionDeniedError as e:
        raise VisionError("المفتاح ده مالوش صلاحية يستخدم الموديل. راجع حسابك على console.anthropic.com.") from e
    except anthropic.NotFoundError as e:
        raise VisionError(f"الموديل {model} مش موجود. راجع CLAUDE_MODEL في ملف .env.") from e
    except anthropic.RateLimitError as e:
        raise VisionError("طلبات كتير ورا بعض. استنى دقيقة وجرب تاني.") from e
    except anthropic.BadRequestError as e:
        if "credit" in str(e).lower() or "billing" in str(e).lower():
            raise VisionError("الرصيد خلص في حساب Anthropic. اشحن من console.anthropic.com → Billing.") from e
        raise VisionError(f"الطلب اترفض: {getattr(e, 'message', e)}") from e
    except anthropic.APIStatusError as e:
        raise VisionError(f"مشكلة عند Anthropic (كود {e.status_code}). جرب تاني بعد شوية.") from e
    except anthropic.APIConnectionError as e:
        raise VisionError("مفيش اتصال بالإنترنت أو السيرفر مش بيرد. اتأكد من النت وجرب تاني.") from e

    if msg.stop_reason == "refusal":
        raise VisionError("الموديل رفض يقرأ الصور دي. جرب صور تانية.")
    return "".join(b.text for b in msg.content if b.type == "text")


def read_sheets(images: list[bytes], students: list[Student], model: str | None = None,
                split: bool = True) -> ReadResult:
    if not images:
        raise VisionError("ارفع صورة ورقة الحضور الأول.")
    parts: list[bytes] = []
    for data in images:
        parts.extend(preprocess(data, split=split))
    content: list = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                     "data": base64.standard_b64encode(p).decode()}}
        for p in parts
    ]
    content.append({"type": "text", "text": build_prompt(students, len(images), len(parts))})

    client = _client()
    model = model or os.getenv("CLAUDE_MODEL", "").strip() or DEFAULT_MODEL
    last_err: Exception | None = None
    for _ in range(2):  # retry once on unparseable output
        text = _call(client, model, content)
        try:
            return apply_result(extract_json(text), students)
        except (ValueError, json.JSONDecodeError) as e:
            last_err = e
    raise VisionError("الرد مكانش مفهوم. جرب تاني أو صوّر الورقة أوضح.") from last_err
