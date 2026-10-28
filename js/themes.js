// Theme metadata (names, board colours, comic words, effect styles) and the
// animated low-resolution backgrounds drawn behind the board.

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const TAU = Math.PI * 2;

export const THEMES = {
  jewels: {
    name: 'Jewels',
    blurb: 'Facets, fire & sparkle',
    board: { a: '#2a1650', b: '#341d61', frame: '#f6c445', light: '#fff0a8', dark: '#a8680c' },
    particle: 'shard',
    idle: 'shine',
    sound: 'bell',
    words: { nova: ['KA-BLAM!', 'BOOM!', 'BLAMMO!'], cross: ['ZAP!', 'KRAK!'], prism: ['DAZZLE!', 'BLINDING!'], mega: ['MEGA BLING!'], create: ['OOH!', 'SHINY!'] },
  },
  cosmos: {
    name: 'Cosmos',
    blurb: 'Planets, meteors & stars',
    board: { a: '#0d1033', b: '#141842', frame: '#5ee7ff', light: '#d2f9ff', dark: '#1f7f9e' },
    particle: 'dust',
    idle: 'drift',
    sound: 'synth',
    words: { nova: ['SUPERNOVA!', 'KABOOM!'], cross: ['WARP!', 'ZZAP!'], prism: ['BIG BANG!', 'COSMIC!'], mega: ['GALAXY BRAIN!'], create: ['WOW!', 'STELLAR!'] },
  },
  garden: {
    name: 'Garden',
    blurb: 'Blossoms, petals & leaves',
    board: { a: '#2f5a2c', b: '#386a33', frame: '#ffb3d1', light: '#ffe6f0', dark: '#c2577f' },
    particle: 'petal',
    idle: 'sway',
    sound: 'marimba',
    words: { nova: ['BLOOM!', 'FWOOMP!'], cross: ['WHOOSH!', 'SWISH!'], prism: ['PETAL STORM!', 'RAINBOW!'], mega: ['SUPER BLOOM!'], create: ['SPROUT!', 'LOVELY!'] },
  },
  slimes: {
    name: 'Slimes',
    blurb: 'Squishy, gooey friends',
    board: { a: '#16384a', b: '#1c4458', frame: '#7dff7a', light: '#d8ffd0', dark: '#2a9a3a' },
    particle: 'goo',
    idle: 'wobble',
    sound: 'bloop',
    words: { nova: ['SPLAT!', 'SPLOOSH!'], cross: ['SQUISH!', 'GLORP!'], prism: ['SLIME TIME!', 'GOOEY!'], mega: ['MEGA SPLAT!'], create: ['BLOOP!', 'SQUEE!'] },
  },
};

export const THEME_ORDER = ['jewels', 'cosmos', 'garden', 'slimes'];

export const CHAIN_WORDS = ['', '', 'NICE!', 'GREAT!', 'SUPER!', 'AWESOME!', 'AMAZING!', 'INCREDIBLE!', 'UNSTOPPABLE!'];

// ------------------------------------------------------------ backgrounds

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// Dithered vertical gradient through a list of colours.
function gradient(img, w, h, stops, from = 0, to = h) {
  const cols = stops.map(hexToRgb);
  for (let y = from; y < to; y++) {
    const f = ((y - from) / Math.max(1, to - from - 1)) * (cols.length - 1);
    for (let x = 0; x < w; x++) {
      let i = Math.floor(f);
      if (f - i > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16) i++;
      put(img, w, x, y, cols[Math.min(i, cols.length - 1)]);
    }
  }
}

function put(img, w, x, y, [r, g, b], a = 255) {
  const i = (y * w + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}

function px(ctx, x, y, c, s = 1) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), s, s);
}

function plus(ctx, x, y, core, arm, len = 1) {
  px(ctx, x, y, core);
  for (let i = 1; i <= len; i++) {
    px(ctx, x - i, y, arm); px(ctx, x + i, y, arm); px(ctx, x, y - i, arm); px(ctx, x, y + i, arm);
  }
}

const rand = (a, b) => a + Math.random() * (b - a);

class Background {
  constructor() { this.base = null; this.w = 0; this.h = 0; }
  resize(w, h) {
    this.w = w; this.h = h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    this.paintBase(img, w, h);
    ctx.putImageData(img, 0, 0);
    this.base = c;
    this.init(w, h);
  }
  init() {}
  paintBase() {}
  draw(ctx, t, dt) { ctx.drawImage(this.base, 0, 0); this.animate(ctx, t, dt); }
  animate() {}
}

