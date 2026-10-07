import { XMLParser } from "fast-xml-parser";

import { type Color, type Point } from "./SoccerContext";

/** A rectangle in game coordinates, y up. */
export interface Box {
  left: number;
  bottom: number;
  width: number;
  height: number;
}

/** A painted line or shape, see #markings in field.svg. */
export type Marking = (
  | { kind: "poly"; points: Point[]; closed: boolean }
  | { kind: "circle"; x: number; y: number; r: number }
) & {
  stroke: number | null;
  strokeWidth: number;
  strokeOpacity: number;
  fill: number | null;
  fillOpacity: number;
};

/** The soccer field, read from field.svg. Game coordinates, y up. */
export interface Field {
  view: Box;
  wall: Point[];
  goals: { color: Color; path: [Point, Point] }[];
  ball: { x: number; y: number; radius: number };
  markings: Marking[];
}

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}

const COLORS: Color[] = ["red", "blue"];

/**
 * Reads the field from svg, see field.svg for what it holds. The svg is drawn y down, as on screen, and turned y up
 * here like the physics. Throws if something the game needs is missing.
 */
export function parseField(svg: string): Field {
  const root = parseXml(svg).find((node) => node.tag === "svg");
  if (!root) fail("no <svg> element");
  const nodes = flatten(root.children);
  const byId = (id: string) => nodes.find((node) => node.attrs.id === id);
  const byClass = (name: string) => nodes.filter((node) => node.attrs.class?.split(/\s+/).includes(name));

  const viewBox = root.attrs.viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length !== 4 || viewBox.some((n) => !Number.isFinite(n)))
    fail('<svg> needs a viewBox="x y width height"');
  const [vx, vy, vw, vh] = viewBox;
  const view = { left: vx, bottom: -(vy + vh), width: vw, height: vh };

  const wallNode = byId("wall");
  if (wallNode?.tag !== "polygon" && wallNode?.tag !== "path") fail('no <polygon id="wall"> or <path id="wall">');
  const wall = wallNode.tag === "path" ? pathPoints(wallNode).points : points(wallNode);
  if (wall.length < 3) fail("#wall needs at least 3 points");

  const goals = byClass("goal").map((node) => {
    if (node.tag !== "line") fail(".goal must be a <line>");
    return { color: team(node), path: [point(node, "x1", "y1"), point(node, "x2", "y2")] as [Point, Point] };
  });
  for (const color of COLORS) {
    if (!goals.some((goal) => goal.color === color)) fail(`no .goal with data-team="${color}"`);
  }

  const ballNode = byId("ball");
  if (ballNode?.tag !== "circle") fail('no <circle id="ball">');
  const ball = { ...point(ballNode, "cx", "cy"), radius: number(ballNode, "r") };

  const markingsNode = byId("markings");
  const markings = markingsNode ? readMarkings(markingsNode, {}, byId) : [];

  return { view, wall, goals, ball, markings };
}

