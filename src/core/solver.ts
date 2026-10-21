import type { Board } from './hex';
import { resolveTap, type Bud } from './rules';

/** Longest chain any single tap can start right now (0 when no bud is one petal from blooming). */
export function bestSingleTap(board: Board, buds: readonly Bud[]): { cell: number; blooms: number } {
  let best = { cell: -1, blooms: 0 };
  for (let i = 0; i < board.size; i++) {
    if (buds[i].petals < 3) continue;
    const n = resolveTap(board, buds, i).bloomed.length;
    if (n > best.blooms) best = { cell: i, blooms: n };
  }
  return best;
}
