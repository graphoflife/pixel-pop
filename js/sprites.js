// Procedural pixel art. Every piece is painted pixel by pixel into a 20x20
// buffer from little shape/lighting functions, then given a comic ink outline.

export const SPR = 20;
export const INK = '#1a0f26';
const HALF = SPR / 2;
const UNIT = 9; // pixels per unit in the -1..1 paint space

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LIGHT = (() => { const l = [-0.5, -0.62, 0.6]; const m = Math.hypot(...l); return l.map((x) => x / m); })();
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

function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function sphere(u, v, cx, cy, R) {
  const x = (u - cx) / R, y = (v - cy) / R, d2 = x * x + y * y;
  if (d2 > 1) return null;
  const z = Math.sqrt(1 - d2);
  const dot = x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2];
  const rz = 2 * dot * z - LIGHT[2];
  return { x, y, z, lam: Math.max(0, dot), spec: Math.pow(Math.max(0, rz), 20) };
}

function rot(u, v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [u * c + v * s, -u * s + v * c];
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

// ================================================================= SPACE

const SPACE_RAMPS = [
  ['#2e0a0a', '#6b1a12', '#a8331c', '#d65a2c', '#f58b4f', '#ffc59b'],
  ['#24130b', '#4a2915', '#764323', '#a5663a', '#d18f57', '#f3bd83'],
  ['#5c3500', '#b06400', '#f0a000', '#ffd21f', '#fff07a', '#ffffe6'],
  ['#0a2a1a', '#145233', '#228a4a', '#4bbf62', '#9be37f', '#ddffc0'],
  ['#08163f', '#123a8a', '#1f66d1', '#4c9bff', '#9fd0ff', '#e8f6ff'],
  ['#1a0533', '#3d0f6b', '#7024b8', '#a855f7', '#d8a4ff', '#fbeaff'],
  ['#2b2f3d', '#545b70', '#8a92a8', '#bcc3d3', '#e3e8f0', '#ffffff'],
];
const FIRE = ['#a8200e', '#e8521a', '#ff8f1f', '#ffc93a', '#fff3b0'];

function crater(u, v, list) {
  for (const [cx, cy, r] of list) {
    const dx = u - cx, dy = v - cy, d = Math.hypot(dx, dy);
    if (d < r) return d > r * 0.55 && dx + dy > 0 ? 0.16 : -0.2;
  }
  return 0;
}

function mars() {
  const ramp = SPACE_RAMPS[0];
  const craters = [[0.3, 0.25, 0.2], [-0.35, 0.35, 0.13], [0.1, -0.3, 0.12]];
  return new Pix().paint((u, v, x, y) => {
    const s = sphere(u, v, 0, 0, 0.92);
    if (!s) return null;
    if (s.y < -0.74 + 0.08 * Math.sin(s.x * 6)) return tone(['#8ea2c4', '#d8e4f5', '#ffffff'], 0.25 + s.lam, x, y);
    let val = 0.14 + 0.86 * s.lam;
    if (vnoise(s.x * 2.6 + 5, s.y * 2.6 + 1, 3) > 0.6) val -= 0.15;
    val += crater(u, v, craters);
    return tone(ramp, val, x, y);
  }).outline();
}

function meteor() {
  const rock = SPACE_RAMPS[1];
  const cx = -0.26, cy = 0.26;
  return new Pix().paint((u, v, x, y) => {
    const du = u - cx, dv = v - cy;
    const ang = Math.atan2(dv, du), d = Math.hypot(du, dv);
    const R = 0.6 + 0.07 * Math.sin(3 * ang + 1) + 0.04 * Math.sin(7 * ang + 2);
    if (d < R) {
      const s = sphere(du / R, dv / R, 0, 0, 1.001) || { lam: 0.3 };
      let val = 0.16 + 0.84 * s.lam;
      val += crater(du, dv, [[0.18, 0.15, 0.17], [-0.25, -0.1, 0.12], [0.02, -0.33, 0.09]]);
      if (du - dv > R * 1.05) return FIRE[3];
      const n = vnoise(du * 5 + 3, dv * 5 + 7, 9);
      if (Math.abs(n - 0.5) < 0.045 && d < R * 0.85) return FIRE[2];
      return tone(rock, val, x, y);
    }
    const t = (du - dv) * 0.7071;
    const side = (du + dv) * 0.7071;
    const width = 0.64 * (1 - t / 1.55) + 0.06 * Math.sin(t * 10);
    if (t > 0 && t < 1.55 && Math.abs(side) < width) {
      const heat = 1.05 - t / 1.4 - (Math.abs(side) / width) * 0.45;
      return tone(FIRE, heat, x, y);
    }
    return null;
  }).outline();
}

function starMask(u, v, R, r) {
  const seg = TAU / 5;
  const ang = Math.atan2(u, -v);
  const k = Math.round(ang / seg);
  const delta = ang - k * seg;
  const a = Math.abs(delta);
  const p1 = [R, 0], p2 = [r * Math.cos(seg / 2), r * Math.sin(seg / 2)];
  const e = [p2[0] - p1[0], p2[1] - p1[1]];
  const dir = [Math.cos(a), Math.sin(a)];
  const rho = (p1[0] * e[1] - p1[1] * e[0]) / (dir[0] * e[1] - dir[1] * e[0]);
  return { inside: Math.hypot(u, v) <= rho, k, delta, d: Math.hypot(u, v) / rho };
}

function star() {
  const ramp = SPACE_RAMPS[2];
  const seg = TAU / 5;
  return new Pix().paint((u, v, x, y) => {
    const s = starMask(u, v, 1.02, 0.5);
    if (!s.inside) return null;
    const armAngle = -Math.PI / 2 + s.k * seg;
    const normal = armAngle + Math.sign(s.delta || 1) * (seg / 3.2);
    let val = 0.55 + 0.32 * Math.cos(normal - LIGHT_ANGLE) + (1 - Math.hypot(u, v)) * 0.25;
    if (Math.hypot(u + 0.12, v + 0.12) < 0.16) val = 1;
    return tone(ramp, val, x, y, false);
  }).outline();
}

function gasGiant() {
  const ramp = SPACE_RAMPS[3];
  return new Pix().paint((u, v, x, y) => {
    const s = sphere(u, v, 0, 0, 0.94);
    if (!s) return null;
    const lat = s.y + 0.09 * Math.sin(s.x * 5 + s.y * 2);
    const band = Math.floor((lat + 1) * 4.5);
    const shift = [0.12, -0.14, 0.2, -0.06, 0.16, -0.16, 0.1, -0.08, 0.14, 0][band] ?? 0;
    let val = 0.18 + 0.72 * s.lam + shift;
    const sx = (s.x - 0.28) / 0.3, sy = (s.y - 0.32) / 0.16, sd = sx * sx + sy * sy;
    if (sd < 1) return tone(['#7a2e12', '#c4562a', '#f08a4c', '#ffc08a'], sd < 0.35 ? 0.2 + s.lam : 0.05 + s.lam * 0.6, x, y);
    if (s.spec > 0.7) val = 1;
    return tone(ramp, val, x, y);
  }).outline();
}

function ringedPlanet() {
  const ramp = SPACE_RAMPS[4];
  const ring = ['#2c3466', '#5d6bb0', '#9db0e6', '#dbe6ff', '#ffffff'];
  const tilt = 0.3;
  const ringAt = (u, v) => {
    const [ru, rv] = rot(u, v, tilt);
    const e = Math.hypot(ru, rv / 0.44);
    if (e < 0.78 || e > 1.06 || (e > 0.9 && e < 0.94)) return null;
    return { front: rv > 0, val: 0.62 - ru * 0.38 + (e > 0.94 ? -0.12 : 0) };
  };
  return new Pix().paint((u, v, x, y) => {
    const s = sphere(u, v, 0, 0, 0.7);
    const r = ringAt(u, v);
    if (s) {
      if (r && r.front) return tone(ring, r.val, x, y);
      let val = 0.15 + 0.85 * s.lam + (Math.sin(s.y * 8 + 1) > 0.55 ? 0.12 : 0);
      if (s.spec > 0.75) val = 1;
      return tone(ramp, val, x, y);
    }
    if (r) return tone(ring, r.val - (r.front ? 0 : 0.18), x, y);
    return null;
  }).outline();
}

function blackHole() {
  const disk = ['#2a0850', '#5b1592', '#9a33d6', '#d266ff', '#f4b8ff', '#ffffff'];
  const sky = ['#0c0218', '#1a0533', '#2b0a52'];
  const tilt = -0.25;
  return new Pix().paint((u, v, x, y) => {
    const d = Math.hypot(u, v);
    if (d > 0.95) return null;
    const [ru, rv] = rot(u, v, tilt);
    const e = Math.hypot(ru, rv / 0.32);
    const inDisk = e > 0.4 && e < 0.98;
    const diskVal = 1.08 - (e - 0.4) * 1.15 - ru * 0.3;
    if (inDisk && rv > 0) return tone(disk, diskVal, x, y);
    if (d < 0.3) return '#05000b';
    if (d < 0.38) return d < 0.34 ? '#ffffff' : disk[4];
    // the far side of the disk is lensed up and over the hole
    if (d < 0.58 && rv < 0.02) return tone(disk, 0.92 - (d - 0.38) * 2.6 - ru * 0.2, x, y);
    if (inDisk) return tone(disk, diskVal - 0.1, x, y);
    if (hash(x, y, 4) > 0.93) return '#e9d6ff';
    return tone(sky, 0.9 - d * 0.9, x, y);
  }).outline();
}

function moon() {
  const ramp = SPACE_RAMPS[6];
  const craters = [[-0.3, -0.25, 0.22], [0.35, 0.2, 0.25], [-0.15, 0.45, 0.14], [0.3, -0.45, 0.12], [-0.55, 0.15, 0.1]];
  return new Pix().paint((u, v, x, y) => {
    const s = sphere(u, v, 0, 0, 0.9);
    if (!s) return null;
    let val = 0.18 + 0.82 * s.lam + crater(u, v, craters);
    if (vnoise(s.x * 2 + 9, s.y * 2 + 2, 5) > 0.62) val -= 0.1;
    return tone(ramp, val, x, y);
  }).outline();
}

function spacePrism(phase) {
  return new Pix().paint((u, v, x, y) => {
    const d = Math.hypot(u, v);
    if (d > 0.95) return null;
    if (d < 0.17) return '#ffffff';
    const ang = Math.atan2(v, u);
    const arm = Math.cos(2 * (ang - 3.4 * d) - phase * TAU);
    if (arm < -0.1 && d > 0.3) return hash(x, y, 7) > 0.92 ? '#ffffff' : '#140726';
    const l = clamp(0.3 + Math.max(0, arm) * 0.35 + (1 - d) * 0.25, 0.2, 0.9);
    return hsl(d * 0.9 - phase, 0.95, l);
  }).outline();
}

// ================================================================ GARDEN

const GARDEN_RAMPS = [
  ['#4a0a14', '#8f1426', '#d42a3a', '#f25560', '#ff9b9b', '#ffe0e0'],
  ['#5a1d00', '#a33d00', '#e8650f', '#ff9532', '#ffc56b', '#fff0c8'],
  ['#5c3d00', '#a87400', '#eab00c', '#ffd83a', '#fff08a', '#fffce0'],
  ['#0b3317', '#145c26', '#239a3a', '#46c95a', '#93ec8c', '#e3ffd9'],
  ['#0d1f5c', '#1a3fa3', '#2f6fe0', '#5c9cff', '#a8ccff', '#eaf3ff'],
  ['#25073f', '#4b1180', '#7d2cc4', '#a95ce6', '#d3a6ff', '#f5eaff'],
  ['#5c1435', '#a3285e', '#e35b8f', '#ff8fb5', '#ffc4da', '#fff0f6'],
];
const LEAF = GARDEN_RAMPS[3];
const BROWN = ['#2e1606', '#4f2a0f', '#73431c', '#9c6431', '#c48b52'];

function ellipseAt(u, v, cx, cy, a, b, angle = 0) {
  const [x, y] = rot(u - cx, v - cy, angle);
  return (x / a) ** 2 + (y / b) ** 2;
}

function tulip() {
  const ramp = GARDEN_RAMPS[0];
  const petal = (u, v, cx, angle) => {
    const [x, y] = rot(u - cx, v + 0.12, angle);
    if (y < -0.72 || y > 0.55) return false;
    const w = y < 0 ? 0.36 * Math.sqrt(Math.max(0, 1 - (y / 0.75) ** 2)) * (1 + y * 0.35) : 0.36 * Math.sqrt(1 - (y / 0.55) ** 2);
    return Math.abs(x) <= w;
  };
  return new Pix().paint((u, v, x, y) => {
    const front = petal(u, v, 0, 0);
    const left = petal(u, v, -0.3, 0.32), right = petal(u, v, 0.3, -0.32);
    if (front) return tone(ramp, 0.62 - u * 0.9 + (Math.abs(u + 0.12) < 0.07 && v < 0.2 ? 0.3 : 0) - (v + 0.1) * 0.2, x, y);
    if (left || right) return tone(ramp, (left ? 0.5 : 0.25) - (v + 0.1) * 0.25, x, y);
    if (Math.abs(u) < 0.1 && v > 0.3) return tone(LEAF, 0.55 - u * 2, x, y, false);
    if (ellipseAt(u, v, -0.4, 0.66, 0.4, 0.14, -0.75) <= 1) return tone(LEAF, 0.75 - ellipseAt(u, v, -0.4, 0.66, 0.4, 0.14, -0.75) * 0.3, x, y);
    if (ellipseAt(u, v, 0.42, 0.72, 0.38, 0.13, 0.75) <= 1) return tone(LEAF, 0.45, x, y);
    return null;
  }).outline();
}

function marigold() {
  const ramp = GARDEN_RAMPS[1];
  return new Pix().paint((u, v, x, y) => {
    const d = Math.hypot(u, v), a = Math.atan2(v, u);
    const r0 = 0.86 + 0.09 * Math.cos(11 * a);
    if (d > r0) return null;
    if (d < 0.13) return BROWN[3];
    const r1 = 0.6 + 0.06 * Math.cos(9 * a + 1.3);
    const r2 = 0.36 + 0.05 * Math.cos(7 * a + 0.4);
    const [lo, hi, k, ph] = d > r1 ? [r1, r0, 11, 0] : d > r2 ? [r2, r1, 9, 1.3] : [0.13, r2, 7, 0.4];
    const within = (d - lo) / (hi - lo);
    const crease = Math.cos(k * a + ph);
    const light = -(u + v) * 0.18;
    return tone(ramp, 0.32 + within * 0.42 + crease * 0.1 + light, x, y);
  }).outline();
}

function sunflower() {
  const ramp = GARDEN_RAMPS[2];
  return new Pix().paint((u, v, x, y) => {
    const d = Math.hypot(u, v), a = Math.atan2(v, u);
    if (d < 0.42) {
      const seed = ((x + y) & 1) ? 0.55 : 0.3;
      const rim = d > 0.34 ? -0.15 : 0;
      return tone(BROWN, seed + rim - (u + v) * 0.35, x, y, false);
    }
    const lobe = Math.pow(Math.abs(Math.cos(6 * a)), 0.75);
    const back = Math.pow(Math.abs(Math.cos(6 * a + Math.PI / 2)), 0.75);
    if (d < 0.5 + 0.48 * lobe) return tone(ramp, 0.42 + lobe * 0.4 - (u + v) * 0.12 - (d < 0.52 ? 0.25 : 0), x, y);
    if (d < 0.48 + 0.38 * back) return tone(ramp, 0.18 + back * 0.15, x, y);
    return null;
  }).outline();
}

function clover() {
  const ramp = LEAF;
  const leaves = [0, 1, 2, 3].map((k) => -Math.PI / 4 + k * (Math.PI / 2) - Math.PI / 2);
  return new Pix().paint((u, v, x, y) => {
    // stem
    const t = (u - 0.1);
    if (u > 0.08 && u < 0.9 && Math.abs(v - (0.3 + t * t * 0.9)) < 0.09 && v > 0.25) return tone(ramp, 0.35, x, y, false);
    for (const ang of leaves) {
      const [lx, ly] = rot(u, v, -ang);
      // in leaf space x points outward from the centre
      const lobeA = Math.hypot(lx - 0.48, ly - 0.2), lobeB = Math.hypot(lx - 0.48, ly + 0.2);
      const inLeaf = (lobeA < 0.31 || lobeB < 0.31 || (lx > 0.05 && lx < 0.5 && Math.abs(ly) < (lx - 0.02) * 0.9)) && lx > 0.04;
      if (!inLeaf) continue;
      if (Math.abs(ly) < 0.045 && lx < 0.72) return ramp[1];
      const chevron = Math.abs(Math.abs(ly) - (lx - 0.3) * 0.9) < 0.06 && lx > 0.3 && lx < 0.62;
      const light = -(u + v) * 0.3 + (1 - Math.hypot(lx - 0.45, ly) * 1.6) * 0.15;
      return chevron ? ramp[4] : tone(ramp, 0.48 + light, x, y);
    }
    return null;
  }).outline();
}

function petalFlower(u, v, count, place, radius, startAngle) {
  // returns the petal index (front-most last) whose disc contains the point, and second hit
  let hit = -1, depth = 0;
  for (let k = 0; k < count; k++) {
    const a = startAngle + k * (TAU / count);
    const d = Math.hypot(u - Math.cos(a) * place, v - Math.sin(a) * place);
    if (d < radius) { if (hit >= 0) depth++; hit = k; }
  }
  return { hit, overlap: depth > 0 };
}

function forgetMeNot() {
  const ramp = GARDEN_RAMPS[4];
  return new Pix().paint((u, v, x, y) => {
    const d = Math.hypot(u, v);
    if (d < 0.13) return '#fff6c0';
    if (d < 0.25) return tone(['#c98a00', '#ffd23f', '#fff3a0'], 0.6 - (u + v), x, y, false);
    if (d < 0.32) return '#ffffff';
    const { hit, overlap } = petalFlower(u, v, 5, 0.5, 0.44, -Math.PI / 2);
    if (hit < 0) return null;
    if (overlap) return ramp[1];
    return tone(ramp, 0.4 + d * 0.35 - (u + v) * 0.2, x, y);
  }).outline();
}

function pansy() {
  const ramp = GARDEN_RAMPS[5];
  const petals = [
    [-0.36, -0.36, 0.5, 0.25], [0.36, -0.36, 0.5, 0.25],
    [-0.5, 0.14, 0.42, 0.55], [0.5, 0.14, 0.42, 0.55], [0, 0.42, 0.5, 0.6],
  ];
  return new Pix().paint((u, v, x, y) => {
    const d = Math.hypot(u, v);
    if (d < 0.12) return '#ffe14a';
    let hit = -1, crease = false;
    petals.forEach(([cx, cy, r], i) => {
      const pd = Math.hypot(u - cx, v - cy);
      if (pd < r) { if (hit >= 0 && pd > r - 0.12) crease = true; hit = i; }
    });
    if (hit < 0) return null;
    if (crease) return ramp[0];
    const [cx, cy, , base] = petals[hit];
    // dark "face" streaks radiating from the centre on the lower petals
    const ang = Math.atan2(v, u);
    if (hit >= 2 && d < 0.5 && Math.cos(ang * 9) > 0.2) return ramp[d < 0.32 ? 0 : 1];
    return tone(ramp, base + Math.hypot(u - cx, v - cy) * 0.3 - (u + v) * 0.15, x, y);
  }).outline();
}

function sakura() {
  const ramp = GARDEN_RAMPS[6];
  return new Pix().paint((u, v, x, y) => {
    const d = Math.hypot(u, v);
    if (d < 0.2) return tone(ramp, 0.25, x, y, false);
    const ang = Math.atan2(v, u);
    let hit = -1, overlap = false;
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + k * (TAU / 5);
      const [px, py] = rot(u, v, a);
      const inPetal = ((px - 0.5) / 0.48) ** 2 + (py / 0.36) ** 2 <= 1;
      const notch = Math.hypot(px - 1.0, py) < 0.17;
      if (inPetal && !notch) { if (hit >= 0) overlap = true; hit = k; }
    }
    if (hit < 0) return null;
    // stamens between petals
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k + 0.5) * (TAU / 5);
      if (Math.hypot(u - Math.cos(a) * 0.32, v - Math.sin(a) * 0.32) < 0.08) return '#ffd23f';
    }
    if (overlap) return ramp[2];
    void ang;
    return tone(ramp, 0.42 + d * 0.5 - (u + v) * 0.15, x, y);
  }).outline();
}

