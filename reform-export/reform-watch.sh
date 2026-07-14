#!/usr/bin/env bash
# Host-Wächter: pollt die Trigger-Datei (von der App geschrieben) und startet den
# Sync manuell. Läuft als systemd-Dienst (reform-watch.service, Restart=always).
set -uo pipefail

DATA=/var/www/lagernaut/reform
TRIGGER="$DATA/trigger"
UMBUCHEN="$DATA/umbuchen.json"
BASE=/var/www/lagernaut/emts-lagernaut/reform-export
SYNC="$BASE/reform-sync.sh"
UMB="$BASE/reform-umbuchen.sh"

mkdir -p "$DATA"
echo "[$(date '+%F %T')] reform-watch gestartet (pollt Sync + Umbuchung)…"

while true; do
  if [ -f "$TRIGGER" ]; then
    rm -f "$TRIGGER"
    echo "[$(date '+%F %T')] Sync-Trigger erkannt…"
    bash "$SYNC" manuell || true
  fi
  if [ -f "$UMBUCHEN" ]; then
    echo "[$(date '+%F %T')] Umbuch-Anfrage erkannt…"
    bash "$UMB" || true
  fi
  sleep 3
done
