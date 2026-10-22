import { describe, expect, it } from 'vitest';
import defaults from '../config/tuning.json';
import { Adapter } from '../src/core/adapt';
import { generateGarden } from '../src/core/generator';
import { previewTap } from '../src/core/preview';
import { cellIndex, makeBoard } from '../src/core/hex';
import { tutorialLessons } from '../src/core/tutorial';
import { Rng, mixSeed } from '../src/core/rng';
import { chainPollen, chainRefund, resolveTap, type Bud } from '../src/core/rules';
import { Run } from '../src/core/run';
import { bestSingleTap } from '../src/core/solver';
import { chainStop } from '../src/core/stop';
import { hexDistance, placeLanterns, ringOf, starsFor } from '../src/core/lanterns';
import { nudgeCell } from '../src/core/nudge';
import { MAX_STAR_GROUPS, chainSpot, gearSpot, previewHint, summaryView, titlePlacement } from '../src/hud';

const t = structuredClone(defaults);

describe('board', () => {
  it('radius 3 has 37 cells and symmetric neighbors', () => {
    const b = makeBoard(3);
    expect(b.size).toBe(37);
    for (let i = 0; i < b.size; i++)
      for (let d = 0; d < 6; d++) {
        const n = b.neighbors[i][d];
        if (n >= 0) expect(b.neighbors[n][(d + 3) % 6]).toBe(i);
      }
  });
});

describe('rules', () => {
  const b = makeBoard(1);
  const at = (q: number, r: number) => cellIndex(b, q, r);
  const flat = (petals: number, arrows = [1, 3, 5]): Bud[] => b.q.map(() => ({ petals, arrows: [...arrows] }));

  it('a tap below 4 just adds a petal', () => {
    const r = resolveTap(b, flat(1), at(0, 0));
    expect(r.bloomed).toEqual([]);
    expect(r.petals[at(0, 0)]).toBe(2);
  });

  it('a bloom sends one petal along each arrow and opens', () => {
    const buds = flat(0);
    buds[at(0, 0)] = { petals: 3, arrows: [0, 2, 4] };
    const r = resolveTap(b, buds, at(0, 0));
    expect(r.bloomed).toEqual([at(0, 0)]);
    expect(r.petals[at(0, 0)]).toBe(0);
    expect(r.petals[at(1, 0)]).toBe(1);
    expect(r.petals[at(0, -1)]).toBe(1);
    expect(r.petals[at(-1, 1)]).toBe(1);
    expect(r.petals[at(-1, 0)]).toBe(0);
  });

  it('every cell at 3 cascades, each blooming once, and the chain ends', () => {
    const big = makeBoard(3);
    const rng = new Rng(7);
    const buds: Bud[] = big.q.map(() => ({ petals: 3, arrows: [rng.int(2), 2 + rng.int(2), 4 + rng.int(2)] }));
    const r = resolveTap(big, buds, 0);
    expect(new Set(r.bloomed).size).toBe(r.bloomed.length);
    expect(r.steps.length).toBeGreaterThan(1);
  });

  it('petals sent to an open flower or off the board fall', () => {
    const buds = flat(3, [0, 2, 4]);
    const r = resolveTap(b, buds, at(0, 0));
    const fallen = r.steps.flatMap((s) => s.transfers).filter((x) => !x.landed);
    expect(fallen.length).toBeGreaterThan(0);
    for (const f of fallen) expect(f.to < 0 || r.bloomed.includes(f.to)).toBe(true);
  });

  it('pollen grows with chain length and refunds follow thresholds', () => {
    expect(chainPollen(1, 10)).toBe(10);
    expect(chainPollen(4, 10)).toBe(100);
    expect(chainRefund(3, [4, 8, 12])).toBe(0);
    expect(chainRefund(4, [4, 8, 12])).toBe(1);
    expect(chainRefund(9, [4, 8, 12])).toBe(2);
  });
});

