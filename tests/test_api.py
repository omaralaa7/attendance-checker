import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTENDANCE_DATA_DIR", str(tmp_path))
    from app import main
    importlib.reload(main)
    return TestClient(main.app), main


def test_flow(client, roster_path, monkeypatch):
    c, main = client
    assert c.get("/").status_code == 200
    assert c.get("/api/roster").status_code == 404

    bad = c.post("/api/roster", files={"file": ("x.xlsx", b"junk")})
    assert bad.status_code == 400 and "إكسل" in bad.json()["detail"]

    r = c.post("/api/roster", files={"file": ("roster.xlsx", roster_path.read_bytes())})
    assert r.status_code == 200 and len(r.json()["students"]) == 98

    from app import vision
    def fake(images, students):
        res = vision.ReadResult(marks={s.serial: "a" for s in students})
        res.marks[1] = "p"; res.doubts[2] = "faded"; res.unmatched = ["x"]
        return res
    monkeypatch.setattr(main.vision, "read_sheets", fake)
    r = c.post("/api/read", data={"date": "2026-10-11"}, files=[("images", ("a.jpg", b"img", "image/jpeg"))])
    assert r.status_code == 200
    j = r.json()
    assert j["marks"]["1"] == "p" and j["doubts"] == {"2": "faded"}

    r = c.post("/api/save", json={"date": "2026-10-11", "marks": j["marks"], "doubts": j["doubts"]})
    assert r.status_code == 200 and r.content[:2] == b"PK"
    assert "attachment" in r.headers["content-disposition"]
    assert c.get("/api/roster").json()["dates"] == ["2026-10-11"]
    a = c.get("/api/attendance/2026-10-11").json()
    assert a["marks"]["1"] == "p" and list(a["doubts"]) == ["2"]
    assert list((main.BACKUPS).glob("*.xlsx"))
    assert c.get("/api/attendance/2026-13-40").status_code == 400
