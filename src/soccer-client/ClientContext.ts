import { type Application, type Container } from "pixi.js";

import { type Color, type SoccerContext, type User } from "../soccer/SoccerContext";
import { type HudData } from "./HudData";

export interface Auth {
  id: string;
  secret: string;
}

export interface ClientContext extends SoccerContext {
  pixi?: Application;
  scene?: Container;

  /**
   * The bridge to the Preact shell, made by the lobby and shared with every
   * game it starts - see HudData.
   */
  hud: HudData;

  // online only: the room, who this client is, and the user record the server has for it
  room?: string;
  auth?: Auth;
  me?: User | null;

  /** Called by the room client when the server has no such room, see LobbyClient. */
  onRoomNotFound?: () => void;
}

/**
 * Whether this client may shoot a player of the given team now. Offline both teams play on this device, but for the
 * computer's, online only the team the server gave this user.
 */
export const canShoot = (context: ClientContext, color: Color) => {
  if (!context.started || context.winner || context.moving) return false;
  if (context.turn !== color) return false;
  if (context.computer === color) return false;
  if (context.room && context.me?.color !== color) return false;
  return true;
};
