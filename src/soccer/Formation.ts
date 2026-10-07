import { type Field } from "./Field";
import { type Color, type Point } from "./SoccerContext";

export const PLAYER_RADIUS = 0.35;

/**
 * Where a team's players stand at kickoff, numbered in order, 1 is the keeper.
 *
 * Positions are relative to the team's own half, so a formation fits either side of any field: x from the team's goal
 * line, 0, to the halfway line, 1, and y from the bottom touchline, -1, to the top one, 1, as seen with the team's goal
 * on the left.
 */
export type Formation = Point[];

export const FORMATIONS = {
  "2-2": [
    { x: 0.1, y: 0 },
    { x: 0.4, y: -0.4 },
    { x: 0.4, y: 0.4 },
    { x: 0.8, y: -0.2 },
    { x: 0.8, y: 0.2 },
  ],
} satisfies Record<string, Formation>;

export type FormationName = keyof typeof FORMATIONS;

export const DEFAULT_FORMATION: FormationName = "2-2";

/** The most players any formation has, see Art. */
export const MAX_PLAYERS = Math.max(...Object.values(FORMATIONS).map((formation) => formation.length));

/**
 * Kickoff positions of a team on the field: from its own goal line to the halfway line between the two goals, and
 * across the wall's height. The goals are expected on the left and the right of the field.
 */
export function placeFormation(formation: Formation, field: Field, color: Color): Point[] {
  const goalX = (color: Color) => {
    const goal = field.goals.find((goal) => goal.color === color)!;
    return (goal.path[0].x + goal.path[1].x) / 2;
  };
  const own = goalX(color);
  const halfway = (own + goalX(color === "red" ? "blue" : "red")) / 2;
  const bottom = Math.min(...field.wall.map((p) => p.y));
  const top = Math.max(...field.wall.map((p) => p.y));
  return formation.map((p) => ({
    x: own + p.x * (halfway - own),
    y: (top + bottom) / 2 + (p.y * (top - bottom)) / 2,
  }));
}
