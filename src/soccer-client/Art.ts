import { CanvasSource, Texture } from "pixi.js";

import { type Color } from "../soccer/SoccerContext";
import { type Field } from "../soccer/Field";
import { MAX_PLAYERS } from "../soccer/Formation";
import fieldSvg from "../art/field.svg?raw";
import redSvg from "../art/red.svg?raw";
import blueSvg from "../art/blue.svg?raw";
import discLightSvg from "../art/disc-light.svg?raw";
import ballLightSvg from "../art/ball-light.svg?raw";
import shadowSvg from "../art/shadow.svg?raw";

/** Ground texture pixels per world unit. */
export const GROUND_RESOLUTION = 128;
// the ground is painted past the view, for screens of another shape
const GROUND_MARGIN = 1.35;
/** Width and height of disc textures, in pixels. */
const DISC_SIZE = 256;

const TEAMS: Record<Color, string> = { red: redSvg, blue: blueSvg };

/**
 * Everything drawn from svg, rendered once into textures by the browser before the game is shown: the ground from
 * field.svg, the players from red.svg and blue.svg, and light and shadow, all in src/art. The ball is not here, it is
 * painted as it rolls, see RollingBall.
 */
export interface Art {
  // the ground's texture, and where its top-left corner is in world coordinates, y up
  ground: { texture: Texture; left: number; top: number };
  // by team and number
  players: Map<string, Texture>;
  discLight: Texture;
  ballLight: Texture;
  shadow: Texture;
}

export const playerKey = (color: Color, number: number) => color + "-" + number;

export async function loadArt(field: Field): Promise<Art> {
  const view = field.view;
  const width = view.width * GROUND_MARGIN;
  const height = view.height * GROUND_MARGIN;
  const cx = view.left + view.width / 2;
  const cy = view.bottom + view.height / 2;
  // svg y is down
  const groundBox = { x: cx - width / 2, y: -(cy + height / 2), width, height };
  const ground = rasterize(fieldSvg, Math.ceil(width * GROUND_RESOLUTION), Math.ceil(height * GROUND_RESOLUTION), {
    viewBox: groundBox,
    css: ".goal, #ball, #markings { display: none; }",
  });

  const players: Promise<[string, Texture]>[] = [];
  for (const color of Object.keys(TEAMS) as Color[]) {
    // any formation may be chosen, so every number up to the largest
    for (let number = 1; number <= MAX_PLAYERS; number++) {
      const keeper = number === 1;
      players.push(
        rasterize(TEAMS[color], DISC_SIZE, DISC_SIZE, {
          css: keeper ? ".outfield { display: none; }" : ".keeper { display: none; }",
          edit: (svg) => {
            const text = svg.querySelector("#number");
            if (!text) throw new Error(`${color}.svg: no #number`);
            text.textContent = String(number);
            if (keeper) text.classList.add("keeper-number");
          },
        }).then((texture) => [playerKey(color, number), texture]),
      );
    }
  }

  const [groundTexture, discLight, ballLight, shadow, ...playerTextures] = await Promise.all([
    ground,
    rasterize(discLightSvg, DISC_SIZE, DISC_SIZE),
    rasterize(ballLightSvg, DISC_SIZE, DISC_SIZE),
    rasterize(shadowSvg, DISC_SIZE / 2, DISC_SIZE / 2),
    ...players,
  ]);

  return {
    ground: { texture: groundTexture, left: groundBox.x, top: -groundBox.y },
    players: new Map(playerTextures),
    discLight,
    ballLight,
    shadow,
  };
}

export function destroyArt(art: Art) {
  for (const texture of [art.ground.texture, art.discLight, art.ballLight, art.shadow, ...art.players.values()]) {
    texture.destroy(true);
  }
}

interface RasterizeOptions {
  // replaces the svg's viewBox, to paint more or less of it
  viewBox?: { x: number; y: number; width: number; height: number };
  // added to the svg, say to hide parts of it
  css?: string;
  edit?: (svg: SVGSVGElement) => void;
}

/** Renders svg into a texture of the given size in pixels, with the browser's own svg renderer. */
async function rasterize(source: string, width: number, height: number, options: RasterizeOptions = {}) {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (svg.tagName !== "svg") throw new Error("not an svg: " + doc.documentElement.textContent);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");
  if (options.viewBox) {
    const { x, y, width: w, height: h } = options.viewBox;
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  }
  if (options.css) {
    const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = options.css;
    svg.appendChild(style);
  }
  options.edit?.(svg);

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" }));
  try {
    const image = new Image(width, height);
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
    return new Texture({ source: new CanvasSource({ resource: canvas, autoGenerateMipmaps: true }) });
  } finally {
    URL.revokeObjectURL(url);
  }
}
