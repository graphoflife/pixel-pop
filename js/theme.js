// The jewel look: board colours, comic words, and the animated low-resolution
// background drawn behind the board.

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const TAU = Math.PI * 2;

export const THEME = {
  board: { a: '#2a1650', b: '#341d61', frame: '#f6c445', light: '#fff0a8', dark: '#a8680c' },
  words: { nova: ['KA-BLAM!', 'BOOM!', 'BLAMMO!'], cross: ['ZAP!', 'KRAK!'], prism: ['DAZZLE!', 'BLINDING!'], mega: ['MEGA BLING!'], create: ['OOH!', 'SHINY!'] },
};

export const CHAIN_WORDS = ['', '', 'NICE!', 'GREAT!', 'SUPER!', 'AWESOME!', 'AMAZING!', 'INCREDIBLE!', 'UNSTOPPABLE!'];

// ------------------------------------------------------------- background

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function put(img, w, x, y, [r, g, b], a = 255) {
  const i = (y * w + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}

// Dithered vertical gradient through a list of colours.
function gradient(img, w, h, stops) {
  const cols = stops.map(hexToRgb);
  for (let y = 0; y < h; y++) {
    const f = (y / Math.max(1, h - 1)) * (cols.length - 1);
    for (let x = 0; x < w; x++) {
      let i = Math.floor(f);
      if (f - i > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16) i++;
      put(img, w, x, y, cols[Math.min(i, cols.length - 1)]);
    }
  }
}

function px(ctx, x, y, c) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

function plus(ctx, x, y, core, arm, len) {
  px(ctx, x, y, core);
  for (let i = 1; i <= len; i++) {
    px(ctx, x - i, y, arm); px(ctx, x + i, y, arm); px(ctx, x, y - i, arm); px(ctx, x, y + i, arm);
  }
}

const rand = (a, b) => a + Math.random() * (b - a);

// Deep velvet with a faint argyle lattice, drifting glitter and twinkling stars.
export class Background {
  constructor() { this.base = null; this.w = 0; this.h = 0; }

  resize(w, h) {
    this.w = w; this.h = h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    gradient(img, w, h, ['#12062a', '#1b0a3c', '#28104f', '#371665', '#28104f']);
    const line = hexToRgb('#3f1c74');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((x + y) % 28 === 0 || ((x - y) % 28 + 28) % 28 === 0) put(img, w, x, y, line);
    }
    ctx.putImageData(img, 0, 0);
    this.base = c;
    this.sparks = Array.from({ length: Math.round(w * h / 260) }, () => ({ x: rand(0, w), y: rand(0, h), p: rand(0, TAU), s: rand(0.6, 1.6) }));
    this.glitter = Array.from({ length: Math.round(w / 3) }, () => ({ x: rand(0, w), y: rand(0, h), v: rand(3, 9), c: ['#ffd23f', '#ff8fd0', '#9fd2ff', '#ffffff'][Math.floor(rand(0, 4))] }));
  }

  draw(ctx, t, dt) {
    ctx.drawImage(this.base, 0, 0);
    for (const g of this.glitter) {
      g.y += g.v * dt; g.x += Math.sin(t * 0.8 + g.v) * 0.05;
      if (g.y > this.h) { g.y = -2; g.x = rand(0, this.w); }
      if (Math.sin(t * 4 + g.v * 10) > 0) px(ctx, g.x, g.y, g.c);
    }
    for (const s of this.sparks) {
      const k = Math.sin(t * s.s + s.p);
      if (k > 0.9) plus(ctx, s.x, s.y, '#ffffff', '#ffe28a', 2);
      else if (k > 0.6) plus(ctx, s.x, s.y, '#fff3c4', '#8a5bd1', 1);
    }
  }
}
