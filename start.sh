#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -q -r requirements.txt
[ -f .env ] || cp .env.example .env
exec .venv/bin/python run.py
