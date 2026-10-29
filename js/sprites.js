// Procedural pixel art. Every gem is painted pixel by pixel into a 20x20
// buffer from little shape/facet functions, then given a comic ink outline.

export const SPR = 20;
export const INK = '#1a0f26';
const UNIT = 9; // pixels per unit in the -1..1 paint space

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LIGHT_ANGLE = Math.atan2(-1, -1);

// Picks a colour from a dark->light ramp, ordered-dithering the in-betweens.
export function tone(ramp, v, x, y, dither = true) {
  const n = ramp.length - 1;
  const f = clamp(v) * n;
  let i = Math.floor(f);
  const frac = f - i;
  if (dither) {
    if (clamp((frac - 0.5) * 2.2 + 0.5) > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16) i++;
  } else if (frac >= 0.5) i++;
  return ramp[Math.min(n, Math.max(0, i))];
}

export function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export class Pix {
  constructor(w = SPR, h = SPR) {
    this.w = w; this.h = h;
    this.px = new Array(w * h).fill(null);
  }
  uv(x, y) { return [(x + 0.5 - this.w / 2) / UNIT, (y + 0.5 - this.h / 2) / UNIT]; }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c; }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : null; }
  paint(fn) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const [u, v] = this.uv(x, y);
        const c = fn(u, v, x, y);
        if (c) this.set(x, y, c);
      }
    }
    return this;
  }
  // stamp a list of "x,y" offsets (relative to px, py) in one colour
  dots(px, py, list, c) { for (const [dx, dy] of list) this.set(px + dx, py + dy, c); }
  outline(col = INK) {
    const add = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push([x, y]);
      }
    }
    for (const [x, y] of add) this.set(x, y, col);
    return this;
  }
  canvas() {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(this.w, this.h);
    this.px.forEach((col, i) => {
      if (!col) return;
      const n = parseInt(col.slice(1), 16);
      img.data[i * 4] = n >> 16;
      img.data[i * 4 + 1] = (n >> 8) & 255;
      img.data[i * 4 + 2] = n & 255;
      img.data[i * 4 + 3] = 255;
    });
    ctx.putImageData(img, 0, 0);
    return c;
  }
}

// ================================================================ JEWELS

const GEM_RAMPS = [
  ['#3d0414', '#7a0c25', '#c41a3b', '#ef3f55', '#ff8a8f', '#ffe3e3'],
  ['#4f1c03', '#94400a', '#e0701a', '#ffa036', '#ffd27a', '#fff4da'],
  ['#4f3a00', '#957000', '#dcb614', '#ffe23f', '#fff39a', '#fffde6'],
  ['#06361e', '#0c6334', '#1ba352', '#45d474', '#a2f2b0', '#e9fff0'],
  ['#0a1a55', '#15389f', '#2766e6', '#55a0ff', '#a8d6ff', '#eef9ff'],
  ['#270946', '#521686', '#8a2fcf', '#b86af0', '#ddb3ff', '#f8eeff'],
  ['#3a4560', '#6e7fa3', '#adbdd8', '#d9e6f5', '#f2f8ff', '#ffffff'],
];

