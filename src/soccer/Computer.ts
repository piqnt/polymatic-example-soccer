import { Middleware } from "polymatic";

import {
  type Ball,
  type Color,
  type FrameLoopEvent,
  type Goal,
  type Player,
  type Point,
  type SoccerContext,
  other,
} from "./SoccerContext";
import { BALL_DAMPING, BALL_DENSITY, PLAYER_DAMPING, PLAYER_DENSITY, PLAYER_RESTITUTION } from "./Physics";

// the hardest a player can shoot, MAX_DRAG times SHOOT_STRENGTH in Terminal
const MAX_IMPULSE = 10;
// how long the computer looks at the pitch, then lines the shot up, in seconds
const THINK_TIME = 0.6;
const AIM_TIME = 0.7;
// how far off its aim the computer may be, in radians
const AIM_ERROR = 0.06;
// a cut shot turns the ball off the line between player and ball, this part of the cut, up to MAX_THROW, by friction,
// and the ball takes a bit less speed than a frictionless hit would give, as measured in planck
const THROW = 1 / 6;
const MAX_THROW = 0.11;
const TRANSFER = 0.93;
// gap kept between a shot's path and the players it should miss
const CLEARANCE = 0.05;
// speed the ball should still have when it reaches the goal line
const SPARE_SPEED = 3;
// how far off a shot on goal may be expected to go, in radians, see shotsOnGoal
const SHOT_SPREAD = 0.1;
// what a shot on goal is worth, besides its chance to go in, against moving the ball up the pitch, 0 to 1
const SHOT_VALUE = 0.8;
// how much the opponent's chance to score next weighs, and the computer's own, against moving the ball toward the
// opponent's goal
const DANGER = 0.6;
const PROMISE = 0.3;
// moving a player without the ball is worth this much less than a kick, and is not done once the ball has stayed put
// for this many turns
const MOVE_COST = 0.2;
const STUCK = 2;
// the ball is not sent closer than this to the computer's own goal
const OWN_GOAL_ZONE = 1.5;

interface Plan {
  key: string;
  impulse: Point;
  // seconds since the turn started
  t: number;
}

interface Shot {
  player: Player;
  angle: number;
  speed: number;
}

/** What the computer reads off the pitch to plan a shot, or how it expects the pitch to be after one. */
interface Scene {
  ball: Ball;
  players: Player[];
  wall: Point[];
}

const smooth = (u: number) => {
  u = Math.max(0, Math.min(1, u));
  return u * u * (3 - 2 * u);
};

/**
 * The computer player, offline. On its turn it picks a player to shoot, then pulls it back where you can see, and
 * shoots. Physics, rendering and network agnostic: it reads the pitch and emits the same shot a player would.
 *
 * It looks for a shot on goal: one of its players hitting the ball so it goes in, without anything in the way. When
 * there is no good one, it kicks the ball up the pitch, or moves a player into place without the ball, whichever
 * leaves the pitch best for it: the ball far from its own goal, little chance for the opponent to score next, and a
 * chance for itself. It never kicks the ball toward its own goal.
 */
export class Computer extends Middleware<SoccerContext> {
  plan: Plan | null = null;
  // where the ball was on the computer's last turn, and how many turns in a row it has not moved since
  last: Point | null = null;
  still = 0;

  constructor() {
    super();
    this.on("frame-update", this.handleFrameUpdate);
  }

  handleFrameUpdate = (ev: FrameLoopEvent) => {
    const context = this.context;
    const { computer, started, winner, moving, turn, ball, players } = context;
    if (!computer || !started || winner || moving || turn !== computer || !ball) {
      this.plan = null;
      context.computerAim = null;
      return;
    }

    if (!this.plan || !players.some((p) => p.key === this.plan.key)) {
      this.plan = { ...this.think(computer), t: 0 };
    }
    const plan = this.plan;
    plan.t += ev.dt / 1000;

    // pulls back from nothing to the shot
    const u = smooth((plan.t - THINK_TIME) / AIM_TIME);
    context.computerAim = u > 0 ? { key: plan.key, impulse: { x: plan.impulse.x * u, y: plan.impulse.y * u } } : null;

    if (plan.t > THINK_TIME + AIM_TIME + 0.2) {
      this.plan = null;
      context.computerAim = null;
      this.emit("user-shoot", { key: plan.key, impulse: plan.impulse });
    }
  };

