#!/usr/bin/env bash
# Host-Wächter: pollt die Trigger-Datei (von der App geschrieben) und startet den
# Sync manuell. Läuft als systemd-Dienst (reform-watch.service, Restart=always).
set -uo pipefail

DATA=/var/www/lagernaut/reform
TRIGGER="$DATA/trigger"
SYNC=/var/www/lagernaut/emts-lagernaut/reform-export/reform-sync.sh

mkdir -p "$DATA"
echo "[$(date '+%F %T')] reform-watch gestartet (pollt $TRIGGER)…"

while true; do
  if [ -f "$TRIGGER" ]; then
    rm -f "$TRIGGER"
    echo "[$(date '+%F %T')] Trigger erkannt → Sync (manuell)…"
    bash "$SYNC" manuell || true
  fi
  sleep 3
done
