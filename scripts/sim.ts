// Balance check: plays many runs with simple bots and prints run length and chain sizes.
// Usage: npm run sim [-- runs]
import defaults from '../config/tuning.json';
import { resolveTap, type Bud } from '../src/core/rules';
import { Run } from '../src/core/run';
import { bestSingleTap } from '../src/core/solver';
import type { Board } from '../src/core/hex';

type Bot = (board: Board, buds: Bud[], rnd: () => number, run: Run) => number;

const random: Bot = (b, _buds, rnd) => Math.floor(rnd() * b.size);
const greedy: Bot = (b, buds, rnd) => {
  const best = bestSingleTap(b, buds);
  return best.cell >= 0 ? best.cell : Math.floor(rnd() * b.size);
};
/** Takes a chain of 3+ if offered, otherwise primes the bud that sets up the longest next chain. */
const planner: Bot = (b, buds) => {
  const best = bestSingleTap(b, buds);
  if (best.blooms >= 3) return best.cell;
  let pick = { cell: best.cell >= 0 ? best.cell : 0, score: best.blooms };
  for (let i = 0; i < b.size; i++) {
    const r = resolveTap(b, buds, i);
    if (r.bloomed.length > 0) continue;
    const after = buds.map((x, j) => ({ petals: r.petals[j], arrows: x.arrows }));
    const s = bestSingleTap(b, after).blooms - 1.2;
    if (s > pick.score) pick = { cell: i, score: s };
  }
  return pick.cell;
};

/** Plays for the lanterns: values lanterns lit, then petals that reach unlit lanterns, then chain length. */
const lanterner: Bot = (b, buds, _rnd, run) => {
  const unlit = run.lanterns.filter((_, k) => !run.lit[k]);
  let pick = { cell: 0, score: -Infinity };
  for (let i = 0; i < b.size; i++) {
    const r = resolveTap(b, buds, i);
    const lights = unlit.filter((c) => r.bloomed.includes(c)).length;
    const fill = unlit.reduce((a, c) => a + (r.bloomed.includes(c) ? 0 : r.petals[c] - buds[c].petals), 0);
    const s = lights * 100 + fill * 8 + r.bloomed.length;
    if (s > pick.score) pick = { cell: i, score: s };
  }
  return pick.cell;
};

const runs = Number(process.argv[2] ?? 300);
for (const [name, bot] of Object.entries({ random, greedy, planner, lanterner })) {
  let gardens = 0, starSum = 0, litSum = 0;
  const starHist = [0, 0, 0, 0];
  let taps = 0, pollen = 0, longest = 0, chains = 0, chainSum = 0, diff = 0;
  const hist = new Array(16).fill(0);
  for (let s = 0; s < runs; s++) {
    const run = new Run(structuredClone(defaults), s + 1);
    let x = s * 7919 + 1;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    while (!run.ended) {
      const o = run.tap(bot(run.board, run.buds, rnd, run));
      const n = o.result.bloomed.length;
      if (n > 0) { chains++; chainSum += n; hist[Math.min(15, n)]++; }
    }
    gardens += run.gardensLit; litSum += run.gardensLit * run.lanterns.length + run.litCount;
    for (const st of run.stars) { starSum += st; starHist[st]++; }
    taps += run.taps; pollen += run.pollen; longest += run.longest; diff += run.adapter.difficulty;
  }
  console.log(`${name.padEnd(8)} taps/run ${(taps / runs).toFixed(1)}  pollen ${(pollen / runs).toFixed(0)}  longest ${(longest / runs).toFixed(1)}  avg chain ${(chainSum / chains).toFixed(2)}  end difficulty ${(diff / runs).toFixed(2)}`);
  console.log('         chain sizes 1..15+: ' + hist.slice(1).join(' '));
  console.log(`         gardens lit/run ${(gardens / runs).toFixed(2)}  lanterns lit/run ${(litSum / runs).toFixed(2)}  stars 1/2/3: ${starHist.slice(1).join(' / ')}  avg stars ${(starSum / Math.max(1, gardens)).toFixed(2)}`);
}
