import { CanvasSource, Texture } from "pixi.js";

/** Width and height of the ball's texture, in pixels. It is repainted as the ball rolls. */
const SIZE = 96;

const PHI = (1 + Math.sqrt(5)) / 2;
// distance of the pentagon and hexagon faces of a truncated icosahedron from its center, for unit edges
const PENTAGON_DISTANCE = 2.32743;
const HEXAGON_DISTANCE = 2.26728;
// seams between panels, and how far a panel is puffed up toward its center, in face score units
const SEAM = 0.004;
const PUFF = 0.05;

const WHITE = [244, 244, 239];
const BLACK = [26, 26, 28];
const SEAM_COLOR = [150, 150, 144];

/** Directions to the centers of the 12 pentagons, the vertices of an icosahedron. */
const PENTAGONS = normalize([
  ...[-1, 1].flatMap((a) =>
    [-1, 1].flatMap((b) => [
      [0, a, b * PHI],
      [a, b * PHI, 0],
      [b * PHI, 0, a],
    ]),
  ),
]);
/**
 * Directions to the centers of the 20 hexagons, the vertices of the dodecahedron dual to that icosahedron, the centers
 * of its faces.
 */
const HEXAGONS = normalize([
  ...[-1, 1].flatMap((a) => [-1, 1].flatMap((b) => [-1, 1].map((c) => [a, b, c]))),
  ...[-1, 1].flatMap((a) =>
    [-1, 1].flatMap((b) => [
      [0, a * PHI, b / PHI],
      [a / PHI, 0, b * PHI],
      [a * PHI, b / PHI, 0],
    ]),
  ),
]);
// every panel, with the distance to its face, black for pentagons
const PANELS = [
  ...PENTAGONS.map((n) => ({ n, d: PENTAGON_DISTANCE, black: true })),
  ...HEXAGONS.map((n) => ({ n, d: HEXAGON_DISTANCE, black: false })),
];

/**
 * A classic black and white football that rolls: it keeps its orientation, turned as it moves across the pitch and
 * as it spins, and paints what is facing up into its texture. The panels are those of a truncated icosahedron, 12
 * black pentagons and 20 white hexagons, stitched at the seams.
 *
 * Coordinates are the texture's, x right and y down, with z into the pitch, so the half of the ball that is seen has
 * negative z.
 */
export class RollingBall {
  texture: Texture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;

  // orientation, a unit quaternion turning ball coordinates into texture coordinates
  q = [1, 0, 0, 0];
  dirty = true;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(SIZE, SIZE);
    this.texture = new Texture({ source: new CanvasSource({ resource: this.canvas, autoGenerateMipmaps: true }) });
    // a pentagon facing up, as on a ball waiting for kickoff: turn (0, 1, phi) to -z, around x
    this.turn(1, 0, 0, -Math.PI / 2 - Math.atan2(PHI, 1));
    this.paint();
  }

  /** The ball moved by dx, dy without slipping, so it turned by the distance over its radius, across the move. */
  roll(dx: number, dy: number, radius: number) {
    const distance = Math.hypot(dx, dy);
    if (distance < radius * 1e-4) return;
    // axis is up out of the pitch crossed with the move, up being -z
    this.turn(dy / distance, -dx / distance, 0, distance / radius);
  }

  /** The ball spun on the spot by an angle, clockwise on the texture. */
  spin(angle: number) {
    if (Math.abs(angle) < 1e-4) return;
    this.turn(0, 0, 1, angle);
  }

  /** Turns the ball around a unit axis, in texture coordinates. */
  turn(ax: number, ay: number, az: number, angle: number) {
    const s = Math.sin(angle / 2);
    const dw = Math.cos(angle / 2);
    const dx = ax * s;
    const dy = ay * s;
    const dz = az * s;
    const [w, x, y, z] = this.q;
    // q = dq * q
    const nw = dw * w - dx * x - dy * y - dz * z;
    const nx = dw * x + dx * w + dy * z - dz * y;
    const ny = dw * y - dx * z + dy * w + dz * x;
    const nz = dw * z + dx * y - dy * x + dz * w;
    const n = Math.hypot(nw, nx, ny, nz);
    this.q = [nw / n, nx / n, ny / n, nz / n];
    this.dirty = true;
  }

  /** Repaints the texture if the ball turned since the last paint. */
  update() {
    if (!this.dirty) return;
    this.paint();
    this.texture.source.update();
  }

  paint() {
    this.dirty = false;
    const [w, x, y, z] = this.q;
    // rotation matrix, its transpose takes a texture point into ball coordinates
    const r00 = 1 - 2 * (y * y + z * z);
    const r01 = 2 * (x * y - w * z);
    const r02 = 2 * (x * z + w * y);
    const r10 = 2 * (x * y + w * z);
    const r11 = 1 - 2 * (x * x + z * z);
    const r12 = 2 * (y * z - w * x);
    const r20 = 2 * (x * z - w * y);
    const r21 = 2 * (y * z + w * x);
    const r22 = 1 - 2 * (x * x + y * y);

    const data = this.image.data;
    const half = SIZE / 2;
    for (let j = 0; j < SIZE; j++) {
      const py = (j + 0.5 - half) / half;
      for (let i = 0; i < SIZE; i++) {
        const px = (i + 0.5 - half) / half;
        const k = (j * SIZE + i) * 4;
        const d2 = px * px + py * py;
        // antialiased edge
        const cover = clamp((1 - Math.sqrt(d2)) * half + 0.5);
        if (cover <= 0) {
          data[k + 3] = 0;
          continue;
        }
        const pz = -Math.sqrt(Math.max(0, 1 - d2));
        const bx = r00 * px + r10 * py + r20 * pz;
        const by = r01 * px + r11 * py + r21 * pz;
        const bz = r02 * px + r12 * py + r22 * pz;

        // the panel whose face is nearest along this direction, and how near the next one is
        let best = -Infinity;
        let second = -Infinity;
        let black = false;
        for (const panel of PANELS) {
          const score = (panel.n[0] * bx + panel.n[1] * by + panel.n[2] * bz) / panel.d;
          if (score > best) {
            second = best;
            best = score;
            black = panel.black;
          } else if (score > second) {
            second = score;
          }
        }
        const gap = best - second;
        const [pr, pg, pb] = black ? BLACK : WHITE;
        // puffed panels are a little darker toward their seams
        const shade = 0.88 + 0.12 * clamp(gap / PUFF);
        const seam = clamp((SEAM - gap) / SEAM + 0.5);
        data[k] = pr * shade + (SEAM_COLOR[0] - pr * shade) * seam;
        data[k + 1] = pg * shade + (SEAM_COLOR[1] - pg * shade) * seam;
        data[k + 2] = pb * shade + (SEAM_COLOR[2] - pb * shade) * seam;
        data[k + 3] = cover * 255;
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  destroy() {
    this.texture.destroy(true);
  }
}

function normalize(vectors: number[][]) {
  return vectors.map((v) => {
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
  });
}

function clamp(t: number) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
