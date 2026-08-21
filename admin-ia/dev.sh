#!/usr/bin/env bash
# Admin IA — uvicorn con reload para desarrollo local.
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi

exec .venv/bin/python -m uvicorn app.main:app \
  --host 0.0.0.0 --port "${ADMIN_IA_PORT:-8002}" --reload
