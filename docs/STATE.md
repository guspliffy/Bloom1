# State

**Milestone:** road to alpha (M3 Content, then M4 Polish). On 2026-10-22 Jonny decided both Bloom and Still Water go to alpha; he has not picked one yet.

**Alpha plan:** Claude Doc "Bloom: road to alpha", https://claude.ai/artifact/9VVQTnfAkSXPoLTMFtSpAY. Four phases, each closed by a gate Jonny checks by playing:
- **A Readable** (built 2026-10-22, waiting on Jonny's gate play): hold/hover chain preview (`src/core/preview.ts`, `tuning.preview`, depth 1 = first step only); why-it-stopped marks (`src/core/stop.ts`, `GardenView.restPetal`, `feel.stopMarkMs`/`stopMarkFadeMs`): petals of a chain's last wave that are lost stay a moment where they fell, on the rim (off the edge) or in the gap halfway back (bounced off an open flower), with a faint ring; first-time lines after a tap, at most one per tap, in order: "Longer chains are worth much more." (first chain of `hud.scoreHintChain` 5+), the preview hint, "Petals off the edge are lost.", "Open flowers catch no petals." Gate: Jonny plans chains in his first 5 minutes.
- **B Deeper puzzles:** garden goals with 1-3 stars; bud types stone, reed, star bud, sleeping seed, sunflower, moon lily (one every 3-4 gardens, each with a one-line mini lesson); two-tap solver; garden editor in the dev panel; hidden easier/normal/harder versions per garden moved by stars (as in Still Water); easy "bloom feast" gardens after hard ones. Gate: 24 gardens, each with a solver-verified 3-star path.
- **C Come back:** journey map (2 seasons, 24 gardens), daily garden (same seed for all, adaptation off, no punishing streak), flower journal, meadow on the end sheet, best-chain replay. Gate: Jonny returns on 3 days unprompted.
- **D Alpha ready:** save and resume, offline/PWA install, settings (volumes, haptics, reduced motion), accessibility, 60 fps on a 3-year-old mid-range Android, 5-10 outside testers. Gate: testers finish 10 gardens unhelped.

**Playable:** full loop on phone and desktop. Four-lesson guided tutorial (first visit; ? card replays), 37-bud garden, refunds, sprouts, adaptive difficulty. Visual and audio redesign per GDD §4/§6/§7 (2026-10-21): blue-hour scene where each run is one evening, raised garden bed, lit petal sprites, flowers that light the garden, cascades on a 96 BPM note grid with chords, pad and finale, drop pips and pollen motes, Fraunces and Nunito type, title moment, "The garden rests" end sheet. `npm run dev` locally, or the GitHub Pages link.

**In progress:** Phase A built and deployed; waiting for Jonny's gate play. 2026-10-22 Jonny asked how to make the graphics more fun: the creative director proposed a "lantern garden" (Claude Doc https://claude.ai/artifact/Cv6T4jy1r5MrLgy2xdpgcq). Wave 1 is built (plump buds with leaves, soil in a warm planter, a chain count in the flower's colour that grows, three flower shapes that grow along a chain, bigger flying petals with a catch ring). Wave 2 (lantern bud bodies, light spilling into the garden, tiers at 4/8/12 with a moth, phone layout, wind and a visiting moth) waits for Jonny's reaction. Next after that: Phase B (garden goals, bud types, two-tap solver, garden editor).

**Look owner questions** (defaults in use): warm planter rim (yes); flowers grow along a chain (yes, up to 1.32×); a moth visits ready buds after 6 s idle (Wave 2, yes).

**Next:** finish Phase A; open decisions below.

**Open alpha decisions** (decision cards were posted to Jonny on 2026-10-22; check the thread for answers)
- Decision cards re-posted 2026-10-22 in the "Bloom alpha" thread.
- Preview strength: DECIDED 2026-10-22 by Jonny: first step only (`preview.depth` 1).
- Modes: DECIDED 2026-10-22 by Jonny: journey + endless + daily.
- OK to recruit 5-10 outside testers and collect anonymous play stats? Needed by Phase D.

**Earlier owner questions**
1. Which concept feels better to come back to: Bloom or Still Water?
2. Bloom: within five minutes, are you planning chains rather than tapping at random?
3. Pace: is the cascade speed right, too slow, or too fast?
4. Phones: add press-and-hold to preview a non-glowing bud's arrows? Default: no for now.
5. Keep the first-run idle hint (best bud circled after 8 s)? Default: yes.
6. Redesign defaults chosen by the creative director: web fonts shipped (Fraunces, Nunito), ambient evening-air bed on, no phone tilt parallax (desktop pointer only). Change any?

**Decisions (reversible)**
- Earlier lost petals still flutter and fade; only the last wave rests, because it is what explains the stop and more marks would clutter long chains.
- Input since the preview: a tap fires on release, not on press. On touch, holding a bud for `preview.holdMs` (or sliding the finger) previews the bud under the finger, and letting go cancels without a tap. A mouse previews on hover after `preview.hoverDelayMs` and taps on click. A one-time toast after the first tap teaches it (key `bloom.previewHintDone`), and the ? card has a fourth line.
- A bloomed cell stays open for the rest of its chain and catches nothing: each cell blooms at most once, which keeps chains readable and guaranteed to end.
- 2026-10-21 UI simplification (Jonny: "gameplay nice, UI too complex"); spec by the creative director in GDD §6/§7.
- 2026-10-21 redesign (Jonny: "simple now but plain and boring"): research on calm puzzle games, then a creative-director spec, now GDD §4/§6/§7. Held breath before a long chain's last wave is one extra sixteenth so the grid stays musical. Polyphony cap counts sounding voices at their scheduled time, since whole cascades are scheduled ahead.
- Software-rendered browsers (CI, swiftshader) run at a few fps and tweens slow down with them (frame time is clamped to 50 ms); real GPUs are fine. Invisible halos and rings are skipped to save fill rate on phones.
- Portrait screens rotate the board 30° (flat-top) so it fills a phone's width.
- Solver scores only single-tap plans; priming taps are neutral for adaptation (two-tap plans are in the backlog).
- Tutorial is shown once (localStorage key `bloom.tutorialDone.v2`); `?tutorial` or the ? card replays it. Added 2026-10-21 after Jonny found the first build hard to understand.
- Balance from `npm run sim`: random tapping about 11 taps and 300 pollen per run, a planning bot about 19 taps and 1,600 pollen.
