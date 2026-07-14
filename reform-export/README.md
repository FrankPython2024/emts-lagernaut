# ReForm Auto-Export → Lagernaut Mobil-Import (+ Button/Sync-Brücke)

Zieht die Mobilteile-CSV automatisch aus dem ReForm-Portal (`portal.afb-group.eu`,
qooxdoo-App) per **Playwright** (headless) und speist sie in den bestehenden
Lagernaut-Mobil-Import (`scripts/mobil-import.ts` → `runMobilImport`).

Läuft auf dem VPS als **eigener Container** + **cron** (alle 10 Min) + **Button**
auf `/admin/mobil` („Aus ReForm aktualisieren" mit Fortschrittsbalken).

## Architektur (die „Brücke")
```
Button (App) ──schreibt──▶ /var/www/lagernaut/reform/trigger
                                     │  (Volume, in App gemountet als /data/reform)
Host-Wächter (systemd) ──pollt──────┘──▶ reform-sync.sh manuell
cron (*/10) ─────────────────────────────▶ reform-sync.sh cron
reform-sync.sh:  Export-Container → CSV → Import (App-Container)
                 schreibt status.json bei jeder Etappe (atomar)
App pollt status.json ──▶ Fortschrittsbalken
```
Die App kann Chromium NICHT selbst starten (kein Browser im App-Image) → Brücke
über Trigger-/Status-Datei im gemeinsamen Ordner `/var/www/lagernaut/reform`.

## Dateien
- `mobil-export.mjs` — Playwright-Export (Locale **de-DE**!), → `$OUT_DIR/mobil-export.csv`.
- `Dockerfile` / `package.json` — schlankes Playwright-Image (`node:20-slim` + Chromium).
- `reform-sync.sh` — Export → Import, schreibt `status.json`, flock-Überlappungsschutz.
- `reform-watch.sh` / `reform-watch.service` — Host-Wächter (Trigger → Sync), systemd.

## Einrichtung auf dem VPS

```bash
cd /var/www/lagernaut/emts-lagernaut && git pull

# Zugangsdaten (NICHT im Repo):
mkdir -p /var/www/lagernaut/reform
cat > /var/www/lagernaut/reform/.env <<'EOF'
PORTAL_USER=fsus
PORTAL_PASS=DEIN_PASSWORT
EOF
chmod 600 /var/www/lagernaut/reform/.env

# Export-Image bauen (einmalig):
docker build -t reform-export reform-export/

# App mit Volume-Mount neu starten (docker-compose.yml wurde ergänzt):
docker compose up -d

# Host-Wächter als Dienst (für den Button):
cp reform-export/reform-watch.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now reform-watch
systemctl status reform-watch --no-pager

# Automatischer Takt (alle 10 Min):
( crontab -l 2>/dev/null | grep -vE 'reform-sync|^PATH='; \
  echo 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'; \
  echo '*/10 * * * * bash /var/www/lagernaut/emts-lagernaut/reform-export/reform-sync.sh cron >> /var/log/reform-sync.log 2>&1' \
) | crontab -
```

## Testen
- **Nur Export:** `docker run --rm --env-file /var/www/lagernaut/reform/.env -v /var/www/lagernaut/reform:/out reform-export`
- **Voller Sync (CLI):** `bash reform-export/reform-sync.sh manuell`
- **Button:** `/admin/mobil` → „🔄 Aus ReForm aktualisieren" → Fortschrittsbalken.
- **Log:** `tail -f /var/log/reform-sync.log`

## Sicherheitsnetz
- `flock` verhindert überlappende Läufe.
- 50%-Plausibilitäts-Sicherung im Import: leerer/kaputter Export scheidet KEINEN
  Bestand fälschlich aus.
- Fehler schreiben `status.json` state=fehler → Button zeigt's rot an.