function gardenPrism(phase) {
  return new Pix().paint((u, v, x, y) => {
    const d = Math.hypot(u, v);
    if (d < 0.22) return tone(['#a86a00', '#ffc21a', '#fff1a0', '#ffffff'], 0.8 - (u + v) * 0.8, x, y, false);
    const { hit, overlap } = petalFlower(u, v, 6, 0.52, 0.42, -Math.PI / 2 + phase * TAU / 6);
    if (hit < 0) return null;
    if (overlap) return hsl(hit / 6 + phase, 0.85, 0.35);
    return hsl(hit / 6 + phase, 0.9, clamp(0.5 + d * 0.25 - (u + v) * 0.12, 0.3, 0.85));
  }).outline();
}

// ================================================================= SLIMES

const SLIME_RAMPS = [
  ['#3d0a0a', '#7d1410', '#d0281f', '#f2503c', '#ff9480', '#ffd8cf'],
  ['#4a1f05', '#94410c', '#e07020', '#ff9a3c', '#ffc77a', '#fff0d0'],
  ['#4a3d05', '#8f7a0a', '#d9bf1c', '#fbe24a', '#fff39a', '#fffde0'],
  ['#0a3315', '#14632a', '#25a042', '#4fd062', '#a0f09a', '#e6ffe0'],
  ['#0a1f4f', '#14419a', '#2470e0', '#4ea0ff', '#9fd2ff', '#e8f6ff'],
  ['#2a0c4a', '#541a8c', '#8a32d0', '#b468f0', '#dcb0ff', '#f6ecff'],
  ['#5c1446', '#b03a82', '#f070b4', '#ff9ccf', '#ffc8e4', '#fff2fa'],
];

