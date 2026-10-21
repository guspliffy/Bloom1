// Balance check: plays many runs with simple bots and prints run length and chain sizes.
// Usage: npm run sim [-- runs]
import defaults from '../config/tuning.json';
import { resolveTap, type Bud } from '../src/core/rules';
import { Run } from '../src/core/run';
import { bestSingleTap } from '../src/core/solver';
import type { Board } from '../src/core/hex';

type Bot = (board: Board, buds: Bud[], rnd: () => number) => number;

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

const runs = Number(process.argv[2] ?? 300);
for (const [name, bot] of Object.entries({ random, greedy, planner })) {
  let taps = 0, pollen = 0, longest = 0, chains = 0, chainSum = 0, diff = 0;
  const hist = new Array(16).fill(0);
  for (let s = 0; s < runs; s++) {
    const run = new Run(structuredClone(defaults), s + 1);
    let x = s * 7919 + 1;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    while (!run.ended) {
      const o = run.tap(bot(run.board, run.buds, rnd));
      const n = o.result.bloomed.length;
      if (n > 0) { chains++; chainSum += n; hist[Math.min(15, n)]++; }
    }
    taps += run.taps; pollen += run.pollen; longest += run.longest; diff += run.adapter.difficulty;
  }
  console.log(`${name.padEnd(8)} taps/run ${(taps / runs).toFixed(1)}  pollen ${(pollen / runs).toFixed(0)}  longest ${(longest / runs).toFixed(1)}  avg chain ${(chainSum / chains).toFixed(2)}  end difficulty ${(diff / runs).toFixed(2)}`);
  console.log('         chain sizes 1..15+: ' + hist.slice(1).join(' '));
}
