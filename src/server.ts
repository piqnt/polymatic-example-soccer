import { exec } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import http from "http";
import ViteExpress from "vite-express";
import { Server } from "socket.io";

import { lobby } from "./lobby-server/LobbyServer";

// `npm start` passes --production: serve the built client from dist, rather than running vite
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
if (production) process.env.NODE_ENV = "production";
// vite-express mounts on the base, which vite.config.ts leaves relative for static hosting
ViteExpress.config({ mode: production ? "production" : "development", inlineViteConfig: { base: "/" } });

const PORT = Number(process.env.PORT) || 4802;

const expressApp = express();
const httpServer = http.createServer(expressApp);

// serve client app
ViteExpress.bind(expressApp, httpServer);

httpServer.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Server running on ${url}`);
  if (!production) openBrowser(url);
});

// match-making lobby, and a game for each room
lobby(new Server(httpServer));

/**
 * Opens the page when `npm run dev` starts. tsx watch restarts this server on every change while the page stays open,
 * so it is opened once per watcher, which outlives the restarts: a file named after it says the page was opened.
 * BROWSER=none leaves it to you, as in vite.
 */
function openBrowser(url: string) {
  if (process.env.BROWSER === "none") return;
  const opened = path.join(os.tmpdir(), `polymatic-example-soccer-${process.ppid}.opened`);
  if (fs.existsSync(opened)) return;
  fs.writeFileSync(opened, url);
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
  exec(`${command} ${url}`);
}
