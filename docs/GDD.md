# Bloom: game design

## §0 Pitch and stack
A dusk garden of flower buds. Feed one a drop of water; when it fills it bursts open and feeds its neighbors, and a well-placed drop can bloom half the garden, each flower playing the next note of a melody. Static web app (TypeScript, Vite, PixiJS 8, Web Audio), phone and desktop, touch and mouse.

This build is a **comparison prototype** against Still Water: core loop plus feel only. No menus, progression, meadow, accounts or leaderboards.

## §1 Pillars
1. **Plan, then watch.** The pleasure is seeing a chain lined up, spending one drop, and watching your plan run on its own.
2. **Calm, never punished.** No timer, no fail state, deterministic rules. A run ends softly when the drops run out.
3. **Every bloom sings.** Sound and motion carry the reward; a long chain is a melody.

## §2 Core loop
Read the garden and its 3 lanterns → tap a bud (1 drop, +1 petal) → if it reaches 4 it blooms and the cascade plays → pollen, drop refunds, lanterns lit → bloomed cells sprout fresh buds → when all 3 lanterns are lit the garden is lit (stars, drops back, the next garden sprouts) → repeat until drops reach 0 → summary (gardens lit, stars, pollen) → new evening.

## §3 Mechanics
- **Garden.** Hex board of radius `board.radius` (3 = 37 buds). Each bud holds 0 to 3 petals and has 3 arrows pointing at on-board neighbors.
- **Tap.** Spends a drop and adds one petal. At 4 petals the bud blooms.
- **Bloom.** Sends one petal along each arrow, then stays open for the rest of the chain. Petals that reach an open flower or leave the board fall and are lost. Any bud pushed to 4 blooms in the next step. Each cell blooms at most once per chain, so every chain ends.
- **Sprouts.** When the chain settles, every bloomed cell sprouts a new bud (random petals and arrows from the generator).
- **Lanterns (the goal, 2026-10-22).** Each garden has `goal.lanterns` lantern buds, on rings `goal.ring` and at least `goal.minDistance` apart, starting with at most `goal.startPetals` petals. A lantern lights when its bud blooms and stays lit. When all are lit the garden is lit: stars by drops left at that moment (`goal.stars` = minimum drops for 3/2/1), `goal.refillOnLit` drops back, and a new garden with new lanterns is planted at once. The evening's score is gardens lit and stars; pollen is second. Sim (300 runs): a lantern-playing bot lights about 2 gardens a run (stars 36% 1, 42% 2, 22% 3); a bot that only takes the longest chain lights 0.1. Chosen by Jonny from three "catch" options (the others, aiming the drop and midnight blooms, are in the backlog).
- **Score.** A chain of n blooms gives `score.pollenPerBloom × n(n+1)/2` pollen, so long chains are worth far more than many short ones.
- **Drops.** A run starts with `run.startDrops`. Chains of at least `run.refundChain1/2/3` blooms give back 1/2/3 drops in total. The run ends at 0 drops.
- **Generator.** Sprout petal counts are drawn from weights that blend from `sprout.petalWeightsGentle` to `sprout.petalWeightsWild` by difficulty. Arrows lean toward fuller neighbors with strength `alignGentle` → `alignWild`.
- **Solver and adaptation.** Before each tap the solver finds the longest chain any single tap could start. The player's chain divided by that best is the tap's ratio. Taps with nothing bloomable, and small priming taps (no bloom when the best was under 3), are neutral. `adapt.streak` ratios ≥ `goodRatio` raise difficulty by `adapt.step`; the same number below `poorRatio` lower it. Label: Gentle < 0.33 ≤ Lively < 0.67 ≤ Wild. The summary shows the average ratio as "of the best chains".
- **Tutorial (first visit, replayable from the ? card).** Four tiny gardens, taught by doing, one short coach line each (max 8 words, one line on a phone) plus progress marks. Gardens and judges are unchanged; only the words shrink. Exact lines:
  1. Fill. Open: "Tap the circled bud." Continue: "2 of 4." then "3 of 4. One more!" Pass: "Four petals. It blooms!"
  2. Arrows. Open: "A glowing bud is ready. Tap it." Continue (other bud): "Tap the glowing one." Pass: "Its petals flew along the arrows."
  3. Chain. Open: "Tap the circled bud. Watch the chain." Continue: "Tap the circled bud." Retry: "Only n. Start from the circled bud." Pass: "A chain of 3. Each bloom sings."
  4. Choose. Open: "Find a tap that blooms 4 or more." Continue: "Tap a glowing bud." Retry: "Only n. Whose arrows hit glowing buds?" Pass: "n blooms! That is the whole game."
  After lesson 4 the run starts directly (no card). The How to play card exists only behind the ? button (§7).

