// Pure match-3 rules: matching, specials, chain reactions, move search and
// the "smart" refill that keeps the board playable. No DOM access here, so
// this module also runs under Node for the tests.

export const SIZE = 8;
export const TYPES = 7;

export const NONE = 0;
export const NOVA = 1;   // 4 in a line  -> blasts a 3x3 area
export const CROSS = 2;  // L / T shape  -> clears its row and column
export const PRISM = 3;  // 5 in a line  -> wildcard, clears one whole colour

let nextId = 1;
export function makePiece(type, special = NONE) {
  return { id: nextId++, type, special };
}

export const key = (r, c) => r * SIZE + c;
export const rowOf = (k) => Math.floor(k / SIZE);
export const colOf = (k) => k % SIZE;
export const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
export const adjacent = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

const randInt = (rng, n) => Math.floor(rng() * n);
const sameColour = (p, t) => !!p && t >= 0 && p.type === t;

export function emptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

export function forEachCell(grid, fn) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) fn(grid[r][c], r, c);
}

// ---------------------------------------------------------------- matching

// Length of the horizontal and vertical colour runs passing through (r, c).
export function runsAt(grid, r, c) {
  const p = grid[r][c];
  if (!p || p.type < 0) return { h: 0, v: 0 };
  const t = p.type;
  let l = c, rr = c, u = r, d = r;
  while (l > 0 && sameColour(grid[r][l - 1], t)) l--;
  while (rr < SIZE - 1 && sameColour(grid[r][rr + 1], t)) rr++;
  while (u > 0 && sameColour(grid[u - 1][c], t)) u--;
  while (d < SIZE - 1 && sameColour(grid[d + 1][c], t)) d++;
  return { h: rr - l + 1, v: d - u + 1 };
}

// All match groups on the board. Runs that share a cell are merged into one
// group, which is how L, T and + shapes are recognised.
export function findMatches(grid) {
  const runs = [];
  for (let r = 0; r < SIZE; r++) {
    let c = 0;
    while (c < SIZE) {
      const p = grid[r][c];
      let e = c;
      if (p && p.type >= 0) while (e + 1 < SIZE && sameColour(grid[r][e + 1], p.type)) e++;
      if (p && p.type >= 0 && e - c >= 2) {
        const cells = [];
        for (let i = c; i <= e; i++) cells.push(key(r, i));
        runs.push({ dir: 'h', type: p.type, cells });
      }
      c = e + 1;
    }
  }
  for (let c = 0; c < SIZE; c++) {
    let r = 0;
    while (r < SIZE) {
      const p = grid[r][c];
      let e = r;
      if (p && p.type >= 0) while (e + 1 < SIZE && sameColour(grid[e + 1][c], p.type)) e++;
      if (p && p.type >= 0 && e - r >= 2) {
        const cells = [];
        for (let i = r; i <= e; i++) cells.push(key(i, c));
        runs.push({ dir: 'v', type: p.type, cells });
      }
      r = e + 1;
    }
  }
  if (!runs.length) return [];

  const parent = runs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  runs.forEach((run, i) => {
    for (const k of run.cells) {
      if (owner.has(k)) parent[find(i)] = find(owner.get(k));
      else owner.set(k, i);
    }
  });

  const byRoot = new Map();
  runs.forEach((run, i) => {
    const root = find(i);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(run);
  });

  return [...byRoot.values()].map((groupRuns) => {
    const cells = [...new Set(groupRuns.flatMap((run) => run.cells))];
    const hCells = new Set(groupRuns.filter((run) => run.dir === 'h').flatMap((run) => run.cells));
    const vCells = new Set(groupRuns.filter((run) => run.dir === 'v').flatMap((run) => run.cells));
    const longest = groupRuns.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
    return {
      type: groupRuns[0].type,
      cells,
      runs: groupRuns,
      longest,
      maxLen: longest.cells.length,
      corner: cells.filter((k) => hCells.has(k) && vCells.has(k)),
    };
  });
}

export function specialFor(group) {
  if (group.maxLen >= 5) return PRISM;
  if (group.corner.length) return CROSS;
  if (group.maxLen === 4) return NOVA;
  return NONE;
}

// Where a newly earned special appears: on the piece the player moved if it is
// part of the group, else on the corner of an L/T, else mid-run. Cells that
// already hold a special are avoided because those are about to detonate.
export function pickSpecialCell(grid, group, preferKeys = []) {
  const free = (k) => grid[rowOf(k)][colOf(k)]?.special === NONE;
  for (const k of preferKeys) if (group.cells.includes(k) && free(k)) return k;
  for (const k of group.corner) if (free(k)) return k;
  const run = group.longest.cells;
  const mid = Math.floor((run.length - 1) / 2);
  const order = run.map((k, i) => [k, Math.abs(i - mid)]).sort((a, b) => a[1] - b[1]);
  for (const [k] of order) if (free(k)) return k;
  return group.cells.find(free) ?? null;
}

