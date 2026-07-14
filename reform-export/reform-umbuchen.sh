#!/usr/bin/env bash
# ReForm-Umbuchung (VPS): fährt den Playwright-Container mit umbuchen.mjs.
# Anfrage liegt in $DATA/umbuchen.json (von der App geschrieben). Der Container
# liest sie und schreibt $DATA/umbuchen-status.json (Fortschritt/Ergebnis).
set -uo pipefail

REPO=/var/www/lagernaut/emts-lagernaut
DATA=/var/www/lagernaut/reform
ENV_FILE="$DATA/.env"
REQ="$DATA/umbuchen.json"
PROC="$DATA/umbuchen.processing.json"
STATUS="$DATA/umbuchen-status.json"

[ -f "$REQ" ] || exit 0
# Anfrage „übernehmen" (umbenennen), damit sie nicht doppelt läuft.
mv "$REQ" "$PROC" 2>/dev/null || exit 0
cd "$REPO" || exit 1

echo "[$(date '+%F %T')] ── ReForm-Umbuchung startet…"
if ! docker run --rm --env-file "$ENV_FILE" -e HEADLESS=1 \
     -e UMBUCHEN_REQ=/out/umbuchen.processing.json \
     -e UMBUCHEN_STATUS=/out/umbuchen-status.json \
     -v "$DATA:/out" reform-export node umbuchen.mjs; then
  # Falls der Container gar nicht bis zum Status-Schreiben kam: Fallback-Fehler.
  printf '{"state":"fehler","phase":"Fehler","fehler":"Umbuchung fehlgeschlagen (Container).","endedAt":%s000}\n' \
    "$(date +%s)" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
fi

rm -f "$PROC"
echo "[$(date '+%F %T')] ── Umbuchung fertig."
