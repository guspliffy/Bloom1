import type { Board } from './hex';
import { resolveTap, type Bud, type Transfer } from './rules';

export interface PreviewPlan {
  cell: number;
  /** Cells that bloom within the shown depth, in bloom order (empty when the tap only adds a petal). */
  blooms: number[];
  /** Petal flights within the shown depth. */
  transfers: Transfer[];
  /** Cells that would bloom in the step after the shown depth: hinted, not explained. */
  next: number[];
  /** Petal count the tapped bud would show if it does not bloom. */
  petalsAfter: number;
}

/**
 * What a tap would do, cut to `depth` steps of the cascade (GDD §7 preview). Depth 1 shows the tapped
 * bud's own bloom and where its petals land, and marks which of those buds would bloom next, so the
 * rules are visible while longer chains are still the player's to read.
 */
export function previewTap(board: Board, buds: readonly Bud[], cell: number, depth: number): PreviewPlan {
  const r = resolveTap(board, buds, cell);
  const shown = r.steps.slice(0, Math.max(1, depth));
  return {
    cell,
    blooms: shown.flatMap((s) => s.blooms),
    transfers: shown.flatMap((s) => s.transfers),
    next: r.steps[shown.length]?.blooms ?? [],
    petalsAfter: r.bloomed.includes(cell) ? 0 : r.petals[cell],
  };
}
