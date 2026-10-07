import { Middleware, Runtime } from "polymatic";

import { Pitch } from "../soccer/Pitch";
import { Physics } from "../soccer/Physics";
import { FixedLoop } from "./FixedLoop";
import { RoomServer } from "./RoomServer";
import { type ServerContext } from "./ServerContext";
import { FIELD } from "./field";

/**
 * Game server for one room: runs the rules and physics, and syncs them with the clients in the room.
 */
export class MainServer extends Middleware<ServerContext> {
  constructor() {
    super();

    this.use(new FixedLoop());
    this.use(new Pitch());
    this.use(new Physics());
    this.use(new RoomServer());

    this.on("activate", this.handleActivate);
    this.on("terminate-room", this.handleTerminateRoom);
  }

  handleActivate = () => {
    // before the rules are activated, parents first
    this.context.field = FIELD;
  };

  handleTerminateRoom = () => {
    Runtime.deactivate(this);
  };
}
