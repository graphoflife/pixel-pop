// Visual effects in "art pixel" space: particles, shockwave rings, lightning,
// comic starbursts and floating score text. Shapes are drawn into the low-res
// scene; words are drawn afterwards on the full-resolution canvas.

import { INK } from './sprites.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const FONT = '"Press Start 2P", monospace';

const outBack = (t) => { const c = 2.2; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

function line(ctx, x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function jaggedPath(x0, y0, x1, y1, jitter) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(len / 6));
  const nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1);
  const pts = [[x0, y0]];
  for (let i = 1; i < n; i++) {
    const k = i / n, j = rand(-jitter, jitter);
    pts.push([x0 + (x1 - x0) * k + nx * j, y0 + (y1 - y0) * k + ny * j]);
  }
  pts.push([x1, y1]);
  return pts;
}

// Comic starburst sprite, cached by size and palette.
const burstCache = new Map();
function burstSprite(w, h, fill, inner) {
  const id = `${w}x${h}:${fill}:${inner}`;
  if (burstCache.has(id)) return burstCache.get(id);
  const c = document.createElement('canvas');
  c.width = w + 4; c.height = h + 4;
  const ctx = c.getContext('2d');
  const cx = c.width / 2, cy = c.height / 2;
  const spikes = 13;
  const outer = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU + rand(-0.06, 0.06);
    const r = i % 2 ? rand(0.66, 0.74) : rand(0.9, 1);
    outer.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const inside = (u, v, poly, s) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i].map((q) => q * s), [xj, yj] = poly[j].map((q) => q * s);
      if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const grid = [];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const u = (x + 0.5 - cx) / (w / 2), v = (y + 0.5 - cy) / (h / 2);
      grid[y * c.width + x] = inside(u, v, outer, 0.98) ? (inside(u, v, outer, 0.72) ? 2 : 1) : 0;
    }
  }
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const g = grid[y * c.width + x];
      const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= c.width || yy >= c.height ? 0 : grid[yy * c.width + xx]);
      if (g) {
        // halftone dots in the lower-right of the outer ring for that comic print look
        const dot = g === 1 && (x + y) % 3 === 0 && x % 3 === 0 && x + y > c.width;
        ctx.fillStyle = g === 2 ? inner : dot ? INK : fill;
        ctx.fillRect(x, y, 1, 1);
      } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        ctx.fillStyle = INK;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  burstCache.set(id, c);
  return c;
}

export class Fx {
  constructor() {
    this.parts = [];
    this.rings = [];
    this.beams = [];
    this.bolts = [];
    this.bursts = [];
    this.popups = [];
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.shake = 0;
    this.offset = { x: 0, y: 0 };
  }

  clear() {
    this.parts.length = this.rings.length = this.beams.length = this.bolts.length = 0;
    this.bursts.length = this.popups.length = 0;
    this.flash = this.shake = 0;
  }

  // ---------------------------------------------------------- spawners