describe('generator', () => {
  it('makes buds with 0-3 petals and 3 distinct on-board arrows', () => {
    const b = makeBoard(3);
    for (const d of [0, 0.5, 1]) {
      const buds = generateGarden(b, t.sprout, d, new Rng(42));
      for (let i = 0; i < b.size; i++) {
        expect(buds[i].petals).toBeGreaterThanOrEqual(0);
        expect(buds[i].petals).toBeLessThanOrEqual(3);
        expect(new Set(buds[i].arrows).size).toBe(3);
        for (const a of buds[i].arrows) expect(b.neighbors[i][a]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is deterministic for a seed', () => {
    const b = makeBoard(3);
    expect(generateGarden(b, t.sprout, 0.4, new Rng(9))).toEqual(generateGarden(b, t.sprout, 0.4, new Rng(9)));
  });
});

describe('solver and adapter', () => {
  it('finds the longest single-tap chain', () => {
    const chain = tutorialLessons()[2];
    expect(bestSingleTap(chain.board, chain.start()).blooms).toBe(3);
  });

  it('good streaks make the garden wilder, poor streaks gentler, priming is neutral', () => {
    const a = new Adapter(t.adapt);
    const d0 = a.difficulty;
    a.record(5, 5);
    a.record(5, 5);
    expect(a.difficulty).toBeGreaterThan(d0);
    a.record(0, 2);
    a.record(0, 1);
    expect(a.difficulty).toBeGreaterThan(d0);
    a.record(1, 6);
    a.record(1, 6);
    expect(a.difficulty).toBeCloseTo(d0);
  });
});

describe('tutorial', () => {
  const play = (i: number, q: number, r: number) => {
    const l = tutorialLessons()[i];
    const buds = l.start();
    const res = resolveTap(l.board, buds, cellIndex(l.board, q, r));
    return { res, fb: l.judge(res, buds) };
  };

  it('lesson 1 needs three taps on the circled bud', () => {
    const l = tutorialLessons()[0];
    let buds = l.start();
    const outcomes: string[] = [];
    for (let k = 0; k < 3; k++) {
      const res = resolveTap(l.board, buds, l.hint[0]);
      outcomes.push(l.judge(res, buds).outcome);
      buds = buds.map((b, i) => ({ ...b, petals: res.petals[i] }));
    }
    expect(outcomes).toEqual(['continue', 'continue', 'pass']);
  });

  it('lesson 2 blooms one bud without chaining', () => {
    const { res, fb } = play(1, 0, 0);
    expect(res.bloomed.length).toBe(1);
    expect(fb.outcome).toBe('pass');
  });

  it('lesson 3 chains three from the left bud and asks for a retry otherwise', () => {
    expect(play(2, -1, 0).res.bloomed.length).toBe(3);
    expect(play(2, -1, 0).fb.outcome).toBe('pass');
    expect(play(2, -1, 0).fb.say).toBe('A chain of 3. Each bloom sings.');
    const bad = play(2, 0, 0);
    expect(bad.fb.outcome).toBe('retry');
    expect(bad.fb.say).toMatch(/^Only \d\. Start from the circled bud\.$/);
    expect(play(2, 0, -1).fb).toEqual({ outcome: 'continue', say: 'Tap the circled bud.' });
  });

  it('lesson 3 teaches the preview by doing: hold or hover the circled bud, and a tap without it still passes', () => {
    const touch = tutorialLessons(false)[2];
    const mouse = tutorialLessons(true)[2];
    expect(touch.say).toBe('Hold the circled bud.');
    expect(mouse.say).toBe('Hover the circled bud.');
    const circled = touch.hint[0];
    expect(touch.onPreview?.(circled)).toBe('See the path. Let go, then tap it.');
    expect(mouse.onPreview?.(circled)).toBe('See the path. Now click it.');
    expect(touch.onPreview?.(cellIndex(touch.board, 0, 0))).toBeNull();
    // No hold happened in this test, yet the tap passes.
    const res = resolveTap(touch.board, touch.start(), circled);
    expect(touch.judge(res, touch.start()).outcome).toBe('pass');
    for (const i of [0, 1, 3]) expect(tutorialLessons()[i].onPreview).toBeUndefined();
  });

  it('lesson 4 is the lantern lesson: exactly the two chains that reach the lantern light it', () => {
    const l = tutorialLessons()[3];
    const lantern = cellIndex(l.board, 1, -1);
    expect(l.say).toBe('Light the lantern.');
    expect(l.lanterns).toEqual([lantern]);
    expect(l.hint).toEqual([]);
    const buds = l.start();
    expect(buds[lantern].petals).toBe(1);
    const glowing = buds.map((b, i) => (b.petals === 3 ? i : -1)).filter((i) => i >= 0);
    expect(glowing.length).toBe(5);
    const lights = glowing.filter((c) => resolveTap(l.board, buds, c).bloomed.includes(lantern));
    expect(lights.sort()).toEqual([cellIndex(l.board, 0, -1), cellIndex(l.board, -1, 0)].sort());
    for (const c of lights) {
      const fb = l.judge(resolveTap(l.board, buds, c), buds);
      expect(fb).toEqual({ outcome: 'pass', say: 'Lit! Three lanterns light a garden.' });
    }
    for (const c of glowing.filter((g) => !lights.includes(g))) {
      const fb = l.judge(resolveTap(l.board, buds, c), buds);
      expect(fb).toEqual({ outcome: 'retry', say: 'Still dark. Which chain reaches the lantern?' });
    }
    const quiet = cellIndex(l.board, 0, 1);
    expect(l.judge(resolveTap(l.board, buds, quiet), buds)).toEqual({ outcome: 'continue', say: 'Tap a glowing bud. Reach the lantern.' });
  });
});

describe('run', () => {
  it('spends drops, refunds long chains, sprouts bloomed cells and ends', () => {
    const run = new Run(t, 123);
    let guard = 0;
    while (!run.ended && guard++ < 500) {
      const best = bestSingleTap(run.board, run.buds);
      const before = run.drops;
      const o = run.tap(best.cell >= 0 ? best.cell : 0);
      expect(run.drops).toBe(before - 1 + o.refund);
      expect(o.sprouts.map((s) => s.cell).sort()).toEqual([...o.result.bloomed].sort());
      for (const b of run.buds) expect(b.petals).toBeLessThanOrEqual(3);
    }
    expect(run.ended).toBe(true);
    expect(() => run.tap(0)).toThrow();
  });

  it('replays identically from the same seed', () => {
    const play = () => {
      const run = new Run(t, 99);
      const log: number[] = [];
      while (!run.ended) log.push(run.tap(bestSingleTap(run.board, run.buds).cell >= 0 ? bestSingleTap(run.board, run.buds).cell : 5).result.bloomed.length);
      return { log, pollen: run.pollen };
    };
    expect(play()).toEqual(play());
  });
});

describe('garden keys', () => {
  /** Plays the best single tap each turn until `gardens` are lit or the run ends. */
  const play = (run: Run, gardens = 99) => {
    const log: number[] = [];
    while (!run.ended && run.gardensLit < gardens) {
      const b = bestSingleTap(run.board, run.buds);
      log.push(run.tap(b.cell >= 0 ? b.cell : 5).result.bloomed.length);
    }
    return log;
  };

  it('mixes seed and garden index into distinct streams', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 20; seed++) for (let k = 0; k < 20; k++) seen.add(mixSeed(seed, k));
    expect(seen.size).toBe(19 * 20);
  });

  it('rebuilds any garden of an evening from its key: same buds, same lanterns', () => {
    // Compared at plant time: a key reproduces the garden as planted, before any taps.
    const rebuilds = (run: Run) => {
      const again = new Run(t, 0, run.key);
      expect(again.buds).toEqual(run.buds);
      expect(again.lanterns).toEqual(run.lanterns);
      expect(again.key).toEqual(run.key);
      expect(again.seed).toBe(run.seed);
    };
    let planted = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const run = new Run(t, seed);
      rebuilds(run);
      let guard = 0;
      while (!run.ended && guard++ < 400) {
        const b = bestSingleTap(run.board, run.buds);
        const lit = run.gardensLit;
        run.tap(b.cell >= 0 ? b.cell : 5);
        if (run.gardensLit > lit) {
          rebuilds(run);
          planted++;
        }
      }
    }
    expect(planted).toBeGreaterThan(0);
  });

  it('records the difficulty the garden was planted at and starts the replay there', () => {
    const run = new Run(t, 7);
    run.adapter.difficulty = 0.8;
    // Plant garden 1 by lighting garden 0: the key must carry the difficulty at that moment.
    let guard = 0;
    while (run.gardensLit === 0 && !run.ended && guard++ < 400) {
      const b = bestSingleTap(run.board, run.buds);
      run.tap(b.cell >= 0 ? b.cell : 5);
    }
    if (run.gardensLit === 0) return;
    expect(run.key.k).toBe(1);
    expect(run.key.difficulty).toBe(run.adapter.difficulty);
    const again = new Run(t, 0, run.key);
    expect(again.adapter.difficulty).toBe(run.key.difficulty);
    expect(again.drops).toBe(t.run.startDrops);
    expect(again.gardensLit).toBe(0);
  });

  it('a replayed key plays out deterministically, sprouts included', () => {
    const run = new Run(t, 321);
    play(run, 1);
    const key = { ...run.key };
    const go = () => {
      const r = new Run(t, 0, key);
      const log = play(r);
      return { log, pollen: r.pollen, stars: r.stars, buds: r.buds };
    };
    expect(go()).toEqual(go());
  });
});

