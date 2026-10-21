# State

**Milestone:** comparison prototype (M1 greybox plus M2 feel pass), built alongside Still Water so Jonny can pick a direction.

**Playable:** full loop on phone and desktop. Four-lesson guided tutorial (first visit; ? card replays), 37-bud garden, refunds, sprouts, adaptive difficulty. Visual and audio redesign per GDD §4/§6/§7 (2026-10-21): blue-hour scene where each run is one evening, raised garden bed, lit petal sprites, flowers that light the garden, cascades on a 96 BPM note grid with chords, pad and finale, drop pips and pollen motes, Fraunces and Nunito type, title moment, "The garden rests" end sheet. `npm run dev` locally, or the GitHub Pages link.

**In progress:** nothing.

**Next:** Jonny plays the redesigned build; owner questions below.

**Open owner questions**
1. Which concept feels better to come back to: Bloom or Still Water?
2. Bloom: within five minutes, are you planning chains rather than tapping at random?
3. Pace: is the cascade speed right, too slow, or too fast?
4. Phones: add press-and-hold to preview a non-glowing bud's arrows? Default: no for now.
5. Keep the first-run idle hint (best bud circled after 8 s)? Default: yes.
6. Redesign defaults chosen by the creative director: web fonts shipped (Fraunces, Nunito), ambient evening-air bed on, no phone tilt parallax (desktop pointer only). Change any?

**Decisions (reversible)**
- A bloomed cell stays open for the rest of its chain and catches nothing: each cell blooms at most once, which keeps chains readable and guaranteed to end.
- 2026-10-21 UI simplification (Jonny: "gameplay nice, UI too complex"); spec by the creative director in GDD §6/§7.
- 2026-10-21 redesign (Jonny: "simple now but plain and boring"): research on calm puzzle games, then a creative-director spec, now GDD §4/§6/§7. Held breath before a long chain's last wave is one extra sixteenth so the grid stays musical. Polyphony cap counts sounding voices at their scheduled time, since whole cascades are scheduled ahead.
- Software-rendered browsers (CI, swiftshader) run at a few fps and tweens slow down with them (frame time is clamped to 50 ms); real GPUs are fine. Invisible halos and rings are skipped to save fill rate on phones.
- Portrait screens rotate the board 30° (flat-top) so it fills a phone's width.
- Solver scores only single-tap plans; priming taps are neutral for adaptation (two-tap plans are in the backlog).
- Tutorial is shown once (localStorage key `bloom.tutorialDone.v2`); `?tutorial` or the ? card replays it. Added 2026-10-21 after Jonny found the first build hard to understand.
- Balance from `npm run sim`: random tapping about 11 taps and 300 pollen per run, a planning bot about 19 taps and 1,600 pollen.
