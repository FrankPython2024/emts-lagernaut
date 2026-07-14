#!/usr/bin/env bash
# ReForm → Lagernaut Sync (VPS): Export (Playwright-Container) → Import (App-Container).
# Für cron. Zugangsdaten liegen in $DATA/.env (NICHT im Repo).
set -euo pipefail

REPO=/var/www/lagernaut/emts-lagernaut
DATA=/var/www/lagernaut/reform
ENV_FILE="$DATA/.env"
CSV="$DATA/mobil-export.csv"

cd "$REPO"
mkdir -p "$DATA"

echo "[$(date '+%F %T')] ── ReForm-Export startet…"
docker run --rm --env-file "$ENV_FILE" -e HEADLESS=1 -v "$DATA:/out" reform-export

if [ ! -s "$CSV" ]; then
  echo "[$(date '+%F %T')] ❌ Keine/leere CSV — Import übersprungen."
  exit 1
fi

echo "[$(date '+%F %T')] ── Import in den App-Container…"
docker compose cp scripts/mobil-import.ts app:/app/mobil-import.ts
docker compose cp "$CSV" app:/tmp/mobil-export.csv
docker compose exec -T app npx tsx /app/mobil-import.ts /tmp/mobil-export.csv

echo "[$(date '+%F %T')] ✅ Sync fertig."
