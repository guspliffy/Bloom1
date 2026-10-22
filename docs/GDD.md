# Bloom: game design

## §0 Pitch and stack
A dusk garden of flower buds. Feed one a drop of water; when it fills it bursts open and feeds its neighbors, and a well-placed drop can bloom half the garden, each flower playing the next note of a melody. Static web app (TypeScript, Vite, PixiJS 8, Web Audio), phone and desktop. A **comparison prototype** against Still Water: core loop plus feel; no menus, progression, accounts or leaderboards.

## §1 Pillars
1. **Plan, then watch.** The pleasure is seeing a chain lined up, spending one drop, and watching your plan run on its own.
2. **Calm, never punished.** No timer, no fail state, deterministic rules. A run ends softly when the drops run out.
3. **Every bloom sings.** Sound and motion carry the reward; a long chain is a melody.

Will not do (2026-10-22 review): undo, a timer or red last-drop pip, a home screen between gardens, more than four tutorial lessons, Still Water-style text coaching (one-line first-time hints are the ceiling).

## §2 Core loop
Read the garden and its 3 lantern posts → tap a bud (1 drop, +1 petal) → at 4 it blooms and the cascade plays → pollen, refunds, lanterns light → bloomed cells sprout → all 3 lanterns lit = garden lit (stars, drops back, next garden) → repeat until drops reach 0 → the garden rests (gardens lit and stars first, pollen second; replay this garden or plant a new one).

## §3 Mechanics
- **Garden.** Hex board of radius `board.radius` (3 = 37 buds). Each bud holds 0 to 3 petals and has 3 arrows pointing at on-board neighbors.
- **Tap.** Spends a drop and adds one petal. At 4 petals the bud blooms.
- **Bloom.** Sends one petal along each arrow, then stays open for the rest of the chain. Petals that reach an open flower or leave the board fall and are lost. Any bud pushed to 4 blooms in the next step. Each cell blooms at most once per chain, so every chain ends.
- **Sprouts.** When the chain settles, every bloomed cell sprouts a new bud (random petals and arrows from the generator).
- **Lanterns (the goal).** Each garden has `goal.lanterns` lantern buds on rings `goal.ring`, at least `goal.minDistance` apart, starting with at most `goal.startPetals` petals. A lantern lights when its bud blooms and stays lit. When all are lit the garden is lit: stars by drops left at that moment (`goal.stars` = minimum drops for 3/2/1), the stars are held over the garden (§7), `goal.refillOnLit` drops come back, and a new garden with new lanterns is planted. The evening's score is gardens lit and stars; pollen is second. Sim: a lantern-playing bot lights about 2 gardens a run.
- **Garden keys and replay.** Garden k of an evening is generated from its own `Rng(mix(seed, k))` at the adapter's difficulty when planted, and its sprouts draw from that rng, so the key `{seed, k, difficulty}` reproduces the garden, its lanterns and its sprouts for the same taps. "Replay this garden" (§7) starts a fresh evening whose first garden is that key, with `run.startDrops` drops and the adapter at the key's difficulty: the same puzzle on even terms. Test: a replayed key yields identical buds and lanterns.
- **Score.** A chain of n blooms gives `score.pollenPerBloom × n(n+1)/2` pollen, so long chains are worth far more than many short ones.
- **Drops.** A run starts with `run.startDrops`. Chains of at least `run.refundChain1/2/3` blooms give back 1/2/3 drops in total. The run ends at 0 drops.
- **Generator.** Sprout petal counts blend from `sprout.petalWeightsGentle` to `sprout.petalWeightsWild` by difficulty; arrows lean toward fuller neighbors with strength `alignGentle` → `alignWild`.
- **Solver and adaptation.** Before each tap the solver finds the longest single-tap chain; the player's chain over that best is the tap's ratio (taps with nothing bloomable, and priming taps when the best was under 3, are neutral). `adapt.streak` ratios ≥ `goodRatio` raise difficulty by `adapt.step`; the same number below `poorRatio` lower it. Gentle < 0.33 ≤ Lively < 0.67 ≤ Wild.
- **Tutorial (first visit, key `bloom.tutorialDone.v3`; replayable from settings).** Four tiny gardens, taught by doing, one coach line each (max 8 words) plus progress marks. The boards are the existing ones; lesson 4 gains a lantern. Exact lines (touch / mouse where they differ):
  1. Fill (radius 1). Open: "Tap the circled bud." Continue: "2 of 4." then "3 of 4. One more!" Pass: "Four petals. It blooms!"
  2. Arrows (radius 1). Open: "A glowing bud is ready. Tap it." Continue (other bud): "Tap the glowing one." Pass: "Its petals flew along the arrows."
  3. Chain and preview (radius 1, three ready buds in a row, the left one circled). Open: "Hold the circled bud." / "Hover the circled bud." When the preview of the circled bud shows (lesson hook `onPreview(cell)`): "See the path. Let go, then tap it." / "See the path. Now click it." Continue (tap elsewhere, no chain): "Tap the circled bud." Retry (chain under 3): "Only n. Start from the circled bud." Pass: "A chain of 3. Each bloom sings." Holding never fails the lesson: a tap without a hold still passes. A hold here sets `bloom.previewHintDone`, so the run's preview hint is skipped.
  4. Light the lantern (radius 2, the old "choose" board; the bud at (1,−1) is a lantern with 1 petal, so of the five glowing buds exactly (0,−1) and (−1,0) light it; no hint ring). Open: "Light the lantern." Continue (no bloom): "Tap a glowing bud. Reach the lantern." Retry (blooms, lantern dark): "Still dark. Which chain reaches the lantern?" Pass: "Lit! Three lanterns light a garden."
  After lesson 4 the first run starts directly, with no toast: its three lantern posts plant one by one, `feel.lanternBeatMs` apart, each with one pane pulse and the lantern bell, before the buds sprout. The posts say what to do.

