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
- **Tutorial (first visit, replayable from the ? card).** Four tiny gardens, taught by doing, one short coach line each (max 8 words, one line on a phone) plus progress dots. Gardens and judges are unchanged; only the words shrink. Exact lines:
  1. Fill. Open: "Tap the circled bud." Continue: "2 of 4." then "3 of 4. One more!" Pass: "Four petals. It blooms!"
  2. Arrows. Open: "A glowing bud is ready. Tap it." Continue (other bud): "Tap the glowing one." Pass: "Its petals flew along the arrows."
  3. Chain. Open: "Tap the circled bud. Watch the chain." Continue: "Tap the circled bud." Retry: "Only n. Start from the circled bud." Pass: "A chain of 3. Each bloom sings."
  4. Choose. Open: "Find a tap that blooms 4 or more." Continue: "Tap a glowing bud." Retry: "Only n. Whose arrows hit glowing buds?" Pass: "n blooms! That is the whole game."
  After lesson 4 the run starts directly (no card). The How to play card exists only behind the ? button (§7).

## §4 Feel targets
- Tap response under 100 ms: bud pop (`feel.tapPopMs`) and a ripple ring on pointer-down.
- Cascade pacing: first step after `feel.firstStepDelayMs`, then a step every `feel.chainStepMs`, shrinking by `chainAccel` per step down to `chainStepMinMs`, so long chains accelerate into a flourish.
- Petals fly on an arc (`feel.petalArc`) over `feel.petalFlightMs`, leaving a fading trail, and pop the receiving bud when they land.
- Bloom: open flower scales in with an elastic overshoot over `feel.bloomOpenMs`, plus a glow burst and pollen sparks.
- Ready buds (3 petals) are the one strong affordance on screen: they alone are warm, haloed and arrowed, and they breathe (halo alpha 0.22 + 0.22·pulse, bud scale 1 + `feel.readyBreathe`·pulse) at `feel.readyPulseHz`. Everything else is cool and still.
- First-run idle nudge: in the player's first real run, `feel.idleHintMs` without a tap circles the solver's best bud with the tutorial hint ring; any tap clears it. Never shown after the first run (puzzle stays the player's).
- Sprouts grow in with a back-ease over `feel.sproutMs` after `feel.sproutDelayMs`.
- Android vibrates `feel.vibrateMs` per bloom (iPhone Safari has no vibration API).

## §5 Content
One endless garden mode with seeded randomness. Later bud types (line, star, dormant seeds, stones) are backlog.

## §6 Art and audio
All vector shapes in code, sizes as fractions of the hex radius s. Deep dusk background with drifting fireflies, unchanged.

**Playtest diagnosis ("UI feels complex").** Every bud drew 12 marks (3 spokes, 3 chevrons as bright as petals, 4 slots outlined even when empty, hex tile, core): ~450 marks at 30° steps, so the board read as a lattice, and neighbouring chevrons met nose to nose as stars and diamonds instead of directions. Three petal hues made count a colour code. Plus three HUD chips (one an unexplained "Lively"), a two-line tip and four buttons. Rule of the redesign: **one mark per petal, arrows only where they matter, one warm colour that means "ready".**

**Bud.** No hex tile (remove fill and stroke). No empty slots. No spokes.
- Core: circle r = 0.12s, `palette.core` #fff4d6, alpha 0.95. With 0 petals: r = 0.10s, alpha 0.45 (a seed; it marks the tappable cell).
- Petals: one teardrop per petal, `drawPetal` with len 0.55s, half-width 0.21s, inner 0.08s. **Petals sit on the bud's arrow directions**: sort the 3 arrows by direction index; petal i points along arrows[i]. So the petals themselves say where they will fly, and the flight animation is the petal leaving along its own axis. A 1-petal bud is a lollipop, 2 a V, 3 a Y: count reads by shape, no colour code needed.
- Colour by state, not count: 1-2 petals `palette.petalIdle` #b4a7ff alpha 0.9 (cool lavender); 3 petals `palette.petalReady` #ffc27a alpha 0.95 (amber). Rose is dropped. `palette.petalByCount` becomes [core, idle, idle, ready].
- Arrow heads only on ready buds: beyond each petal a chevron, tip 0.82s, base 0.66s, notch 0.72s, half-width 0.13s, #ffc27a alpha 0.9, no spoke. Chevron tip and the neighbour's petal tip leave a 0.38s gap, so heads never touch petals. Ready buds also get the halo (sprite 2.6s, tint `palette.ready`) and the breathe in §4. When the bud becomes ready, chevrons fade in over 180 ms; when it blooms they vanish with the petals.
- Hover reveal (pointer: fine only, i.e. desktop): hovering a non-ready, unopened bud shows its 3 chevrons in `palette.arrow` #f3ecff at alpha 0.4, fade in `feel.arrowRevealMs`, out 200 ms. Phones get no preview; a non-ready bud's missing arrow is only next-turn information and appears the moment it becomes ready. (Press-and-hold preview stays in the backlog.)
- Open flower: unchanged (8 + 8 petals, hue walks the chain).
- Tutorial hint ring, tap pop, ripple, petal trails, sparks: unchanged. The hint ring in lessons pulses the ready bud's own chevrons (scale 1 + 0.12·pulse) exactly as now.

**Audio.** Major pentatonic from MIDI `audio.rootMidi`. The k-th bloom of a chain plays scale step k, climbing `audio.noteSteps` steps and then walking back down. Blooms in the same step are staggered by `audio.noteStaggerMs`. Bell voice (sine plus quiet triangle and third partial), `audio.noteDecay` seconds, through generated reverb and a soft delay. Taps that don't bloom play a water-drop blip; refunds sparkle; the run ends on a soft chord.

## §7 UX flow
Open → tutorial (first visit only) → run → summary → "Plant a new garden" → run. No card between tutorial and play; returning players land straight in a run.

**HUD during a run.** Two numbers and two buttons, nothing else.
- Top left: drop icon + drops left, 26 px, as now. Top right: pollen as a 4-point gold star glyph (18 px, #ffd36e) + number, 26 px, tabular, gold. No "POLLEN" caption; the floating "+n pollen" on each bloom names it. Nothing in the centre.
- Mood chip: removed from the HUD. Difficulty is adaptive and invisible; the word only lives in the dev panel.
- Bottom right: two 40 px round buttons, sound and ?, resting opacity 0.5, full on hover or press. "New garden" and "Full screen" move into the ? card.
- Toast after a run starts: "Tap a glowing bud." for `feel.toastMs`, once per run, 15 px, single line.
- Chain banner "×n blooms" from the second bloom, floating "+n pollen" / "+1 drop": unchanged.

**? card (How to play).** Three lines, no bold terms, then buttons:
1. Tap a bud: +1 petal. Costs a drop.
2. At 4 petals it blooms and sends petals along its arrows.
3. Long chains score more and give drops back.
Buttons: "Back to the garden" (primary), "Replay the tutorial", "New garden", and "Full screen" (desktop only: hidden when `document.fullscreenEnabled` is false or the pointer is coarse). Opening the card pauses nothing; a chain in flight keeps playing beneath it.

**Summary card.** Headline pollen, "best" line, then two stats only: longest chain and flowers bloomed. "Drops used" and "of the best chains" go to the dev panel. Button: "Plant a new garden".

**Coach (tutorial).** One line at the top, 18 px, max 8 words, progress dots above; lines in §3.

## §8 Backlog
- Press-and-hold preview of a non-ready bud's arrows on phone (if players ask where a 2-petal bud will send).
- Show the mood word (Gentle, Lively, Wild) on the summary card only.
- Slow-motion replay of the best chain on the summary.
- Meadow that grows from every run; songbook of 12+ chains.
- New bud types: line, star, dormant seed, stone.
- Daily garden with adaptation off; efficiency leaderboard.
- Two-tap solver plans so priming taps are scored.
- Pin the mood (Gentle, Lively, Wild).
