import { Container, Graphics, Sprite, type FederatedPointerEvent, type Texture } from "pixi.js";

import { Binder, Driver, Middleware } from "polymatic";

import { type ClientContext, canShoot } from "./ClientContext";
import { type Marking } from "../soccer/Field";
import { type Ball, type Entity, type Player, type Point, type Wall } from "../soccer/SoccerContext";
import { type Art, GROUND_RESOLUTION, destroyArt, playerKey } from "./Art";
import { RollingBall } from "./RollingBall";

// shadows fall away from the lights, right and down on screen, as a part of the radius
const SHADOW_OFFSET = { x: 0.18, y: 0.26 };

// impulse per world unit of drag
const SHOOT_STRENGTH = 2;
// pointer can grab a player a bit outside its edge, for touch
const GRAB_MARGIN = 0.2;
// a shorter drag is taken as a change of mind, and a longer one is capped, in world units
const MIN_DRAG = 0.2;
export const MAX_DRAG = 5;

const LINE_WIDTH = 0.04;
// pixi picks a circle's segment count from its radius in local units, which is tiny in world units,
// so circles are drawn larger and the graphics scaled back down
const CURVE_SCALE = 100;
const COLORS = {
  red: 0xff411a,
  blue: 0x0077ff,
};

/** Textured disc: the body rotates with physics, the shine on top stays lit from the same side. */
interface Disc {
  view: Container;
  body: Sprite;
  light: Sprite;
  shadow: Sprite;
  // marks the team whose turn it is
  ring: Graphics;
}

/** The ball, turned in 3d as it rolls, and where it was last frame. */
interface BallDisc extends Disc {
  ball: RollingBall;
  last: { x: number; y: number; angle: number };
}

/**
 * Terminal: renders game data with Pixi, and reads pointer input. Drag a player and release to shoot it
 * in the opposite direction, like a slingshot.
 */
export class Terminal extends Middleware<ClientContext> {
  // pitch markings, below players and ball
  markings: Container;
  // shadows of players and ball, then players and ball, between the pitch and the aim line
  shadows: Container;
  layer: Container;
  aim: Graphics;

  // drawn from svg, see Art, and owned by this. The ball's texture is owned by the ball
  art: Art;

  // player being aimed, and pointer position in world coordinates
  aimKey: string | null = null;
  pointer: Point = { x: 0, y: 0 };

  constructor(art: Art) {
    super();
    this.art = art;
    this.on("activate", this.handleActivate);
    this.on("deactivate", this.handleDeactivate);
    this.on("frame-render", this.handleFrameRender);
  }

  handleActivate = () => {
    const pixi = this.context.pixi;

    pixi.renderer.on("resize", this.handleViewport);
    this.handleViewport();

    this.markings = new Container();
    this.shadows = new Container();
    this.layer = new Container();
    this.aim = new Graphics();
    this.context.scene.addChild(this.markings, this.shadows, this.layer, this.aim);

    pixi.stage.eventMode = "static";
    pixi.stage.hitArea = pixi.screen;
    pixi.stage.on("pointerdown", this.handlePointerDown);
    pixi.stage.on("globalpointermove", this.handlePointerMove);
    pixi.stage.on("pointerup", this.handlePointerUp);
    pixi.stage.on("pointerupoutside", this.handlePointerUp);
  };

  handleDeactivate = () => {
    const pixi = this.context.pixi;
    pixi?.renderer.off("resize", this.handleViewport);
    pixi?.stage.removeAllListeners();

    destroyArt(this.art);
  };

  /** Players are numbered in their team's formation, 1 is the keeper. */
  playerTexture(player: Player) {
    const number = (this.context.players?.filter((p) => p.color === player.color).indexOf(player) ?? 0) + 1;
    // the field's formation has a texture for every number, a player past it takes the last
    const players = this.art.players;
    return players.get(playerKey(player.color, number)) ?? [...players.values()].at(-1);
  }

  /** Where a disc's shadow goes, a fixed way on screen however the scene is turned and flipped. */
  placeShadow(disc: Disc, x: number, y: number, radius: number) {
    const turn = this.context.scene.rotation;
    const ox = SHADOW_OFFSET.x * radius;
    const oy = SHADOW_OFFSET.y * radius;
    // the scene flips y, so a screen offset is turned back and flipped
    const vx = Math.cos(turn) * ox + Math.sin(turn) * oy;
    const vy = -Math.sin(turn) * ox + Math.cos(turn) * oy;
    disc.shadow.position.set(x + vx, y - vy);
  }

