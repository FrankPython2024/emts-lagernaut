#!/usr/bin/env bash
# ReForm-Buch-Session (VPS): fährt den Playwright-Container (umbuchen.mjs) als
# LAUFENDE Session. Colli-Auftrag liegt in $DATA/session-req.json (von der App).
# Der Container bleibt offen, verarbeitet LogIDs aus $DATA/queue/ und schreibt
# $DATA/session-status.json, bis $DATA/session-close kommt oder Leerlauf-Timeout.
set -uo pipefail

REPO=/var/www/lagernaut/emts-lagernaut
DATA=/var/www/lagernaut/reform
ENV_FILE="$DATA/.env"
REQ="$DATA/session-req.json"
PROC="$DATA/session-req.processing.json"
STATUS="$DATA/session-status.json"

[ -f "$REQ" ] || exit 0
mv "$REQ" "$PROC" 2>/dev/null || exit 0
cd "$REPO" || exit 1

# Frische Session: alte Queue + Close-Signal wegräumen.
mkdir -p "$DATA/queue"
rm -f "$DATA/session-close"
rm -f "$DATA"/queue/*.json 2>/dev/null || true

echo "[$(date '+%F %T')] ── Buch-Session startet (Colli-Auftrag)…"
if ! docker run --rm --env-file "$ENV_FILE" -e HEADLESS=1 \
     -e SESSION_REQ=/out/session-req.processing.json -e OUT_DIR=/out \
     -v "$DATA:/out" reform-export node umbuchen.mjs; then
  printf '{"state":"fehler","phase":"Fehler","fehler":"Session-Container fehlgeschlagen.","endedAt":%s000}\n' \
    "$(date +%s)" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
fi

rm -f "$PROC"
echo "[$(date '+%F %T')] ── Buch-Session beendet."
