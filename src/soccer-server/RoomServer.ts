import { Middleware } from "polymatic";

import { type Ball, type Color, type Player, type Point, type User } from "../soccer/SoccerContext";
import { type Auth, type ServerContext } from "./ServerContext";

// longest shot a client may ask for, see Terminal
const MAX_IMPULSE = 10;
// a room nobody has played in for this long is closed, in ms
const ROOM_LEASE = 30 * 60 * 1000;

/**
 * This runs on server and is responsible for sending data to clients, and receiving user actions from clients.
 *
 * The first two users to join play, red and blue at random, anyone after them watches. A user keeps their team
 * when they reconnect with the same auth.
 */
export class RoomServer extends Middleware<ServerContext> {
  inactiveRoomTimeout: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    this.on("activate", this.handleActivate);
    this.on("deactivate", this.handleDeactivate);
    this.on("frame-update", this.handleFrameUpdate);
    this.on("update", this.sendState);
  }

  handleActivate = () => {
    this.context.users = [];
    this.extendRoomLease();

    this.context.io.on("connection", (socket) => {
      const auth = socket.handshake.auth as Auth;
      if (typeof auth?.id !== "string" || typeof auth?.secret !== "string") {
        socket.disconnect();
        return;
      }

      const record = this.context.auths.find((a) => a.id === auth.id);
      if (!record) {
        this.context.auths.push({ id: auth.id, secret: auth.secret });
      } else if (record.secret !== auth.secret) {
        socket.disconnect();
        return;
      }

      let user = this.context.users.find((u) => u.id === auth.id);
      if (!user) {
        user = { id: auth.id };
        this.context.users.push(user);
      }
      this.handleUserEnter();

      socket.on("user-shoot", (data) => this.handleUserShoot(user, data));
      socket.on("user-restart", () => this.handleUserRestart(user));

      // one message, so the client never renders the pitch without the pieces on it
      socket.emit("room-update", { ...this.fixedState(), ...this.state() });
      socket.broadcast.emit("room-update", this.state());
    });
  };

  handleDeactivate = () => {
    clearTimeout(this.inactiveRoomTimeout);

    const io = this.context.io;
    if (io) {
      this.context.io = null;
      io.removeAllListeners("connection");
      io.local.disconnectSockets();
      io.server._nsps.delete(io.name);
    }
  };

  extendRoomLease = () => {
    clearTimeout(this.inactiveRoomTimeout);
    this.inactiveRoomTimeout = setTimeout(() => this.emit("terminate-room"), ROOM_LEASE);
  };

  /** Once two users are in, they get a team each and the game starts. */
  handleUserEnter = () => {
    if (this.context.started) return;
    const players = this.context.users.slice(0, 2);
    if (players.length < 2) return;
    const colors: Color[] = Math.random() < 0.5 ? ["red", "blue"] : ["blue", "red"];
    players.forEach((user, i) => (user.color = colors[i]));
    this.emit("game-start");
  };

  handleUserShoot = (user: User, data: { key: string; impulse: Point }) => {
    if (!user.color || user.color !== this.context.turn) return;
    if (typeof data?.key !== "string") return;
    const x = Number(data.impulse?.x);
    const y = Number(data.impulse?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const k = Math.min(1, MAX_IMPULSE / (Math.hypot(x, y) || 1));
    // the rules check the player is on the team whose turn it is
    this.emit("user-shoot", { key: data.key, impulse: { x: x * k, y: y * k } });
    this.extendRoomLease();
  };

  handleUserRestart = (user: User) => {
    if (!user.color) return;
    this.emit("user-restart");
  };

  handleFrameUpdate = () => {
    if (this.context.moving) {
      this.sendState();
    }
  };

  fixedState = () => {
    const { wall, goals } = this.context;
    return { wall, goals };
  };

  sendState = () => {
    this.context.io?.emit("room-update", this.state());
  };

  state = () => {
    const { ball, players, score, started, turn, moving, winner, users } = this.context;
    return {
      ball: ball ? round(ball) : null,
      players: players.map(round),
      score,
      started,
      turn,
      moving,
      winner,
      users,
    };
  };
}

/** Clients only need positions to a millimeter, and never the pending impulse. */
function round<T extends Ball | Player>(data: T): T {
  const { impulse, ...rest } = data as Player;
  return {
    ...rest,
    x: Math.round(data.x * 1000) / 1000,
    y: Math.round(data.y * 1000) / 1000,
    angle: Math.round(data.angle * 1000) / 1000,
  } as T;
}
