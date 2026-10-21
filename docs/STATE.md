# State

**Milestone:** comparison prototype (M1 greybox plus M2 feel pass), built alongside Still Water so Jonny can pick a direction.

**Playable:** full loop on phone and desktop. Intro (first visit), 37-bud garden, cascade with animation and pentatonic notes, refunds, sprouts, adaptive difficulty, summary. `npm run dev` locally, or the GitHub Pages link.

**In progress:** nothing.

**Next:** Jonny plays both prototypes and decides which to continue.

**Open owner questions**
1. Which concept feels better to come back to: Bloom or Still Water?
2. Bloom: within five minutes, are you planning chains rather than tapping at random?
3. Pace: is the cascade speed right, too slow, or too fast?

**Decisions (reversible)**
- A bloomed cell stays open for the rest of its chain and catches nothing: each cell blooms at most once, which keeps chains readable and guaranteed to end.
- Petal slots sit between arrow directions and arrows have a faint spoke, so each arrow clearly belongs to its bud.
- Portrait screens rotate the board 30° (flat-top) so it fills a phone's width.
- Solver scores only single-tap plans; priming taps are neutral for adaptation (two-tap plans are in the backlog).
- Intro is shown once (localStorage); `?intro` replays it.
- Balance from `npm run sim`: random tapping about 11 taps and 300 pollen per run, a planning bot about 19 taps and 1,600 pollen.