// body silhouettes: [half width, top of dome, pointiness]
const SLIME_BODIES = [
  [0.9, -0.62, 0], [0.88, -0.6, 0], [0.98, -0.4, 0], [0.86, -0.7, 0],
  [0.84, -0.98, 1], [0.86, -0.6, 0], [0.9, -0.66, 0],
];

function slimeBody(u, v, [hw, top, pointy]) {
  const ground = 0.86, mid = 0.25;
  if (v > ground) return null;
  if (v >= mid) {
    const curl = v > 0.62 ? (v - 0.62) * 0.9 : 0;
    const w = hw - curl * curl * 3;
    return Math.abs(u) <= w ? { nx: u / hw, ny: (v - mid) / (ground - mid) * 0.5 } : null;
  }
  const t = (v - mid) / (top - mid); // 0 at mid, 1 at top
  if (t > 1) return null;
  let w = hw * Math.sqrt(Math.max(0, 1 - t * t));
  if (pointy) w = hw * Math.pow(Math.max(0, 1 - t), 0.85) * Math.min(1, (1 - t) * 3 + 0.3);
  return Math.abs(u) <= w ? { nx: u / hw, ny: -t } : null;
}

function slimeSprite(type, ramp = SLIME_RAMPS[type], body = SLIME_BODIES[type], colourAt = null) {
  const p = new Pix();
  p.paint((u, v, x, y) => {
    const b = slimeBody(u, v, body);
    if (!b) return null;
    const nz = Math.sqrt(Math.max(0, 1 - b.nx * b.nx - b.ny * b.ny));
    let val = 0.38 + 0.4 * Math.max(0, -b.nx * 0.55 - b.ny * 0.6 + nz * 0.55) + nz * 0.12;
    if (v > 0.7) val -= 0.22;
    if (Math.abs(b.nx) > 0.86) val -= 0.12;
    // a few bubbles suspended in the goo
    if ([[0.42, 0.42], [0.55, 0.15], [-0.5, 0.55]].some(([bx, by]) => Math.hypot(u - bx, v - by) < 0.07)) val += 0.35;
    return colourAt ? colourAt(u, v, val, x, y) : tone(ramp, val, x, y);
  });
  // glossy highlight
  const top = Math.round(HALF + body[1] * UNIT);
  const hx = Math.round(HALF - body[0] * UNIT * 0.52);
  const hy = Math.max(top + 3, 8);
  p.dots(hx, hy, [[0, 0], [1, 0], [0, 1], [1, -1], [2, -1]], '#ffffff');
  p.set(hx + 4, hy - 2, '#ffffff');
  return p;
}

