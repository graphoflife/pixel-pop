// Game controller: owns the board, runs the swap -> match -> blast -> drop
// loop as awaited animations, handles input and renders the scene.

import * as B from './board.js';
import { themeSprites, INK } from './sprites.js';
import { THEMES, CHAIN_WORDS } from './themes.js';
import { Fx } from './fx.js';

const T = 20;                     // tile size in art pixels
const PAD = 6;                    // frame around the board
const ART = B.SIZE * T + PAD * 2; // scene size in art pixels
const GRAVITY = 60;               // cells / s^2
const HINT_AFTER = 7000;          // ms of idling before a hint appears

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  back: (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const cx = (c) => PAD + c * T + T / 2;
const cy = (r) => PAD + r * T + T / 2;

export const levelTarget = (level) => 1000 + 500 * (level - 1);

export class Game {
  constructor({ canvas, audio, hooks }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audio = audio;
    this.hooks = hooks;
    this.scene = document.createElement('canvas');
    this.scene.width = this.scene.height = ART;
    this.sctx = this.scene.getContext('2d');
    this.fx = new Fx();
    this.time = 0;
    this.tweens = [];
    this.fallWaiters = [];
    this.dying = [];
    this.queue = [];      // swaps the player made that are shown but not played yet, in order
    this.busy = false;    // a queued swap is being resolved
    this.locked = false;  // intro / new game: input ignored
    this.selected = null;
    this.hint = null;
    this.idleSince = 0;
    this.drag = null;
    this.vibrate = true;
    this.layout = { S: 1, ox: 0, oy: 0 };
    this.bindInput();
  }

  // ------------------------------------------------------------- setup

  setTheme(id) {
    this.themeId = id;
    this.theme = THEMES[id];
    this.sprites = themeSprites(id);
    this.frame = this.buildFrame();
    this.audio.setVoice(this.theme.sound);
  }

  start(saved, stats) {
    this.stats = stats;
    this.grid = saved && B.deserialize(saved.grid);
    if (this.grid) {
      this.score = saved.score | 0;
      this.level = Math.max(1, saved.level | 0);
      this.levelScore = saved.levelScore | 0;
    } else {
      this.grid = B.createBoard();
      this.score = 0;
      this.level = 1;
      this.levelScore = 0;
    }
    this.bestAtStart = stats.best;
    this.announcedBest = false;
    B.forEachCell(this.grid, (p, r, c) => this.dress(p, r, c));
    this.idleSince = this.time;
    this.notify();
  }

  // The board drops in from above, column by column.
  async intro() {
    this.locked = true;
    B.forEachCell(this.grid, (p, r, c) => {
      p.y = r - B.SIZE - 1;
      p.fall = { vy: 0, ty: r, delay: c * 45 + (B.SIZE - r) * 15 };
    });
    await this.waitFalls();
    this.locked = false;
    this.idleSince = this.time;
  }

  async newGame() {
    if (this.locked) return false;
    this.locked = true;
    this.queue.length = 0;
    while (this.busy) await this.wait(50);
    this.selected = this.hint = null;
    B.forEachCell(this.grid, (p) => { this.endSlide(p); this.kill(p, 'burst', Math.random() * 250); });
    this.audio.shuffle();
    await this.wait(450);
    this.grid = B.createBoard();
    this.score = 0; this.level = 1; this.levelScore = 0;
    this.bestAtStart = this.stats.best;
    this.announcedBest = false;
    this.stats.games++;
    B.forEachCell(this.grid, (p, r, c) => this.dress(p, r, c));
    this.notify();
    await this.intro();
    this.save();
    return true;
  }

  dress(p, r, c) {
    p.x = c; p.y = r;
    p.phase = Math.random();
    p.fall = null;
    p.slide = null;
    p.land = -1e9;
    p.born = -1e9;
    return p;
  }

  save() {
    this.hooks.save({
      grid: B.serialize(this.grid),
      score: this.score, level: this.level, levelScore: this.levelScore,
    });
  }

  notify() {
    this.hooks.score({ score: this.score, best: Math.max(this.stats.best, this.score), level: this.level, progress: this.levelScore / levelTarget(this.level) });
  }

  // --------------------------------------------------------- animation

  anim(dur, fn = () => {}, easing = ease.linear) {
    return new Promise((resolve) => this.tweens.push({ start: this.time, dur, fn, easing, resolve }));
  }

  wait(ms) { return this.anim(ms); }

  // Glides a piece to a cell. A new slide replaces the old one from wherever
  // the piece is now; y = null leaves the vertical to an ongoing fall.
  slideTo(p, x, y, dur, lift = false) {
    this.endSlide(p);
    return new Promise((done) => { p.slide = { fx: p.x, fy: p.y, tx: x, ty: y, start: this.time, dur, lift, done }; });
  }

  endSlide(p) {
    if (!p?.slide) return;
    const { done } = p.slide;
    p.slide = null;
    p.lift = 0;
    done();
  }

  waitFalls() {
    let falling = false;
    B.forEachCell(this.grid, (p) => { if (p?.fall) falling = true; });
    if (!falling) return Promise.resolve();
    return new Promise((resolve) => this.fallWaiters.push(resolve));
  }

  update(dt) {
    this.time += dt;
    for (const tw of [...this.tweens]) {
      const k = clamp((this.time - tw.start) / tw.dur, 0, 1);
      tw.fn(tw.easing(k));
      if (k >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.resolve(); }
    }

    B.forEachCell(this.grid, (p) => {
      const s = p?.slide;
      if (!s) return;
      const k = clamp((this.time - s.start) / s.dur, 0, 1), e = ease.inOut(k);
      const vertical = s.ty !== null && !p.fall;
      p.x = k >= 1 ? s.tx : s.fx + (s.tx - s.fx) * e;
      if (vertical) p.y = k >= 1 ? s.ty : s.fy + (s.ty - s.fy) * e;
      p.lift = s.lift ? Math.sin(k * Math.PI) : 0;
      if (k >= 1) this.endSlide(p);
    });

    let falling = 0;
    B.forEachCell(this.grid, (p) => {
      if (!p?.fall) return;
      const f = p.fall;
      if (f.delay > 0) { f.delay -= dt; falling++; return; }
      f.vy += GRAVITY * dt / 1000;
      p.y += f.vy * dt / 1000;
      if (p.y >= f.ty) {
        p.y = f.ty;
        p.fall = null;
        p.land = this.time;
        this.audio.land();
      } else falling++;
    });
    if (!falling && this.fallWaiters.length) this.fallWaiters.splice(0).forEach((r) => r());

    for (const p of this.dying) {
      const k = (this.time - p.pop.start) / p.pop.dur;
      if (p.pop.mode === 'burst' && k >= 0.3 && !p.pop.spawned) {
        p.pop.spawned = true;
        const ramp = p.special === B.PRISM ? null : this.sprites.ramps[p.type];
        this.fx.explode(PAD + p.x * T + T / 2, PAD + p.y * T + T / 2, ramp, this.theme.particle, p.pop.big ? 16 : 9);
      }
    }
    this.dying = this.dying.filter((p) => this.time - p.pop.start < p.pop.dur);
    this.fx.update(dt / 1000);

    if (!this.hint && this.time - this.idleSince > HINT_AFTER) this.showHint(false);
  }

  // -------------------------------------------------------------- input

  bindInput() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      const cell = this.cellAt(e);
      if (!cell) { this.selected = null; return; }
      try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      this.drag = { start: cell, x: e.clientX, y: e.clientY, used: false, deselect: false };
      if (this.locked) return;
      const sel = this.selected;
      if (sel && B.adjacent(sel, cell)) {
        this.selected = null;
        this.drag.used = true;
        this.queueSwap(sel, cell);
        return;
      }
      if (sel && sel.r === cell.r && sel.c === cell.c) this.drag.deselect = true;
      else { this.selected = cell; this.audio.select(); }
    });
    cv.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.used || this.locked) return;
      const rect = cv.getBoundingClientRect();
      const cell = (T * this.layout.S) / (cv.width / rect.width);
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * 0.35) return;
      const dir = Math.abs(dx) > Math.abs(dy) ? { r: 0, c: Math.sign(dx) } : { r: Math.sign(dy), c: 0 };
      const to = { r: d.start.r + dir.r, c: d.start.c + dir.c };
      d.used = true;
      if (!B.inBounds(to.r, to.c)) return;
      this.selected = null;
      this.queueSwap(d.start, to);
    });
    const end = () => {
      if (this.drag?.deselect && !this.drag.used) this.selected = null;
      this.drag = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  cellAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / rect.width;
    const { S, ox, oy } = this.layout;
    const ax = ((e.clientX - rect.left) * k - ox) / S - PAD;
    const ay = ((e.clientY - rect.top) * k - oy) / S - PAD;
    const c = Math.floor(ax / T), r = Math.floor(ay / T);
    return B.inBounds(r, c) ? { r, c } : null;
  }

  showHint(byButton) {
    if (this.busy || this.locked || this.queue.length) return;
    const move = B.bestMove(this.grid);
    if (!move) return;
    this.hint = { ...move, since: this.time };
    if (byButton) this.audio.select();
  }

  // ---------------------------------------------------------- gameplay

  // The board as the player sees it: the real grid with every queued swap applied in order.
  viewGrid() {
    const view = this.grid.map((row) => row.slice());
    for (const { a, b } of this.queue) [view[a.r][a.c], view[b.r][b.c]] = [view[b.r][b.c], view[a.r][a.c]];
    return view;
  }

  // Swaps can be made at any time. The swap is shown right away and then
  // waits its turn; swaps are played strictly in the order they were made.
  queueSwap(a, b) {
    if (this.locked || this.queue.length >= 8) return;
    const view = this.viewGrid();
    const pa = view[a.r][a.c], pb = view[b.r][b.c];
    if (!pa || !pb || pa.fall || pb.fall) return;
    this.hint = null;
    this.audio.swap();
    const move = { a, b, pa, pb };
    move.shown = Promise.all([this.slideTo(pa, b.c, b.r, 140, true), this.slideTo(pb, a.c, a.r, 140)]);
    this.queue.push(move);
    this.pump();
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length && !this.locked) {
      const move = this.queue[0];
      await move.shown;
      if (this.queue[0] === move) await this.play(move);
    }
    this.busy = false;
    this.idleSince = this.time;
  }

  // Re-checks the queued swaps against the board as it is now. A swap stays
  // only while both of its pieces are still where the player swapped them
  // (counting the swaps queued before it), so when a cascade destroys or moves
  // them, that swap and every later one built on it is undone immediately.
  revalidate() {
    const view = this.grid.map((row) => row.slice());
    const kept = [];
    for (const m of this.queue) {
      if (view[m.a.r][m.a.c] !== m.pa || view[m.b.r][m.b.c] !== m.pb) continue;
      view[m.a.r][m.a.c] = m.pb;
      view[m.b.r][m.b.c] = m.pa;
      kept.push(m);
    }
    if (kept.length < this.queue.length) this.audio.cancel();
    this.queue = kept;
    // glide everything to where it should now be shown; falling pieces only fix their column
    B.forEachCell(view, (p, r, c) => {
      if (!p) return;
      const goalX = p.slide ? p.slide.tx : p.x;
      const goalY = p.slide && p.slide.ty !== null ? p.slide.ty : p.y;
      if (p.fall) { if (Math.abs(goalX - c) > 1e-6) this.slideTo(p, c, null, 160); return; }
      if (Math.abs(goalX - c) > 1e-6 || Math.abs(goalY - r) > 1e-6) this.slideTo(p, c, r, 160);
    });
  }

  async play(move) {
    const { a, b, pa, pb } = move;
    this.grid[b.r][b.c] = pa;
    this.grid[a.r][a.c] = pb;
    this.queue.shift();

    this.turnPoints = 0;
    let chain = 0;
    const combo = B.comboFor(this.grid, a, b);
    if (combo) {
      chain = 1;
      await this.playCombo(combo);
      await this.dropAndFill(chain);
      chain = await this.cascade(chain, []);
    } else if (B.findMatches(this.grid).length) {
      chain = await this.cascade(0, [B.key(b.r, b.c), B.key(a.r, a.c)]);
    } else {
      // no match: swap back, which also undoes any later swap that relied on this one
      this.grid[a.r][a.c] = pa;
      this.grid[b.r][b.c] = pb;
      this.audio.invalid();
      this.revalidate();
      await this.wait(170);
      return;
    }
    await this.endTurn(chain);
  }

  async cascade(chain, prefer) {
    for (;;) {
      const groups = B.findMatches(this.grid);
      if (!groups.length) return chain;
      chain++;
      await this.clearGroups(groups, chain, prefer);
      prefer = [];
      await this.dropAndFill(chain);
    }
  }

  async clearGroups(groups, chain, prefer) {
    const creations = [];
    const protect = new Set();
    for (const g of groups) {
      const special = B.specialFor(g);
      if (!special) continue;
      const k = B.pickSpecialCell(this.grid, g, prefer);
      if (k === null || protect.has(k)) continue;
      protect.add(k);
      creations.push({ k, special, group: g });
    }
    const merges = new Map();
    for (const cr of creations) for (const k of cr.group.cells) if (k !== cr.k) merges.set(k, cr.k);

    const { waves } = B.resolveDetonations(this.grid, groups.flatMap((g) => g.cells), { protect });

    let biggest = 3;
    for (const g of groups) {
      const n = g.cells.length;
      biggest = Math.max(biggest, g.maxLen + (g.corner.length ? 1 : 0));
      const bonus = n >= 5 ? 100 : n === 4 ? 30 : 0;
      const mx = g.cells.reduce((s, k) => s + B.colOf(k), 0) / n;
      const my = g.cells.reduce((s, k) => s + B.rowOf(k), 0) / n;
      this.addPoints((n * 10 + bonus) * chain, PAD + (mx + 0.5) * T, PAD + (my + 0.5) * T, this.sprites.ramps[g.type][4]);
    }
    this.audio.match(chain, biggest);
    if (chain >= 2) this.chainWord(chain);

    await this.playWaves(waves, chain, merges);

    for (const cr of creations) {
      const p = this.grid[B.rowOf(cr.k)][B.colOf(cr.k)];
      if (!p) continue;
      p.special = cr.special;
      if (cr.special === B.PRISM) p.type = -1;
      p.born = this.time;
      const x = cx(B.colOf(cr.k)), y = cy(B.rowOf(cr.k));
      this.fx.ring(x, y, this.theme.board.frame, 14, 0.35);
      for (let i = 0; i < 6; i++) this.fx.sparkle(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 16);
      this.audio.create();
      if (cr.special === B.PRISM) this.fx.burst(x, y - 6, pick(this.theme.words.create), { size: 6, fill: '#7dff7a' });
    }
    if (creations.length) await this.wait(120);
  }

  async playWaves(waves, chain, merges = new Map()) {
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      for (const ev of w.events) this.playEvent(ev, chain);
      let blasted = 0;
      const removed = [];
      for (const k of w.cells) {
        const r = B.rowOf(k), c = B.colOf(k);
        if (!this.grid[r][c]) continue;
        removed.push([k, this.grid[r][c], r, c]);
        this.grid[r][c] = null;
      }
      if (this.queue.length) this.revalidate();
      for (const [k, p, r, c] of removed) {
        // a queued swap may have been showing this piece elsewhere: it pops where it really is
        this.endSlide(p);
        p.x = c; p.y = r;
        if (merges.has(k) && p.special === B.NONE) {
          const to = merges.get(k);
          this.kill(p, 'merge', 0, { tx: B.colOf(to), ty: B.rowOf(to) });
        } else {
          this.kill(p, 'burst', i ? Math.random() * 60 : 0, { big: p.special !== B.NONE });
          if (i) blasted++;
        }
      }
      if (blasted) {
        const ev = waves[i - 1].events[0];
        this.addPoints(blasted * 20 * chain, ev ? cx(ev.c) : ART / 2, ev ? cy(ev.r) : ART / 2, '#ffd23f');
      }
      this.stats.popped += w.cells.length;
      await this.wait(i === 0 ? 150 : 120);
    }
    await this.wait(150);
  }

  kill(p, mode, delay = 0, extra = {}) {
    this.endSlide(p);
    p.pop = { start: this.time + delay, dur: mode === 'merge' ? 170 : 300, mode, spawned: false, ...extra };
    p.fall = null;
    this.dying.push(p);
  }

  playEvent(ev, chain) {
    const x = cx(ev.c), y = cy(ev.r);
    const words = this.theme.words;
    const colour = ev.type >= 0 ? this.sprites.ramps[ev.type][4] : '#ffffff';
    const buzz = (ms) => { if (this.vibrate && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(ms); };
    switch (ev.kind) {
      case 'nova': {
        const big = ev.radius > 1;
        this.fx.ring(x, y, colour, big ? 52 : 30, big ? 0.5 : 0.35, 3);
        this.fx.ring(x, y, '#ffffff', big ? 36 : 20, 0.25);
        this.fx.explode(x, y, ev.type >= 0 ? this.sprites.ramps[ev.type] : null, this.theme.particle, big ? 40 : 22, big ? 2 : 1.4);
        this.fx.kick(big ? 7 : 4, big ? 0.4 : 0.18);
        this.fx.burst(x, y, pick(words.nova), { size: big ? 9 : 7 });
        this.audio.nova(big ? 2 : 1);
        buzz(big ? 80 : 40);
        break;
      }
      case 'cross':
      case 'cross3': {
        const rows = ev.kind === 'cross' ? [ev.r] : [ev.r - 1, ev.r, ev.r + 1];
        const cols = ev.kind === 'cross' ? [ev.c] : [ev.c - 1, ev.c, ev.c + 1];
        for (const r of rows) if (r >= 0 && r < B.SIZE) this.fx.beam(PAD, cy(r), PAD + B.SIZE * T, cy(r), colour);
        for (const c of cols) if (c >= 0 && c < B.SIZE) this.fx.beam(cx(c), PAD, cx(c), PAD + B.SIZE * T, colour);
        this.fx.kick(ev.kind === 'cross' ? 3 : 6, ev.kind === 'cross' ? 0.12 : 0.3);
        this.fx.burst(x, y, pick(words.cross), { size: ev.kind === 'cross' ? 7 : 9, fill: '#5ee7ff' });
        this.audio.zap();
        buzz(30);
        break;
      }
      case 'prism': {
        for (const k of ev.cells.slice(0, 40)) this.fx.bolt(x, y, cx(B.colOf(k)), cy(B.rowOf(k)), colour);
        this.fx.kick(4, 0.25, colour);
        this.fx.burst(x, y, pick(words.prism), { size: 8, fill: '#ff8fd0', text: '#ffffff' });
        this.audio.prism();
        buzz(60);
        break;
      }
      case 'prism2': {
        this.fx.kick(9, 0.8);
        for (let i = 0; i < 4; i++) this.fx.ring(x, y, ['#ff4d6d', '#ffd23f', '#5ee7ff', '#b468f0'][i], 40 + i * 25, 0.4 + i * 0.12, 3);
        this.fx.burst(ART / 2, ART / 2, pick(words.mega), { size: 10, fill: '#ffd23f', text: '#ff3d6e' });
        this.audio.mega();
        buzz(150);
        break;
      }
      default: break;
    }
  }

  async playCombo(combo) {
    if (combo.transforms.length) {
      // let the converted pieces visibly light up before they go off
      const ev = combo.events[0];
      for (const t of combo.transforms) {
        const p = this.grid[B.rowOf(t.k)][B.colOf(t.k)];
        if (p) p.born = this.time;
        this.fx.bolt(cx(ev.c), cy(ev.r), cx(B.colOf(t.k)), cy(B.rowOf(t.k)), '#ffffff', 0.35);
      }
      this.audio.prism();
      await this.wait(380);
    }
    const { waves } = B.resolveDetonations(this.grid, combo.start, { detonated: combo.detonated, events: combo.events });
    await this.playWaves(waves, 1);
  }

  async dropAndFill(chain) {
    const moved = B.collapse(this.grid);
    for (const m of moved) m.piece.fall = { vy: 1, ty: m.to, delay: 0 };
    const added = B.smartFill(this.grid, Math.random, { chain });
    const perCol = new Map();
    for (const a of added) perCol.set(a.c, (perCol.get(a.c) || 0) + 1);
    for (const a of added) {
      this.dress(a.piece, a.r, a.c);
      a.piece.y = a.r - perCol.get(a.c) - 0.4;
      a.piece.fall = { vy: 1, ty: a.r, delay: a.c * 10 };
    }
    if (this.queue.length) this.revalidate();
    await this.waitFalls();
  }

  async endTurn(chain) {
    this.stats.bestChain = Math.max(this.stats.bestChain, chain);
    this.stats.bestMove = Math.max(this.stats.bestMove, this.turnPoints);
    if (this.turnPoints >= 1500) this.fx.confetti(ART, ART, 50);
    if (!B.countMoves(this.grid, 1)) await this.reshuffle();
    this.save();
  }

  async reshuffle() {
    // every pending swap refers to the old layout
    this.queue.length = 0;
    this.locked = true;
    B.forEachCell(this.grid, (p) => this.endSlide(p));
    this.fx.burst(ART / 2, ART / 2, 'SHUFFLE!', { size: 9, fill: '#5ee7ff' });
    this.audio.shuffle();
    await this.wait(400);
    const next = B.shuffle(this.grid);
    const from = new Map();
    B.forEachCell(this.grid, (p, r, c) => from.set(p, { r, c }));
    this.grid = next;
    const moves = [];
    B.forEachCell(next, (p, r, c) => moves.push({ p, a: from.get(p), r, c }));
    await this.anim(600, (k) => {
      for (const m of moves) {
        const swirl = Math.sin(k * Math.PI) * 1.5;
        m.p.x = m.a.c + (m.c - m.a.c) * k + Math.cos(m.p.phase * 6.28) * swirl;
        m.p.y = m.a.r + (m.r - m.a.r) * k + Math.sin(m.p.phase * 6.28) * swirl;
      }
    }, ease.inOut);
    this.locked = false;
  }

  chainWord(chain) {
    const word = CHAIN_WORDS[Math.min(chain, CHAIN_WORDS.length - 1)];
    const fills = ['#ffd23f', '#7dff7a', '#5ee7ff', '#ff8fd0', '#ff9a3c'];
    this.fx.burst(ART / 2, PAD + 24, word, { size: Math.min(10, 7 + chain * 0.4), fill: fills[chain % fills.length], sub: `CHAIN x${chain}` });
  }

  addPoints(pts, x, y, colour = '#ffffff') {
    if (!pts) return;
    this.score += pts;
    this.turnPoints = (this.turnPoints || 0) + pts;
    this.levelScore += pts;
    this.fx.popup(x, y, `+${pts}`, colour);
    while (this.levelScore >= levelTarget(this.level)) {
      this.levelScore -= levelTarget(this.level);
      this.level++;
      this.stats.bestLevel = Math.max(this.stats.bestLevel, this.level);
      this.fx.burst(ART / 2, ART / 2 + 20, 'LEVEL UP!', { size: 9, fill: '#7dff7a', text: '#ffffff', sub: `LEVEL ${this.level}`, life: 1.4 });
      this.fx.confetti(ART, ART, 70);
      this.audio.levelUp();
      this.hooks.levelUp?.(this.level);
    }
    if (this.score > this.stats.best) {
      this.stats.best = this.score;
      if (!this.announcedBest && this.bestAtStart > 0) {
        this.announcedBest = true;
        this.fx.burst(ART / 2, ART / 2 - 20, 'NEW BEST!', { size: 9, fill: '#ff8fd0', text: '#ffffff', life: 1.5 });
        this.fx.confetti(ART, ART, 80);
        this.audio.highscore();
      }
    }
    this.notify();
  }

  // ------------------------------------------------------------- render

  resize(cssW, cssH, dpr) {
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    this.canvas.width = w; this.canvas.height = h;
    let S = Math.min(w, h) / ART;
    // whole-number scaling keeps every art pixel the same size when it costs little space
    if (S >= 2 && Math.floor(S) / S > 0.86) S = Math.floor(S);
    this.layout = { S, ox: Math.round((w - ART * S) / 2), oy: Math.round((h - ART * S) / 2) };
  }

  buildFrame() {
    const c = document.createElement('canvas');
    c.width = c.height = ART;
    const ctx = c.getContext('2d');
    const { a, b, frame, light, dark } = this.theme.board;
    const rect = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
    // chunky comic frame with pixel-cut corners
    rect(2, 0, ART - 4, ART, INK); rect(0, 2, ART, ART - 4, INK); rect(1, 1, ART - 2, ART - 2, INK);
    rect(2, 2, ART - 4, ART - 4, frame);
    rect(2, 2, ART - 4, 1, light); rect(2, 2, 1, ART - 4, light);
    rect(2, ART - 3, ART - 4, 1, dark); rect(ART - 3, 2, 1, ART - 4, dark);
    rect(PAD - 1, PAD - 1, B.SIZE * T + 2, B.SIZE * T + 2, INK);
    for (const [x, y] of [[3, 3], [ART - 5, 3], [3, ART - 5], [ART - 5, ART - 5]]) { rect(x, y, 2, 2, light); rect(x + 1, y + 1, 1, 1, dark); }
    for (let r = 0; r < B.SIZE; r++) {
      for (let col = 0; col < B.SIZE; col++) rect(PAD + col * T, PAD + r * T, T, T, (r + col) % 2 ? b : a);
    }
    // halftone speckle on the tiles
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = PAD; y < PAD + B.SIZE * T; y += 3) for (let x = PAD + (y % 2); x < PAD + B.SIZE * T; x += 4) ctx.fillRect(x, y, 1, 1);
    return c;
  }

  render() {
    const s = this.sctx;
    s.imageSmoothingEnabled = false;
    s.clearRect(0, 0, ART, ART);
    s.drawImage(this.frame, 0, 0);
    this.drawMarkers(s);

    s.save();
    s.beginPath();
    s.rect(PAD, PAD, B.SIZE * T, B.SIZE * T);
    s.clip();
    const sel = this.selected && this.viewGrid()[this.selected.r][this.selected.c];
    B.forEachCell(this.grid, (p) => { if (p && p !== sel) this.drawPiece(s, p); });
    if (sel) this.drawPiece(s, sel, true);
    for (const p of this.dying) this.drawPiece(s, p);
    s.restore();

    this.fx.drawScene(s, ART, ART);

    const ctx = this.ctx;
    const { S, ox, oy } = this.layout;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const dx = ox + this.fx.offset.x * S, dy = oy + this.fx.offset.y * S;
    ctx.drawImage(this.scene, dx, dy, ART * S, ART * S);
    this.fx.drawText(ctx, S, dx, dy);
  }

  drawMarkers(s) {
    const t = this.time;
    const bracket = (r, c, col, gap) => {
      const x = PAD + c * T - gap, y = PAD + r * T - gap, w = T + gap * 2;
      s.fillStyle = col;
      for (const [bx, by, sx, sy] of [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + w - 1, 1, -1], [x + w - 1, y + w - 1, -1, -1]]) {
        s.fillRect(bx, by, 4 * sx || 1, 1 * sy || 1);
        s.fillRect(bx, by, 1 * sx || 1, 4 * sy || 1);
      }
    };
    if (this.selected) {
      const { r, c } = this.selected;
      s.fillStyle = 'rgba(255,255,255,0.18)';
      s.fillRect(PAD + c * T, PAD + r * T, T, T);
      bracket(r, c, Math.floor(t / 180) % 2 ? '#ffffff' : this.theme.board.frame, 0);
    }
    // queued swaps waiting their turn: small corner ticks, brighter for the next one up
    this.queue.forEach((m, i) => {
      s.fillStyle = i === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)';
      for (const { r, c } of [m.a, m.b]) {
        const x = PAD + c * T, y = PAD + r * T;
        for (const [px, py, dx, dy] of [[x + 1, y + 1, 1, 1], [x + T - 2, y + 1, -1, 1], [x + 1, y + T - 2, 1, -1], [x + T - 2, y + T - 2, -1, -1]]) {
          s.fillRect(px, py, 1, 1);
          s.fillRect(px + dx, py, 1, 1);
          s.fillRect(px, py + dy, 1, 1);
        }
      }
    });
    if (this.hint) {
      const pulse = Math.floor((t - this.hint.since) / 260) % 2;
      for (const cell of [this.hint.a, this.hint.b]) {
        s.fillStyle = pulse ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
        s.fillRect(PAD + cell.c * T, PAD + cell.r * T, T, T);
        bracket(cell.r, cell.c, pulse ? '#ffffff' : this.theme.board.frame, pulse);
      }
    }
  }

  drawPiece(s, p, selected = false) {
    const t = this.time;
    const special = p.special;
    const img = special === B.PRISM ? this.sprites.prism[Math.floor(t / 70) % this.sprites.prism.length] : this.sprites.pieces[p.type]?.img;
    if (!img) return;
    const white = special === B.PRISM ? this.sprites.prismWhite : this.sprites.pieces[p.type].white;
    const shadow = special === B.PRISM ? this.sprites.prismShadow : this.sprites.pieces[p.type].shadow;

    let x = PAD + p.x * T, y = PAD + p.y * T;
    let sx = 1, sy = 1, flash = 0, alpha = 1, anchorBottom = true;

    // idle personality per theme: every piece is always gently moving
    const idle = this.theme.idle;
    const ph = p.phase * 6.283;
    const sec = t / 1000;
    let angle = 0, pivotBottom = false;
    if (!p.pop && !p.fall) {
      if (idle === 'shine') angle = Math.sin(sec * 1.7 + ph) * 0.08;
      if (idle === 'drift') { angle = Math.sin(sec * 1.1 + ph) * 0.11; y += Math.round(Math.sin(sec * 1.4 + ph) * 0.8); }
      if (idle === 'sway') { angle = Math.sin(sec * 1.9 + ph) * 0.14 + Math.sin(sec * 0.7 + ph * 2) * 0.04; pivotBottom = true; }
      if (idle === 'wobble') {
        const w = Math.sin(sec * 3.2 + ph) * 0.06;
        sy += w; sx -= w * 0.8;
        angle = Math.sin(sec * 1.6 + ph) * 0.06; pivotBottom = true;
      }
    }

    const sinceLand = t - p.land;
    if (sinceLand < 220) {
      const k = sinceLand / 220;
      const squash = Math.sin(k * Math.PI) * (1 - k) * (idle === 'wobble' ? 0.35 : 0.2);
      sy -= squash; sx += squash * 0.8;
    }
    const sinceBorn = t - p.born;
    if (sinceBorn < 380) {
      const k = sinceBorn / 380;
      const sc = 0.4 + 0.6 * ease.back(k);
      sx *= sc; sy *= sc; flash = 1 - k; anchorBottom = false;
    }
    if (selected) y -= Math.abs(Math.sin(t / 1000 * 7)) * 2;
    if (p.lift) { sx *= 1 + p.lift * 0.15; sy *= 1 + p.lift * 0.15; anchorBottom = false; }

    if (p.pop) {
      const k = (t - p.pop.start) / p.pop.dur;
      anchorBottom = false;
      if (k < 0) { /* waiting for its turn in a chain reaction */ } else if (p.pop.mode === 'merge') {
        const e = ease.inOut(clamp(k, 0, 1));
        x += (PAD + p.pop.tx * T - x) * e;
        y += (PAD + p.pop.ty * T - y) * e;
        sx = sy = 1 - 0.5 * e; alpha = 1 - e * 0.6; flash = e;
      } else if (k < 0.3) {
        sx = sy = 1 + 0.3 * (k / 0.3); flash = k / 0.3;
      } else {
        const e = (k - 0.3) / 0.7;
        sx = sy = 1.3 * (1 - e); flash = 1; alpha = 1 - e * 0.3;
      }
    }

    const w = Math.max(1, Math.round(T * sx)), h = Math.max(1, Math.round(T * sy));
    const dx = Math.round(x + (T - w) / 2);
    const dy = Math.round(anchorBottom ? y + (T - h) : y + (T - h) / 2);

    // every layer of the sprite goes through the same (possibly rotated) blit
    const blit = (image, a, ox = 0, oy = 0) => {
      s.globalAlpha = a;
      if (!angle) { s.drawImage(image, dx + ox, dy + oy, w, h); return; }
      s.save();
      s.translate(dx + w / 2 + ox, (pivotBottom ? dy + h : dy + h / 2) + oy);
      s.rotate(angle);
      s.drawImage(image, -w / 2, pivotBottom ? -h : -h / 2, w, h);
      s.restore();
    };

    if ((special === B.NOVA || special === B.CROSS) && !p.pop) this.drawSpecialBack(s, p, dx, dy, w, h);
    blit(shadow, alpha * 0.35, 1, 1);
    blit(img, alpha);

    if (idle === 'shine' && !p.pop && special !== B.PRISM) {
      const cycle = (sec + p.phase * 9) % 4;
      const frames = this.sprites.pieces[p.type].shine;
      if (cycle < 0.5) blit(frames[Math.floor((cycle / 0.5) * frames.length)], 0.75);
    }

    if (special === B.NOVA || special === B.CROSS) this.drawSpecialAura(s, p, dx, dy, w, h);
    if (flash > 0) blit(white, Math.min(1, flash) * alpha);
    s.globalAlpha = 1;
    if (!p.pop && !p.fall) this.drawTwinkle(s, p, dx, dy, w, h);
  }

  // A little four-point star that keeps popping up on a bright spot of each
  // piece, so the board always glitters a bit.
  drawTwinkle(s, p, dx, dy, w, h) {
    const PERIOD = 2.2, SHOW = 0.55;
    const cyc = this.time / 1000 / PERIOD + p.phase * 7;
    const n = Math.floor(cyc);
    const k = ((cyc - n) * PERIOD) / SHOW;
    if (k >= 1) return;
    const spots = p.special === B.PRISM ? this.sprites.prismSpots : this.sprites.pieces[p.type].spots;
    const [sx, sy] = spots[Math.abs((p.id * 7919 + n * 104729) | 0) % spots.length];
    const x = Math.round(dx + (sx * w) / T), y = Math.round(dy + (sy * h) / T);
    const arm = k < 0.2 ? 0 : k < 0.45 ? 1 : k < 0.75 ? 2 : 1;
    const tint = p.special === B.PRISM ? '#fff6c8' : this.sprites.ramps[p.type][5];
    s.fillStyle = tint;
    for (let i = 1; i <= arm; i++) {
      s.fillRect(x - i, y, 1, 1); s.fillRect(x + i, y, 1, 1);
      s.fillRect(x, y - i, 1, 1); s.fillRect(x, y + i, 1, 1);
    }
    s.fillStyle = '#ffffff';
    s.fillRect(x, y, 1, 1);
    if (arm === 2) { s.fillRect(x - 1, y, 3, 1); s.fillRect(x, y - 1, 1, 3); }
  }

  // glow drawn underneath a special piece so it reads at a glance
  drawSpecialBack(s, p, dx, dy, w, h) {
    const t = this.time / 1000;
    const ramp = this.sprites.ramps[p.type];
    const mx = Math.round(dx + w / 2), my = Math.round(dy + h / 2);
    const pulse = 0.5 + 0.5 * Math.sin(t * 6 + p.phase * 6);
    if (p.special === B.NOVA) {
      const rad = 8 + Math.round(pulse * 2);
      s.fillStyle = ramp[3];
      s.globalAlpha = 0.55;
      for (let y = -rad; y <= rad; y++) {
        const half = Math.round(Math.sqrt(rad * rad - y * y));
        s.fillRect(mx - half, my + y, half * 2, 1);
      }
      s.globalAlpha = 1;
      s.fillStyle = ramp[5];
      const steps = 40;
      for (let i = 0; i < steps; i++) {
        if ((i + Math.floor(t * 12)) % 4 === 0) continue;
        const a = (i / steps) * Math.PI * 2;
        s.fillRect(Math.round(mx + Math.cos(a) * rad), Math.round(my + Math.sin(a) * rad), 1, 1);
      }
    } else {
      s.globalAlpha = 0.35 + pulse * 0.35;
      s.fillStyle = ramp[4];
      s.fillRect(dx - 1, my - 2, w + 2, 4);
      s.fillRect(mx - 2, dy - 1, 4, h + 2);
      s.fillStyle = '#ffffff';
      s.fillRect(dx - 1, my - 1, w + 2, 1);
      s.fillRect(mx - 1, dy - 1, 1, h + 2);
      s.globalAlpha = 1;
    }
  }

  drawSpecialAura(s, p, dx, dy, w, h) {
    const t = this.time / 1000;
    const ramp = this.sprites.ramps[p.type];
    const mx = dx + w / 2, my = dy + h / 2;
    const glow = 0.15 + 0.2 * Math.sin(t * 8 + p.phase * 6);
    s.globalAlpha = Math.max(0, glow);
    s.drawImage(this.sprites.pieces[p.type].white, dx, dy, w, h);
    s.globalAlpha = 1;
    if (p.special === B.NOVA) {
      // four sparks orbiting the piece
      for (let i = 0; i < 4; i++) {
        const a = t * 3.5 + i * (Math.PI / 2);
        const ox = Math.round(mx + Math.cos(a) * 8), oy = Math.round(my + Math.sin(a) * 8);
        s.fillStyle = INK;
        s.fillRect(ox - 2, oy - 1, 5, 3); s.fillRect(ox - 1, oy - 2, 3, 5);
        s.fillStyle = ramp[5];
        s.fillRect(ox - 1, oy, 3, 1); s.fillRect(ox, oy - 1, 1, 3);
        s.fillStyle = '#ffffff';
        s.fillRect(ox, oy, 1, 1);
      }
    } else {
      // arrows pulsing outward along the row and column it will clear
      const k = (t * 2.5) % 1;
      const d = Math.round(7 + k * 2);
      for (const [ax, ay] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const px = Math.round(mx + ax * d), py = Math.round(my + ay * d);
        const pts = [[ax, ay], [0, 0], [-ay, ax], [ay, -ax], [-ay * 2 - ax, ax * 2 - ay], [ay * 2 - ax, -ax * 2 - ay]];
        s.fillStyle = INK;
        for (const [qx, qy] of pts) s.fillRect(px + qx - 1, py + qy - 1, 3, 3);
        s.fillStyle = k < 0.5 ? '#ffffff' : ramp[5];
        for (const [qx, qy] of pts) s.fillRect(px + qx, py + qy, 1, 1);
      }
    }
  }
}

export { ART };
