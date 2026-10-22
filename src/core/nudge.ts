import type { Board } from './hex';
import { resolveTap, type Bud } from './rules';
import { bestSingleTap } from './solver';

/**
 * The bud the first-run idle nudge circles (GDD §4): the longest single-tap chain among those that
 * light a dark lantern, so the first minute points at the goal; with none, the solver's best bud.
 * -1 when no bud is one petal from blooming.
 */
export function nudgeCell(board: Board, buds: readonly Bud[], lanterns: readonly number[], lit: readonly boolean[]): number {
  const dark = new Set(lanterns.filter((_, k) => !lit[k]));
  let best = { cell: -1, blooms: 0 };
  if (dark.size > 0) {
    for (let i = 0; i < board.size; i++) {
      if (buds[i].petals < 3) continue;
      const { bloomed } = resolveTap(board, buds, i);
      if (bloomed.length > best.blooms && bloomed.some((c) => dark.has(c))) best = { cell: i, blooms: bloomed.length };
    }
  }
  return best.cell >= 0 ? best.cell : bestSingleTap(board, buds).cell;
}
