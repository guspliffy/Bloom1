# Bloom

Calm chain-reaction garden for phone and desktop browsers. Design: docs/GDD.md. Status: docs/STATE.md.

## Stack
TypeScript, Vite, PixiJS 8 (WebGL), Vitest, Web Audio (synthesized, no sound files), Tweakpane (dev panel only). Static site, deployed to GitHub Pages (https://guspliffy.github.io/Bloom1/) by `.github/workflows/deploy.yml` on every push to `main`.

## Commands
- `npm run dev`: dev server with hot reload (`--host`, so a phone on the same network can open it)
- `npm test`: Vitest unit tests
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: typecheck plus production build into `dist/`
- `npm run sim -- 300`: bot balance simulation (run length, chain sizes) after tuning changes
- `npm run server:build` / `npm run server:dev`: bundle or run the leaderboard server locally

The server only accepts runs whose game version (package version + hash of `config/tuning.json`) matches its own, so redeploy the server (rerun install.sh) whenever tuning or rules change.

## Folder map
- `config/tuning.json`: every gameplay number. Code reads it through `src/tuning.ts`; never hardcode one.
- `src/core/`: pure, deterministic game logic, no DOM or Pixi. `hex` board, `rules` (tap and cascade), `generator` (sprouts), `solver`, `adapt` (difficulty), `run` (one run), `tutorial` (lesson gardens and judging), `preview` (what a tap would do, for hold/hover), `rng`.
- `src/view/`: Pixi rendering. `scene` is the blue-hour backdrop (sky, hedges, fireflies, night factor); `bed` bakes the garden bed; `garden` replays a resolved tap as a cascade of light; `budView` draws one bud from baked `textures`; `tween` is the ticker-driven tween and wait helper.
- `src/audio/`: `schedule` puts a cascade on the note grid (pure, tested); `synth` is the Web Audio voice, chords, pad and ambient bed.
- `src/audio/synth.ts`: pentatonic bloom notes, tap blip, refund chime, end chord.
- `src/hud.ts`: DOM overlay (counters, chain banner, floating numbers, summary card).
- `src/game.ts`: flow (tutorial, run, summary) wiring logic, view, audio and HUD.
- `src/dev/panel.ts`: Tweakpane tuning panel, lazy-loaded.
- `src/net/`: online layer. `online` (HTTP client, session, run queues), `names` (name rules, shared with the server), `guestRuns`, `clean` (which runs may be submitted, game version), `board` (board helpers), `fake` (in-memory server for `__bloom.fakeOnline()`). `src/boardView.ts`, `src/accountSheets.ts`, `src/social.ts`: Gardeners board, name and sign-out sheets, run submission.
- `server/`: self-hosted leaderboard (Node 22, `node:sqlite`, no dependencies). Replays each submitted tap log with `src/core` and shows only runs that verify. `server/install.sh` is the one-command VPS install and update; see `server/README.md`.
- `config/online.json`: API address for the GitHub Pages build (empty = offline). `VITE_BLOOM_API` overrides it at build time. `config/names-blocklist.json`: name blocklist used by client and server.
- `tests/`: Vitest specs. `scripts/sim.ts`: balance bots.

## Architecture rules
- Simulation is separate from rendering. `core/` resolves a tap completely and returns a result; the view only replays it.
- Same seed, same garden and sprouts (`?seed=N`). Use `Rng`, never `Math.random`, in `core/`. Cosmetic randomness in `view/` is fine.
- Animation time comes from `Tweener`, driven by the Pixi ticker with a clamped dt; no `setTimeout` for gameplay timing.
- Tuning values are read at use time, so the dev panel edits apply live. Board, run, sprout and adapt values apply to the next garden.
- Audio starts only after a user gesture (`synth.unlock()` on tap).

## Conventions
- Small modules with named exports. Comments explain why, not what.
- Tests cover rules, generator invariants, solver, adapter and determinism. Add a test with every rule change.
- Dev URL flags: `?dev` opens the tuning panel (or press the backquote key), `?seed=N` fixes the garden, `?tutorial` replays the tutorial.