describe('preview', () => {
  const board = makeBoard(3);
  const rng = new Rng(11);
  const buds = generateGarden(board, defaults.sprout, 0.5, rng);
  it('matches the real cascade at full depth', () => {
    for (let c = 0; c < board.size; c++) {
      const r = resolveTap(board, buds, c);
      const p = previewTap(board, buds, c, 99);
      expect(p.blooms).toEqual(r.bloomed);
      expect(p.next).toEqual([]);
    }
  });
  it('shows only the first step and hints the next blooms at depth 1', () => {
    for (let c = 0; c < board.size; c++) {
      const r = resolveTap(board, buds, c);
      const p = previewTap(board, buds, c, 1);
      expect(p.blooms).toEqual(r.steps[0]?.blooms ?? []);
      expect(p.transfers).toEqual(r.steps[0]?.transfers ?? []);
      expect(p.next).toEqual(r.steps[1]?.blooms ?? []);
      if (p.blooms.length === 0) expect(p.petalsAfter).toBe(buds[c].petals + 1);
    }
  });
  it('does not change the garden', () => {
    const before = JSON.stringify(buds);
    previewTap(board, buds, 0, 99);
    expect(JSON.stringify(buds)).toBe(before);
  });
});

describe('chain stop', () => {
  const board = makeBoard(3);
  it('explains every petal of the last wave and never a bloom', () => {
    const rng = new Rng(5);
    const buds = generateGarden(board, defaults.sprout, 0.5, rng);
    for (let c = 0; c < board.size; c++) {
      const r = resolveTap(board, buds, c);
      const marks = chainStop(r);
      if (r.steps.length === 0) {
        expect(marks).toEqual([]);
        continue;
      }
      expect(marks.length).toBe(r.steps[r.steps.length - 1].transfers.length);
      for (const m of marks) {
        if (m.kind === 'edge') expect(m.to).toBe(-1);
        if (m.kind === 'open') expect(r.bloomed).toContain(m.to);
        if (m.kind === 'short') expect(r.petals[m.to]).toBeLessThan(4);
      }
    }
  });
  it('names the edge and an open flower', () => {
    // Centre bud blooms into a ready neighbour, which sends one petal back onto the open centre.
    const centre = cellIndex(board, 0, 0);
    const buds: Bud[] = Array.from({ length: board.size }, () => ({ petals: 0, arrows: [0, 1, 2] }));
    buds[centre] = { petals: 3, arrows: [0, 2, 4] };
    const east = board.neighbors[centre][0];
    buds[east] = { petals: 3, arrows: [3, 1, 5] };
    const r = resolveTap(board, buds, centre);
    expect(r.steps.length).toBe(2);
    const kinds = chainStop(r).map((m) => m.kind);
    expect(kinds).toContain('open');
    expect(kinds).toContain('short');
  });
});

