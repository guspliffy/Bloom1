import { describe, expect, it } from 'vitest';
import defaults from '../config/tuning.json';
import { Adapter } from '../src/core/adapt';
import { generateGarden } from '../src/core/generator';
import { cellIndex, makeBoard } from '../src/core/hex';
import { introGardens } from '../src/core/intro';
import { Rng } from '../src/core/rng';
import { chainPollen, chainRefund, resolveTap, type Bud } from '../src/core/rules';
import { Run } from '../src/core/run';
import { bestSingleTap } from '../src/core/solver';

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
    const [, second] = introGardens();
    expect(bestSingleTap(second.board, second.buds).blooms).toBe(3);
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

describe('intro', () => {
  it('first garden blooms one bud, second chains three', () => {
    const [first, second] = introGardens();
    expect(resolveTap(first.board, first.buds, first.hint).bloomed.length).toBe(1);
    expect(resolveTap(second.board, second.buds, second.hint).bloomed.length).toBe(3);
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