## §4 Feel targets
- Tap response under 100 ms: bud pop (`feel.tapPopMs`), a drop falling onto the bud (`feel.dropFallMs`), and a ripple ring where it lands.
- Cascade pacing is musical. Waves of blooms land on a note grid at `audio.bpm`: the first wave on the first grid tick at least `feel.firstStepDelayMs` after the tap, the next `audio.eighthWaves` waves an eighth apart, every later wave a sixteenth apart, so long chains accelerate into a flourish. Visual bloom and note share one scheduled time.
- Petals fly on an arc (`feel.petalArc`) over `feel.petalFlightMs` and pop the receiving bud. A bloom squashes for `feel.squashMs`, then opens through `feel.bloomOvershoot` over `feel.bloomOpenMs` with one back-ease overshoot (no elastic ringing).
- Ready buds (3 petals) are the one strong affordance on screen: they alone are warm, haloed and arrowed, breathing (halo alpha 0.22 + 0.22·pulse, scale 1 + `feel.readyBreathe`·pulse) at `feel.readyPulseHz`. Everything else is cool and quiet.
- Cascade light hierarchy: the chain frontier is the brightest thing on screen (light budget, §6); buds outside the chain dim to `feel.cascadeDimAlpha`; the board breathes in by `feel.cascadeZoom`. Chains ≥ `feel.holdBreathChain` hold their breath (`feel.holdBreathScale` for `feel.holdBreathMs`) before the last bloom. Never a screen shake.
- Preview (hold after `preview.holdMs` on touch, hover after `preview.hoverDelayMs` on mouse; `preview.depth`): the first step's paths and the buds it would bloom; the rest dims to `preview.dimAlpha`. On touch the held bud's chevrons scale to `preview.heldArrowScale` at alpha 1 so they reach out from under the finger; hover keeps scale 1.
- First-run idle nudge: in the player's first real run, `feel.idleHintMs` without a tap circles the solver's best bud with the tutorial hint ring; any tap clears it. Never shown after the first run.
- Sprouts grow in with a back-ease over `feel.sproutMs` after `feel.sproutDelayMs`.
- Haptics (Android only): `feel.vibrateTapMs` on the player's tap and `feel.vibrateFinale` once on a finale chain. Never per bloom.
- `prefers-reduced-motion`: no camera breath, no held breath, half the particle counts, no parallax, the chain count stays above the bed.

## §5 Content
One endless garden mode with seeded randomness. Rules decided for later modes: the daily garden (same seed for all, adaptation off) punishes nothing: no streaks, no missed-day marks, no rank shown by default. Unlocks, when they come, are looks (seasonal palettes, lantern styles) tied to the flower journal, never power.

