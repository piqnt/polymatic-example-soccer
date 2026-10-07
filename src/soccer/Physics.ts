import { World, Circle, Chain, Edge, Settings, type Body, type Contact } from "planck";

import { Binder, Driver, Middleware } from "polymatic";

import {
  type Ball,
  type Entity,
  type FrameLoopEvent,
  type Goal,
  type Player,
  type SoccerContext,
  type Wall,
} from "./SoccerContext";

const TIME_STEP = 1 / 60;
const MAX_FRAME_TIME = 50;
// a shot that is still going after this long is ended anyway, in ms
const MAX_SHOT_TIME = 15000;

/**
 * Physics: maps game data to bodies, steps the world, and turns collisions and rest into game events.
 */
export class Physics extends Middleware<SoccerContext> {
  world: World;
  timeAccumulator = 0;
  shotTime = 0;

  constructor() {
    super();
    this.on("activate", this.handleActivate);
    this.on("frame-update", this.handleFrameUpdate);
  }

  handleActivate = () => {
    // let slow bodies bounce instead of sticking to each other
    Settings.velocityThreshold = 0;
    this.world = new World({ gravity: { x: 0, y: 0 } });
    this.world.on("begin-contact", this.handleContact);
  };

  handleFrameUpdate = (ev: FrameLoopEvent) => {
    const { wall, goals, ball, players } = this.context;
    this.binder.setData([wall, ...goals, ball, ...players]);

    // fixed time step
    this.timeAccumulator += Math.min(ev.dt, MAX_FRAME_TIME) / 1000;
    while (this.timeAccumulator >= TIME_STEP) {
      this.world.step(TIME_STEP);
      this.timeAccumulator -= TIME_STEP;
    }

    // copy position and rotation to game data
    for (let body = this.world.getBodyList(); body; body = body.getNext()) {
      const data = body.getUserData() as Entity | null;
      if (!data || (data.type !== "player" && data.type !== "ball")) continue;
      const p = body.getPosition();
      data.x = p.x;
      data.y = p.y;
      data.angle = body.getAngle();
    }

    // a shot ends once every body has come to rest
    if (this.context.moving) {
      this.shotTime += ev.dt;
      let resting = true;
      for (let body = this.world.getBodyList(); body && resting; body = body.getNext()) {
        if (body.isDynamic() && body.isAwake()) resting = false;
      }
      if (resting || this.shotTime > MAX_SHOT_TIME) {
        this.emit("shot-end");
      }
    } else {
      this.shotTime = 0;
    }
  };

  playerDriver = Driver.create<Player, Body>({
    filter: (data) => data.type === "player",
    enter: (data) => this.createPlayer(data),
    update: (data, body) => {
      if (data.impulse) {
        body.applyLinearImpulse(data.impulse, body.getWorldCenter(), true);
        data.impulse = null;
      }
    },
    exit: (data, body) => {
      this.world.destroyBody(body);
    },
  });

  ballDriver = Driver.create<Ball, Body>({
    filter: (data) => data.type === "ball",
    enter: (data) => this.createBall(data),
    update: (data, body) => {},
    exit: (data, body) => {
      this.world.destroyBody(body);
    },
  });

  wallDriver = Driver.create<Wall, Body>({
    filter: (data) => data.type === "wall",
    enter: (data) => this.createWall(data),
    update: (data, body) => {},
    exit: (data, body) => {
      this.world.destroyBody(body);
    },
  });

  goalDriver = Driver.create<Goal, Body>({
    filter: (data) => data.type === "goal",
    enter: (data) => this.createGoal(data),
    update: (data, body) => {},
    exit: (data, body) => {
      this.world.destroyBody(body);
    },
  });

  binder = Binder.create<Entity>({
    key: (data) => data.key,
    drivers: [this.playerDriver, this.ballDriver, this.wallDriver, this.goalDriver],
  });

  createWall(data: Wall) {
    const body = this.world.createBody({
      type: "static",
      userData: data,
    });
    body.createFixture({
      shape: new Chain(data.path, true),
      friction: 0,
      restitution: 0,
    });
    return body;
  }

  createGoal(data: Goal) {
    const body = this.world.createBody({
      type: "static",
      userData: data,
    });
    body.createFixture({
      shape: new Edge(data.path[0], data.path[1]),
      friction: 0,
      restitution: 1,
    });
    return body;
  }

  createBall(data: Ball) {
    const body = this.world.createBody({
      type: "dynamic",
      bullet: true,
      position: { x: data.x, y: data.y },
      angle: data.angle,
      linearDamping: 3.5,
      angularDamping: 1.6,
      userData: data,
    });
    body.createFixture({
      shape: new Circle(data.radius),
      friction: 0.2,
      restitution: 0.99,
      density: 0.5,
    });
    return body;
  }

  createPlayer(data: Player) {
    const body = this.world.createBody({
      type: "dynamic",
      bullet: true,
      position: { x: data.x, y: data.y },
      angle: data.angle,
      linearDamping: 4,
      angularDamping: 1.6,
      userData: data,
    });
    body.createFixture({
      shape: new Circle(data.radius),
      friction: 0.1,
      restitution: 0.99,
      density: 0.8,
    });
    return body;
  }

  handleContact = (contact: Contact) => {
    const dataA = contact.getFixtureA().getBody().getUserData() as Entity | null;
    const dataB = contact.getFixtureB().getBody().getUserData() as Entity | null;
    if (!dataA || !dataB) return;

    const ball = dataA.type === "ball" ? dataA : dataB.type === "ball" ? dataB : null;
    const goal = dataA.type === "goal" ? dataA : dataB.type === "goal" ? dataB : null;

    // the world is locked during a step, game events are handled later
    if (ball && goal) {
      this.emit("game-goal", { ball, goal });
    }
  };
}
