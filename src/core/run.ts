import { Adapter } from './adapt';
import { generateGarden, sproutArrows, sproutPetals } from './generator';
import { makeBoard, type Board } from './hex';
import { Rng } from './rng';
import { chainPollen, chainRefund, resolveTap, type Bud, type TapResult } from './rules';
import { bestSingleTap } from './solver';
import type { Tuning } from '../tuning';

export interface Sprout {
  cell: number;
  bud: Bud;
}

export interface TapOutcome {
  result: TapResult;
  pollen: number;
  refund: number;
  /** Longest chain a single tap could have started before this tap. */
  best: number;
  sprouts: Sprout[];
  ended: boolean;
}

/** One run: a garden, a drop budget and the score. Pure logic; the view replays each outcome. */
export class Run {
  readonly board: Board;
  buds: Bud[];
  drops: number;
  pollen = 0;
  longest = 0;
  totalBlooms = 0;
  taps = 0;
  ended = false;
  readonly adapter: Adapter;
  private rng: Rng;

  constructor(private t: Tuning, readonly seed: number) {
    this.rng = new Rng(seed);
    this.board = makeBoard(t.board.radius);
    this.adapter = new Adapter(t.adapt);
    this.buds = generateGarden(this.board, t.sprout, this.adapter.difficulty, this.rng);
    this.drops = t.run.startDrops;
  }

  tap(cell: number): TapOutcome {
    if (this.ended || this.drops <= 0) throw new Error('run is over');
    const best = bestSingleTap(this.board, this.buds).blooms;
    this.drops--;
    this.taps++;
    const result = resolveTap(this.board, this.buds, cell);
    const n = result.bloomed.length;
    const r = this.t.run;
    const refund = chainRefund(n, [r.refundChain1, r.refundChain2, r.refundChain3]);
    const pollen = chainPollen(n, this.t.score.pollenPerBloom);
    this.drops += refund;
    this.pollen += pollen;
    this.totalBlooms += n;
    this.longest = Math.max(this.longest, n);
    this.adapter.record(n, best);

    this.buds = this.buds.map((b, i) => ({ petals: result.petals[i], arrows: b.arrows }));
    const sprouts = this.sprout(result.bloomed);
    this.ended = this.drops <= 0;
    return { result, pollen, refund, best, sprouts, ended: this.ended };
  }

  private sprout(cells: readonly number[]): Sprout[] {
    const d = this.adapter.difficulty;
    const petals = this.buds.map((b) => b.petals);
    for (const c of cells) petals[c] = sproutPetals(this.t.sprout, d, this.rng);
    return cells.map((cell) => {
      const bud = { petals: petals[cell], arrows: sproutArrows(this.board, petals, cell, this.t.sprout, d, this.rng) };
      this.buds[cell] = bud;
      return { cell, bud };
    });
  }
}
