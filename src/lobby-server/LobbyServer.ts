import { type Server } from "socket.io";
import { Middleware, Runtime } from "polymatic";

import { randomRoomId } from "../lobby/RoomId";
import { MainServer } from "../soccer-server/MainServer";
import { type ServerContext } from "../soccer-server/ServerContext";

export const lobby = (io: Server) => {
  Runtime.activate(new LobbyServer(), { io });
};

export class Room {
  id = randomRoomId();
}

interface LobbyContext {
  io: Server;
}

class LobbyServer extends Middleware<LobbyContext> {
  constructor() {
    super();
    this.on("activate", this.handleActivate);
  }

  handleActivate = () => {
    this.context.io.on("connection", (socket) => {
      socket.on("create-room", (ack) => this.handleCreateRoomRequest(ack));
      socket.on("check-room", (id, ack) => this.handleCheckRoomRequest(id, ack));
    });
  };

  handleCreateRoomRequest = (ack: (room: { id: string }) => void) => {
    if (typeof ack !== "function") return;
    const room = new Room();
    this.activateRoom(room);
    ack({ id: room.id });
  };

  /** Whether a room is still running: its namespace is removed when it closes, see RoomServer. */
  handleCheckRoomRequest = (id: string, ack: (alive: boolean) => void) => {
    if (typeof ack !== "function") return;
    ack(typeof id === "string" && this.context.io._nsps.has("/room/" + id));
  };

  activateRoom = (room: Room) => {
    // a socket.io namespace and a server-side game instance for each room
    const context: ServerContext = {
      room,
      io: this.context.io.of("/room/" + room.id),
      auths: [],
    };
    Runtime.activate(new MainServer(), context);
  };
}
