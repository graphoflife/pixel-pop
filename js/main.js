// App shell: persistence, HUD, menus, theme switching and the frame loop.

import { Game } from './game.js';
import { Audio } from './audio.js';
import { THEMES, THEME_ORDER, makeBackground } from './themes.js';
import { themeSprites, SPR } from './sprites.js';

const KEY = 'pixelpop.v1';
const DEFAULTS = {
  settings: { theme: 'jewels', sfx: true, music: true, vibrate: true },
  stats: { best: 0, bestMove: 0, bestChain: 0, bestLevel: 1, popped: 0, games: 1 },
};

function load() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch { /* storage unavailable */ }
  return {
    settings: { ...DEFAULTS.settings, ...d?.settings },
    stats: { ...DEFAULTS.stats, ...d?.stats },
    game: d?.game ?? null,
  };
}

const data = load();
if (!THEMES[data.settings.theme]) data.settings.theme = 'jewels';
const persist = () => {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode etc. */ }
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString('en-US');

// ---------------------------------------------------------------- HUD

const hud = {
  shown: 0,
  target: 0,
  set({ score, best, level, progress }) {
    if (score > this.target) {
      $('score').classList.remove('bump');
      void $('score').offsetWidth;
      $('score').classList.add('bump');
    }
    this.target = score;
    if (score < this.shown) this.shown = score;
    $('best').textContent = fmt(best);
    $('level').textContent = level;
    $('bar').style.width = `${Math.min(100, progress * 100)}%`;
  },
  tick(dt) {
    if (this.shown === this.target) return;
    this.shown = Math.min(this.target, this.shown + Math.max(1, (this.target - this.shown) * Math.min(1, dt * 8)));
    $('score').textContent = fmt(this.shown);
  },
};

// --------------------------------------------------------------- game

const audio = new Audio();
audio.sfxOn = data.settings.sfx;
audio.musicOn = data.settings.music;

const game = new Game({
  canvas: $('board'),
  audio,
  hooks: {
    save(g) { data.game = g; persist(); },
    score(s) { hud.set(s); },
  },
});
game.vibrate = data.settings.vibrate;

// ---------------------------------------------------------- background

const bgCanvas = $('bg');
const bgCtx = bgCanvas.getContext('2d');
let bg = null;
let bgTime = 0;
const BG_PIXEL = 3; // css pixels per background pixel

function sizeBackground() {
  const w = Math.ceil(window.innerWidth / BG_PIXEL), h = Math.ceil(window.innerHeight / BG_PIXEL);
  bgCanvas.width = w; bgCanvas.height = h;
  bg?.resize(w, h);
}

// -------------------------------------------------------------- themes

function previewCanvas(themeId, count = 7, gap = 2) {
  const set = themeSprites(themeId);
  const c = document.createElement('canvas');
  c.width = count * (SPR + gap) + gap;
  c.height = SPR + gap * 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = THEMES[themeId].board.a;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < count; i++) ctx.drawImage(set.pieces[i].img, gap + i * (SPR + gap), gap);
  return c;
}