  think(color: Color): { key: string; impulse: Point } {
    const { ball, players, wall, goals } = this.context;
    const scene: Scene = { ball, players, wall: wall.path };
    const own = players.filter((p) => p.color === color);
    // the goal to score in, and the one to keep
    const theirs = goals.find((goal) => goal.color === other(color));
    const ours = goals.find((goal) => goal.color === color);
    const target = mouth(theirs, ours);
    const keep = mouth(ours, theirs);

    // turns the ball has stayed put, see STUCK
    const stays = this.last && Math.hypot(ball.x - this.last.x, ball.y - this.last.y) < 0.01;
    this.still = stays ? this.still + 1 : 0;
    this.last = { x: ball.x, y: ball.y };

    // how close to the opponent's goal a point is, from 0 as far as the computer's own goal to 1 in the mouth, so the
    // corners count for less than the middle
    const length = Math.hypot(target.center.x - keep.center.x, target.center.y - keep.center.y);
    const progress = (p: Point) => 1 - Math.hypot(p.x - target.center.x, p.y - target.center.y) / length;
    // the best chance the given team has to score, if the pitch were left like this
    const chance = (shooters: Player[], goal: Mouth, scene: Scene) =>
      Math.max(0, ...shotsOnGoal(shooters, goal, scene).map((shot) => shot.chance));
    // how good the pitch is for the computer
    const value = (scene: Scene) => {
      const team = (color: Color) => scene.players.filter((p) => p.color === color);
      return (
        progress(scene.ball) -
        DANGER * chance(team(other(color)), keep, scene) +
        PROMISE * chance(team(color), target, scene)
      );
    };

    let best: (Shot & { value: number }) | null = null;
    const consider = (shot: Shot, value: number) => {
      if (!best || value > best.value) best = { ...shot, value };
    };

    for (const shot of shotsOnGoal(own, target, scene)) {
      consider(shot, SHOT_VALUE + shot.chance);
    }
    for (const kick of kicks(own, keep, scene)) {
      consider(kick, value(kick.scene));
    }
    // players are moved without the ball for a few turns at most, then the ball has to be played
    if (this.still < STUCK) {
      for (const move of moves(own, keep, target, scene)) {
        consider(move, value(move.scene) - MOVE_COST);
      }
    }
    if (!best) {
      const shot = push(own, keep, scene);
      if (shot) best = { ...shot, value: 0 };
    }
    if (!best) {
      // nothing works: a small push toward the middle for the player furthest from the ball, it has to shoot something
      const distance = (p: Player) => Math.hypot(p.x - ball.x, p.y - ball.y);
      const player = own.reduce((a, b) => (distance(b) > distance(a) ? b : a));
      const middle = { x: (target.center.x + keep.center.x) / 2, y: (target.center.y + keep.center.y) / 2 };
      const angle = Math.atan2(middle.y - player.y, middle.x - player.x);
      best = { player, angle, speed: PLAYER_DAMPING * 0.5, value: 0 };
    }

    const angle = best.angle + (Math.random() - 0.5) * 2 * AIM_ERROR;
    const impulse = Math.min(MAX_IMPULSE, best.speed * mass(best.player));
    return { key: best.player.key, impulse: { x: Math.cos(angle) * impulse, y: Math.sin(angle) * impulse } };
  }
}

const mass = (body: { radius: number; type: "player" | "ball" }) =>
  (body.type === "player" ? PLAYER_DENSITY : BALL_DENSITY) * Math.PI * body.radius ** 2;

/** A goal mouth, its middle, and the way into the pitch from it. */
interface Mouth {
  a: Point;
  b: Point;
  center: Point;
  inward: Point;
}