## §4 Feel targets
- Tap response under 100 ms: bud pop (`feel.tapPopMs`), a drop falling from the HUD pip onto the bud (`feel.dropFallMs`), and a ripple ring where it lands.
- Cascade pacing is musical. Waves of blooms land on a note grid at `audio.bpm`: the first wave on the first grid tick at least `feel.firstStepDelayMs` after the tap, the next `audio.eighthWaves` waves an eighth note apart, every later wave a sixteenth apart, so long chains accelerate into a flourish. Visual bloom and note share one scheduled time.
- Petals fly on an arc (`feel.petalArc`) over `feel.petalFlightMs`, leaving a fading trail, and pop the receiving bud when they land.
- Bloom: squash for `feel.squashMs`, then the open flower scales through `feel.bloomOvershoot` and settles over `feel.bloomOpenMs` with one back-ease overshoot (no elastic ringing), plus a halo and pollen motes (§6).
- Ready buds (3 petals) are the one strong affordance on screen: they alone are warm, haloed and arrowed, and they breathe (halo alpha 0.22 + 0.22·pulse, bud scale 1 + `feel.readyBreathe`·pulse) at `feel.readyPulseHz`. Everything else is cool and quiet (idle buds breathe at a tenth of that, §6).
- Cascade light hierarchy: the chain frontier is the brightest thing on screen; buds outside the chain dim to `feel.cascadeDimAlpha`; the board breathes in by `feel.cascadeZoom`. Chains of at least `feel.holdBreathChain` hold their breath (`feel.holdBreathScale` time scale for `feel.holdBreathMs`) before the last bloom. Never a screen shake.
- First-run idle nudge: in the player's first real run, `feel.idleHintMs` without a tap circles the solver's best bud with the tutorial hint ring; any tap clears it. Never shown after the first run.
- Sprouts grow in with a back-ease over `feel.sproutMs` after `feel.sproutDelayMs`.
- Haptics (Android only): `feel.vibrateTapMs` on the player's tap and `feel.vibrateFinale` once on a finale chain. Never per bloom.
- `prefers-reduced-motion`: no camera breath, no held breath, half the particle counts, no parallax.

## §5 Content
One endless garden mode with seeded randomness. Later bud types (line, star, dormant seeds, stones) are backlog.

## §6 Art and audio
**Direction.** A lantern garden (2026-10-22 review; full proposal in the Claude Doc "Bloom: making the look as fun as the play", Waves 2-3 not yet built): plump buds planted in a warm planter, each chain lighting the garden around it. One composed picture, like a print: a raised garden bed at blue hour, lit by its own flowers. The scene is cool and value-compressed (indigo sky, teal soil, mauve hedges); the only warm things are the ember horizon, the cream cores, the amber ready buds; the only saturated things are open flowers. **The run is one evening:** each drop spent moves the sky from dusk toward night (night factor n = drops spent / `run.startDrops`, clamped 0..1, eased over `scene.nightLerpMs`; refunds move it back), so the last cascades are the brightest lights in the darkest garden. Everything is vector Graphics, canvas-baked gradient textures, tinted sprites and additive blending. No filter runs per frame. Sizes are fractions of the hex radius s; light comes from the top-left.