// --------------------------------------------------------- special effects

function square(r, c, radius) {
  const out = [];
  for (let dr = -radius; dr <= radius; dr++)
    for (let dc = -radius; dc <= radius; dc++)
      if (inBounds(r + dr, c + dc)) out.push(key(r + dr, c + dc));
  return out;
}

function lines(rows, cols) {
  const out = new Set();
  for (const r of rows) if (r >= 0 && r < SIZE) for (let c = 0; c < SIZE; c++) out.add(key(r, c));
  for (const c of cols) if (c >= 0 && c < SIZE) for (let r = 0; r < SIZE; r++) out.add(key(r, c));
  return [...out];
}

function cellsOfType(grid, t) {
  const out = [];
  forEachCell(grid, (p, r, c) => { if (p && p.type === t) out.push(key(r, c)); });
  return out;
}

function mostCommonType(grid, exclude) {
  const counts = Array(TYPES).fill(0);
  forEachCell(grid, (p, r, c) => {
    if (p && p.type >= 0 && !exclude.has(key(r, c))) counts[p.type]++;
  });
  let best = 0;
  counts.forEach((n, t) => { if (n > counts[best]) best = t; });
  return best;
}

// What a special clears when something else sets it off.
function blastOf(grid, r, c, piece, cleared) {
  switch (piece.special) {
    case NOVA: return { kind: 'nova', radius: 1, cells: square(r, c, 1) };
    case CROSS: return { kind: 'cross', cells: lines([r], [c]) };
    case PRISM: {
      const target = mostCommonType(grid, cleared);
      return { kind: 'prism', target, cells: cellsOfType(grid, target) };
    }
    default: return null;
  }
}

// Breadth-first chain reaction. Wave 0 is `start`; every special popped in a
// wave detonates, and the cells it newly hits form the next wave. `protect`
// cells (where new specials are being born) are never cleared.
export function resolveDetonations(grid, start, { protect = new Set(), detonated = new Set(), events = [] } = {}) {
  const cleared = new Set();
  const first = [];
  for (const k of start) if (!protect.has(k) && !cleared.has(k) && grid[rowOf(k)][colOf(k)]) { cleared.add(k); first.push(k); }
  const waves = [{ cells: first, events: [...events] }];
  let frontier = first;
  while (frontier.length) {
    const wave = waves[waves.length - 1];
    const next = [];
    for (const k of frontier) {
      const r = rowOf(k), c = colOf(k), p = grid[r][c];
      if (!p || p.special === NONE || detonated.has(p.id)) continue;
      detonated.add(p.id);
      const blast = blastOf(grid, r, c, p, cleared);
      wave.events.push({ ...blast, r, c, type: p.type });
      for (const b of blast.cells) {
        if (protect.has(b) || cleared.has(b) || !grid[rowOf(b)][colOf(b)]) continue;
        cleared.add(b);
        next.push(b);
      }
    }
    if (next.length) waves.push({ cells: next, events: [] });
    frontier = next;
  }
  return { waves, cleared };
}

// Swapping two specials, or a prism with anything, fires a combo without
// needing a colour match. `a` is where the moved piece came from, `b` where it
// landed (the grid is already swapped). Returns null for an ordinary swap.
export function comboFor(grid, a, b) {
  const pa = grid[a.r][a.c], pb = grid[b.r][b.c];
  if (!pa || !pb) return null;
  const ka = key(a.r, a.c), kb = key(b.r, b.c);
  const sa = pa.special, sb = pb.special;
  const isPrismA = sa === PRISM, isPrismB = sb === PRISM;
  if (!isPrismA && !isPrismB && (sa === NONE || sb === NONE)) return null;

  const detonated = new Set([pa.id, pb.id]);
  if (isPrismA && isPrismB) {
    const all = [];
    forEachCell(grid, (p, r, c) => { if (p) all.push(key(r, c)); });
    return { start: all, detonated, events: [{ kind: 'prism2', r: b.r, c: b.c, cells: all }], transforms: [] };
  }
  if (isPrismA || isPrismB) {
    const [prismKey, prism, other, otherAt] = isPrismA ? [ka, pa, pb, b] : [kb, pb, pa, a];
    const targets = cellsOfType(grid, other.type);
    const transforms = other.special === NONE ? [] : targets.map((k) => ({ k, special: other.special }));
    for (const t of transforms) grid[rowOf(t.k)][colOf(t.k)].special = t.special;
    // the converted pieces must still go off, so only the prism counts as spent
    const spent = new Set([prism.id]);
    const pr = rowOf(prismKey), pc = colOf(prismKey);
    return {
      start: [prismKey, ...targets],
      detonated: spent,
      events: [{ kind: 'prism', r: pr, c: pc, target: other.type, cells: targets, via: otherAt }],
      transforms,
    };
  }
  // two of nova / cross
  const pair = [sa, sb].sort().join('+');
  if (pair === `${NOVA}+${NOVA}`) {
    return { start: square(b.r, b.c, 2), detonated, events: [{ kind: 'nova', radius: 2, r: b.r, c: b.c, type: pb.type }], transforms: [] };
  }
  if (pair === `${CROSS}+${CROSS}`) {
    return {
      start: lines([a.r, b.r], [a.c, b.c]),
      detonated,
      events: [
        { kind: 'cross', r: a.r, c: a.c, type: pa.type },
        { kind: 'cross', r: b.r, c: b.c, type: pb.type },
      ],
      transforms: [],
    };
  }
  return {
    start: lines([b.r - 1, b.r, b.r + 1], [b.c - 1, b.c, b.c + 1]),
    detonated,
    events: [{ kind: 'cross3', r: b.r, c: b.c, type: pb.type }],
    transforms: [],
  };
}

