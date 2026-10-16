import os

import pytest
from dotenv import load_dotenv

from app import excel, vision

load_dotenv()
pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not os.getenv("ANTHROPIC_API_KEY"), reason="ANTHROPIC_API_KEY not set"),
]


def test_live_sample_sheets(roster_path, expected):
    roster = excel.load_roster(roster_path)
    imgs = [(roster_path.parent / f).read_bytes()
            for f in ("sheet_power_2026-10-11.jpg", "sheet_communications_2026-10-11.jpg")]
    r = vision.read_sheets(imgs, roster.students)

    want = set(expected["present_serials"])
    got = {s for s, m in r.marks.items() if m == "p"}
    tp = len(got & want)
    precision = tp / len(got) if got else 0
    recall = tp / len(want)
    agreement = sum((s in got) == (s in want) for s in r.marks) / len(r.marks)
    print(f"\nprecision={precision:.3f} recall={recall:.3f} agreement={agreement:.3f}")
    print("false present:", sorted(got - want), "missed:", sorted(want - got))
    print("doubts:", r.doubts, "unmatched:", r.unmatched)
    assert agreement >= 0.95
