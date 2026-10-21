# Bloom

Calm chain-reaction garden for phone and desktop browsers. Design: docs/GDD.md. Status: docs/STATE.md.

## Stack
TypeScript, Vite, PixiJS 8 (WebGL), Vitest, Web Audio (synthesized, no sound files), Tweakpane (dev panel only). Static site, deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

## Commands
- `npm run dev`: dev server with hot reload (`--host`, so a phone on the same network can open it)
- `npm test`: Vitest unit tests
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: typecheck plus production build into `dist/`
- `npm run sim -- 300`: bot balance simulation (run length, chain sizes) after tuning changes

## Folder map
- `config/tuning.json`: every gameplay number. Code reads it through `src/tuning.ts`; never hardcode one.
- `src/core/`: pure, deterministic game logic, no DOM or Pixi. `hex` board, `rules` (tap and cascade), `generator` (sprouts), `solver`, `adapt` (difficulty), `run` (one run), `intro`, `rng`.
- `src/view/`: Pixi rendering. `garden` replays a resolved tap as an animated cascade; `budView` draws one bud; `tween` is the ticker-driven tween and wait helper.
- `src/audio/synth.ts`: pentatonic bloom notes, tap blip, refund chime, end chord.
- `src/hud.ts`: DOM overlay (counters, chain banner, floating numbers, summary card).
- `src/game.ts`: flow (intro, run, summary) wiring logic, view, audio and HUD.
- `src/dev/panel.ts`: Tweakpane tuning panel, lazy-loaded.
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
- Dev URL flags: `?dev` opens the tuning panel (or press the backquote key), `?seed=N` fixes the garden, `?intro` replays the intro.
