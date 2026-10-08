import { Memo, Middleware } from "polymatic";

import { type Color, other } from "../soccer/SoccerContext";
import { type ClientContext } from "./ClientContext";

const NAMES: Record<Color, string> = { red: "Red", blue: "Blue" };

/** Publishes the score and the game's status line onto the hud - see HudData. */
export class Status extends Middleware<ClientContext> {
  memo = Memo.init();

  constructor() {
    super();
    this.on("deactivate", this.handleDeactivate);
    this.on("frame-render", this.handleFrameRender);
  }

  handleDeactivate = () => {
    this.memo.clear();
    this.context.hud.scoreText.value = "";
    this.context.hud.statusText.value = "";
  };

  handleFrameRender = () => {
    const { score, started, turn, moving, winner, users, room, me, computer, hud } = this.context;
    if (!this.memo.update(score?.red, score?.blue, started, turn, moving, winner, users?.length, me?.color, computer))
      return;

    hud.scoreText.value = score ? `Red ${score.red} : ${score.blue} Blue` : "";

    const status = [];
    if (computer) {
      status.push(`You play ${other(computer)}`);
      if (winner) {
        status.push(winner === computer ? "The computer wins. Tap to play again" : "You win! Tap to play again");
      } else if (moving) {
        status.push("Shot in progress");
      } else if (turn === computer) {
        status.push("Computer's turn");
      } else if (turn) {
        status.push("Your turn: drag a player and release to shoot");
      }
    } else if (!room) {
      if (winner) {
        status.push(`${NAMES[winner]} wins! Tap to play again`);
      } else if (moving) {
        status.push("Shot in progress");
      } else if (turn) {
        status.push(`${NAMES[turn]}'s turn: drag a player and release to shoot`);
      }
    } else if (!started) {
      status.push("Waiting for an opponent, share the room id");
    } else {
      const color = me?.color;
      if (color) {
        status.push(`You play ${color}`);
      } else {
        status.push("Watching");
      }
      if (winner) {
        status.push(
          !color
            ? `${NAMES[winner]} wins`
            : winner === color
              ? "You win! Tap to play again"
              : "You lose. Tap to play again",
        );
      } else if (moving) {
        status.push("Shot in progress");
      } else if (color) {
        status.push(turn === color ? "Your turn" : "Opponent's turn");
      } else if (turn) {
        status.push(`${NAMES[turn]}'s turn`);
      }
    }
    hud.statusText.value = status.join(" | ");
  };
}