function eyes(p, kind, cx, ey) {
  const L = cx - 3, R = cx + 2;
  const dark = INK;
  if (kind === 'dot') {
    for (const ex of [L, R]) { p.dots(ex, ey, [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], dark); p.set(ex, ey, '#ffffff'); }
  } else if (kind === 'big') {
    for (const ex of [L - 1, R]) {
      p.dots(ex, ey - 1, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2], [1, 3]], dark);
      p.dots(ex, ey - 1, [[0, 0], [1, 0], [0, 1]], '#ffffff');
    }
  } else if (kind === 'happy') {
    for (const ex of [L, R]) p.dots(ex, ey, [[0, 1], [1, 0], [2, 1]], dark);
  } else if (kind === 'sleepy') {
    for (const ex of [L, R]) p.dots(ex, ey + 1, [[0, 0], [1, 0], [2, 0]], dark);
  } else if (kind === 'wink') {
    p.dots(L, ey, [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], dark);
    p.set(L, ey, '#ffffff');
    p.dots(R, ey + 1, [[0, 1], [1, 0], [2, 1]], dark);
  }
}

function slimeFace(p, type, ramp) {
  const cx = HALF, ey = 10;
  const faces = ['wink', 'dot', 'happy', 'big', 'dot', 'sleepy', 'happy'];
  eyes(p, faces[type], cx, ey);
  const mouths = {
    0: [[-1, 0], [0, 1], [1, 0]],
    1: [[0, 0], [-1, 0], [1, 0]],
    2: [[-1, 0], [0, 1], [1, 1], [2, 0]],
    3: [[0, 0], [1, 0], [0, 1], [1, 1]],
    4: [[-1, 0], [0, 1], [1, 0]],
    5: [[0, 0], [1, 0]],
    6: [[-1, 0], [0, 1], [1, 0]],
  };
  p.dots(cx, ey + 4, mouths[type], INK);
  if ([0, 2, 6].includes(type)) {
    p.dots(cx - 6, ey + 3, [[0, 0], [1, 0]], ramp[4]);
    p.dots(cx + 5, ey + 3, [[0, 0], [1, 0]], ramp[4]);
  }
}