function applyTheme(id) {
  data.settings.theme = id;
  persist();
  document.body.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', getComputedStyle(document.body).getPropertyValue('--bg').trim());
  game.setTheme(id);
  bg = makeBackground(id);
  sizeBackground();
  document.querySelectorAll('[data-theme-id]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.themeId === id)));
}

function buildThemePickers() {
  const grid = $('theme-grid');
  const pills = $('splash-themes');
  for (const id of THEME_ORDER) {
    const card = document.createElement('button');
    card.className = 'theme-card';
    card.dataset.themeId = id;
    card.append(previewCanvas(id));
    const name = document.createElement('b'); name.textContent = THEMES[id].name.toUpperCase();
    const blurb = document.createElement('small'); blurb.textContent = THEMES[id].blurb;
    card.append(name, blurb);
    card.addEventListener('click', () => { audio.unlock(); applyTheme(id); audio.select(); });
    grid.append(card);

    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.dataset.themeId = id;
    pill.textContent = THEMES[id].name.toUpperCase();
    pill.addEventListener('click', () => { audio.unlock(); applyTheme(id); audio.select(); });
    pills.append(pill);
  }
}

// ------------------------------------------------------------- overlays

function open(id) { $(id).classList.remove('hidden'); }
function close(id) { $(id).classList.add('hidden'); }

function fillRecords() {
  const s = data.stats;
  $('rec-best').textContent = fmt(s.best);
  $('rec-move').textContent = fmt(s.bestMove);
  $('rec-chain').textContent = s.bestChain ? `x${s.bestChain}` : '-';
  $('rec-level').textContent = s.bestLevel;
  $('rec-popped').textContent = fmt(s.popped);
}

function syncSoundToggles() {
  $('opt-sfx').checked = data.settings.sfx;
  $('opt-music').checked = data.settings.music;
  $('opt-vibrate').checked = data.settings.vibrate;
}

function setSound(sfx, music) {
  data.settings.sfx = sfx;
  data.settings.music = music;
  audio.setSfx(sfx);
  audio.setMusic(music);
  syncSoundToggles();
  persist();
}

function wireUi() {
  $('btn-hint').addEventListener('click', () => { audio.unlock(); game.showHint(true); });
  $('btn-menu').addEventListener('click', () => { audio.unlock(); fillRecords(); open('menu'); });
  $('btn-new').addEventListener('click', () => { close('menu'); open('confirm'); });
  $('btn-confirm-new').addEventListener('click', async () => {
    close('confirm');
    await game.newGame();
    persist();
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('.overlay').classList.add('hidden')));
  document.querySelectorAll('#menu, #confirm').forEach((o) => o.addEventListener('pointerdown', (e) => { if (e.target === o) o.classList.add('hidden'); }));

  $('opt-sfx').addEventListener('change', (e) => setSound(e.target.checked, data.settings.music));
  $('opt-music').addEventListener('change', (e) => setSound(data.settings.sfx, e.target.checked));
  $('opt-vibrate').addEventListener('change', (e) => {
    data.settings.vibrate = game.vibrate = e.target.checked;
    persist();
    if (e.target.checked) navigator.vibrate?.(30);
  });

  $('btn-play').addEventListener('click', () => {
    audio.unlock();
    close('splash');
    splashOpen = false;
    game.intro();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('#menu, #confirm').forEach((o) => o.classList.add('hidden'));
    if (e.key === 'h' || e.key === 'H') game.showHint(true);
  });

  // iOS only unlocks audio inside touchend/click handlers
  for (const type of ['touchend', 'click']) document.addEventListener(type, () => audio.unlock(), { passive: true });
  $('board').addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { audio.suspend(); persist(); } else audio.resume();
  });
  window.addEventListener('pagehide', persist);
}

// --------------------------------------------------------------- layout

const stage = $('stage');
function layout() {
  const rect = stage.getBoundingClientRect();
  const size = Math.floor(Math.min(rect.width, rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cv = $('board');
  cv.style.width = `${size}px`;
  cv.style.height = `${size}px`;
  game.resize(size, size, dpr);
}
new ResizeObserver(layout).observe(stage);
// zooming changes devicePixelRatio without resizing the stage
window.addEventListener('resize', () => { layout(); sizeBackground(); });

// ---------------------------------------------------------- splash parade

let splashOpen = true;
const parade = $('parade');
const paradeCtx = parade.getContext('2d');
function drawParade(t) {
  const set = themeSprites(data.settings.theme);
  paradeCtx.clearRect(0, 0, parade.width, parade.height);
  for (let i = 0; i < 7; i++) {
    const y = 8 + Math.round(Math.sin(t * 4 + i * 0.8) * 4);
    paradeCtx.drawImage(set.pieces[i].shadow, 4 + i * 23 + 1, y + 1);
    paradeCtx.drawImage(set.pieces[i].img, 4 + i * 23, y);
  }
}

// ----------------------------------------------------------------- loop

let last = performance.now();
function frame(now) {
  const dt = Math.min(50, now - last);
  last = now;
  bgTime += dt / 1000;
  if (bg) bg.draw(bgCtx, bgTime, dt / 1000);
  if (splashOpen) drawParade(bgTime);
  game.update(dt);
  game.render();
  hud.tick(dt / 1000);
  requestAnimationFrame(frame);
}

// ----------------------------------------------------------------- boot

buildThemePickers();
wireUi();
applyTheme(data.settings.theme);
syncSoundToggles();
game.start(data.game, data.stats);
// hide the board until PLAY drops it in
game.grid.flat().forEach((p) => { p.y = -20; });
$('splash-best').textContent = fmt(data.stats.best);
$('btn-play').textContent = data.game ? 'CONTINUE' : 'PLAY';
hud.shown = hud.target;
$('score').textContent = fmt(hud.shown);
layout();
document.fonts?.load('10px "Press Start 2P"');
if (new URLSearchParams(location.search).has('debug')) window.game = game;
requestAnimationFrame(frame);
