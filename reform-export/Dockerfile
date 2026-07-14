# Eigenständiges Image für den ReForm-Export (Playwright + Chromium).
# Bewusst getrennt vom App-Image (bläht dieses nicht auf). Lean: node-slim +
# passendes Chromium via Playwright (nicht das 2-GB-Offiziell-Image).
FROM node:20-slim

WORKDIR /app

# Nur die Playwright-JS-Lib installieren…
COPY package.json ./
RUN npm install --omit=dev

# …dann das passende Chromium + System-Libs (apt) dazu.
RUN npx playwright install --with-deps chromium

COPY mobil-export.mjs ./

ENV HEADLESS=1
ENV OUT_DIR=/out

# Schreibt /out/mobil-export.csv (per Volume nach außen gereicht).
CMD ["node", "mobil-export.mjs"]