function slimeExtras(p, type) {
  const top = Math.round(HALF + SLIME_BODIES[type][1] * UNIT);
  if (type === 0) { // little devil horns
    const h = '#5c0f1c';
    p.dots(5, top + 1, [[0, 0], [1, 0], [0, -1], [1, -1], [0, -2]], h);
    p.dots(13, top + 1, [[0, 0], [1, 0], [0, -1], [1, -1], [1, -2]], h);
  } else if (type === 1) { // leaf sprout
    p.dots(HALF, top - 1, [[0, 0], [0, -1], [1, -2], [2, -2], [2, -3], [1, -3], [3, -3]], '#3fbf4f');
    p.set(HALF - 1, top - 2, '#2b8a3a');
  } else if (type === 5) { // tiny crown
    const g = '#ffd23f', o = '#c98a00';
    p.dots(HALF - 3, top - 1, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]], o);
    p.dots(HALF - 3, top - 2, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [0, -1], [2, -1], [3, -1], [5, -1], [0, -2], [5, -2], [2, -2], [3, -2]], g);
    p.set(HALF - 1, top - 2, '#ff4d6d');
  } else if (type === 6) { // bow
    const c = '#ff3d7f', k = '#b0124d';
    p.dots(11, top - 1, [[0, -1], [0, 0], [0, 1], [1, 0], [1, -1], [1, 1], [3, 0], [3, -1], [3, 1], [4, -1], [4, 0], [4, 1]], c);
    p.set(13, top - 1, k);
    p.set(12, top - 1, '#ffd0e2');
  }
}