const GEM_SHAPES = [
  { // heart
    mask: (u, v) => { const x = u * 1.18, y = -v * 1.15 + 0.12, a = x * x + y * y - 1; return a * a * a - x * x * y * y * y <= 0; },
    center: [0, -0.05], facets: 8, rot: Math.PI / 8, table: 0.5,
  },
  { // pointy hexagon
    mask: (u, v) => Math.abs(u) <= 0.85 && Math.abs(v) + 0.577 * Math.abs(u) <= 0.98,
    center: [0, 0], facets: 6, rot: Math.PI / 6, table: 0.52,
  },
  { // kite / rhombus
    mask: (u, v) => Math.abs(u) / 0.92 + Math.abs(v) / 1.0 <= 1,
    center: [0, 0], facets: 8, rot: 0, table: 0.48,
  },
  { // emerald step cut
    mask: (u, v) => Math.abs(u) <= 0.74 && Math.abs(v) <= 0.96 && Math.abs(u) + Math.abs(v) <= 1.45,
    center: [0, 0], step: true,
  },
  { // round brilliant
    mask: (u, v) => u * u + v * v <= 0.9,
    center: [0, 0], facets: 16, rot: 0, table: 0.5,
    tableMask: (u, v) => Math.abs(u) + Math.abs(v) <= 0.62 && Math.abs(u) <= 0.46 && Math.abs(v) <= 0.46,
  },
  { // trillion, point down
    mask: (u, v) => v >= -0.78 && Math.abs(u) <= (0.96 - v) / 1.74,
    center: [0, -0.2], facets: 6, rot: -Math.PI / 6, table: 0.5,
  },
  { // pear, point up
    mask: (u, v) => (v > 0.25 ? u * u + (v - 0.25) ** 2 <= 0.5 : Math.abs(u) <= 0.707 * Math.sqrt(Math.max(0, (v + 0.98) / 1.23))),
    center: [0, 0.12], facets: 8, rot: Math.PI / 8, table: 0.5,
  },
];

function facetValue(du, dv, n, rotation) {
  const ang = Math.atan2(dv, du);
  const sector = ((Math.floor(((ang + Math.PI + rotation) / TAU) * n) % n) + n) % n;
  const mid = ((sector + 0.5) / n) * TAU - Math.PI - rotation;
  return { sector, facing: Math.cos(mid - LIGHT_ANGLE) };
}

function stepCutValue(du, dv) {
  const ax = Math.abs(du) / 0.74, ay = Math.abs(dv) / 0.96;
  const d = Math.max(ax, ay);
  if (d < 0.5) return { table: true };
  const inner = d < 0.76;
  const side = ax > ay ? (du < 0 ? 0.74 : 0.3) : (dv < 0 ? 0.9 : 0.18);
  return { table: false, value: side + (inner ? 0.08 : -0.05) };
}

function gemSprite(type) {
  const shape = GEM_SHAPES[type], ramp = GEM_RAMPS[type];
  const p = new Pix();
  const region = new Int8Array(SPR * SPR);
  const [cu, cv] = shape.center;
  const inTable = shape.tableMask
    ? shape.tableMask
    : (u, v) => shape.mask(cu + (u - cu) / shape.table, cv + (v - cv) / shape.table);

  p.paint((u, v, x, y) => {
    if (!shape.mask(u, v)) return null;
    const du = u - cu, dv = v - cv;
    if (shape.step) {
      const s = stepCutValue(du, dv);
      if (s.table) { region[y * SPR + x] = 1; return tone(ramp, 0.62 - (du + dv) * 0.35, x, y, false); }
      region[y * SPR + x] = 2;
      return tone(ramp, s.value, x, y, false);
    }
    if (inTable(u, v)) {
      region[y * SPR + x] = 1;
      return tone(ramp, 0.64 - (du + dv) * 0.32, x, y, false);
    }
    region[y * SPR + x] = 2;
    const { sector, facing } = facetValue(du, dv, shape.facets, shape.rot);
    return tone(ramp, 0.5 + 0.36 * facing + (sector % 2 ? 0.08 : -0.04), x, y, false);
  });

  // crisp facet rims: bright where the crown meets the table on the lit side,
  // and a darker bevel along the outer edge away from the light
  const rims = [];
  for (let y = 0; y < SPR; y++) {
    for (let x = 0; x < SPR; x++) {
      if (region[y * SPR + x] !== 2) continue;
      const [u, v] = p.uv(x, y);
      const lit = (u - cu) + (v - cv);
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => region[(y + dy) * SPR + (x + dx)] ?? 0);
      const outOfBounds = x === 0 || y === 0 || x === SPR - 1 || y === SPR - 1;
      if (nb.includes(1)) rims.push([x, y, lit < 0 ? ramp[4] : ramp[1]]);
      else if (outOfBounds || nb.includes(0)) {
        if (lit > 0.15) rims.push([x, y, ramp[1]]);
        else if (lit < -0.7) rims.push([x, y, ramp[4]]);
      }
    }
  }
  for (const [x, y, c] of rims) p.set(x, y, c);

  // sparkle on the table's upper-left corner
  let spark = null;
  for (let y = 0; y < SPR; y++) for (let x = 0; x < SPR; x++)
    if (region[y * SPR + x] === 1 && (!spark || x + y < spark[0] + spark[1])) spark = [x, y];
  if (spark) {
    const [sx, sy] = [spark[0] + 2, spark[1] + 2];
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (region[(sy + dy) * SPR + sx + dx]) p.set(sx + dx, sy + dy, dx || dy ? ramp[5] : '#ffffff');
    }
  }
  return p.outline();
}

