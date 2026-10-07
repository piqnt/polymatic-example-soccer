import { Middleware } from "polymatic";

import { Pitch } from "../soccer/Pitch";
import { Physics } from "../soccer/Physics";
import { FrameLoop } from "./FrameLoop";
import { PixiManager } from "./PixiManager";
import { Status } from "./Status";
import { Terminal } from "./Terminal";
import { destroyArt, loadArt } from "./Art";
import { type ClientContext } from "./ClientContext";
import { FIELD } from "./field";

/**
 * Offline game: two players take turns on this device.
 */
export class MainOffline extends Middleware<ClientContext> {
  constructor() {
    super();
    this.use(new FrameLoop());
    this.use(new PixiManager());
    this.use(new Pitch());
    this.use(new Physics());
    this.use(new Status());
    this.on("activate", this.handleActivate);
    this.on("pixi-ready", this.handlePixiReady);
  }

  handleActivate = () => {
    // before the rules are activated, parents first
    this.context.field = FIELD;
    this.emit("game-start");
  };

  /** The art is rendered from svg first, then the game is shown. */
  handlePixiReady = async () => {
    const art = await loadArt(FIELD);
    if (!this.activated) {
      destroyArt(art);
      return;
    }
    this.use(new Terminal(art));
  };
}