/** Shapes in the markings group, each with the style it has or inherits from its groups. */
function readMarkings(
  node: Node,
  inherited: Record<string, string>,
  byId: (id: string) => Node | undefined,
): Marking[] {
  const attrs = { ...inherited, ...node.attrs };
  const style = {
    stroke: color(attrs.stroke ?? "none"),
    strokeWidth: Number(attrs["stroke-width"] ?? 1),
    strokeOpacity: Number(attrs["stroke-opacity"] ?? 1),
    fill: color(attrs.fill ?? "#000000"),
    fillOpacity: Number(attrs["fill-opacity"] ?? 1),
  };
  switch (node.tag) {
    case "g":
      return node.children.flatMap((child) => readMarkings(child, attrs, byId));
    case "use": {
      // the shape it refers to, styled by the use, and by its own attributes over that
      const href = (node.attrs.href ?? node.attrs["xlink:href"] ?? "").replace(/^#/, "");
      const target = byId(href);
      if (!target) fail(`<use> refers to #${href}, which is not there`);
      const style = { ...attrs };
      delete style.href;
      delete style["xlink:href"];
      delete style.id;
      return readMarkings(target, style, byId);
    }
    case "line":
      return [{ kind: "poly", points: [point(node, "x1", "y1"), point(node, "x2", "y2")], closed: false, ...style }];
    case "polyline":
      return [{ kind: "poly", points: points(node), closed: false, ...style }];
    case "polygon":
      return [{ kind: "poly", points: points(node), closed: true, ...style }];
    case "path": {
      const path = pathPoints(node);
      return [{ kind: "poly", points: path.points, closed: path.closed, ...style }];
    }
    case "rect": {
      const { left, bottom, width, height } = box(node);
      const corners = [
        { x: left, y: bottom },
        { x: left + width, y: bottom },
        { x: left + width, y: bottom + height },
        { x: left, y: bottom + height },
      ];
      return [{ kind: "poly", points: corners, closed: true, ...style }];
    }
    case "circle":
      return [{ kind: "circle", ...point(node, "cx", "cy"), r: number(node, "r"), ...style }];
    default:
      fail(`<${node.tag}> is not supported in #markings, use line, polyline, polygon, path, rect, circle or use`);
  }
}

function parseXml(svg: string): Node[] {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
  });
  const toNodes = (items: Record<string, unknown>[]): Node[] =>
    items.flatMap((item) => {
      const tag = Object.keys(item).find((key) => key !== ":@");
      if (!tag || tag.startsWith("#") || tag.startsWith("?")) return [];
      return [
        {
          tag,
          attrs: (item[":@"] as Record<string, string>) ?? {},
          children: toNodes((item[tag] as Record<string, unknown>[]) ?? []),
        },
      ];
    });
  return toNodes(parser.parse(svg));
}

/** Every element, in document order. */
function flatten(nodes: Node[]): Node[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function number(node: Node, name: string) {
  const value = Number(node.attrs[name]);
  if (!Number.isFinite(value)) fail(`<${node.tag}${id(node)}> needs a number ${name}`);
  return value;
}

/** A point of the svg, turned y up. */
function point(node: Node, x: string, y: string): Point {
  return { x: number(node, x), y: 0 - number(node, y) };
}

function points(node: Node): Point[] {
  const values = (node.attrs.points ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (values.length % 2 || values.some((n) => !Number.isFinite(n))) fail(`<${node.tag}${id(node)}> has bad points`);
  const result: Point[] = [];
  for (let i = 0; i < values.length; i += 2) result.push({ x: values[i], y: 0 - values[i + 1] });
  return result;
}

// how finely curves are split into straight segments, as the largest turn of one segment, in radians
const CURVE_STEP = Math.PI / 24;

/**
 * The points along a path, curves split into short straight segments, turned y up. One subpath, with M, L, H, V, A,
 * Q, C and Z, absolute or relative.
 */
function pathPoints(node: Node): { points: Point[]; closed: boolean } {
  const tokens = (node.attrs.d ?? "").match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const result: Point[] = [];
  let closed = false;
  let i = 0;
  let command = "";
  let x = 0;
  let y = 0;
  const next = () => {
    const value = Number(tokens[i++]);
    if (!Number.isFinite(value)) fail(`<path${id(node)}> has a bad d near "${tokens.slice(i - 2, i + 2).join(" ")}"`);
    return value;
  };
  const add = (px: number, py: number) => {
    const last = result[result.length - 1];
    if (!last || Math.hypot(last.x - px, last.y - py) > 1e-9) result.push({ x: px, y: py });
    x = px;
    y = py;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M":
        if (result.length) fail(`<path${id(node)}> has more than one subpath`);
        add(ox + next(), oy + next());
        // pairs after a move are lines
        command = relative ? "l" : "L";
        break;
      case "L":
        add(ox + next(), oy + next());
        break;
      case "H":
        add(ox + next(), y);
        break;
      case "V":
        add(x, oy + next());
        break;
      case "Q": {
        const [x0, y0, cx, cy] = [x, y, ox + next(), oy + next()];
        const [x1, y1] = [ox + next(), oy + next()];
        const n = curveSegments(Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy));
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          add(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
        }
        break;
      }
      case "C": {
        const [x0, y0] = [x, y];
        const [c1x, c1y, c2x, c2y] = [ox + next(), oy + next(), ox + next(), oy + next()];
        const [x1, y1] = [ox + next(), oy + next()];
        const n = curveSegments(
          Math.hypot(c1x - x0, c1y - y0) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(x1 - c2x, y1 - c2y),
        );
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          add(
            u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1,
            u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1,
          );
        }
        break;
      }
      case "A": {
        const [rx, ry, rotation, large, sweep] = [next(), next(), next(), next(), next()];
        const [x1, y1] = [ox + next(), oy + next()];
        for (const p of arcPoints(x, y, rx, ry, rotation, large !== 0, sweep !== 0, x1, y1)) add(p.x, p.y);
        break;
      }
      case "Z":
        closed = true;
        i = tokens.length;
        break;
      default:
        fail(`<path${id(node)}> uses ${command}, use M, L, H, V, A, Q, C and Z`);
    }
  }
  // a closed path does not repeat its first point
  const first = result[0];
  const last = result[result.length - 1];
  if (result.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) {
    result.pop();
    closed = true;
  }
  return { points: result.map((p) => ({ x: p.x, y: 0 - p.y })), closed };
}

