// Run with: node tests/board.test.mjs
import assert from 'node:assert/strict';
import {
  SIZE, TYPES, NONE, NOVA, CROSS, PRISM, makePiece, emptyGrid, key,
  findMatches, specialFor, pickSpecialCell, resolveDetonations, comboFor,
  findMoves, countMoves, createBoard, collapse, smartFill, shuffle,
  serialize, deserialize,
} from '../js/board.js';

function seeded(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds a grid from rows of digits; '.' = empty, 'P' = prism.
function gridFrom(rows) {
  const g = emptyGrid();
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === '.') return;
    g[r][c] = ch === 'P' ? makePiece(-1, PRISM) : makePiece(Number(ch));
  }));
  return g;
}

// Every test grid is a match-free checkerboard of colours 5/6 with a pattern on top.
const BASE = Array.from({ length: SIZE }, (_, r) =>
  Array.from({ length: SIZE }, (_, c) => ((r + c) % 2 ? '5' : '6')).join(''));
const over = (r, c, s, rows = [...BASE]) => {
  rows[r] = rows[r].slice(0, c) + s + rows[r].slice(c + s.length);
  return rows;
};

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

test('base checkerboard has no matches', () => {
  assert.equal(findMatches(gridFrom(BASE)).length, 0);
});

test('3-in-a-row is a plain match', () => {
  const g = gridFrom(over(2, 1, '000'));
  const groups = findMatches(g);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].cells.length, 3);
  assert.equal(specialFor(groups[0]), NONE);
});

test('4 makes a nova, 5 makes a prism', () => {
  assert.equal(specialFor(findMatches(gridFrom(over(0, 0, '0000')))[0]), NOVA);
  assert.equal(specialFor(findMatches(gridFrom(over(0, 0, '00000')))[0]), PRISM);
});

test('L shape merges into one cross group', () => {
  let rows = over(4, 2, '000');
  rows = over(2, 2, '0', rows);
  rows = over(3, 2, '0', rows);
  const groups = findMatches(gridFrom(rows));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].cells.length, 5);
  assert.equal(specialFor(groups[0]), CROSS);
  assert.deepEqual(groups[0].corner, [key(4, 2)]);
  assert.equal(pickSpecialCell(gridFrom(rows), groups[0]), key(4, 2));
});

test('special cell prefers the moved piece', () => {
  const g = gridFrom(over(0, 0, '0000'));
  const group = findMatches(g)[0];
  assert.equal(pickSpecialCell(g, group, [key(0, 3)]), key(0, 3));
});

test('chain reaction: nova sets off a cross', () => {
  const g = gridFrom(BASE);
  g[3][3].special = NOVA;
  g[4][4].special = CROSS;
  const { waves, cleared } = resolveDetonations(g, [key(3, 3)]);
  assert.equal(waves.length, 3);
  assert.equal(waves[0].events[0].kind, 'nova');
  assert.equal(waves[1].events[0].kind, 'cross');
  // 3x3 plus the rest of row 4 and column 4
  assert.equal(cleared.size, 9 + 5 + 5);
});

test('protected cells survive blasts', () => {
  const g = gridFrom(BASE);
  g[3][3].special = NOVA;
  const { cleared } = resolveDetonations(g, [key(3, 3)], { protect: new Set([key(3, 4)]) });
  assert.ok(!cleared.has(key(3, 4)));
  assert.equal(cleared.size, 8);
});

test('prism + colour clears that colour', () => {
  const g = gridFrom(over(0, 0, 'P'));
  const combo = comboFor(g, { r: 0, c: 0 }, { r: 0, c: 1 });
  assert.equal(combo.events[0].kind, 'prism');
  const { cleared } = resolveDetonations(g, combo.start, combo);
  assert.equal(cleared.size, 1 + 32);
});

test('prism + nova turns a colour into novas', () => {
  const g = gridFrom(over(0, 0, 'P'));
  g[0][1].special = NOVA;
  const combo = comboFor(g, { r: 0, c: 0 }, { r: 0, c: 1 });
  assert.equal(combo.transforms.length, 32);
  const { waves } = resolveDetonations(g, combo.start, combo);
  assert.ok(waves[0].events.filter((e) => e.kind === 'nova').length >= 30);
});

test('two plain pieces are not a combo', () => {
  const g = gridFrom(BASE);
  assert.equal(comboFor(g, { r: 0, c: 0 }, { r: 0, c: 1 }), null);
});

test('move finder sees a simple swap', () => {
  const rows = over(0, 0, '0010');
  const g = gridFrom(rows);
  assert.equal(findMatches(g).length, 0);
  const moves = findMoves(g);
  assert.ok(moves.some((m) => m.a.r === 0 && m.a.c === 2 && m.b.c === 3));
});

test('created boards are clean and playable', () => {
  const rng = seeded(1);
  for (let i = 0; i < 200; i++) {
    const g = createBoard(rng);
    assert.equal(findMatches(g).length, 0);
    assert.ok(countMoves(g) >= 5);
  }
});

test('collapse + smartFill never leaves the player stuck', () => {
  const rng = seeded(7);
  let cascades = 0, settles = 0;
  for (let i = 0; i < 3000; i++) {
    const g = createBoard(rng);
    // knock out a random blob of cells
    const r0 = Math.floor(rng() * SIZE), c0 = Math.floor(rng() * SIZE);
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++)
      if (Math.abs(r - r0) + Math.abs(c - c0) <= 2) g[r][c] = null;
    collapse(g);
    const added = smartFill(g, rng, { chain: i % 6 });
    assert.ok(added.length > 0);
    g.forEach((row) => row.forEach((p) => assert.ok(p)));
    if (findMatches(g).length) cascades++;
    else { settles++; assert.ok(countMoves(g) > 0, 'refill left no moves'); }
  }
  console.log(`   cascades ${cascades}, calm refills ${settles}`);
  assert.ok(cascades > 200 && settles > 1000);
});

test('shuffle keeps pieces, removes matches and gives moves', () => {
  const rng = seeded(3);
  const g = createBoard(rng);
  g[2][2].special = CROSS;
  const ids = g.flat().map((p) => p.id).sort();
  const s = shuffle(g, rng);
  assert.deepEqual(s.flat().map((p) => p.id).sort(), ids);
  assert.equal(findMatches(s).length, 0);
  assert.ok(countMoves(s) >= 4);
});

test('serialize round-trip', () => {
  const g = createBoard(seeded(9));
  g[1][1].special = NOVA;
  const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  assert.ok(back);
  assert.deepEqual(serialize(back), serialize(g));
  assert.equal(deserialize([[1]]), null);
});

test('types constant sanity', () => assert.equal(TYPES, 7));

console.log(`\n${passed} tests passed`);
