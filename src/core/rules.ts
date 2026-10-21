import type { Board } from './hex';

export const BLOOM_AT = 4;
export const MAX_PETALS = BLOOM_AT - 1;

export interface Bud {
  petals: number;
  /** Three distinct direction indices (0..5). */
  arrows: number[];
}

export interface Transfer {
  from: number;
  dir: number;
  /** Receiving cell, or -1 when the petal leaves the board. */
  to: number;
  /** False when the petal falls: off the board, or onto a flower that already bloomed this chain. */
  landed: boolean;
}

export interface ChainStep {
  /** Cells blooming in this step, in the order their final petal arrived. */
  blooms: number[];
  transfers: Transfer[];
}

export interface TapResult {
  tapped: number;
  steps: ChainStep[];
  /** Every bloomed cell, in bloom order. These sprout fresh buds once the chain settles. */
  bloomed: number[];
  /** Petal counts after the chain; bloomed cells read 0 until they sprout. */
  petals: number[];
}

/**
 * One tap: add a petal, then let blooms cascade step by step. A bloomed cell stays open for the
 * rest of the chain and catches nothing, so each cell blooms at most once and every chain ends.
 */
export function resolveTap(board: Board, buds: readonly Bud[], tapped: number): TapResult {
  const petals = buds.map((b) => b.petals);
  const open = new Array<boolean>(board.size).fill(false);
  const steps: ChainStep[] = [];
  const bloomed: number[] = [];

  petals[tapped] += 1;
  let frontier = petals[tapped] >= BLOOM_AT ? [tapped] : [];

  while (frontier.length > 0) {
    const transfers: Transfer[] = [];
    for (const b of frontier) {
      open[b] = true;
      petals[b] = 0;
      bloomed.push(b);
    }
    const next: number[] = [];
    for (const b of frontier) {
      for (const dir of buds[b].arrows) {
        const to = board.neighbors[b][dir];
        const landed = to >= 0 && !open[to];
        transfers.push({ from: b, dir, to, landed });
        if (!landed) continue;
        petals[to] += 1;
        if (petals[to] >= BLOOM_AT && !next.includes(to)) next.push(to);
      }
    }
    steps.push({ blooms: frontier, transfers });
    frontier = next;
  }
  return { tapped, steps, bloomed, petals };
}

export function chainPollen(blooms: number, perBloom: number): number {
  return (perBloom * blooms * (blooms + 1)) / 2;
}

export function chainRefund(blooms: number, thresholds: readonly number[]): number {
  return thresholds.filter((t) => blooms >= t).length;
}
