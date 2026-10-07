import { Middleware } from "polymatic";

import { FrameLoop } from "./FrameLoop";
import { PixiManager } from "./PixiManager";
import { RoomClient } from "./RoomClient";
import { Status } from "./Status";
import { Terminal } from "./Terminal";
import { destroyArt, loadArt } from "./Art";
import { type ClientContext } from "./ClientContext";
import { FIELD } from "./field";

/**
 * Online game: the server runs the rules and physics, this renders what it sends and passes user actions to it.
 */
export class MainClient extends Middleware<ClientContext> {
  constructor() {
    super();
    this.use(new FrameLoop());
    this.use(new PixiManager());
    this.use(new RoomClient());
    this.use(new Status());
    this.on("activate", this.handleActivate);
    this.on("pixi-ready", this.handlePixiReady);
  }

  /** The server sends the walls and the goals, the field is for the markings and the view. */
  handleActivate = () => {
    this.context.field = FIELD;
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