function slime(type) {
  const ramp = SLIME_RAMPS[type];
  const p = slimeSprite(type);
  slimeFace(p, type, ramp);
  slimeExtras(p, type);
  return p.outline();
}

function slimePrism(phase) {
  const body = [0.9, -0.66, 0];
  const p = slimeSprite(0, null, body, (u, v, val) => hsl(phase + v * 0.45 + u * 0.1, 0.9, clamp(0.25 + val * 0.6, 0.2, 0.9)));
  eyes(p, 'big', HALF, 10);
  p.dots(HALF, 14, [[-1, 0], [0, 1], [1, 1], [2, 0]], INK);
  slimeExtras(p, 5);
  return p.outline();
}

// ================================================================ THEMES

export const PIECE_BUILDERS = {
  jewels: { pieces: (t) => gemSprite(t), prism: gemPrism, ramps: GEM_RAMPS },
  cosmos: { pieces: (t) => [mars, meteor, star, gasGiant, ringedPlanet, blackHole, moon][t](), prism: spacePrism, ramps: SPACE_RAMPS },
  garden: { pieces: (t) => [tulip, marigold, sunflower, clover, forgetMeNot, pansy, sakura][t](), prism: gardenPrism, ramps: GARDEN_RAMPS },
  slimes: { pieces: (t) => slime(t), prism: slimePrism, ramps: SLIME_RAMPS },
};

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

const cache = new Map();

export function themeSprites(themeId) {
  if (cache.has(themeId)) return cache.get(themeId);
  const builder = PIECE_BUILDERS[themeId];
  const pieces = Array.from({ length: 7 }, (_, t) => {
    const pix = builder.pieces(t);
    const img = pix.canvas();
    return { img, white: silhouette(img, '#ffffff'), shadow: silhouette(img, INK), shine: shineFrames(pix), spots: brightSpots(pix) };
  });
  const prismPix = Array.from({ length: 12 }, (_, f) => builder.prism(f / 12));
  const prism = prismPix.map((pix) => pix.canvas());
  const set = {
    pieces,
    prism,
    prismWhite: silhouette(prism[0], '#ffffff'),
    prismShadow: silhouette(prism[0], INK),
    prismSpots: brightSpots(prismPix[0]),
    ramps: builder.ramps,
  };
  cache.set(themeId, set);
  return set;
}
