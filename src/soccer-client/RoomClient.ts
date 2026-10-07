import { Middleware } from "polymatic";
import { io, type Socket } from "socket.io-client";

import { type Ball, type FrameLoopEvent, type Player, type Point } from "../soccer/SoccerContext";
import { type ClientContext } from "./ClientContext";

// how quickly shown positions catch up with the server's, in ms
const SMOOTHING = 40;

type Moving = Ball | Player;

/**
 * This runs on client and is responsible for receiving data from server, and passing user actions to server.
 *
 * The server sends positions a few times a second, so they are eased toward on every frame rather than jumped to.
 */
export class RoomClient extends Middleware<ClientContext> {
  io: Socket;
  connectionError: string | null = null;

  // latest positions from the server, by key
  targets = new Map<string, { x: number; y: number; angle: number }>();

  constructor() {
    super();

    this.on("activate", this.handleActivate);
    this.on("deactivate", this.handleDeactivate);
    this.on("frame-update", this.handleFrameUpdate);
    this.on("user-shoot", this.handleUserShoot);
    this.on("user-restart", this.handleUserRestart);
  }

  handleActivate = () => {
    this.printRoomStatus();

    // the login is picked by the lobby, see RoomStore
    const auth = this.context.auth;

    this.io = io("/room/" + this.context.room, { auth });

    this.io.on("connect_error", (err) => {
      if (err.message === "Invalid namespace") {
        this.connectionError = "Room not found!";
        this.context.onRoomNotFound?.();
      } else {
        this.connectionError = "Connection error: " + err.message;
      }
      this.printRoomStatus();
    });

    this.io.on("connect", () => {
      this.connectionError = null;
      this.printRoomStatus();
    });

    this.io.on("room-update", this.handleServerRoomState);
  };

  handleDeactivate = () => {
    this.context.hud.roomError.value = null;
    this.io?.disconnect();
  };

  handleServerRoomState = (data: any) => {
    const { ball, players, users, ...rest } = data;
    Object.assign(this.context, rest);

    if (ball !== undefined) {
      this.context.ball = ball && this.merge(this.context.ball, ball);
    }
    if (players !== undefined) {
      const current = new Map(this.context.players?.map((p) => [p.key, p]));
      this.context.players = players.map((p: Player) => this.merge(current.get(p.key), p));
    }
    if (users !== undefined) {
      this.context.users = users;
      this.context.me = users.find((user) => user.id === this.context.auth?.id) ?? null;
    }
  };

  /** Takes everything but the position from the server, the position is eased toward. */
  merge<T extends Moving>(current: T | null | undefined, next: T): T {
    this.targets.set(next.key, { x: next.x, y: next.y, angle: next.angle });
    if (!current || current.key !== next.key) return next;
    const { x, y, angle } = current;
    return Object.assign(current, next, { x, y, angle });
  }

  handleFrameUpdate = (ev: FrameLoopEvent) => {
    const t = 1 - Math.exp(-ev.dt / SMOOTHING);
    const moving: Moving[] = [...(this.context.players ?? []), this.context.ball].filter(Boolean);
    for (const data of moving) {
      const target = this.targets.get(data.key);
      if (!target) continue;
      data.x += (target.x - data.x) * t;
      data.y += (target.y - data.y) * t;
      data.angle += (target.angle - data.angle) * t;
    }
  };

  handleUserShoot = (data: { key: string; impulse: Point }) => {
    this.io?.emit("user-shoot", data);
  };

  handleUserRestart = () => {
    this.io?.emit("user-restart");
  };

  printRoomStatus = () => {
    this.context.hud.roomError.value = this.connectionError;
  };
}