// ------------------------------------------------------------ move search

function swapCells(grid, a, b) {
  const t = grid[a.r][a.c];
  grid[a.r][a.c] = grid[b.r][b.c];
  grid[b.r][b.c] = t;
}

// How good a swap is (0 = not a legal move). Larger matches and specials score
// higher, which the hint system uses to suggest satisfying moves.
export function swapValue(grid, a, b) {
  const pa = grid[a.r][a.c], pb = grid[b.r][b.c];
  if (!pa || !pb) return 0;
  if (pa.special === PRISM && pb.special === PRISM) return 60;
  if (pa.special === PRISM || pb.special === PRISM) return 30 + (pa.special + pb.special) * 4;
  if (pa.special !== NONE && pb.special !== NONE) return 25 + (pa.special + pb.special) * 3;
  if (pa.type === pb.type) return 0;
  swapCells(grid, a, b);
  let value = 0;
  for (const p of [a, b]) {
    const { h, v } = runsAt(grid, p.r, p.c);
    const hh = h >= 3 ? h : 0, vv = v >= 3 ? v : 0;
    if (!hh && !vv) continue;
    value += hh + vv;
    if (Math.max(h, v) >= 5) value += 14;
    else if (hh && vv) value += 9;
    else if (Math.max(h, v) === 4) value += 5;
    const piece = grid[p.r][p.c];
    if (piece.special !== NONE) value += 4;
  }
  swapCells(grid, a, b);
  return value;
}

const DIRS = [[0, 1], [1, 0]];

export function findMoves(grid, cap = Infinity) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      for (const [dr, dc] of DIRS) {
        const r2 = r + dr, c2 = c + dc;
        if (!inBounds(r2, c2)) continue;
        const value = swapValue(grid, { r, c }, { r: r2, c: c2 });
        if (value > 0) {
          moves.push({ a: { r, c }, b: { r: r2, c: c2 }, value });
          if (moves.length >= cap) return moves;
        }
      }
    }
  }
  return moves;
}

export const countMoves = (grid, cap = Infinity) => findMoves(grid, cap).length;

export function bestMove(grid, rng = Math.random) {
  const moves = findMoves(grid);
  if (!moves.length) return null;
  const top = Math.max(...moves.map((m) => m.value));
  const best = moves.filter((m) => m.value >= top - 1);
  return best[randInt(rng, best.length)];
}

// ---------------------------------------------------------- board building

function wouldMatch(grid, r, c, t) {
  if (c >= 2 && sameColour(grid[r][c - 1], t) && sameColour(grid[r][c - 2], t)) return true;
  if (r >= 2 && sameColour(grid[r - 1][c], t) && sameColour(grid[r - 2][c], t)) return true;
  return false;
}

// A fresh board with no matches on it and plenty of moves available.
export function createBoard(rng = Math.random, minMoves = 5) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const grid = emptyGrid();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        let t = randInt(rng, TYPES);
        for (let i = 0; i < TYPES && wouldMatch(grid, r, c, t); i++) t = (t + 1) % TYPES;
        grid[r][c] = makePiece(t);
      }
    }
    if (!findMatches(grid).length && countMoves(grid, minMoves) >= minMoves) return grid;
  }
  throw new Error('could not build a board');
}

// Drops pieces into the gaps. Returns the pieces that moved.
export function collapse(grid) {
  const moved = [];
  for (let c = 0; c < SIZE; c++) {
    let write = SIZE - 1;
    for (let r = SIZE - 1; r >= 0; r--) {
      const p = grid[r][c];
      if (!p) continue;
      if (r !== write) {
        grid[write][c] = p;
        grid[r][c] = null;
        moved.push({ piece: p, from: r, to: write, c });
      }
      write--;
    }
  }
  return moved;
}