function mouth(goal: Goal, other: Goal): Mouth {
  const [a, b] = goal.path;
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // goals are at the ends of the pitch, toward the other one is inward
  const [c, d] = other.path;
  let inward = unit(a.y - b.y, b.x - a.x);
  if (inward.x * (c.x + d.x - a.x - b.x) + inward.y * (c.y + d.y - a.y - b.y) < 0) {
    inward = { x: -inward.x, y: -inward.y };
  }
  return { a, b, center, inward };
}

/**
 * Where the player has to be when it touches the ball for the ball to go the given way, and what it takes to get it
 * there: the cut, the player's speed for the ball to leave at the given speed, and where the player ends up. Null if
 * the cut is too thin, the player's way there is blocked, or it is faster than the player can go.
 */
function strike(player: Player, ball: Ball, dir: Point, ballSpeed: number, scene: Scene) {
  const contact = player.radius + ball.radius;
  // the ball goes off the line between them at contact, turned a little the way the player goes, see THROW, so that
  // line is turned back as much, found in a few steps
  let line = dir;
  for (let i = 0; i < 3; i++) {
    const lx = ball.x - line.x * contact - player.x;
    const ly = ball.y - line.y * contact - player.y;
    const cut = Math.atan2(line.x * ly - line.y * lx, line.x * lx + line.y * ly);
    const drift = Math.sign(cut) * Math.min(Math.abs(cut) * THROW, MAX_THROW);
    line = rotate(dir, -drift);
  }
  // where the player is when it touches the ball
  const ghost = { x: ball.x - line.x * contact, y: ball.y - line.y * contact };
  const lx = ghost.x - player.x;
  const ly = ghost.y - player.y;
  const length = Math.hypot(lx, ly);
  if (length < 0.01) return null;
  const cos = (lx * line.x + ly * line.y) / length;
  if (cos < 0.4) return null;

  const others = scene.players.filter((p) => p !== player);
  if (others.some((p) => segmentDistance(p, player, ghost) < p.radius + player.radius + CLEARANCE)) return null;
  if (!clearOfWall(player, ghost, player.radius, scene.wall)) return null;

  // the ball takes the part of the player's speed along the line between them, more so the lighter it is
  const mp = mass(player);
  const mb = mass(ball);
  const transfer = (TRANSFER * cos * (1 + PLAYER_RESTITUTION) * mp) / (mp + mb);
  const hit = ballSpeed / transfer;
  const speed = hit + PLAYER_DAMPING * length;
  if (speed * mp > MAX_IMPULSE) return null;

  // the player goes on after the hit, slowed along the line to the ball
  const along = hit * cos * ((mp - PLAYER_RESTITUTION * mb) / (mp + mb));
  const side = { x: (hit * lx) / length - hit * cos * line.x, y: (hit * ly) / length - hit * cos * line.y };
  const vx = line.x * along + side.x;
  const vy = line.y * along + side.y;
  const after = { x: ghost.x + vx / PLAYER_DAMPING, y: ghost.y + vy / PLAYER_DAMPING };

  return { angle: Math.atan2(ly, lx), speed, cos, length, after: inside(after, player.radius, scene.wall) };
}

/**
 * Shots of the ball into the goal, at a few points across the mouth, each with its chance to go in: how far off its
 * aim the shooter can be and still score, as a part of SHOT_SPREAD, and a cut from further away needs more care.
 * Shots where the ball would hit a player or a post are left out.
 */
