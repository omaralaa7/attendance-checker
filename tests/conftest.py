import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
SAMPLES = ROOT / "samples"



@pytest.fixture
def roster_path():
    p = SAMPLES / "roster.xlsx"
    if not p.exists():
        pytest.skip("samples/roster.xlsx not present")
    return p


@pytest.fixture
def expected():
    return json.loads((SAMPLES / "expected_2026-10-11.json").read_text(encoding="utf-8"))
