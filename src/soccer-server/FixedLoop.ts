import { Middleware } from "polymatic";

import { type FrameLoopEvent } from "../soccer/SoccerContext";

/**
 * Fixed-time game loop for the server. Sends frame-update to all middlewares on every tick.
 */
export class FixedLoop extends Middleware {
  timeStep = 1000 / 30;
  interval: ReturnType<typeof setInterval>;

  // reuse object
  event: FrameLoopEvent = {
    dt: 0,
    now: 0,
  };

  constructor() {
    super();
    this.on("activate", this.handleActivate);
    this.on("deactivate", this.handleDeactivate);
  }

  handleActivate = () => {
    this.interval = setInterval(this.handleFrame, this.timeStep);
  };

  handleDeactivate = () => {
    clearInterval(this.interval);
  };

  handleFrame = () => {
    if (!this.activated) return;

    this.event.now = Date.now();
    this.event.dt = this.timeStep;

    this.emit("frame-update", this.event);
  };
}
