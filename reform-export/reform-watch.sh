#!/usr/bin/env bash
# Host-Wächter: pollt die Trigger-Datei (von der App geschrieben) und startet den
# Sync manuell. Läuft als systemd-Dienst (reform-watch.service, Restart=always).
set -uo pipefail

DATA=/var/www/lagernaut/reform
TRIGGER="$DATA/trigger"
SESSION="$DATA/session-req.json"
BASE=/var/www/lagernaut/emts-lagernaut/reform-export
SYNC="$BASE/reform-sync.sh"
UMB="$BASE/reform-umbuchen.sh"

mkdir -p "$DATA"
echo "[$(date '+%F %T')] reform-watch gestartet (pollt Sync + Buch-Session)…"

while true; do
  if [ -f "$TRIGGER" ]; then
    rm -f "$TRIGGER"
    echo "[$(date '+%F %T')] Sync-Trigger erkannt…"
    bash "$SYNC" manuell || true
  fi
  if [ -f "$SESSION" ]; then
    echo "[$(date '+%F %T')] Buch-Session-Auftrag erkannt…"
    bash "$UMB" || true    # blockiert für die Dauer der Session (gewollt)
  fi
  sleep 2
done