// How eager the refill is to hand out a free cascade, by chain depth. Early
// cascades feel great; endless ones feel like the game is playing itself.
const CASCADE_CHANCE = [0.4, 0.3, 0.2, 0.12, 0.06];

// Fills every hole. Instead of rolling blindly it tries a batch of candidate
// refills and keeps the one that best fits the plan for this drop: either a
// bonus cascade, or a calm board that still offers lots of moves. A refill
// that leaves the player stuck is never chosen if any alternative exists.
export function smartFill(grid, rng = Math.random, { chain = 0, candidates = 14 } = {}) {
  const holes = [];
  forEachCell(grid, (p, r, c) => { if (!p) holes.push({ r, c }); });
  if (!holes.length) return [];

  const wantCascade = rng() < (CASCADE_CHANCE[chain] ?? 0.03);
  let best = null, bestScore = -Infinity;

  for (let i = 0; i < candidates; i++) {
    const types = holes.map(({ r, c }) => {
      // half the time echo a neighbour's colour, which builds near-matches
      if (rng() < 0.5) {
        const near = [grid[r + 1]?.[c], grid[r]?.[c - 1], grid[r]?.[c + 1]].filter((p) => p && p.type >= 0);
        if (near.length) return near[randInt(rng, near.length)].type;
      }
      return randInt(rng, TYPES);
    });
    holes.forEach(({ r, c }, j) => { grid[r][c] = { type: types[j], special: NONE }; });
    const cascades = findMatches(grid).length > 0;
    const moves = cascades ? 0 : countMoves(grid, 8);
    holes.forEach(({ r, c }) => { grid[r][c] = null; });

    if (!cascades && moves === 0) continue;
    let score = rng() * 1.5;
    if (cascades) score += wantCascade ? 10 : -4;
    else score += Math.min(moves, 8) + (wantCascade ? 0 : 3);
    if (score > bestScore) { bestScore = score; best = types; }
  }

  if (!best) best = forcePlayable(grid, holes, rng);
  return holes.map(({ r, c }, j) => {
    const piece = makePiece(best[j]);
    grid[r][c] = piece;
    return { piece, r, c };
  });
}

// Last resort: walk the holes and pick colours one by one until a move exists.
function forcePlayable(grid, holes, rng) {
  const types = holes.map(() => randInt(rng, TYPES));
  holes.forEach(({ r, c }, j) => { grid[r][c] = { type: types[j], special: NONE }; });
  outer: for (let j = 0; j < holes.length; j++) {
    const { r, c } = holes[j];
    for (let t = 0; t < TYPES; t++) {
      grid[r][c].type = t;
      if (findMatches(grid).length || countMoves(grid, 1)) { types[j] = t; break outer; }
    }
    grid[r][c].type = types[j];
  }
  holes.forEach(({ r, c }) => { grid[r][c] = null; });
  return types;
}

// Rearranges the existing pieces into a match-free layout with several moves.
// Returns the new grid; piece objects (and their specials) are preserved.
export function shuffle(grid, rng = Math.random, minMoves = 4) {
  const pieces = [];
  forEachCell(grid, (p) => { if (p) pieces.push(p); });
  let fallback = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = randInt(rng, i + 1);
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    const next = emptyGrid();
    pieces.forEach((p, i) => { next[Math.floor(i / SIZE)][i % SIZE] = p; });
    if (findMatches(next).length) continue;
    const moves = countMoves(next, minMoves);
    if (moves >= minMoves) return next;
    if (moves > 0 && !fallback) fallback = next;
  }
  if (fallback) return fallback;
  // pathological colour mix: recolour into a fresh layout but keep specials
  const fresh = createBoard(rng);
  forEachCell(fresh, (p, r, c) => {
    const old = pieces[r * SIZE + c];
    if (old) { old.type = old.special === PRISM ? -1 : p.type; fresh[r][c] = old; }
  });
  return fresh;
}

// ------------------------------------------------------------- persistence

export function serialize(grid) {
  return grid.map((row) => row.map((p) => (p ? [p.type, p.special] : null)));
}

export function deserialize(data) {
  if (!Array.isArray(data) || data.length !== SIZE) return null;
  const grid = emptyGrid();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = data[r]?.[c];
      if (!Array.isArray(cell)) return null;
      const [type, special] = cell;
      if (!Number.isInteger(type) || type < -1 || type >= TYPES) return null;
      if (![NONE, NOVA, CROSS, PRISM].includes(special)) return null;
      grid[r][c] = makePiece(special === PRISM ? -1 : type, special);
    }
  }
  if (findMatches(grid).length || !countMoves(grid, 1)) return null;
  return grid;
}
