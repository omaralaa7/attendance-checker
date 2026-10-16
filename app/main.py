"""FastAPI routes for دفتر الغياب."""
from __future__ import annotations

import os
import shutil
from datetime import date, datetime
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import excel, vision

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATA = Path(os.getenv("ATTENDANCE_DATA_DIR", ROOT / "data"))
CURRENT = DATA / "current.xlsx"
BACKUPS = DATA / "backups"
STATIC = Path(__file__).resolve().parent / "static"

app = FastAPI(title="دفتر الغياب")


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail=msg)


def _check_iso(iso: str) -> str:
    try:
        return date.fromisoformat(iso).isoformat()
    except ValueError:
        _err(400, "التاريخ مش صحيح.")


def _roster() -> excel.Roster:
    if not CURRENT.exists():
        _err(404, "لسه مفيش ملف طلبة. ارفع ملف الإكسل الأول.")
    try:
        return excel.load_roster(CURRENT)
    except excel.RosterError as e:
        _err(400, str(e))


def _backup():
    if CURRENT.exists():
        BACKUPS.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        shutil.copy2(CURRENT, BACKUPS / f"{stamp}.xlsx")


@app.get("/api/roster")
def get_roster():
    return _roster().to_json()


@app.post("/api/roster")
async def upload_roster(file: UploadFile = File(...)):
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = DATA / "upload.tmp.xlsx"
    tmp.write_bytes(await file.read())
    try:
        roster = excel.load_roster(tmp)
    except excel.RosterError as e:
        tmp.unlink(missing_ok=True)
        _err(400, str(e))
    _backup()
    tmp.replace(CURRENT)
    return roster.to_json()


@app.get("/api/attendance/{iso}")
def get_attendance(iso: str):
    iso = _check_iso(iso)
    _roster()
    return excel.read_marks(CURRENT, iso)


@app.post("/api/read")
async def read(date: str = Form(...), images: list[UploadFile] = File(...)):
    _check_iso(date)
    roster = _roster()
    blobs = [await f.read() for f in images if f.filename]
    if not blobs:
        _err(400, "ارفع صورة ورقة الحضور الأول.")
    if len(blobs) > 6:
        _err(400, "أقصى عدد 6 صور في المرة.")
    try:
        res = await run_in_threadpool(vision.read_sheets, blobs, roster.students)
    except vision.VisionError as e:
        _err(502, str(e))
    return res.to_json()


class SaveBody(BaseModel):
    date: str
    marks: dict[int, str]
    doubts: dict[int, str] = {}


@app.post("/api/save")
def save(body: SaveBody):
    iso = _check_iso(body.date)
    _roster()
    marks = {k: v for k, v in body.marks.items() if v in ("p", "a")}
    if not marks:
        _err(400, "مفيش علامات تتحفظ.")
    _backup()
    excel.write_column(CURRENT, iso, marks, body.doubts)
    d = excel.fmt_date(iso).replace("/", "-")
    name = f"الغياب {d}.xlsx"
    return Response(
        content=CURRENT.read_bytes(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"attendance-{d}.xlsx\"; filename*=UTF-8''{quote(name)}"},
    )


@app.get("/api/health")
def health():
    return {"ok": True, "has_key": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()),
            "has_roster": CURRENT.exists()}


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
