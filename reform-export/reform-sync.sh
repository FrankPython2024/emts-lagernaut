#!/usr/bin/env bash
# ReForm → Lagernaut Sync (VPS): Export (Playwright-Container) → Import (App-Container).
# Aufruf: reform-sync.sh [manuell|cron]  (Default cron)
# Schreibt bei jeder Etappe $DATA/status.json (atomar) — die App zeigt daraus den
# Fortschrittsbalken. Zugangsdaten in $DATA/.env (NICHT im Repo).
set -uo pipefail

REPO=/var/www/lagernaut/emts-lagernaut
DATA=/var/www/lagernaut/reform
ENV_FILE="$DATA/.env"
CSV="$DATA/mobil-export.csv"
STATUS="$DATA/status.json"
QUELLE="${1:-cron}"
START=$(date +%s)000   # ms

cd "$REPO" || exit 1
mkdir -p "$DATA"

# ── atomare Status-Datei ──────────────────────────────────────────────────────
# status <state> <phase> [bericht-json] [fehlertext]
status() {
  local state="$1" phase="$2" bericht="${3:-null}" fehler="null" ended="null"
  if [ "$state" = "fertig" ] || [ "$state" = "fehler" ]; then ended="$(date +%s)000"; fi
  if [ -n "${4:-}" ]; then fehler="\"$(printf '%s' "$4" | sed 's/\\/\\\\/g; s/"/\\"/g')\""; fi
  printf '{"state":"%s","phase":"%s","quelle":"%s","startedAt":%s,"endedAt":%s,"bericht":%s,"fehler":%s}\n' \
    "$state" "$phase" "$QUELLE" "$START" "$ended" "$bericht" "$fehler" > "$STATUS.tmp"
  mv "$STATUS.tmp" "$STATUS"
}
fehler_exit() { echo "[$(date '+%F %T')] ❌ $1"; status fehler "Fehler" null "$1"; exit 1; }

# ── Überlappungs-Schutz ───────────────────────────────────────────────────────
exec 9>/var/lock/reform-sync.lock
if ! flock -n 9; then
  echo "[$(date '+%F %T')] Sync läuft bereits — übersprungen."
  exit 0
fi

# ── 1) Export ─────────────────────────────────────────────────────────────────
echo "[$(date '+%F %T')] ── ReForm-Export ($QUELLE)…"
status export "Export aus ReForm läuft…"
if ! docker run --rm --env-file "$ENV_FILE" -e HEADLESS=1 -v "$DATA:/out" reform-export; then
  fehler_exit "Export aus ReForm fehlgeschlagen"
fi
[ -s "$CSV" ] || fehler_exit "Keine/leere CSV erzeugt"

# ── 2) Import ─────────────────────────────────────────────────────────────────
echo "[$(date '+%F %T')] ── Import in Lagernaut…"
status import "Import in Lagernaut läuft…"
docker compose cp scripts/mobil-import.ts app:/app/mobil-import.ts >/dev/null 2>&1 || fehler_exit "Skript-Kopie fehlgeschlagen"
docker compose cp "$CSV" app:/tmp/mobil-export.csv >/dev/null 2>&1 || fehler_exit "CSV-Kopie fehlgeschlagen"
OUT="$(docker compose exec -T app npx tsx /app/mobil-import.ts /tmp/mobil-export.csv --json 2>&1)"
if [ $? -ne 0 ]; then echo "$OUT"; fehler_exit "Import fehlgeschlagen"; fi
echo "$OUT"

BERICHT="$(printf '%s' "$OUT" | grep '^##BERICHT## ' | sed 's/^##BERICHT## //' | head -n1)"
[ -z "$BERICHT" ] && BERICHT=null

status fertig "Fertig" "$BERICHT"
echo "[$(date '+%F %T')] ✅ Sync fertig."