class JewelsBg extends Background {
  paintBase(img, w, h) {
    gradient(img, w, h, ['#12062a', '#1b0a3c', '#28104f', '#371665', '#28104f']);
    const line = hexToRgb('#3f1c74');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((x + y) % 28 === 0 || ((x - y) % 28 + 28) % 28 === 0) put(img, w, x, y, line);
    }
  }
  init(w, h) {
    this.sparks = Array.from({ length: Math.round(w * h / 260) }, () => ({ x: rand(0, w), y: rand(0, h), p: rand(0, TAU), s: rand(0.6, 1.6) }));
    this.glitter = Array.from({ length: Math.round(w / 3) }, () => ({ x: rand(0, w), y: rand(0, h), v: rand(3, 9), c: ['#ffd23f', '#ff8fd0', '#9fd2ff', '#ffffff'][Math.floor(rand(0, 4))] }));
  }
  animate(ctx, t, dt) {
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

class CosmosBg extends Background {
  paintBase(img, w, h) {
    gradient(img, w, h, ['#04020c', '#090619', '#0e0b2a', '#150f3a', '#0b0820']);
    // dithered nebula clouds
    const neb = [hexToRgb('#2a1458'), hexToRgb('#4a1d78'), hexToRgb('#0f3c5c'), hexToRgb('#1a5a7a')];
    const n = (x, y) => Math.sin(x * 0.07 + Math.sin(y * 0.05) * 2) + Math.sin(y * 0.06 + Math.cos(x * 0.04) * 2) + Math.sin((x + y) * 0.03);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = n(x, y);
      const th = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      if (v > 1.2 + th) put(img, w, x, y, neb[v > 2 ? 1 : 0]);
      else if (v < -1.3 - th) put(img, w, x, y, neb[v < -2 ? 3 : 2]);
    }
  }
  init(w, h) {
    this.stars = Array.from({ length: Math.round(w * h / 70) }, () => ({
      x: rand(0, w), y: rand(0, h), z: Math.floor(rand(0, 3)), p: rand(0, TAU),
      c: ['#ffffff', '#bfe3ff', '#ffe9b0', '#ffc0f0'][Math.floor(rand(0, 4))],
    }));
    this.shooter = null;
    this.nextShot = 2;
  }
  animate(ctx, t, dt) {
    for (const s of this.stars) {
      s.x -= (s.z + 1) * 1.2 * dt;
      if (s.x < 0) { s.x += this.w; s.y = rand(0, this.h); }
      const tw = Math.sin(t * (1.5 + s.z) + s.p);
      if (s.z === 2 && tw > 0.85) plus(ctx, s.x, s.y, '#ffffff', s.c, 1);
      else if (tw > -0.4) px(ctx, s.x, s.y, s.z === 0 ? '#5a5c8a' : s.c);
    }
    this.nextShot -= dt;
    if (!this.shooter && this.nextShot < 0) {
      this.shooter = { x: rand(this.w * 0.3, this.w), y: rand(0, this.h * 0.4), life: 0 };
      this.nextShot = rand(3, 8);
    }
    if (this.shooter) {
      const s = this.shooter;
      s.life += dt; s.x -= 90 * dt; s.y += 45 * dt;
      for (let i = 0; i < 14; i++) px(ctx, s.x + i * 2, s.y - i, i < 3 ? '#ffffff' : i < 8 ? '#9fd2ff' : '#3a5a9a');
      if (s.life > 1.2) this.shooter = null;
    }
  }
}

