# Bloom: game design

## §0 Pitch and stack
A dusk garden of flower buds. Feed one a drop of water; when it fills it bursts open and feeds its neighbors, and a well-placed drop can bloom half the garden, each flower playing the next note of a melody. Static web app (TypeScript, Vite, PixiJS, Web Audio), phone and desktop, touch and mouse.

This build is a **comparison prototype** against Still Water: core loop plus feel only. No menus, progression, meadow, accounts or leaderboards.

## §1 Pillars
1. **Plan, then watch.** The pleasure is seeing a chain lined up, spending one drop, and watching your plan run on its own.
2. **Calm, never punished.** No timer, no fail state, deterministic rules. A run ends softly when the drops run out.
3. **Every bloom sings.** Sound and motion carry the reward; a long chain is a melody.

## §2 Core loop
Read the garden → tap a bud (1 drop, +1 petal) → if it reaches 4 it blooms and the cascade plays → pollen and drop refunds → bloomed cells sprout fresh buds → repeat until drops reach 0 → summary → new garden.

## §3 Mechanics
- **Garden.** Hex board of radius `board.radius` (3 = 37 buds). Each bud holds 0 to 3 petals and has 3 arrows pointing at on-board neighbors.
- **Tap.** Spends a drop and adds one petal. At 4 petals the bud blooms.
- **Bloom.** Sends one petal along each arrow, then stays open for the rest of the chain. Petals that reach an open flower or leave the board fall and are lost. Any bud pushed to 4 blooms in the next step. Each cell blooms at most once per chain, so every chain ends.
- **Sprouts.** When the chain settles, every bloomed cell sprouts a new bud (random petals and arrows from the generator).
- **Score.** A chain of n blooms gives `score.pollenPerBloom × n(n+1)/2` pollen, so long chains are worth far more than many short ones.
- **Drops.** A run starts with `run.startDrops`. Chains of at least `run.refundChain1/2/3` blooms give back 1/2/3 drops in total. The run ends at 0 drops.
- **Generator.** Sprout petal counts are drawn from weights that blend from `sprout.petalWeightsGentle` to `sprout.petalWeightsWild` by difficulty. Arrows lean toward fuller neighbors with strength `alignGentle` → `alignWild`.
- **Solver and adaptation.** Before each tap the solver finds the longest chain any single tap could start. The player's chain divided by that best is the tap's ratio. Taps with nothing bloomable, and small priming taps (no bloom when the best was under 3), are neutral. `adapt.streak` ratios ≥ `goodRatio` raise difficulty by `adapt.step`; the same number below `poorRatio` lower it. Label: Gentle < 0.33 ≤ Lively < 0.67 ≤ Wild. The summary shows the average ratio as "of the best chains".
- **Intro (first visit only).** Two 7-bud gardens: a single glowing bud to tap, then three ready buds in a row that chain. Then the first real run with one line of text about drops.

## §4 Feel targets
- Tap response under 100 ms: bud pop (`feel.tapPopMs`) and a ripple ring on pointer-down.
- Cascade pacing: first step after `feel.firstStepDelayMs`, then a step every `feel.chainStepMs`, shrinking by `chainAccel` per step down to `chainStepMinMs`, so long chains accelerate into a flourish.
- Petals fly on an arc (`feel.petalArc`) over `feel.petalFlightMs`, leaving a fading trail, and pop the receiving bud when they land.
- Bloom: open flower scales in with an elastic overshoot over `feel.bloomOpenMs`, plus a glow burst and pollen sparks.
- Ready buds (3 petals) glow with a slow pulse at `feel.readyPulseHz`.
- Sprouts grow in with a back-ease over `feel.sproutMs` after `feel.sproutDelayMs`.
- Android vibrates `feel.vibrateMs` per bloom (iPhone Safari has no vibration API).

## §5 Content
One endless garden mode with seeded randomness. Later bud types (line, star, dormant seeds, stones) are backlog.

## §6 Art and audio
- **Art.** All vector shapes in code. Deep dusk background with drifting fireflies. Buds are 4 petal slots between the arrow directions; fullness reads cool to warm (lavender, rose, amber). Open flowers take a hue that walks along the chain.
- **Audio.** Major pentatonic from MIDI `audio.rootMidi`. The k-th bloom of a chain plays scale step k, climbing `audio.noteSteps` steps and then walking back down. Blooms in the same step are staggered by `audio.noteStaggerMs`. Bell voice (sine plus quiet triangle and third partial), `audio.noteDecay` seconds, through generated reverb and a soft delay. Taps that don't bloom play a water-drop blip; refunds sparkle; the run ends on a soft chord.

## §7 UX flow
Open → intro (first visit) → run with HUD (drops left, pollen centre, mood chip right; new garden, sound and full-screen buttons at the bottom) → chain banner "×n" from the second bloom → floating "+pollen" and "+1 drop" → summary card (pollen, best, longest chain, flowers, drops used, chain-finding ratio) → "Plant a new garden".

## §8 Backlog
- Press-and-hold preview of a bloom's first step (fallback if chains read as random).
- Slow-motion replay of the best chain on the summary.
- Meadow that grows from every run; songbook of 12+ chains.
- New bud types: line, star, dormant seed, stone.
- Daily garden with adaptation off; efficiency leaderboard.
- Two-tap solver plans so priming taps are scored.
- Pin the mood (Gentle, Lively, Wild).