function shotsOnGoal(shooters: Player[], goal: Mouth, scene: Scene) {
  const shots: (Shot & { chance: number })[] = [];
  const { ball } = scene;
  const span = Math.hypot(goal.b.x - goal.a.x, goal.b.y - goal.a.y);
  const along = unit(goal.b.x - goal.a.x, goal.b.y - goal.a.y);
  const inset = ball.radius + CLEARANCE;
  for (let k = 0; k <= 6; k++) {
    const s = inset + ((span - 2 * inset) * k) / 6;
    // where the ball touches the goal line
    const end = {
      x: goal.a.x + along.x * s + goal.inward.x * ball.radius,
      y: goal.a.y + along.y * s + goal.inward.y * ball.radius,
    };
    const dx = end.x - ball.x;
    const dy = end.y - ball.y;
    const distance = Math.hypot(dx, dy);
    const dir = unit(dx, dy);
    // in through the front of the goal
    const into = -(dir.x * goal.inward.x + dir.y * goal.inward.y);
    if (into < 0.2) continue;
    if (!clearOfWall(ball, end, ball.radius + CLEARANCE, scene.wall)) continue;

    // room either side for the ball to still go in, across its path
    const room = (Math.min(s, span - s) - ball.radius) * into;

    for (const player of shooters) {
      const others = scene.players.filter((p) => p !== player);
      if (others.some((p) => segmentDistance(p, ball, end) < p.radius + ball.radius + CLEARANCE)) continue;
      const hit = strike(player, ball, dir, BALL_DAMPING * distance + SPARE_SPEED, scene);
      if (!hit) continue;
      // the ball goes off by the player's aim error, times this
      const spread = 1 + hit.length / ((player.radius + ball.radius) * hit.cos);
      const tolerance = room / (distance * spread);
      shots.push({ player, angle: hit.angle, speed: hit.speed, chance: Math.min(1, tolerance / SHOT_SPREAD) });
    }
  }
  return shots;
}

/**
 * Kicks of the ball any way but toward the computer's own goal, to where it comes to rest, sliding along the wall if
 * it gets there, or to the first player in its way, well away from the goal, as it is not known where it goes from
 * there. Each comes with the pitch as it will be after it.
 */
