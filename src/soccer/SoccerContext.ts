import { type Field } from "./Field";
import { type FormationName } from "./Formation";

export type Color = "red" | "blue";

export const other = (color: Color): Color => (color === "red" ? "blue" : "red");

export interface Point {
  x: number;
  y: number;
}

export interface Player {
  key: string;
  type: "player";
  color: Color;
  radius: number;
  // position and rotation, updated by physics
  x: number;
  y: number;
  angle: number;
  // shot to apply, consumed by physics
  impulse?: Point | null;
}

export interface Ball {
  key: string;
  type: "ball";
  radius: number;
  // position and rotation, updated by physics
  x: number;
  y: number;
  angle: number;
}

/** Pitch boundary, closed outline with goal pockets on both ends. */
export interface Wall {
  key: string;
  type: "wall";
  path: Point[];
}

/** Goal mouth line, the ball touching it is a goal. */
export interface Goal {
  key: string;
  type: "goal";
  // team defending this goal
  color: Color;
  path: [Point, Point];
}

export type Entity = Player | Ball | Wall | Goal;

/** Someone taking part: a person at the table offline is not one, online everyone connected is. */
export interface User {
  id: string;
  // team this user plays, none for a spectator
  color?: Color;
}

export interface FrameLoopEvent {
  dt: number;
  now: number;
}

/**
 * Game data, shared by the offline game, the server, and the online client which receives it from the server.
 */
export interface SoccerContext {
  // layout, read from field.svg, see Field
  field?: Field;
  // each team's kickoff positions, the default formation if not chosen, see Formation
  formations?: Partial<Record<Color, FormationName>>;

  wall?: Wall;
  goals?: Goal[];
  ball?: Ball | null;
  players?: Player[];

  score?: Record<Color, number>;
  started?: boolean;
  // team to shoot next
  turn?: Color;
  // a shot was taken, and things are still moving
  moving?: boolean;
  winner?: Color | null;

  users?: User[];

  // offline only: the team the computer plays, if any, and the shot it is lining up, see Computer
  computer?: Color;
  computerAim?: { key: string; impulse: Point } | null;
}
