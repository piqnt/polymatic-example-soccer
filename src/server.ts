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
  console.log(`Server running on http://localhost:${PORT}`);
});

// match-making lobby, and a game for each room
lobby(new Server(httpServer));
