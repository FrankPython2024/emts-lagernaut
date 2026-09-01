FROM node:20-alpine AS base
# apk scheitert auf dem VPS gelegentlich an einem DNS-Aussetzer beim Spiegel-
# server ("DNS: transient error"). Ohne Paketindex meldet apk dann "no such
# package" und der ganze Build bricht ab, obwohl es beim naechsten Anlauf sofort
# klappt. Deshalb bis zu drei Versuche mit Pause.
# Die Pruefung am Ende laesst den Build trotzdem scheitern, wenn wirklich nichts
# installiert wurde -- ein stiller Weiterlauf ohne openssl waere schlimmer.
# tesseract-ocr liest Teilenummern von gedruckten Etiketten, ohne fremdes
# Kontingent und ohne Netz nach draussen. Gemessen am 21.08.2026 an vier echten
# Teilen: Etiketten (Akku, Tastatur) werden zeichengenau gelesen, Siebdruck auf
# Platinen NICHT -- dafuer bleibt Gemini der Weg. Kostet rund 15 MB im Image.
RUN set -eu; \
    for i in 1 2 3; do \
      if apk add --no-cache openssl openssl-dev libc6-compat tesseract-ocr tesseract-ocr-data-eng; then break; fi; \
      echo ">>> apk-Versuch $i fehlgeschlagen, neuer Versuch in 5 Sekunden"; \
      sleep 5; \
    done; \
    apk info -e openssl >/dev/null; \
    apk info -e tesseract-ocr >/dev/null

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

# Next.js build output
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Source für Custom Server (via tsx)
COPY --from=builder /app/src ./src

# Konfiguration + Schema
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/prisma ./prisma

# Alle node_modules (tsx, socket.io, bullmq, next, etc.)
COPY --from=builder /app/node_modules ./node_modules

RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
ENV PORT=3000

# Custom Server via tsx (tsx ist in dependencies)
CMD ["node_modules/.bin/tsx", "src/server.ts"]
