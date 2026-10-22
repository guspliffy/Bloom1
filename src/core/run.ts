import { Adapter } from './adapt';
import { generateGarden, sproutArrows, sproutPetals } from './generator';
import { makeBoard, type Board } from './hex';
import { placeLanterns, starsFor } from './lanterns';
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
  /** Lantern cells this tap lit. */
  lit: number[];
  /** Set when this tap lit the garden's last lantern: its stars, and the next garden planted in its place. */
  gardenLit: { stars: number; buds: Bud[]; lanterns: number[] } | null;
  ended: boolean;
}

/**
 * One run (an evening): gardens in turn, a drop budget and the score. Each garden holds lanterns;
 * blooming them all lights the garden, scores stars by drops left, refills some drops and plants the
 * next garden. Pure logic; the view replays each outcome.
 */
export class Run {
  readonly board: Board;
  buds: Bud[] = [];
  drops: number;
  pollen = 0;
  longest = 0;
  totalBlooms = 0;
  taps = 0;
  ended = false;
  lanterns: number[] = [];
  lit: boolean[] = [];
  gardensLit = 0;
  /** Stars of each lit garden, in order. */
  stars: number[] = [];
  readonly adapter: Adapter;
  private rng: Rng;

  constructor(private t: Tuning, readonly seed: number) {
    this.rng = new Rng(seed);
    this.board = makeBoard(t.board.radius);
    this.adapter = new Adapter(t.adapt);
    this.plant();
    this.drops = t.run.startDrops;
  }

  private plant(): void {
    this.buds = generateGarden(this.board, this.t.sprout, this.adapter.difficulty, this.rng);
    this.lanterns = placeLanterns(this.board, this.t.goal, this.rng);
    this.lit = this.lanterns.map(() => false);
    for (const c of this.lanterns) this.buds[c] = { ...this.buds[c], petals: Math.min(this.buds[c].petals, this.t.goal.startPetals) };
  }

  get litCount(): number {
    return this.lit.filter(Boolean).length;
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

    const lit: number[] = [];
    this.lanterns.forEach((c, k) => {
      if (!this.lit[k] && result.bloomed.includes(c)) {
        this.lit[k] = true;
        lit.push(c);
      }
    });
    let gardenLit: TapOutcome['gardenLit'] = null;
    if (this.lanterns.length > 0 && this.lit.every(Boolean)) {
      const stars = starsFor(this.drops, this.t.goal.stars);
      this.gardensLit++;
      this.stars.push(stars);
      this.drops += this.t.goal.refillOnLit;
      this.plant();
      gardenLit = { stars, buds: this.buds, lanterns: this.lanterns };
    }
    this.ended = this.drops <= 0;
    return { result, pollen, refund, best, sprouts, lit, gardenLit, ended: this.ended };
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