  /**
   * Fit the pitch inside the screen, center the origin, and flip y-axis to point up like physics.
   * On a portrait screen the pitch is turned a quarter, so it stays the long way round.
   */
  handleViewport = () => {
    const pixi = this.context.pixi;
    const scene = this.context.scene;

    const screenWidth = pixi.screen.width;
    const screenHeight = pixi.screen.height;

    const portrait = screenHeight > screenWidth;
    const view = this.context.field.view;
    const viewWidth = portrait ? view.height : view.width;
    const viewHeight = portrait ? view.width : view.height;

    const scale = Math.min(screenWidth / viewWidth, screenHeight / viewHeight);
    scene.scale.set(scale, -scale);
    scene.rotation = portrait ? Math.PI / 2 : 0;
    // the middle of the view, from field.svg, in the middle of the screen
    scene.pivot.set(view.left + view.width / 2, view.bottom + view.height / 2);
    scene.position.set(screenWidth / 2, screenHeight / 2);
  };

  toWorld(ev: FederatedPointerEvent): Point {
    const p = this.context.scene.toLocal(ev.global);
    return { x: p.x, y: p.y };
  }

  /** Player being aimed, if it can still be shot. */
  aimed(): Player | null {
    const player = this.context.players?.find((p) => p.key === this.aimKey);
    return player && canShoot(this.context, player.color) ? player : null;
  }

  handlePointerDown = (ev: FederatedPointerEvent) => {
    const { winner, room, me } = this.context;
    if (winner) {
      // offline anyone at the table may restart, online only the two playing
      if (!room || me?.color) this.emit("user-restart");
      return;
    }
    const point = this.toWorld(ev);
    const players = this.context.players?.filter((p) => canShoot(this.context, p.color)) ?? [];
    this.aimKey = findPlayer(players, point)?.key ?? null;
    this.pointer = point;
  };

  handlePointerMove = (ev: FederatedPointerEvent) => {
    if (!this.aimKey) return;
    this.pointer = this.toWorld(ev);
  };

  handlePointerUp = (ev: FederatedPointerEvent) => {
    const player = this.aimed();
    this.aimKey = null;
    if (!player) return;

    const drag = this.drag(player, this.toWorld(ev));
    if (Math.hypot(drag.x, drag.y) < MIN_DRAG) return;
    const impulse = { x: drag.x * SHOOT_STRENGTH, y: drag.y * SHOOT_STRENGTH };
    this.emit("user-shoot", { key: player.key, impulse });
  };

  /** From the pointer back to the player, capped at MAX_DRAG. */
  drag(player: Player, point: Point): Point {
    const x = player.x - point.x;
    const y = player.y - point.y;
    const k = Math.min(1, MAX_DRAG / (Math.hypot(x, y) || 1));
    return { x: x * k, y: y * k };
  }

  handleFrameRender = () => {
    const { wall, ball, players } = this.context;
    if (!wall || !players) return;
    this.binder.setData([wall, ball, ...players]);

    this.aim.clear();
    const player = this.aimed();
    if (player) {
      this.drawAim(player, this.drag(player, this.pointer));
    } else {
      this.aimKey = null;
      // the computer's shot, drawn as if it were dragged
      const shot = this.context.computerAim;
      const aimed = shot && players.find((p) => p.key === shot.key);
      if (aimed) {
        this.drawAim(aimed, { x: shot.impulse.x / SHOOT_STRENGTH, y: shot.impulse.y / SHOOT_STRENGTH });
      }
    }
  };

  /** The drag back from the player, and the way it will go. */
  drawAim(player: Player, drag: Point) {
    this.aim
      .moveTo(player.x, player.y)
      .lineTo(player.x - drag.x, player.y - drag.y)
      .stroke({ width: LINE_WIDTH, color: 0xffffff, alpha: 0.5 })
      .moveTo(player.x, player.y)
      .lineTo(player.x + drag.x * 0.5, player.y + drag.y * 0.5)
      .stroke({ width: LINE_WIDTH * 1.5, color: COLORS[player.color], alpha: 0.9 });
  }

  wallDriver = Driver.create<Wall, Container>({
    filter: (data) => data.type === "wall",
    enter: (data) => {
      const ground = this.art.ground;
      const grass = new Sprite(ground.texture);
      // texture is y-down, flip it back up
      grass.position.set(ground.left, ground.top);
      grass.scale.set(1 / GROUND_RESOLUTION, -1 / GROUND_RESOLUTION);

      const graphics = drawMarkings(this.context.field.markings);

      const view = new Container();
      view.addChild(grass, graphics);
      this.markings.addChildAt(view, 0);
      return view;
    },
    update: (data, view) => {},
    exit: (data, view) => {
      view.removeFromParent();
      // the ground texture is the art's
      view.destroy({ children: true });
    },
  });

