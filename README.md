# Pixel Pop! Zen

A relaxing pixel-art match-3 game for the browser, in comic style. Zen mode only:
no timer, no game over, just combos, cascades and explosions.

**Play it:** https://graphoflife.github.io/pixel-pop/

Works on desktop and phones (swipe or tap to swap). You can add it to your home
screen and it runs like an app.

## Features

- **Four themes**, all pixel art generated in code:
  - **Jewels**: faceted heart, hexagon, kite, emerald, round, trillion and pear cuts
  - **Cosmos**: Mars, a flaming meteor, a star, a gas giant, a ringed planet, a black hole and the moon
  - **Garden**: tulip, marigold, sunflower, four-leaf clover, forget-me-not, pansy and cherry blossom
  - **Slimes**: seven squishy slimes, each with its own face and accessory
- **Specials**
  - 4 in a row → **Nova**: blasts the 3×3 area around it
  - L or T shape → **Cross**: clears its whole row and column
  - 5 in a row → **Prism**: swap it with any piece to clear every piece of that colour
  - Swap two specials together for mega combos (Nova+Nova, Cross+Cross, Nova+Cross, Prism+anything)
- **Swipe ahead**: you can keep swapping while explosions are still playing. Each
  swap shows right away and waits its turn, and swaps play in the order you made
  them. If a cascade destroys or moves a piece you swapped, that swap (and any
  later swap that relied on it) flips back immediately.
- **Always alive**: every piece gently sways, wobbles or tilts and keeps twinkling
- **Chain reactions and cascades**: points are multiplied by the cascade depth, and
  the music climbs the scale as the chain grows
- **Smart board**: refills try several candidate fills and pick one that keeps
  plenty of moves on the board, with occasional free cascades. You never get
  stuck, and a hint appears if you idle for a while.
- **Sound**: every effect and the ambient music are synthesised with WebAudio.
  Each theme has its own instrument (bells, synths, marimba, bloops).
- **Records** saved in the browser: high score, best single move, longest chain,
  highest level and pieces popped. Your current game is saved automatically.

## Run locally

It is a static site with no build step:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. ES modules need to be served over HTTP, so
opening `index.html` directly from disk won't work.

`tools/gallery.html` shows every sprite of every theme at large size.

## Tests

The rules engine (`js/board.js`) is DOM-free and covered by Node tests:

```bash
node tests/board.test.mjs
```

## Code map

| File | What it does |
| --- | --- |
| `js/board.js` | Match finding, specials, chain reactions, move search, smart refill, shuffle |
| `js/game.js` | Turn flow as awaited animations, input, rendering at integer pixel scale |
| `js/sprites.js` | Procedural pixel-art painter for every piece |
| `js/themes.js` | Theme metadata and the animated backgrounds |
| `js/fx.js` | Particles, shockwaves, lightning, comic starbursts, score popups |
| `js/audio.js` | WebAudio sound effects and generative ambient music |
| `js/main.js` | HUD, menus, persistence and the frame loop |
