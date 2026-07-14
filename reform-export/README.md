# ReForm Auto-Export → Lagernaut Mobil-Import

Zieht die Mobilteile-CSV automatisch aus dem ReForm-Portal (`portal.afb-group.eu`,
qooxdoo-App) per **Playwright** (echter Browser, headless) und speist sie in den
bestehenden Lagernaut-Mobil-Import (`scripts/mobil-import.ts` → `runMobilImport`).

Läuft auf dem VPS als **eigener Container** (getrennt vom App-Image) + **cron**.

## Bestandteile
- `mobil-export.mjs` — Login → Mandant AfB → „alle Lagerdetails" → Filter
  `Stellplatz enthält "ETL-Mobil"` → Enter (lädt) → Export (Erdkugel) → `CSV (.csv)`
  → `$OUT_DIR/mobil-export.csv`.
- `Dockerfile` / `package.json` — schlankes Playwright-Image (`node:20-slim` + Chromium).
- `reform-sync.sh` — Orchestrierung: Export-Container → Import im App-Container.

## Einrichtung auf dem VPS (einmalig)

```bash
cd /var/www/lagernaut/emts-lagernaut
git pull                       # bringt reform-export/

mkdir -p /var/www/lagernaut/reform
# Zugangsdaten (NICHT im Repo!) — eigener Service-/Account einsetzen:
cat > /var/www/lagernaut/reform/.env <<'EOF'
PORTAL_USER=fsus
PORTAL_PASS=DEIN_PASSWORT
EOF
chmod 600 /var/www/lagernaut/reform/.env

# Export-Image bauen (einmalig, ~700 MB–1 GB):
docker build -t reform-export reform-export/
```

## Etappe A — Export testen (produziert nur die CSV)

```bash
docker run --rm --env-file /var/www/lagernaut/reform/.env \
  -v /var/www/lagernaut/reform:/out reform-export
ls -la /var/www/lagernaut/reform/mobil-export.csv
```

Bei Fehlern liegt ein `reform-fehler.png` im selben Ordner.

## Etappe B — Sync testen (Export + Import)

```bash
chmod +x reform-export/reform-sync.sh
reform-export/reform-sync.sh
```

Der Import läuft standardmäßig ECHT. Für eine Vorschau vorher den Trockenlauf:
`docker compose exec app npx tsx /app/mobil-import.ts /tmp/mobil-export.csv --dry`.

## Etappe C — Zeitplan (cron, z. B. täglich 05:00)

```bash
crontab -e
# Zeile:
0 5 * * * /var/www/lagernaut/emts-lagernaut/reform-export/reform-sync.sh >> /var/log/reform-sync.log 2>&1
```
