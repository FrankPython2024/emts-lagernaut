/**
 * Custom Next.js Server mit Socket.io + BullMQ
 *
 * Start (Dev):   tsx src/server.ts
 * Start (Prod):  tsx src/server.ts   (tsx ist in dependencies)
 */

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { initSocketIO } from "./modules/realtime/socket";
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

  // Socket.io an den HTTP-Server anhängen
  initSocketIO(httpServer);

  // BullMQ Worker starten
  startWorkers();

  httpServer.listen(port, host, () => {
    console.log(`> Next.js läuft auf http://${host}:${port}`);
    console.log(`> Socket.io aktiv auf /socket.io`);
    console.log(`> Umgebung: ${process.env.NODE_ENV ?? "development"}`);
  });
});
