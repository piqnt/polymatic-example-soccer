import type { Namespace } from "socket.io";

import { type SoccerContext } from "../soccer/SoccerContext";
import type { Room } from "../lobby-server/LobbyServer";

export interface Auth {
  id: string;
  secret: string;
}

export interface ServerContext extends SoccerContext {
  io: Namespace | null;
  room?: Room;

  auths: Auth[];
}