**Palette** (role: dusk → night where it changes).
- Sky: skyZenith #1b1a44 → #0b0b21 (stop 0); skyMid #3a2a5e → #1a1640 (0.45); skyLow #7a4a6e → #352a50 (0.9 of the horizon); horizonBand #d9865e → #5a3a55 (a 6%-of-height band at the horizon); groundTop #1a2a2c → #0e1a1c; groundBottom #0b1214 → #06090b.
- Silhouettes: hedgeFar #4a3a66 → #262048; hedgeNear #2a2448 → #15122e; leafFore #0a0a16. Moon #fff2d6, moonGlow #ffe2b8, star #e8e4ff.
- Bed: soilTop #243530; soilBottom #182420; moss #2e4a3c; planter rim #4a3a30 → #2e2420 with moonlight #a08868; side #2a1f1a → #17110e.
- Leaves: leaf #2f5a46, leafReady #3f6a4c.
- Buds: core #fff4d6 (centre #fffaf0, edge #f0d9a8); seed #cfd8c4; petalIdle #cdc3ff (tip; the texture darkens the base to ≈#8d7de0); petalReady #ffd9a4 (base ≈#f0984a); readyHalo #ffb760; arrow #f3ecff.
- Blooms (petal tips, the hue walks one step per bloom): #ff8fb8 #ffa47a #ffd36e #b5ec8a #82e0e6 #9fb2ff #d59cff. cascadeLight #ffd8a0; pollen #ffd36e; firefly #ffe7a3.
- Text and HUD: ink #f4eefc; inkDim rgba(244,238,252,.55); drop #8fd3ff; dropEmpty rgba(143,211,255,.3); sheet rgba(12,10,28,.85); buttonFace gradient #ffd9a4 → #f0984a with buttonInk #2a1a10. Never pure white or black.
- Dev panel: a grayscale toggle (Sky's check) and a night slider. Ready vs idle must separate in grayscale by value and by shape (chevrons, halo), never by hue alone.

**Background layers**, back to front. Parallax: pointer on desktop, `deviceorientation` on phones when granted, offsets layer i by `scene.parallaxPx[i]` × normalised tilt, eased 8%/frame. Horizon at `scene.horizonY` of the height (portrait) or `scene.horizonYLandscape`.
1. Sky: two full-screen sprites of a 2×512 vertical gradient canvas (dusk stops, night stops); the night sprite sits on top at alpha n. No re-render on change.
2. Stars: `scene.stars` points above the horizon, 1–2 px, star colour, alpha (0.25 + 0.45·twinkle)·n, each twinkling on its own 2–5 s sine.
3. Moon: disc r 0.55s at (0.74w, 0.14h), alpha 0.9, with a 6s moonGlow glow sprite at alpha 0.25. Horizon glow: a glow sprite 1.6× the board width centred on the horizon, moonGlow, alpha 0.18·(1 − 0.4n).
4. Far hedge: a silhouette of overlapping circles along the horizon (radii 0.9–2.4s, centres y = horizon ± 0.3s, spacing 1.2s, seeded), baked once to a texture, tinted hedgeFar (lerped by n), swaying ±`scene.hedgeSwayPx` at `scene.hedgeSwayHz`.
5. Near hedge: same recipe, radii 1.2–3s, centres at horizon + 0.8s, hedgeNear, sway in antiphase.
6. Ground: vertical gradient groundTop → groundBottom from the horizon to the bottom edge.
7. Garden bed and board (below).
8. Foreground leaves: 3 (portrait) or 4 (landscape) plain teardrop silhouettes 3–5s long rooted off-frame at the bottom corners, leafFore alpha 0.95, swaying ±`scene.leafSwayDeg` at `scene.leafSwayHz`, parallax opposite to the hedges.
9. Fireflies: `scene.fireflies` additive glow sprites 10–16 px, firefly tint, drifting on summed sines at 8–14 px/s, alpha pulsing 0.2–0.8 over 2–4 s, overall alpha ×(0.6 + 0.4n). The 3 nearest drift toward each fresh bloom at `scene.fireflyAttractPx`/s for `scene.fireflyAttractMs`.
10. Vignette: one pre-rendered radial sprite darkening the corners by `scene.vignette`. Grain: a 256² noise TilingSprite at `scene.grainAlpha`, tilePosition stepped every 4 frames.

**Garden bed.** A planter under the board: a rounded hexagon aligned with the board's outer outline (same rotation), circumradius rb = 0.866·(2R+1)·s + 1.0s, corner radius 0.5s, baked once per board size. Back to front: 4 grass tufts behind the far edge (leafFore alpha 0.5); drop shadow alpha 0.6; side face offset +0.45s y; a 0.36s warm rim band; soil inside it (soilTop → soilBottom) with 8 moss blotches alpha 0.42, about 900 1 px speckles (half light rgba(205,225,205,.07), half dark rgba(0,0,0,.14)), one dimple per cell (alpha 0.3, r 0.75s), a moonlight pool at (−0.2rb, −0.3rb) r 1.1rb alpha 0.12 and a soft inner shadow from the rim; moonlight 2 px along the rim's upper edges fading toward the front; 9 grass tufts on the front edge. Tutorial boards use the same bed at their own R.

**Bud.** Light from the top-left; one shared plump petal texture (white teardrop widest near 0.45·len, `feel.petalLen` 0.70s × `feel.petalHalfW` 0.30s, `feel.petalLenSmall` 0.62s when s < 32 px, inner 0.08s; axis gradient tip #ffffff, 0.5 #e2e2e2, base #7a7a7a; 1 px inner rim; a faint centre vein), tinted per state.
- Leaves: two leaf-tinted petal sprites (`feel.leafLen` 0.42s) under every bud, pointing low-left and low-right in screen space, also at 0 petals, so each cell reads as a plant.
- Contact shadow: black ellipse 1.1s × 0.5s, offset +0.18s y, alpha 0.42 (0 petals: 0.6×).
- Core: circle r 0.17s with a rim #4a3550 alpha 0.5, radial gradient, specular dot. Seed (0 petals): r 0.11s, seed colour, alpha 0.7.
- Petals: one petal sprite per petal, anchored at its base, pointing along arrows[i] (sorted by direction) as before; 1 a lollipop, 2 a V, 3 a Y. Tint petalIdle at 1–2, petalReady at 3.
- Life: every bud breathes 1 ± `feel.idleBreathe` on a 3–4.5 s sine with a per-cell phase (the board shimmers, never pulses in unison); each petal leans ± `feel.idleLeanDeg` at 0.3 Hz with a per-petal phase. Seeded per-cell jitter: rotation ±`feel.jitterDeg`, scale ±`feel.jitterScale`, hue ±`feel.jitterHueDeg` via tint.
- Ready (unchanged signal): halo 2.6s readyHalo breathing, chevrons (tip 0.82s, base 0.66s, notch 0.72s, half-width 0.13s, petalReady alpha 0.9) fading in over 180 ms, breathe per §4. Nothing else glows at rest. Desktop hover reveal of a non-ready bud's chevrons (arrow, alpha 0.4, `feel.arrowRevealMs`) stays; phones get no preview.

**Bloom and cascade light.**
- Bloom: squash to `feel.squashScale` with tint ×0.9 for `feel.squashMs`, then the flower opens from 0.9 through `feel.bloomOvershoot` to 1 over `feel.bloomOpenMs` (back ease). Three silhouettes picked per bloom: daisy (8+8 petals, outer 0.82s × 0.26s), star (6+6, 0.9s × 0.18s), peony (10+10, 0.7s × 0.32s, inner ring turned 18°). Each flower in a chain opens `feel.flowerGrowPerBloom` bigger than the last, up to `feel.flowerGrowMaxK` blooms (1.32×); its halo grows with it. Outer then inner petals (petal texture tinted by the chain hue) unfold with `feel.petalUnfoldStaggerMs` each, rotating from −25° to 0; pistil of 5 pollen dots r 0.04s.
- Flower light: additive halo 3.2s in the chain hue, alpha `feel.haloOpenAlpha[0]` → `[1]` over `feel.haloOpenMs`, held while open, gone with the sprout. Halos overlap the bed and neighbours: a cascade lights the garden.
- Chain light: one additive cascadeLight glow at the chain's centroid, size 2s + `feel.chainLightSizePerBloom`·blooms (max 14s), alpha `feel.chainLightAlphaPerBloom`·blooms (max `feel.chainLightMaxAlpha`), eased 300 ms, fading 900 ms after settle. Buds outside the chain sit at `feel.cascadeDimAlpha` until settle; the board scales to 1 + `feel.cascadeZoom` over `feel.cascadeZoomMs` and back.
- Held breath: chains ≥ `feel.holdBreathChain`: before the last bloom opens, time scale `feel.holdBreathScale` for `feel.holdBreathMs` (petals in flight slow, the chain light swells 20%), then bloom and chord land together.
- Petal flight: arc as before; trail = 3 additive glow dots fading over 180 ms. Lost petals (off board or onto an open flower) flutter down for 1.2 s with ±20° wobble and fade over `feel.fallenPetalMs`. Lost petals of the chain's last wave instead come to rest, to show why the chain stopped: off the board they drop onto the rim; onto an open flower they bounce back to the gap halfway to their source. Each rests with a soft glow of its colour and a faint ring, holds `feel.stopMarkMs`, then fades over `feel.stopMarkFadeMs`.
- Pollen: `feel.pollenMotesPerBloom` additive motes (4–7 px, pollen tint) rise and scatter over 900 ms, plus `feel.pollenToHudMotes` that fly a bezier to the HUD counter over `feel.pollenFlightMs`, staggered `feel.pollenFlightStaggerMs`; the counter ticks on each arrival (§7). Live particles capped at `feel.particleCap`.
- Sprouts: as before, plus a 4-mote dust puff.

**Typography.** Google Fonts, latin subset, `display=swap`: **Fraunces** (300, 300 italic, 500; SOFT axis 100) for the title, the pollen counter, the chain count, headline numbers and card titles; **Nunito** (400, 600, 700) for everything else. Tabular figures on every number. Small caps labels: Nunito 600, 12 px, tracking 0.18em, inkDim.

**Audio.** Major pentatonic from `audio.rootMidi`; the k-th bloom plays scale step k, climbing `audio.noteSteps` steps then walking back down. Bell voice (sine + quiet triangle + third partial, lowpass 3 kHz), `audio.noteDecay` s, through generated reverb and a soft delay. Changes:
- **Grid.** Blooms are scheduled with `AudioContext` look-ahead on the note grid of `audio.bpm` (§4); the animation uses the same scheduled times.
- **Strum.** Blooms in one wave play as a strum `audio.strumMs` apart, at most `audio.maxVoicesPerWave` sounding (the rest are visual only). Polyphony cap 12, oldest voice stolen with a 30 ms release.
- **Depth layers.** From chain length `audio.octaveDoubleChain`, each note gains an octave-below doubling at −9 dB. From `audio.padChain`, a pad (two detuned triangles on root and fifth, lowpass 900 Hz) swells to `audio.padGain` over `audio.padAttackMs` and releases over `audio.padReleaseMs` after settle.
- **Chord ending.** A chain ≥ `audio.chordChain` resolves one eighth after its last bloom with a tonic chord (root, fifth, octave; plus the major third from 8 blooms) at `audio.chordDecayMult` × noteDecay. Shorter chains end quietly.
- **Finale.** A chain ≥ `audio.finaleChain`: the held breath, then the chord plus a five-note pentatonic rise on sixteenths (steps 0, 2, 4, 7, 9 from the root an octave up) with the pad, reverb mix raised to `audio.finaleReverbMix` for 2 s, and a one-off brighter star twinkle. Rare by design.
- **Taps.** A tap that does not bloom plays a water drop (sine 900 → 400 Hz over 80 ms plus a 15 ms noise tick) pitched to a random note of the tonic chord, so repeated taps never fatigue. Pollen arrivals tick at `audio.tickVolume` on the current chord; refunds play a three-note sixteenth rise; the run ends on a slow tonic chord with the pad.
- **Ambient bed.** Pink noise through a 500 Hz lowpass at `audio.bedGain` with a 0.05 Hz amplitude wobble: evening air, felt not heard. Off at 0 gain.

## §7 UX flow
Open → title moment → tutorial (first visit only) → run → the garden rests → "Plant a new garden" → run. No card between tutorial and play; returning players land straight in a run.

**Title moment.** The scene fades in over 600 ms and the board sprouts cell by cell (sprout animation, 12 ms stagger, centre outward). "Bloom" in Fraunces 300, 52 px, tracking 0.12em, #ffe9c4 alpha 0.9, centred above the bed, fades in with the scene and out after `feel.titleMs` or at the first tap, whichever is first. No button, no text.

**HUD during a run.** Two signals and two buttons, nothing else; everything HTML over the canvas.
- Top left, drops: a row of pips, one per drop, 12 px teardrop glyphs 6 px apart, full pips drop colour with a 6 px glow, spent pips dropEmpty outline. On a tap the rightmost full pip shrinks to its outline over 200 ms and a drop falls from the bud's top onto the bud over `feel.dropFallMs`, landing as the ripple. A refund flies a drop glyph from the chain's last bloom to the first empty pip (700 ms bezier), which fills with a pop; no "+1 drop" text. The row grows past `run.startDrops` up to `hud.maxPips`; beyond that the count appears as a Fraunces number after the last pip.
- Top right, pollen: a 16 px 4-point star glyph, pollen colour, plus the number in Fraunces 500, 28 px, tabular, pollen colour. On each mote arrival the number ticks up with a 180 ms scale pop (1.12) and the star rotates 15°. No caption; the flying motes name it. No floating "+n pollen" text.
- Chain count: from the third bloom of a chain, "×n" in Fraunces 300 italic, 44 px, #ffe9c4 alpha 0.55, centred above the bed, scaling 0.96 → 1 on each increment, fading 600 ms after settle. The only text during a cascade.
- Bottom right: two 44 px round glass buttons (sound, ?), rgba(255,255,255,.05) fill, 1 px rgba(255,255,255,.12) rim, resting opacity 0.4, full on hover or press.
- Toast after a run starts: "Tap a glowing bud." Nunito 15 px, alpha 0.7, for `feel.toastMs`, once per run.
- Low drops: no warning colour. The night factor already deepens the sky; at 2 drops the fireflies brighten (alpha ×1.2).

**? card (How to play).** A bottom sheet, not a boxed modal: a gradient from transparent to sheet over the lower 60% of the screen, no border, the garden still visible above it. Title "How to play" Fraunces 500 22 px. Three lines, Nunito 400 17 px:
1. Tap a bud: +1 petal. Costs a drop.
2. At 4 petals it blooms and sends petals along its arrows.
3. Long chains score more and give drops back.
Buttons: "Back to the garden" (primary: buttonFace gradient, buttonInk, 52 px pill, soft outer glow), then "Replay the tutorial", "New garden" and "Full screen" (desktop only: hidden when `document.fullscreenEnabled` is false or the pointer is coarse) as plain text links, Nunito 600 15 px, inkDim. Opening the card pauses nothing.

**The garden rests (end of run).** When the last chain settles at 0 drops: 600 ms of stillness; the night factor eases to 1.15 (sky past night, stars full) over `feel.endNightMs` while the fireflies drift in over the bed; buds dim to alpha 0.6; the run-end chord plays. Then the sheet rises over 400 ms (ease-out) with: "The garden rests" Fraunces 300 italic 22 px, inkDim; the pollen total in Fraunces 500, 56 px, pollen colour, counting from 0 over `feel.tallyMs` with pollen ticks on the chord; "pollen" small caps; then "New best" in #ffe9c4 if beaten, else "Best n" in inkDim; two stats (longest chain, flowers bloomed) in Fraunces 500 28 px with small-caps labels; the primary pill "Plant a new garden", always in the same place and alone on its row. The board stays visible as the result.

**Tutorial presentation.** Coach line in a pill at the top: Nunito 600 17 px, ink, rgba(12,10,28,.55) background, 1 px rgba(255,255,255,.08) rim, 40 px tall, fading in 200 ms. Progress: four 10 px seed dots above the pill; a passed lesson's dot blooms into a 5-petal glyph in pollen colour over 300 ms. Hint ring: additive ring 1.7s, 2 px, #ffe9c4, breathing alpha 0.4–0.9 at 1 Hz, plus a drop glyph bobbing 4 px at 1 Hz 0.7s above the bud: a drop waits here. In lessons the ring pulses the ready bud's own chevrons (scale 1 + 0.12·pulse) as before. Lesson gardens use the same scene and bed at their own size.

## §8 Backlog
- Aim the drop: hold a ready bud and slide toward a neighbour to send a fourth petal that way (strongest identity idea; second experiment after lanterns).
- Midnight blooms: pollen × (1 + night) so late chains pay more.
- Press-and-hold preview of a non-ready bud's arrows on phone.
- Moth that lands on the last bloom of a long chain (Townscaper-style ambient life).
- Save or share the finished garden as an image.
- Show the mood word (Gentle, Lively, Wild) on the summary card only.
- Slow-motion replay of the best chain on the summary.
- Meadow that grows from every run; songbook of 12+ chains.
- New bud types: line, star, dormant seed, stone.
- Daily garden with adaptation off; efficiency leaderboard.
- Two-tap solver plans so priming taps are scored.
- Pin the mood (Gentle, Lively, Wild).