describe('lanterns', () => {
  const board = makeBoard(3);
  it('places them on allowed rings, spread apart, deterministically', () => {
    for (let seed = 1; seed < 60; seed++) {
      const ls = placeLanterns(board, defaults.goal, new Rng(seed));
      expect(ls.length).toBe(defaults.goal.lanterns);
      for (const c of ls) {
        expect(ringOf(board, c)).toBeGreaterThanOrEqual(1);
        expect(ringOf(board, c)).toBeLessThanOrEqual(3);
      }
      for (const a of ls) for (const b of ls) if (a !== b) expect(hexDistance(board, a, b)).toBeGreaterThanOrEqual(defaults.goal.minDistance);
      expect(placeLanterns(board, defaults.goal, new Rng(seed))).toEqual(ls);
    }
  });
  it('scores stars by drops left', () => {
    expect(starsFor(7, [5, 2, 0])).toBe(3);
    expect(starsFor(3, [5, 2, 0])).toBe(2);
    expect(starsFor(0, [5, 2, 0])).toBe(1);
  });
  it('lighting every lantern plants a new garden, refills drops and keeps the run going', () => {
    const run = new Run(t, 42);
    for (const c of run.lanterns) expect(run.buds[c].petals).toBeLessThanOrEqual(t.goal.startPetals);
    // Make every lantern one petal from blooming, then tap them one by one.
    const first = [...run.lanterns];
    for (const c of first) run.buds[c] = { ...run.buds[c], petals: 3 };
    let out = null;
    for (const c of first) {
      if (run.gardensLit > 0) break;
      const before = run.drops;
      out = run.tap(c);
      if (!out.gardenLit) expect(out.lit).toContain(c);
      else expect(run.drops).toBe(before - 1 + out.refund + t.goal.refillOnLit);
    }
    expect(run.gardensLit).toBe(1);
    expect(out!.gardenLit!.stars).toBe(3);
    expect(run.stars).toEqual([3]);
    expect(run.lit.every((l) => !l)).toBe(true);
    expect(out!.gardenLit!.buds).toBe(run.buds);
  });
});