class GardenBg extends Background {
  paintBase(img, w, h) {
    gradient(img, w, h, ['#7fd3ff', '#a6e2ff', '#cdf0ff', '#eefaff', '#fff4d8']);
    const hills = [
      { base: 0.78, amp: 0.05, f: 0.035, col: hexToRgb('#8fd67c'), dot: hexToRgb('#ffffff') },
      { base: 0.86, amp: 0.04, f: 0.05, col: hexToRgb('#5fbf5a'), dot: hexToRgb('#ff8fb5') },
      { base: 0.93, amp: 0.025, f: 0.08, col: hexToRgb('#3f9a45'), dot: hexToRgb('#ffd23f') },
    ];
    for (const hl of hills) {
      for (let x = 0; x < w; x++) {
        const top = Math.round(h * (hl.base + hl.amp * Math.sin(x * hl.f + hl.base * 10)));
        for (let y = Math.max(0, top); y < h; y++) put(img, w, x, y, hl.col);
        if (x % 7 === 3 && top + 3 < h) put(img, w, x, top + 3, hl.dot);
      }
    }
  }
  init(w, h) {
    this.clouds = Array.from({ length: 4 }, (_, i) => ({ x: rand(0, w), y: rand(4, h * 0.35), s: rand(0.6, 1.2), v: rand(1.5, 4) * (i % 2 ? 1 : 0.7) }));
    this.petals = Array.from({ length: Math.round(w / 4) }, () => this.petal(true));
  }
  petal(anywhere) {
    return { x: rand(0, this.w), y: anywhere ? rand(0, this.h) : -3, v: rand(6, 14), p: rand(0, TAU), c: ['#ffb3d1', '#ffffff', '#ff8fb5', '#ffd6e6', '#9be37f'][Math.floor(rand(0, 5))] };
  }
  animate(ctx, t, dt) {
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x - 30 * c.s > this.w) c.x = -30 * c.s;
      const blobs = [[0, 0, 7], [8, -3, 8], [16, 0, 6], [6, 3, 6], [12, 3, 6]];
      ctx.fillStyle = '#ffffff';
      for (const [bx, by, r] of blobs) {
        const rr = r * c.s;
        for (let dy = -rr; dy <= rr; dy++) {
          const half = Math.floor(Math.sqrt(rr * rr - dy * dy));
          ctx.fillRect(Math.round(c.x + bx * c.s - half), Math.round(c.y + by * c.s + dy), half * 2, 1);
        }
      }
    }
    for (const p of this.petals) {
      p.y += p.v * dt; p.x += Math.sin(t * 1.5 + p.p) * 8 * dt + 3 * dt;
      if (p.y > this.h || p.x > this.w + 3) Object.assign(p, this.petal(false));
      const flip = Math.sin(t * 5 + p.p) > 0;
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), flip ? 2 : 1, flip ? 1 : 2);
    }
  }
}

class SlimesBg extends Background {
  paintBase(img, w, h) {
    gradient(img, w, h, ['#123c3e', '#155047', '#1c3f5c', '#2a2457', '#331a4f']);
    const spot = hexToRgb('#1f5a5a');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (((x * 7 + y * 13) % 97 === 0)) { put(img, w, x, y, spot); }
    }
  }
  init(w, h) {
    this.bubbles = Array.from({ length: Math.round(w * h / 900) + 6 }, () => this.bubble(true));
    this.drips = Array.from({ length: Math.ceil(w / 9) }, (_, i) => ({ x: i * 9 + rand(0, 5), len: rand(3, 14), p: rand(0, TAU), s: rand(0.3, 0.9) }));
  }
  bubble(anywhere) {
    return { x: rand(0, this.w), y: anywhere ? rand(0, this.h) : this.h + 6, r: Math.floor(rand(1, 5)), v: rand(5, 14), p: rand(0, TAU), c: ['#7dff7a', '#ff7cb2', '#9fd2ff', '#fbe24a', '#b468f0'][Math.floor(rand(0, 5))] };
  }
  animate(ctx, t, dt) {
    for (const b of this.bubbles) {
      b.y -= b.v * dt; b.x += Math.sin(t * 2 + b.p) * 4 * dt;
      if (b.y < -6) Object.assign(b, this.bubble(false));
      const steps = Math.max(8, b.r * 7);
      ctx.fillStyle = b.c;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * TAU;
        ctx.fillRect(Math.round(b.x + Math.cos(a) * b.r), Math.round(b.y + Math.sin(a) * b.r), 1, 1);
      }
      if (b.r > 1) px(ctx, b.x - b.r / 2, b.y - b.r / 2, '#ffffff');
    }
    // goo dripping from the top edge
    ctx.fillStyle = '#4fd062';
    ctx.fillRect(0, 0, this.w, 3);
    ctx.fillStyle = '#25a042';
    ctx.fillRect(0, 3, this.w, 1);
    for (const d of this.drips) {
      const len = Math.round(d.len * (0.6 + 0.4 * Math.sin(t * d.s + d.p)));
      ctx.fillStyle = '#4fd062';
      ctx.fillRect(Math.round(d.x), 3, 3, len);
      ctx.fillRect(Math.round(d.x) - 1, 3 + len - 1, 5, 3);
      ctx.fillStyle = '#25a042';
      ctx.fillRect(Math.round(d.x) - 1, 3 + len + 2, 5, 1);
      ctx.fillStyle = '#d8ffd0';
      ctx.fillRect(Math.round(d.x), 3 + len - 1, 1, 1);
    }
  }
}

const BG = { jewels: JewelsBg, cosmos: CosmosBg, garden: GardenBg, slimes: SlimesBg };
export const makeBackground = (id) => new BG[id]();
