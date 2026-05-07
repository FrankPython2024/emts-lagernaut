/**
 * Custom Next.js Server Entry Point
 *
 * Socket.io wird NICHT hier initialisiert — das übernimmt
 * src/pages/api/socketio.ts über den Pages-Router-Trick (res.socket.server).
 *
 * Dieser Server startet nur Next.js + BullMQ Worker.
 *
 * Start: tsx src/server.ts
 */

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { startWorkers } from "./modules/jobs/worker";

const dev  = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOSTNAME ?? "0.0.0.0";

const app    = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  // BullMQ Worker starten
  startWorkers();

  httpServer.listen(port, host, () => {
    console.log(`> Next.js läuft auf http://${host}:${port}`);
    console.log(`> Socket.io wird via /api/socketio (Pages Router) initialisiert`);
    console.log(`> BullMQ Worker aktiv`);
    console.log(`> Umgebung: ${process.env.NODE_ENV ?? "development"}`);
  });
});