  ballDriver = Driver.create<Ball, BallDisc>({
    filter: (data) => data.type === "ball",
    enter: (data) => {
      const ball = new RollingBall();
      const disc = { ...makeDisc(ball.texture, this.art.ballLight, this.art.shadow, data.radius), ball };
      const last = { x: data.x, y: data.y, angle: data.angle };
      this.shadows.addChild(disc.shadow);
      this.layer.addChild(disc.view);
      return { ...disc, last };
    },
    update: (data, disc) => {
      // the texture is y-down, and spinning counterclockwise on the pitch is clockwise on it
      disc.ball.roll(data.x - disc.last.x, -(data.y - disc.last.y), data.radius);
      disc.ball.spin(-(data.angle - disc.last.angle));
      disc.ball.update();
      disc.last.x = data.x;
      disc.last.y = data.y;
      disc.last.angle = data.angle;

      disc.view.position.set(data.x, data.y);
      this.placeShadow(disc, data.x, data.y, data.radius);
      // the scene turns on portrait screens, keep the light where it was
      disc.light.rotation = this.context.scene.rotation;
    },
    exit: (data, disc) => {
      disc.shadow.removeFromParent();
      disc.shadow.destroy();
      disc.view.removeFromParent();
      disc.view.destroy({ children: true });
      disc.ball.destroy();
    },
  });

  playerDriver = Driver.create<Player, Disc>({
    filter: (data) => data.type === "player",
    enter: (data) => {
      const disc = makeDisc(this.playerTexture(data), this.art.discLight, this.art.shadow, data.radius);
      this.shadows.addChild(disc.shadow);
      this.layer.addChild(disc.view);
      return disc;
    },
    update: (data, disc) => {
      disc.view.position.set(data.x, data.y);
      // numbers read upright at kickoff however the scene is turned, and spin with the player from there
      disc.body.rotation = data.angle + this.context.scene.rotation;
      this.placeShadow(disc, data.x, data.y, data.radius);
      // the scene turns on portrait screens, keep the light where it was
      disc.light.rotation = this.context.scene.rotation;
      disc.ring.visible = canShoot(this.context, data.color);
    },
    exit: (data, disc) => {
      disc.shadow.removeFromParent();
      disc.shadow.destroy();
      disc.view.removeFromParent();
      disc.view.destroy({ children: true });
    },
  });

  binder = Binder.create<Entity>({
    key: (data) => data.key,
    drivers: [this.wallDriver, this.ballDriver, this.playerDriver],
  });
}

/** The painted lines of the field, drawn at CURVE_SCALE so circles are smooth. */
function drawMarkings(markings: Marking[]) {
  const k = CURVE_SCALE;
  const graphics = new Graphics();
  for (const marking of markings) {
    if (marking.fill === null && marking.stroke === null) continue;
    if (marking.kind === "circle") {
      graphics.circle(marking.x * k, marking.y * k, marking.r * k);
    } else {
      graphics.poly(
        marking.points.map((p) => ({ x: p.x * k, y: p.y * k })),
        marking.closed,
      );
    }
    if (marking.fill !== null) {
      graphics.fill({ color: marking.fill, alpha: marking.fillOpacity });
    }
    if (marking.stroke !== null) {
      graphics.stroke({ width: marking.strokeWidth * k, color: marking.stroke, alpha: marking.strokeOpacity });
    }
  }
  graphics.scale.set(1 / k);
  return graphics;
}

/** Disc of the given radius, textures are y-down so they are flipped back up. */
function makeDisc(texture: Texture, shine: Texture, shadowTexture: Texture, radius: number): Disc {
  const body = new Sprite({ texture, anchor: 0.5 });
  body.scale.set((2 * radius) / texture.width, (-2 * radius) / texture.height);
  const light = new Sprite({ texture: shine, anchor: 0.5 });
  light.scale.set((2 * radius) / shine.width, (-2 * radius) / shine.height);
  const ring = new Graphics()
    .circle(0, 0, radius * 1.25 * CURVE_SCALE)
    .stroke({ width: LINE_WIDTH * 1.5 * CURVE_SCALE, color: 0xffffff, alpha: 0.7 });
  ring.scale.set(1 / CURVE_SCALE);
  ring.visible = false;
  const shadow = new Sprite({ texture: shadowTexture, anchor: 0.5 });
  shadow.scale.set((2.3 * radius) / shadowTexture.width);
  const view = new Container();
  view.addChild(ring, body, light);
  return { view, body, light, shadow, ring };
}

/** Closest player under the point. */
function findPlayer(players: Player[], point: Point): Player | null {
  let best: Player | null = null;
  let bestDist = Infinity;
  for (const player of players) {
    const dist = Math.hypot(player.x - point.x, player.y - point.y);
    if (dist < player.radius + GRAB_MARGIN && dist < bestDist) {
      best = player;
      bestDist = dist;
    }
  }
  return best;
}