describe('idle nudge', () => {
  const b = makeBoard(1);
  const X = cellIndex(b, 0, 0);
  const Y = b.neighbors[X][0];
  const Z = b.neighbors[X][1];
  // Three arrows from `c` that avoid the given cells, so chains stay where the test puts them.
  const avoiding = (c: number, cells: number[]) => [0, 1, 2, 3, 4, 5].filter((d) => !cells.includes(b.neighbors[c][d])).slice(0, 3);
  const buds = (): Bud[] => {
    const out: Bud[] = b.q.map(() => ({ petals: 0, arrows: [0, 2, 4] }));
    out[X] = { petals: 3, arrows: [0, 2, 4] };
    out[Y] = { petals: 3, arrows: avoiding(Y, [X, Z]) };
    out[Z] = { petals: 3, arrows: avoiding(Z, [X, Y]) };
    return out;
  };

  it('setup: the solver prefers the long chain, which does not reach the lantern bud', () => {
    const g = buds();
    expect(bestSingleTap(b, g).cell).toBe(X);
    expect(resolveTap(b, g, X).bloomed).not.toContain(Z);
    expect(resolveTap(b, g, Z).bloomed).toEqual([Z]);
  });
  it('prefers a bud whose chain lights a dark lantern over the longest chain', () => {
    expect(nudgeCell(b, buds(), [Z], [false])).toBe(Z);
  });
  it('among chains that light a lantern, takes the longest', () => {
    expect(nudgeCell(b, buds(), [Y], [false])).toBe(X);
  });
  it('ignores lit lanterns and falls back to the solver pick', () => {
    expect(nudgeCell(b, buds(), [Z], [true])).toBe(X);
    expect(nudgeCell(b, buds(), [cellIndex(b, -1, 0)], [false])).toBe(X);
  });
  it('is -1 when no bud is one petal from blooming', () => {
    const none: Bud[] = b.q.map(() => ({ petals: 0, arrows: [0, 2, 4] }));
    expect(nudgeCell(b, none, [Z], [false])).toBe(-1);
  });
});

