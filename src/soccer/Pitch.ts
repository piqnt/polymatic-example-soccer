import { Middleware } from "polymatic";

import { type Color, type Goal, type Player, type Point, type SoccerContext, other } from "./SoccerContext";
import { DEFAULT_FORMATION, FORMATIONS, PLAYER_RADIUS, placeFormation } from "./Formation";

// first team to score this many wins
const WIN_SCORE = 3;

/**
 * Game logic: turns, goals and kickoffs. Physics, rendering and network agnostic.
 *
 * Teams take turns: the team on turn shoots one of its players, and once everything has stopped the turn passes.
 * After a goal both teams go back to formation, and the team that conceded kicks off.
 *
 * The walls, goals and the ball's kickoff position come from the field, see field.svg, and the players' from each
 * team's formation, see Formation.
 */
export class Pitch extends Middleware<SoccerContext> {
  // team to kick off when the current shot ends, set by a goal
  kickoffColor: Color | null = null;

  constructor() {
    super();
    this.on("activate", this.handleActivate);
    this.on("game-start", this.handleGameStart);
    this.on("user-shoot", this.handleUserShoot);
    this.on("user-restart", this.handleUserRestart);
    this.on("game-goal", this.handleGoal);
    this.on("shot-end", this.handleShotEnd);
  }

  handleActivate = () => {
    const field = this.context.field;
    this.context.wall = { key: "wall", type: "wall", path: field.wall };
    this.context.goals = field.goals.map((goal, n) => ({ key: "goal-" + n, type: "goal", ...goal }));
    this.context.score = { red: 0, blue: 0 };
    this.context.started = false;
    this.context.moving = false;
    this.context.winner = null;
    this.kickoff(Math.random() < 0.5 ? "red" : "blue");
  };

  handleGameStart = () => {
    this.context.started = true;
    this.context.score = { red: 0, blue: 0 };
    this.context.winner = null;
    this.kickoff(Math.random() < 0.5 ? "red" : "blue");
  };

  /** Both teams in formation, the ball on the center spot, and the given team to shoot. */
  kickoff(color: Color) {
    this.kickoffColor = null;
    this.context.players = [...this.team("red"), ...this.team("blue")];
    const { x, y, radius } = this.context.field.ball;
    this.context.ball = { key: "ball-" + Math.random(), type: "ball", radius, x, y, angle: 0 };
    this.context.turn = color;
    this.context.moving = false;
    this.emit("update");
  }

  /** A team in its formation's kickoff positions, numbered the same every kickoff. */
  team(color: Color): Player[] {
    const formation = FORMATIONS[this.context.formations?.[color] ?? DEFAULT_FORMATION];
    return placeFormation(formation, this.context.field, color).map(({ x, y }) => ({
      key: color + "-player-" + Math.random(),
      type: "player",
      color,
      radius: PLAYER_RADIUS,
      x,
      y,
      angle: 0,
    }));
  }

  handleUserShoot = ({ key, impulse }: { key: string; impulse: Point }) => {
    const { started, winner, moving, turn, players } = this.context;
    if (!started || winner || moving) return;
    const player = players.find((p) => p.key === key);
    if (!player || player.color !== turn) return;
    player.impulse = impulse;
    this.context.moving = true;
    this.emit("update");
  };

  handleGoal = ({ goal }: { goal: Goal }) => {
    if (!this.context.ball) return;
    this.context.ball = null;

    const scorer = other(goal.color);
    this.context.score[scorer]++;
    if (this.context.score[scorer] >= WIN_SCORE) {
      this.context.winner = scorer;
    }
    this.kickoffColor = goal.color;
    this.emit("update");
  };

  handleShotEnd = () => {
    if (!this.context.moving) return;
    this.context.moving = false;
    if (this.context.winner) {
      // leave the final position on the pitch until someone restarts
    } else if (this.kickoffColor) {
      this.kickoff(this.kickoffColor);
    } else {
      this.context.turn = other(this.context.turn);
    }
    this.emit("update");
  };

  handleUserRestart = () => {
    if (!this.context.winner) return;
    this.emit("game-start");
  };
}
