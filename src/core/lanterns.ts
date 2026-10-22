import type { Board } from './hex';
import type { Rng } from './rng';

export interface GoalParams {
  /** Lanterns per garden. */
  lanterns: number;
  /** Least hex distance between two lanterns, so one chain rarely lights them all. */
  minDistance: number;
  /** Rings (hex distance from the centre) a lantern may stand on. */
  ring: number[];
  /** Petals a lantern bud starts with, so lighting one takes a chain or a few taps. */
  startPetals: number;
  /** Drops left when the last lantern lights, for 3, 2 and 1 stars. */
  stars: number[];
  /** Drops added when a garden is lit and the next one is planted. */
  refillOnLit: number;
}

export function hexDistance(board: Board, a: number, b: number): number {
  const dq = board.q[a] - board.q[b];
  const dr = board.r[a] - board.r[b];
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Ring of a cell: its hex distance from the centre. */
export function ringOf(board: Board, i: number): number {
  return (Math.abs(board.q[i]) + Math.abs(board.r[i]) + Math.abs(board.q[i] + board.r[i])) / 2;
}

/** Lantern cells for a new garden: on the allowed rings, spread at least `minDistance` apart. */
export function placeLanterns(board: Board, p: GoalParams, rng: Rng): number[] {
  const [lo, hi] = [Math.min(...p.ring), Math.max(...p.ring)];
  const pool: number[] = [];
  for (let i = 0; i < board.size; i++) {
    const r = ringOf(board, i);
    if (r >= lo && r <= hi) pool.push(i);
  }
  const out: number[] = [];
  // Retry from scratch if an early pick leaves no room (rare on a 37-cell board).
  for (let attempt = 0; attempt < 20 && out.length < p.lanterns; attempt++) {
    out.length = 0;
    const left = [...pool];
    while (out.length < p.lanterns && left.length > 0) {
      const c = left.splice(rng.int(left.length), 1)[0];
      if (out.every((o) => hexDistance(board, o, c) >= p.minDistance)) out.push(c);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Stars for a lit garden by drops left (before the refill): 3, 2 or 1. */
export function starsFor(dropsLeft: number, thresholds: readonly number[]): number {
  const [three, two] = thresholds;
  return dropsLeft >= three ? 3 : dropsLeft >= two ? 2 : 1;
}