function kicks(own: Player[], keep: Mouth, scene: Scene) {
  const kicks: (Shot & { scene: Scene })[] = [];
  const { ball } = scene;
  // every 15 degrees, and straight on from each player
  const directions: Point[] = [];
  for (let k = 0; k < 24; k++) {
    directions.push({ x: Math.cos((k * Math.PI) / 12), y: Math.sin((k * Math.PI) / 12) });
  }
  for (const player of own) {
    directions.push(unit(ball.x - player.x, ball.y - player.y));
  }
  // close to the computer's own goal, only clean kicks away from it, as a ball hit into the wall or a player may
  // bounce back off the player that kicked it
  const close = segmentDistance(ball, keep.a, keep.b) < 2 * OWN_GOAL_ZONE;
  for (const dir of directions) {
    if (towardGoal(ball, dir, keep)) continue;
    for (const travel of [0.75, 1.5, 3, 4.5]) {
      const { path, glance } = roll(ball, dir, travel, scene.wall);
      if (close && glance < 0.7) continue;
      const zone = close ? 2 * OWN_GOAL_ZONE : OWN_GOAL_ZONE;
      if (path.some((p, i) => i > 0 && !clearOf(keep.a, keep.b, path[i - 1], p, zone))) continue;
      for (const player of own) {
        const others = scene.players.filter((p) => p !== player);
        let stop = path[path.length - 1];
        for (let i = 1; i < path.length; i++) {
          const blocked = Math.min(...others.map((p) => reach(path[i - 1], path[i], p, p.radius + ball.radius)));
          if (blocked === Infinity) continue;
          const d = unit(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
          stop = { x: path[i - 1].x + d.x * blocked, y: path[i - 1].y + d.y * blocked };
          break;
        }
        const free = stop === path[path.length - 1];
        if (!free && (close || segmentDistance(stop, keep.a, keep.b) < 2 * OWN_GOAL_ZONE)) continue;
        const hit = strike(player, ball, dir, BALL_DAMPING * travel, scene);
        if (!hit) continue;
        const players = scene.players.map((p) => (p === player ? { ...p, ...hit.after } : p));
        kicks.push({
          player,
          angle: hit.angle,
          speed: hit.speed,
          scene: { ...scene, ball: { ...ball, ...stop }, players },
        });
      }
    }
  }
  return kicks;
}

/**
 * Nothing else works: the player nearest to the ball runs straight into it to get it moving, whatever else it hits.
 * Not close to the computer's own goal.
 */
function push(own: Player[], keep: Mouth, scene: Scene): Shot | null {
  const { ball } = scene;
  // not close to the computer's own goal, where the ball may bounce anywhere
  if (segmentDistance(ball, keep.a, keep.b) < 2 * OWN_GOAL_ZONE) return null;
  let best: Shot | null = null;
  let nearest = Infinity;
  for (const player of own) {
    const dir = unit(ball.x - player.x, ball.y - player.y);
    if (towardGoal(ball, dir, keep)) continue;
    const distance = Math.hypot(ball.x - player.x, ball.y - player.y) - player.radius - ball.radius;
    if (distance < nearest) {
      nearest = distance;
      // getting there with some speed to spare, to move the ball a couple of units
      best = { player, angle: Math.atan2(dir.y, dir.x), speed: PLAYER_DAMPING * distance + 6 };
    }
  }
  return best;
}

/** Whether the ball, close to the goal, would go anywhere near the way into it. */
function towardGoal(ball: Point, dir: Point, goal: Mouth) {
  if (segmentDistance(ball, goal.a, goal.b) >= 2 * OWN_GOAL_ZONE) return false;
  const angle = (p: Point) => Math.atan2(p.y - ball.y, p.x - ball.x);
  const center = angle(goal.center);
  const width = Math.max(Math.abs(turn(angle(goal.a) - center)), Math.abs(turn(angle(goal.b) - center)));
  return Math.abs(turn(Math.atan2(dir.y, dir.x) - center)) < width + Math.PI / 6;
}

/**
 * Moves of a player, without touching the ball, to where it stops: between the ball and the computer's own goal, or
 * around the ball, to kick it from there next. Each comes with the pitch as it will be after it.
 */
function moves(own: Player[], keep: Mouth, target: Mouth, scene: Scene) {
  const moves: (Shot & { scene: Scene })[] = [];
  const { ball } = scene;
  const spots: Point[] = [];
  // between the ball and the goal, close to the ball and further back
  const guard = unit(keep.center.x - ball.x, keep.center.y - ball.y);
  const back = Math.hypot(keep.center.x - ball.x, keep.center.y - ball.y);
  for (const d of [0.75, 1.5, 2.5]) {
    if (d < back - 0.5) spots.push({ x: ball.x + guard.x * d, y: ball.y + guard.y * d });
  }
  // around the ball, to kick it some way next
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4;
    for (const d of [0.75, 1.5]) {
      spots.push({ x: ball.x + Math.cos(angle) * d, y: ball.y + Math.sin(angle) * d });
    }
  }
  for (const spot of spots) {
    for (const player of own) {
      const distance = Math.hypot(spot.x - player.x, spot.y - player.y);
      if (distance < 0.1) continue;
      const others = scene.players.filter((p) => p !== player);
      if (others.some((p) => segmentDistance(p, player, spot) < p.radius + player.radius + CLEARANCE)) continue;
      // and wide of the ball, even if the aim is off
      const wide = ball.radius + player.radius + CLEARANCE + AIM_ERROR * distance;
      if (segmentDistance(ball, player, spot) < wide) continue;
      if (!clearOfWall(player, spot, player.radius, scene.wall)) continue;
      // players bounce off the goal lines too
      if ([keep, target].some((goal) => !clearOf(goal.a, goal.b, player, spot, player.radius))) continue;
      const speed = PLAYER_DAMPING * distance;
      if (speed * mass(player) > MAX_IMPULSE) continue;
      const players = scene.players.map((p) => (p === player ? { ...p, ...spot } : p));
      const angle = Math.atan2(spot.y - player.y, spot.x - player.x);
      moves.push({ player, angle, speed, scene: { ...scene, players } });
    }
  }
  return moves;
}

/** How far along the way from a to b something gets before it comes within the given distance of p, if it does. */
function reach(a: Point, b: Point, p: Point, distance: number) {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
  const dx = (b.x - a.x) / length;
  const dy = (b.y - a.y) / length;
  const along = (p.x - a.x) * dx + (p.y - a.y) * dy;
  const across = (p.x - a.x) * dy - (p.y - a.y) * dx;
  if (Math.abs(across) >= distance || along < 0) return Infinity;
  const t = along - Math.sqrt(distance * distance - across * across);
  return t <= length ? Math.max(0, t) : Infinity;
}

