# State

**Milestone:** comparison prototype (M1 greybox plus M2 feel pass), built alongside Still Water so Jonny can pick a direction.

**Playable:** full loop on phone and desktop. Four-lesson guided tutorial (first visit; ? card replays), simplified look per GDD §6/§7 (petals point along arrows, arrow heads only on glowing buds, two-number HUD), 37-bud garden, cascade with animation and pentatonic notes, refunds, sprouts, adaptive difficulty, summary. `npm run dev` locally, or the GitHub Pages link.

**In progress:** nothing.

**Next:** Jonny plays the simplified build; owner questions below.

**Open owner questions**
1. Which concept feels better to come back to: Bloom or Still Water?
2. Bloom: within five minutes, are you planning chains rather than tapping at random?
3. Pace: is the cascade speed right, too slow, or too fast?
4. Phones: add press-and-hold to preview a non-glowing bud's arrows? Default: no for now.
5. Keep the first-run idle hint (best bud circled after 8 s)? Default: yes.

**Decisions (reversible)**
- A bloomed cell stays open for the rest of its chain and catches nothing: each cell blooms at most once, which keeps chains readable and guaranteed to end.
- 2026-10-21 UI simplification (Jonny: "gameplay nice, UI too complex"); spec by the creative director in GDD §6/§7. Arrow heads are 0.85s tip / 0.15s half-width, slightly larger than the spec, for phone legibility.
- Portrait screens rotate the board 30° (flat-top) so it fills a phone's width.
- Solver scores only single-tap plans; priming taps are neutral for adaptation (two-tap plans are in the backlog).
- Tutorial is shown once (localStorage key `bloom.tutorialDone.v2`); `?tutorial` or the ? card replays it. Added 2026-10-21 after Jonny found the first build hard to understand.
- Balance from `npm run sim`: random tapping about 11 taps and 300 pollen per run, a planning bot about 19 taps and 1,600 pollen.
