import io

import pytest
from PIL import Image

from app import vision
from app.excel import Student

STUDENTS = [Student(serial=i, row=i + 7, name=f"طالب {i}") for i in range(1, 6)]


def test_extract_plain():
    assert vision.extract_json('{"present":[],"unmatched":[]}') == {"present": [], "unmatched": []}


def test_extract_fenced_and_chatter():
    text = 'تمام، ده الرد:\n```json\n{"present":[{"serial":1,"written":"x","doubt":false}],"unmatched":[]}\n```\nشكراً'
    assert vision.extract_json(text)["present"][0]["serial"] == 1
    fenced = '```json\n{"present":[],"unmatched":["س"]}\n```'
    assert vision.extract_json(fenced)["unmatched"] == ["س"]


def test_extract_invalid():
    with pytest.raises(ValueError):
        vision.extract_json("no json here")
    with pytest.raises(ValueError):
        vision.extract_json('{"present": [1, 2,')


def test_apply_result_rules():
    obj = {
        "present": [
            {"serial": 1, "written": "طالب", "doubt": False},
            {"serial": "2", "written": "ط", "doubt": True},
            {"serial": 1, "written": "dup", "doubt": True},   # duplicate dropped
            {"serial": 99, "written": "unknown"},             # unknown dropped
            {"serial": "abc"},                                 # garbage dropped
            {"row": 4, "written": "old key"},                  # legacy key accepted
            "not a dict",
        ],
        "unmatched": ["محمد مجهول", "", None],
    }
    r = vision.apply_result(obj, STUDENTS)
    assert r.marks == {1: "p", 2: "a", 3: "a", 4: "p", 5: "a"}
    assert set(r.doubts) == {2} and "ط" in r.doubts[2]
    assert r.unmatched == ["محمد مجهول"]


def test_apply_result_empty():
    r = vision.apply_result({}, STUDENTS)
    assert set(r.marks.values()) == {"a"} and not r.doubts and not r.unmatched


def _jpeg(w, h):
    b = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(b, "JPEG")
    return b.getvalue()


def test_preprocess_split_and_resize():
    parts = vision.preprocess(_jpeg(2000, 4000))
    assert len(parts) == 2
    for p in parts:
        im = Image.open(io.BytesIO(p))
        assert max(im.size) <= vision.MAX_SIDE
    # each half covers ~56% of the height (half + 6% overlap)
    im = Image.open(io.BytesIO(vision.preprocess(_jpeg(1000, 1000 * 2))[0]))
    assert abs(im.size[1] / im.size[0] - 1.12) < 0.02
    assert len(vision.preprocess(_jpeg(1600, 900))) == 1


def test_read_sheets_retries_once(monkeypatch):
    calls = []

    def fake_call(client, model, content):
        calls.append(content)
        return "oops" if len(calls) == 1 else '{"present":[{"serial":3,"written":"x"}],"unmatched":[]}'

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(vision, "_call", fake_call)
    r = vision.read_sheets([_jpeg(800, 1200)], STUDENTS)
    assert len(calls) == 2 and r.marks[3] == "p"
    assert sum(1 for b in calls[0] if b["type"] == "image") == 2
    assert "3|طالب 3" in calls[0][-1]["text"]


def test_missing_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(vision.VisionError, match="مفتاح"):
        vision.read_sheets([_jpeg(100, 200)], STUDENTS)