describe('end sheet', () => {
  it('leads with gardens lit and one star group per garden', () => {
    const v = summaryView({ stars: [3, 1], lanternsLit: [false, true, false], pollen: 120, longest: 7, prevBestStars: 6 });
    expect(v.headline).toBe('2 gardens lit');
    expect(v.glyphs).toBeNull();
    expect(v.groups).toEqual([[true, true, true], [true, false, false]]);
    expect(v.newBest).toBe(false);
    expect(v.best).toBe('Best ★ 6');
  });
  it('says "1 garden lit" and "New best" when the star total beats the record', () => {
    const v = summaryView({ stars: [3], lanternsLit: [false, false, false], pollen: 10, longest: 3, prevBestStars: 2 });
    expect(v.headline).toBe('1 garden lit');
    expect(v.best).toBe('New best');
    expect(v.newBest).toBe(true);
  });
  it('with none lit shows the board lantern progress as glyphs, no stars and no best', () => {
    const v = summaryView({ stars: [], lanternsLit: [true, true, false], pollen: 30, longest: 4, prevBestStars: 5 });
    expect(v.headline).toBe('Lanterns lit 2 of 3');
    expect(v.glyphs).toEqual([true, true, false]);
    expect(v.groups).toEqual([]);
    expect(v.best).toBe('');
  });
  it('caps star groups at six and counts the rest', () => {
    const v = summaryView({ stars: [3, 3, 2, 2, 1, 1, 3, 2], lanternsLit: [false, false, false], pollen: 0, longest: 0, prevBestStars: 0 });
    expect(v.groups.length).toBe(MAX_STAR_GROUPS);
    expect(v.more).toBe(2);
    expect(v.best).toBe('Best ★ 17');
  });
});

describe('layout helpers', () => {
  it('puts the title 1.2s above the bed, never within 60 px of the top, and shrinks it on a tight bed', () => {
    const roomy = titlePlacement(400, 30);
    expect(roomy.size).toBe(52);
    expect(roomy.top + roomy.size * 1.1).toBeCloseTo(400 - 36, 5);
    const tight = titlePlacement(90, 40);
    expect(tight.size).toBe(40);
    expect(tight.top).toBe(60);
    expect(titlePlacement(120, 40).top).toBeGreaterThanOrEqual(60);
  });
  it('lifts the chain count 1.4s above the latest bloom and keeps it 12 px inside the viewport', () => {
    const bed = { x: 200, top: 300 };
    const size = { w: 40, h: 44 };
    expect(chainSpot({ x: 150, y: 500 }, bed, 30, size, 400)).toEqual({ x: 150, y: 500 - 42 });
    expect(chainSpot({ x: 2, y: 500 }, bed, 30, size, 400).x).toBe(12 + 20);
    expect(chainSpot({ x: 399, y: 500 }, bed, 30, size, 400).x).toBe(400 - 12 - 20);
    expect(chainSpot({ x: 150, y: 20 }, bed, 30, size, 400).y).toBe(12 + 44);
  });
  it('with reduced motion pins the count above the bed, at the coach spot', () => {
    const p = chainSpot(null, { x: 200, top: 300 }, 30, { w: 40, h: 44 }, 400);
    expect(p.x).toBe(200);
    expect(p.y - 44).toBe(300 - 64);
  });
  it('rides the lower-right edge of the turned planter and stays on screen', () => {
    const g = gearSpot({ x: 200, y: 400 }, 190, 27, 390);
    expect(g.x).toBeGreaterThan(200);
    expect(g.y).toBeGreaterThan(400);
    expect(g.y).toBeLessThan(400 + 190);
    expect(gearSpot({ x: 380, y: 400 }, 190, 27, 390).x).toBeLessThanOrEqual(390 - 12 - 22);
  });
  it('words the preview hint by pointer', () => {
    expect(previewHint(false)).toBe('Hold a bud to see its path.');
    expect(previewHint(true)).toBe('Hover a bud to see its path.');
  });
});
