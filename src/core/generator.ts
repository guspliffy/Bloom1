import type { Board } from './hex';
import type { Rng } from './rng';
import { MAX_PETALS, type Bud } from './rules';

export interface SproutParams {
  petalWeightsGentle: number[];
  petalWeightsWild: number[];
  /** How strongly arrows prefer neighbors that already hold petals. */
  alignGentle: number;
  alignWild: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Petal count for a fresh bud; difficulty 0 = gentle (fuller buds), 1 = wild (emptier buds). */
export function sproutPetals(p: SproutParams, difficulty: number, rng: Rng): number {
  const w = p.petalWeightsGentle.map((g, i) => lerp(g, p.petalWeightsWild[i] ?? 0, difficulty));
  return Math.min(MAX_PETALS, rng.weighted(w));
}

/**
 * Three arrows toward on-board neighbors. In a gentle garden arrows lean toward fuller neighbors,
 * so chains line up more often; in a wild garden they are close to random.
 */
export function sproutArrows(board: Board, petals: readonly number[], i: number, p: SproutParams, difficulty: number, rng: Rng): number[] {
  const align = lerp(p.alignGentle, p.alignWild, difficulty);
  const candidates: number[] = [];
  for (let d = 0; d < 6; d++) if (board.neighbors[i][d] >= 0) candidates.push(d);
  // Cells with fewer than 3 neighbors (radius 0) may point off the board.
  for (let d = 0; candidates.length < 3 && d < 6; d++) if (!candidates.includes(d)) candidates.push(d);
  const arrows: number[] = [];
  while (arrows.length < 3) {
    const weights = candidates.map((d) => {
      const n = board.neighbors[i][d];
      return 1 + align * (n >= 0 ? petals[n] / MAX_PETALS : 0);
    });
    const pick = candidates.splice(rng.weighted(weights), 1)[0];
    arrows.push(pick);
  }
  return arrows.sort((a, b) => a - b);
}

export function generateGarden(board: Board, p: SproutParams, difficulty: number, rng: Rng): Bud[] {
  const petals = board.q.map(() => sproutPetals(p, difficulty, rng));
  return petals.map((n, i) => ({ petals: n, arrows: sproutArrows(board, petals, i, p, difficulty, rng) }));
}