function gemPrism(phase) {
  const p = new Pix();
  p.paint((u, v, x, y) => {
    if (u * u + v * v > 0.92) return null;
    if (Math.abs(u) + Math.abs(v) <= 0.58 && Math.abs(u) <= 0.44 && Math.abs(v) <= 0.44) {
      return hsl(phase + (u - v) * 0.25, 0.9, 0.82 - (u + v) * 0.1);
    }
    const { sector, facing } = facetValue(u, v, 16, 0);
    return hsl(sector / 16 + phase, 0.9, clamp(0.5 + facing * 0.18 + (sector % 2 ? 0.08 : -0.06), 0.25, 0.85));
  });
  p.dots(7, 7, [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]], '#ffffff');
  p.set(13, 5, '#ffffff');
  return p.outline();
}

// Derived images used at draw time: a white flash silhouette, a dark drop
// shadow and a short "shine" sweep animation.
function silhouette(src, colour) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function shineFrames(pix, frames = 7) {
  return Array.from({ length: frames }, (_, f) => {
    const p = new Pix();
    const band = -6 + f * 6;
    for (let y = 0; y < SPR; y++) {
      for (let x = 0; x < SPR; x++) {
        const col = pix.get(x, y);
        if (!col || col === INK) continue;
        const k = x + y - 10 - band;
        if (k >= 0 && k <= 2) p.set(x, y, k === 1 ? '#ffffff' : '#fff8e8');
      }
    }
    return p.canvas();
  });
}

// The brightest third of a sprite's pixels: where idle sparkles may appear.
function brightSpots(pix) {
  const pts = [];
  for (let y = 0; y < pix.h; y++) {
    for (let x = 0; x < pix.w; x++) {
      const col = pix.get(x, y);
      if (!col || col === INK) continue;
      const n = parseInt(col.slice(1), 16);
      pts.push([x, y, 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)]);
    }
  }
  pts.sort((a, b) => b[2] - a[2]);
  return pts.slice(0, Math.max(6, Math.floor(pts.length / 3))).map(([x, y]) => [x, y]);
}

let cache = null;

// Every image the board needs, built once on first use.
export function pieceSprites() {
  if (cache) return cache;
  const pieces = Array.from({ length: 7 }, (_, t) => {
    const pix = gemSprite(t);
    const img = pix.canvas();
    return { img, white: silhouette(img, '#ffffff'), shadow: silhouette(img, INK), shine: shineFrames(pix), spots: brightSpots(pix) };
  });
  const prismPix = Array.from({ length: 12 }, (_, f) => gemPrism(f / 12));
  const prism = prismPix.map((pix) => pix.canvas());
  cache = {
    pieces,
    prism,
    prismWhite: silhouette(prism[0], '#ffffff'),
    prismShadow: silhouette(prism[0], INK),
    prismSpots: brightSpots(prismPix[0]),
    ramps: GEM_RAMPS,
  };
  return cache;
}