## §6 Art and audio
**Direction.** A lantern garden: plump buds in a warm planter at blue hour, lit by its own flowers, one composed picture like a print. The scene is cool and value-compressed; the only warm things are the ember horizon, the cream cores, the amber ready buds and the lanterns; the only saturated things are open flowers. **The run is one evening:** the night factor n = drops spent / `run.startDrops` (clamped, eased over `scene.nightLerpMs`; refunds move it back) darkens the sky, so the last cascades are the brightest lights in the darkest garden. Vector Graphics, baked gradient textures, tinted sprites, additive blending; no per-frame filters. Sizes are fractions of the hex radius s; light comes from the top-left.

**Colour rules.** Gold (#ffd36e family) means light and only light: ready buds, pollen, lit lanterns, fireflies, stars. Blue (#8fd3ff) means water and only water: drops and pips. Bloom hues are neither: rose, coral, lilac, mint, seafoam, lavender.

**Light budget.** Too many lights read as noise, not reward (the Still Water lesson). One bright thing at a time; everything else is glow that belongs to the bed. Caps, checked by a dev-panel readout "lights" (additive sprites over alpha 0.1 inside the bed):
- At rest (target ≤ 10): ready-bud halos, lit lanterns, the hint ring, moon and horizon glow, fireflies. With more than `light.readyHaloFullCount` ready buds, every ready halo scales by fullCount/n, never below `light.readyHaloFloor`. Fireflies: `scene.fireflies`, alpha ×(0.6 + 0.4n).
- During a cascade (target ≤ 24): the frontier is brightest. A flower's halo opens at `feel.haloOpenAlpha[0]`, settles to `[1]` over `feel.haloOpenMs`, and only the latest `light.haloHoldCount` flowers hold that; older halos sink to `light.haloRestAlpha` over 600 ms. One chain light at the centroid, size 2s + `feel.chainLightSizePerBloom`·blooms up to `feel.chainLightMaxSize`·s, alpha `feel.chainLightAlphaPerBloom`·blooms up to `feel.chainLightMaxAlpha`. Petal trails: `feel.trailDots` dots. Pollen: `feel.pollenMotesPerBloom` motes per bloom (half from the 8th bloom), live particles ≤ `feel.particleCap`. At most `scene.fireflyPullMax` fireflies are drawn to blooms at once. Ready halos and the hint ring are off while a chain plays.
- Garden lit (target ≤ 12): the lanterns take the stage. Flower halos and the chain light fade to 0 over 300 ms, then the three lanterns flare (§7); nothing else glows until the next garden sprouts.
- Never: per-bloom screen flashes, full-board glows, more than one chain light.

**Palette.** The scene, bed and bud colours (dusk → night pairs) are built and live in `src/view/palette.ts` and `src/style.css`; this section holds only what changes or carries a rule.
- Buds: core #fff4d6; petalIdle #cdc3ff; petalReady #ffd9a4; readyHalo #ffb760; arrow #f3ecff.
- Blooms (petal tips, the hue walks one step per bloom, no gold): rose #ff8fb8, coral #ffa08a, lilac #d59cff, mint #b5ec8a, seafoam #8fe6c8, lavender #b9a6ff. cascadeLight #ffd8a0; pollen #ffd36e; firefly #ffe7a3.
- Lanterns: iron #2a2026; dark glass #1a1424 alpha 0.7 with rim ink alpha 0.45; lit glass pollen alpha 0.95 with rim iron; glow pollen.
- Text and HUD: ink #f4eefc; inkDim rgba(244,238,252,.55); drop #8fd3ff; sheet rgba(12,10,28,.85); buttonFace gradient #ffd9a4 → #f0984a with buttonInk #2a1a10. Never pure white or black.
- Dev panel: a grayscale toggle, a night slider and the "lights" readout. Ready vs idle must separate in grayscale by value and by shape (chevrons, halo), never by hue alone.

**Scene, bed and bud** (built; keys only). Scene, back to front: sky, `scene.stars`, moon and horizon glow, hedges (`scene.hedgeSwayPx`, `scene.hedgeSwayHz`), ground, the planter bed and board, foreground leaves (`scene.leafSwayDeg`, `scene.leafSwayHz`), `scene.fireflies` (the 3 nearest drift toward each fresh bloom at `scene.fireflyAttractPx`/s for `scene.fireflyAttractMs`, at most `scene.fireflyPullMax` pulled at once), `scene.vignette`, `scene.grainAlpha`; horizon at `scene.horizonY` / `scene.horizonYLandscape`; parallax `scene.parallaxPx[i]`. Bud: one shared plump petal texture (`feel.petalLen`, `feel.petalHalfW`, `feel.petalLenSmall` when s < 32 px), petalIdle at 1–2 petals and petalReady at 3, two leaves (`feel.leafLen`), a shadow and a cream core; life from `feel.idleBreathe`, `feel.idleLeanDeg` and seeded jitter (`feel.jitterDeg`, `feel.jitterScale`, `feel.jitterHueDeg`). Ready: halo 2.6s readyHalo (budget above) and chevrons (tip 0.82s, petalReady alpha 0.9) fading in over 180 ms; hover or hold reveals a non-ready bud's chevrons over `feel.arrowRevealMs`.

**Lantern post.** Beside its bud in the gap toward the top (0.95s away; 30° to the right on the turned portrait board): an iron stem, a hexagonal pane r 0.3s with a cross-bar and cap, and a soil ring r 0.82s around the bud (moonGlow alpha 0.28 dark, pollen alpha 0.48 lit) so it is clear which bud lights it. Dark: dark glass, no glow. Lighting: over 400 ms the glass warms to pollen and a 2.2s pollen glow swells to 0.6 and settles at 0.32, breathing ±0.06 at 0.4 Hz. No HUD copy of the lanterns: the posts are the status.

**Bloom and cascade light.**
- Bloom: squash to `feel.squashScale` for `feel.squashMs`, then the flower opens through `feel.bloomOvershoot` over `feel.bloomOpenMs` (back ease), petals unfolding `feel.petalUnfoldStaggerMs` apart. Three silhouettes: daisy (8+8 petals), star (6+6), peony (10+10). Each flower in a chain opens `feel.flowerGrowPerBloom` bigger than the last, up to `feel.flowerGrowMaxK` blooms; its halo (additive, 3.2s, chain hue, budget above) grows with it and goes with the sprout.
- Chain light: one additive cascadeLight glow at the chain's centroid (budget above), eased 300 ms, fading 900 ms after settle. Buds outside the chain sit at `feel.cascadeDimAlpha`; the board scales to 1 + `feel.cascadeZoom` over `feel.cascadeZoomMs` and back. Held breath (§4): the chain light swells 20% while the last petals hang, then bloom and chord land together.
- Petal flight: an arc with a trail of `feel.trailDots` additive dots and a catch ring on landing. Lost petals flutter down and fade over `feel.fallenPetalMs`, except the last wave's, which rest where they fell (on the rim, or bounced back halfway from an open flower) with a faint ring for `feel.stopMarkMs`, then fade over `feel.stopMarkFadeMs`: why the chain stopped, without a word.
- Pollen: motes scatter, plus `feel.pollenToHudMotes` that fly to the HUD counter over `feel.pollenFlightMs`, staggered `feel.pollenFlightStaggerMs`; the counter ticks on each arrival (§7). Sprouts grow in with a 4-mote dust puff.

**Typography.** **Fraunces** (300, 300 italic, 500) for the title, counters, the chain count, headline numbers and card titles; **Nunito** (400, 600, 700) for everything else. Tabular figures on every number. Small caps labels: Nunito 600, 12 px, tracking 0.18em, inkDim.

**Audio.** Major pentatonic from `audio.rootMidi`; the k-th bloom plays scale step k, climbing `audio.noteSteps` steps then walking back down. Bell voice, `audio.noteDecay` s, through generated reverb (`audio.reverbMix`) and a soft delay (`audio.delayMix`).
- **Start.** The context is created and resumed on the first user gesture; the first chain of a session waits for the context to be running (at most 200 ms) before its notes are scheduled, so no note is lost on iOS. Mute is saved (`bloom.muted`).
- **Grid and strum.** Blooms are scheduled with look-ahead on the note grid of `audio.bpm` (§4); blooms in one wave strum `audio.strumMs` apart, at most `audio.maxVoicesPerWave` sounding; polyphony cap 12.
- **Depth and endings.** From `audio.octaveDoubleChain` blooms, an octave-below doubling; from `audio.padChain`, a pad (`audio.padGain`, `audio.padAttackMs`, `audio.padReleaseMs`). A chain ≥ `audio.chordChain` resolves on a tonic chord at `audio.chordDecayMult` × noteDecay; a chain ≥ `audio.finaleChain` adds a five-note pentatonic rise with the pad and reverb at `audio.finaleReverbMix` for 2 s. Rare by design.
- **Lanterns.** A lantern lighting plays a single bell an octave up; the garden-lit moment plays the chord with the finale rise, then one tick per star as it fills.
- **Taps and ticks.** A tap that does not bloom plays a water drop pitched to a random note of the tonic chord, at `audio.tapVolume`. Pollen arrivals tick at `audio.tickVolume`; refunds play a three-note rise; the run ends on a slow tonic chord. Ambient bed: pink noise at `audio.bedGain`, evening air, felt not heard.

## §7 UX flow
Open → title moment → tutorial (first visit only) → run → the garden rests → "Plant a new garden" or "Replay this garden" → run. No card between tutorial and play; returning players land straight in a run.

**Title moment.** The scene fades in over 600 ms and the board sprouts cell by cell (12 ms stagger, centre outward); "Bloom" (Fraunces 300, 52 px, tracking 0.12em, #ffe9c4 alpha 0.9) above the bed fades out after `feel.titleMs` or at the first tap. No button, no text.

**Layout.** The board is fitted between a 52 px top bar and the bottom bar; portrait screens turn it 30°. Everything that speaks is attached to the bed, not the screen edges, so on a phone the coach line, board and toast sit within one board-height: coach pill and chain count/stars at bed-top − 64 px (CSS `--bed-top`), toast at bed-bottom + 20 px (`--bed-bottom`), centred.

**HUD during a run.** Two signals and one button; everything HTML over the canvas.
- Top left, drops: one 12 px teardrop pip per drop (full: drop colour with a glow; spent: outline). A tap shrinks the rightmost full pip over 200 ms; a refund flies a drop glyph from the chain's last bloom to the first empty pip (700 ms), which fills with a pop; no "+1 drop" text. Past `hud.maxPips` a Fraunces number follows the last pip.
- Top right, pollen: a 16 px star glyph and the number in Fraunces 500, 28 px, pollen colour, ticking up with a 180 ms pop on each mote arrival. No caption; no floating "+n pollen" text.
- Lanterns: on the board only (§6 lantern post).
- Chain count: from the third bloom, the plain number ("6", no ×) in Fraunces 500 italic 44 px (52 px from `audio.finaleChain`), the latest flower's hue lerped halfway to #ffe9c4, glowing from `feel.holdBreathChain`. It sits 1.4s above the latest bloom (clamped 12 px inside the viewport), easing to each new bloom over 120 ms with a 1.18 pop, so the eye never leaves the board. At settle a small caps "chain" label (11 px, alpha 0.6) appears under it; both fade `feel.chainCountFadeMs` later. The only text during a cascade.
- Bottom right: one 44 px round glass settings button (gear glyph, 1.7 px stroke), rgba(255,255,255,.05) fill, 1 px rgba(255,255,255,.12) rim, resting opacity 0.7, full on hover or press. No run-start toast.
- Low drops: no warning colour. The night factor already deepens the sky; at 2 drops the fireflies brighten (alpha ×1.2).
- First-time lines after a tap (toast, Nunito 15 px alpha 0.7, `feel.toastMs`), at most one per tap, each once ever: "Longer chains are worth much more." (first chain ≥ `hud.scoreHintChain`), "Hold a bud to see where its petals go." / "Hover a bud to see where its petals go." (skipped when lesson 3 was held), "Petals off the edge are lost.", "Open flowers catch no petals."

**Settings sheet** (the gear). Bottom sheet, gradient from transparent to sheet over the lower 60%, no border, the garden still visible. Rows, Nunito 600 17 px ink, 48 px tall, left-aligned in a 440 px column: "Sound" with a 44×26 switch (knob drop colour on, inkDim off); "How to play"; "Replay the tutorial"; "New garden"; "Full screen" (hidden when `document.fullscreenEnabled` is false or the pointer is coarse). Then the primary pill "Back to the garden" (buttonFace gradient, buttonInk, 52 px, soft glow). A sheet pauses nothing; board taps are ignored while one is open.

**How to play sheet.** Title "How to play" Fraunces 500 22 px, five lines Nunito 400 17 px, the pill "Back to the garden", nothing else:
1. Tap a bud: +1 petal. Costs a drop.
2. At 4 petals it blooms along its arrows.
3. Bloom all 3 lanterns to light the garden.
4. Spare drops are stars. Long chains refund drops.
5. Hold or hover a bud to see its path.

**Garden lit.** The chain settles as usual; the lit garden does not sprout. Then, in order: (1) flower halos and the chain light fade to 0 over 300 ms; (2) the three lanterns flare together over `goal.flareMs` (glow alpha +0.5, scale ×1.6, easing back) with the chord and finale rise, a pollen ripple from the bed centre and the nearest 6 fireflies drifting to them; (3) from 500 ms, three 32 px star outlines (alpha 0.35) appear above the bed where the chain count sits, and the earned ones fill in pollen colour `goal.starStaggerMs` apart, each with a 320 ms pop (0.6 → 1.25 → 1) and a tick, over a small caps "garden lit" label; (4) hold `goal.starsHoldMs` after the last star; (5) `goal.refillOnLit` drops fly from the lanterns to the pips 90 ms apart with the refund chime while the stars fade over 400 ms; (6) the garden fades over 300 ms and the next one sprouts in with dark posts. The stars are the moment; the refill is its consequence, never the same beat.

**The garden rests (end of run).** At 0 drops: 600 ms of stillness; the night factor eases to 1.15 over `feel.endNightMs` while the fireflies gather over the bed; buds dim to alpha 0.6; the run-end chord plays. Then the sheet rises over 400 ms with, top to bottom:
- "The garden rests" Fraunces 300 italic 22 px, inkDim.
- Headline, Fraunces 500 40 px #ffe9c4: "2 gardens lit" / "1 garden lit"; with none lit, "Lanterns lit 2 of 3" (the garden on the board), so a near miss reads as progress.
- Stars, one group per lit garden, 18 px pollen glyphs (unearned ones outlines at alpha 0.3), groups 10 px apart, at most 6 then "+n". Hidden with none lit.
- "New best" in #ffe9c4 when the evening's star total beats `bloom.bestStars`, else "Best ★ n" in inkDim (blank with none lit).
- Two stats in Fraunces 500 28 px with small caps labels: pollen (counting up over `feel.tallyMs` with ticks) and longest chain.
- The primary pill "Plant a new garden", alone on its row; under it the text link "Replay this garden" (Nunito 600 15 px, inkDim), which replays the garden on the board by its key (§3). The board stays visible as the result.

**Tutorial presentation.** Coach line in a pill above the bed (Layout): Nunito 600 17 px, ink, rgba(12,10,28,.55) background, 40 px tall, fading in 200 ms; four 10 px seed dots above it, a passed lesson's dot blooming into a 5-petal pollen glyph over 300 ms. Hint ring: additive ring 1.7s, 2 px, #ffe9c4, breathing alpha 0.4–0.9 at 1 Hz, plus a drop glyph bobbing 0.7s above the bud; in lesson 2 it also pulses the ready bud's chevrons. Lesson 4 shows its lantern post exactly as a run does. Lesson gardens use the same scene and bed at their own size.

## §8 Backlog
- Aim the drop: hold a ready bud and slide toward a neighbour to send a fourth petal that way (strongest identity idea; second experiment after lanterns).
- Lantern-garden wave 2: lantern bud bodies, light spilling into the garden, tiers at 4/8/12 with a moth, wind.
- Midnight blooms: pollen × (1 + night). Moth that lands on the last bud of a long chain.
- Share the finished garden as an image; slow-motion replay of the best chain on the summary.
- Meadow; flower journal with seasonal palettes and lantern styles as the unlocks (§5); daily garden (§5); journey map.
- New bud types: line, star, dormant seed, stone. Two-tap solver plans; mood word on the summary; pin the mood.