/** Segments for a curve about this long, at least a few. */
function curveSegments(length: number) {
  return Math.max(4, Math.ceil(length / 0.05));
}

/** Points along an svg elliptical arc from x0, y0 to x1, y1, not including the start, see the svg spec, F.6.5. */
function arcPoints(
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  rotation: number,
  large: boolean,
  sweep: boolean,
  x1: number,
  y1: number,
): Point[] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [{ x: x1, y: y1 }];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const px = cos * dx + sin * dy;
  const py = -sin * dx + cos * dy;
  // radii too small to reach are scaled up
  const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
  const den = rx * rx * py * py + ry * ry * px * px;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * py) / ry;
  const cyp = (-k * ry * px) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x1) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y1) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (px - cxp) / rx, (py - cyp) / ry);
  let delta = angle((px - cxp) / rx, (py - cyp) / ry, (-px - cxp) / rx, (-py - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(delta) / CURVE_STEP));
  const result: Point[] = [];
  for (let s = 1; s <= n; s++) {
    const t = start + (delta * s) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    result.push({ x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy });
  }
  // end exactly at the end point
  result[result.length - 1] = { x: x1, y: y1 };
  return result;
}

function box(node: Node): Box {
  const x = number(node, "x");
  const y = number(node, "y");
  const width = number(node, "width");
  const height = number(node, "height");
  return { left: x, bottom: -(y + height), width, height };
}

function team(node: Node): Color {
  const value = node.attrs["data-team"] as Color;
  if (!COLORS.includes(value)) fail(`<${node.tag}${id(node)}> needs data-team="red" or "blue"`);
  return value;
}

/** A color as a number, null for none. Hex colors, and white and black, are understood. */
function color(value: string): number | null {
  const named: Record<string, string> = { white: "#ffffff", black: "#000000" };
  const hex = (named[value.trim().toLowerCase()] ?? value).trim();
  if (hex === "none") return null;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) return parseInt(short[1] + short[1] + short[2] + short[2] + short[3] + short[3], 16);
  if (/^#[0-9a-f]{6}$/i.test(hex)) return parseInt(hex.slice(1), 16);
  fail(`color ${value} is not understood, use #rrggbb, #rgb, white, black or none`);
}

function id(node: Node) {
  return node.attrs.id ? ` id="${node.attrs.id}"` : node.attrs.class ? ` class="${node.attrs.class}"` : "";
}

function fail(message: string): never {
  throw new Error("field.svg: " + message);
}