/**
 * The way the ball rolls, from where it is the given way and distance, as points: on hitting the wall it loses the
 * speed into it, and slides along it with the rest. And how much of its speed it keeps at the worst of the hits.
 */
function roll(ball: Ball, dir: Point, travel: number, wall: Point[]) {
  const path: Point[] = [{ x: ball.x, y: ball.y }];
  let p = path[0];
  let left = travel;
  let glance = 1;
  for (let n = 0; left > 1e-6 && n < 1000; n++) {
    // in short steps, much shorter than the ball's radius
    const step = Math.min(0.05, left);
    const next = { x: p.x + dir.x * step, y: p.y + dir.y * step };
    const edge = nearestEdge(next, wall);
    if (edge.distance < ball.radius && edge.distance < nearestEdge(p, wall).distance) {
      // slides along the wall, with the speed along it
      const along = unit(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
      const c = dir.x * along.x + dir.y * along.y;
      glance = Math.min(glance, Math.abs(c));
      if (Math.abs(c) < 0.1) break;
      dir = { x: Math.sign(c) * along.x, y: Math.sign(c) * along.y };
      left *= Math.abs(c);
      if (p !== path[path.length - 1]) path.push(p);
      continue;
    }
    p = next;
    left -= step;
  }
  if (p !== path[path.length - 1]) path.push(p);
  return { path, glance };
}

/** The wall's edge closest to the point, and how far it is. */
function nearestEdge(p: Point, wall: Point[]) {
  let best = { a: wall[0], b: wall[1], distance: Infinity };
  for (let i = 0; i < wall.length; i++) {
    const a = wall[i];
    const b = wall[(i + 1) % wall.length];
    const distance = segmentDistance(p, a, b);
    if (distance < best.distance) best = { a, b, distance };
  }
  return best;
}

/** A point moved off the wall, to the given distance from it, toward the inside. */
function inside(p: Point, radius: number, wall: Point[]): Point {
  for (let i = 0; i < wall.length; i++) {
    const a = wall[i];
    const b = wall[(i + 1) % wall.length];
    const q = closest(p, a, b);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < radius && d > 1e-9) {
      p = { x: q.x + ((p.x - q.x) * radius) / d, y: q.y + ((p.y - q.y) * radius) / d };
    }
  }
  return p;
}

/**
 * Whether something of the given radius going from a to b stays clear of the wall. One that is touching the wall
 * already may still go, as long as it moves away from it.
 */
function clearOfWall(a: Point, b: Point, radius: number, wall: Point[]) {
  // edges out of reach are skipped, most are
  const left = Math.min(a.x, b.x) - radius;
  const right = Math.max(a.x, b.x) + radius;
  const bottom = Math.min(a.y, b.y) - radius;
  const top = Math.max(a.y, b.y) + radius;
  for (let i = 0; i < wall.length; i++) {
    const c = wall[i];
    const d = wall[(i + 1) % wall.length];
    if (Math.max(c.x, d.x) < left || Math.min(c.x, d.x) > right) continue;
    if (Math.max(c.y, d.y) < bottom || Math.min(c.y, d.y) > top) continue;
    if (!clearOf(c, d, a, b, radius)) return false;
  }
  return true;
}

/** Whether going from a to b stays the given distance from the segment from c to d, or does not get closer to it. */
function clearOf(c: Point, d: Point, a: Point, b: Point, distance: number) {
  const start = segmentDistance(a, c, d);
  return segmentsDistance(a, b, c, d) >= Math.min(distance, start - 1e-6);
}

function rotate(p: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** An angle turned into -PI to PI. */
function turn(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function unit(x: number, y: number): Point {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/** The point on the segment from a to b closest to p. */
function closest(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1e-9)));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Distance from a point to the segment from a to b. */
function segmentDistance(p: Point, a: Point, b: Point) {
  const q = closest(p, a, b);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

/** Distance between the segments from a to b and from c to d. */
function segmentsDistance(a: Point, b: Point, c: Point, d: Point) {
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    segmentDistance(a, c, d),
    segmentDistance(b, c, d),
    segmentDistance(c, a, b),
    segmentDistance(d, a, b),
  );
}