  explode(x, y, ramp, style, count = 10, power = 1) {
    const cols = ramp ? ramp.slice(2) : ['#ff5a5a', '#ffd23f', '#5ee7ff', '#b468f0', '#7dff7a', '#ffffff'];
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), sp = rand(25, 75) * power;
      const p = {
        x: x + rand(-3, 3), y: y + rand(-3, 3), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
        life: 0, max: rand(0.45, 0.9), c: pick(cols), size: Math.random() < 0.35 ? 2 : 1,
        g: 160, drag: 1.5, style,
      };
      if (style === 'dust') { p.g = 0; p.drag = 2.2; p.vy += 20; p.max *= 1.3; }
      if (style === 'petal') { p.g = 45; p.drag = 3; p.size = 2; p.sway = rand(0, TAU); p.max *= 1.6; }
      if (style === 'goo') { p.g = 260; p.size = Math.random() < 0.5 ? 2 : 3; p.vy -= 30; }
      this.parts.push(p);
    }
    for (let i = 0; i < Math.ceil(count / 4); i++) this.sparkle(x + rand(-6, 6), y + rand(-6, 6), ramp ? ramp[5] : '#ffffff');
  }

  sparkle(x, y, c = '#ffffff', life = 0.45) {
    this.parts.push({ x, y, vx: rand(-10, 10), vy: rand(-20, 0), life: 0, max: life, c, size: 1, g: 0, drag: 2, style: 'spark' });
  }

  confetti(w, h, count = 60) {
    const cols = ['#ff4d6d', '#ffd23f', '#5ee7ff', '#7dff7a', '#b468f0', '#ffffff', '#ff9a3c'];
    for (let i = 0; i < count; i++) {
      this.parts.push({
        x: rand(0, w), y: rand(-20, 0), vx: rand(-15, 15), vy: rand(20, 60), life: 0, max: rand(1.4, 2.4),
        c: pick(cols), size: 2, g: 30, drag: 0.6, style: 'petal', sway: rand(0, TAU),
      });
    }
  }

  ring(x, y, c, maxR, dur = 0.35, thick = 2) {
    this.rings.push({ x, y, c, maxR, dur, t: 0, thick });
  }

  // straight electric band (rows / columns)
  beam(x0, y0, x1, y1, c, dur = 0.38) {
    this.beams.push({ x0, y0, x1, y1, c, dur, t: 0 });
  }

  bolt(x0, y0, x1, y1, c, dur = 0.45) {
    this.bolts.push({ x0, y0, x1, y1, c, dur, t: 0, pts: jaggedPath(x0, y0, x1, y1, 3), next: 0 });
  }

  // a comic starburst with a word on it
  burst(x, y, word, { size = 8, fill = '#ffd23f', inner = '#ffffff', text = '#ff3d6e', life = 0.95, tilt = rand(-0.14, 0.14), sub = '' } = {}) {
    const w = Math.max(36, Math.round(word.length * size * 0.95 + 18));
    const h = Math.round(size * 3.4 + (sub ? 6 : 0));
    this.bursts.push({ x, y, word, sub, size, sprite: burstSprite(w, h, fill, inner), text, life, t: 0, tilt });
    if (this.bursts.length > 4) this.bursts.shift();
  }

  popup(x, y, text, c = '#ffffff') {
    this.popups.push({ x, y, text, c, t: 0, life: 0.9 });
  }

  kick(shake, flash = 0, color = '#ffffff') {
    this.shake = Math.max(this.shake, shake);
    if (flash > this.flash) { this.flash = flash; this.flashColor = color; }
  }

  // ------------------------------------------------------------- update

  update(dt) {
    for (const p of this.parts) {
      p.life += dt;
      p.vx *= Math.exp(-p.drag * dt);
      p.vy *= Math.exp(-p.drag * dt);
      p.vy += p.g * dt;
      p.x += p.vx * dt + (p.sway !== undefined ? Math.sin(p.life * 6 + p.sway) * 12 * dt : 0);
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
    for (const list of [this.rings, this.beams, this.bolts, this.bursts, this.popups]) for (const e of list) e.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.dur);
    this.beams = this.beams.filter((b) => b.t < b.dur);
    this.bolts = this.bolts.filter((b) => b.t < b.dur);
    this.bursts = this.bursts.filter((b) => b.t < b.life);
    this.popups = this.popups.filter((p) => p.t < p.life);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.shake = Math.max(0, this.shake - dt * 18);
    const s = Math.round(this.shake);
    this.offset = { x: s ? Math.round(rand(-s, s)) : 0, y: s ? Math.round(rand(-s, s)) : 0 };
  }

  // ----------------------------------------------------- low-res drawing

  drawScene(ctx, w, h) {
    for (const r of this.rings) {
      const k = r.t / r.dur;
      const rad = r.maxR * (1 - (1 - k) ** 3);
      ctx.fillStyle = k < 0.3 ? '#ffffff' : r.c;
      const steps = Math.max(16, Math.round(rad * 7));
      const thick = k > 0.7 ? 1 : r.thick;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * TAU;
        for (let d = 0; d < thick; d++) ctx.fillRect(Math.round(r.x + Math.cos(a) * (rad - d)), Math.round(r.y + Math.sin(a) * (rad - d)), 1, 1);
      }
    }

    for (const b of this.beams) {
      const k = b.t / b.dur;
      const half = Math.max(0, Math.round(4 * (1 - k)));
      const horiz = b.y0 === b.y1;
      const len = horiz ? Math.abs(b.x1 - b.x0) : Math.abs(b.y1 - b.y0);
      const sx = Math.min(b.x0, b.x1), sy = Math.min(b.y0, b.y1);
      for (let i = 0; i <= len; i += 2) {
        const j = Math.round(rand(-1, 1));
        const w2 = half + (Math.random() < 0.3 ? 1 : 0);
        ctx.fillStyle = b.c;
        if (horiz) ctx.fillRect(sx + i, b.y0 - w2 + j, 2, w2 * 2 + 1);
        else ctx.fillRect(b.x0 - w2 + j, sy + i, w2 * 2 + 1, 2);
      }
      ctx.fillStyle = '#ffffff';
      const core = Math.max(1, Math.round(2 * (1 - k)));
      if (horiz) ctx.fillRect(sx, b.y0 - Math.floor(core / 2), len, core);
      else ctx.fillRect(b.x0 - Math.floor(core / 2), sy, core, len);
    }

    for (const b of this.bolts) {
      if (b.t > b.next) { b.pts = jaggedPath(b.x0, b.y0, b.x1, b.y1, 3); b.next = b.t + 0.05; }
      for (const [col, off] of [[b.c, 1], ['#ffffff', 0]]) {
        ctx.fillStyle = col;
        for (let i = 1; i < b.pts.length; i++) {
          const [ax, ay] = b.pts[i - 1], [bx, by] = b.pts[i];
          line(ctx, ax + off, ay, bx + off, by);
          if (off) line(ctx, ax - off, ay, bx - off, by);
        }
      }
    }

    for (const p of this.parts) {
      const k = p.life / p.max;
      if (k > 0.75 && Math.floor(p.life * 30) % 2) continue; // flicker out
      ctx.fillStyle = p.c;
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.style === 'spark') {
        ctx.fillRect(x, y, 1, 1);
        if (k < 0.6) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); }
      } else if (p.style === 'petal') {
        const flip = Math.sin(p.life * 14 + (p.sway || 0)) > 0;
        ctx.fillRect(x, y, flip ? p.size : 1, flip ? 1 : p.size);
      } else if (p.style === 'shard' && p.size === 2) {
        ctx.fillRect(x, y, 1, 1); ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x + 1, y, 1, 1);
      } else {
        ctx.fillRect(x, y, p.size, p.size);
      }
    }

    for (const b of this.bursts) {
      const { sw, sh } = this.burstScale(b);
      if (sw <= 0) continue;
      ctx.save();
      ctx.translate(Math.round(b.x), Math.round(b.y));
      ctx.rotate(b.tilt);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(b.sprite, -Math.round((b.sprite.width * sw) / 2), -Math.round((b.sprite.height * sh) / 2), Math.round(b.sprite.width * sw), Math.round(b.sprite.height * sh));
      ctx.restore();
    }

    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(0.85, this.flash);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  burstScale(b) {
    const k = b.t / b.life;
    let s = k < 0.18 ? outBack(k / 0.18) : 1;
    if (k > 0.8) s = 1 - (k - 0.8) / 0.2;
    return { sw: s, sh: s };
  }

  // ------------------------------------------------- full-res text pass

  drawText(ctx, S, ox, oy) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const b of this.bursts) {
      const { sw } = this.burstScale(b);
      if (sw <= 0.05) continue;
      ctx.save();
      ctx.translate(ox + b.x * S, oy + b.y * S - (b.sub ? 3 * S : 0));
      ctx.rotate(b.tilt);
      ctx.scale(sw, sw);
      textOutlined(ctx, b.word, b.size * S, b.text, S);
      if (b.sub) {
        ctx.translate(0, b.size * S * 0.95 + 1.5 * S);
        textOutlined(ctx, b.sub, 5 * S, '#ffffff', S * 0.8);
      }
      ctx.restore();
    }
    for (const p of this.popups) {
      const k = p.t / p.life;
      const y = p.y - 14 * (1 - (1 - k) ** 2);
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.save();
      ctx.translate(ox + p.x * S, oy + y * S);
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : k < 0.2 ? 1.1 - ((k - 0.12) / 0.08) * 0.1 : 1;
      ctx.scale(pop, pop);
      textOutlined(ctx, p.text, 5 * S, p.c, S * 0.8);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }
}

export function textOutlined(ctx, text, size, fill, S) {
  ctx.font = `${Math.round(size)}px ${FONT}`;
  ctx.lineWidth = Math.max(2, S * 1.6);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.fillText(text, S * 0.9, S * 0.9);
  ctx.strokeText(text, S * 0.9, S * 0.9);
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
}
