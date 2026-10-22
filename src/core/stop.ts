import type { TapResult } from './rules';

/** Why one petal of a chain's last wave did not carry it on. */
export type StopKind = 'edge' | 'open' | 'short';

export interface StopMark {
  from: number;
  dir: number;
  /** Receiving cell, or -1 off the board. */
  to: number;
  kind: StopKind;
}

/**
 * Why a chain ended (alpha plan, Phase A): each petal of the last wave fell off the edge, fell onto a
 * flower already open, or landed on a bud that stayed short of blooming. Empty when nothing bloomed.
 */
export function chainStop(result: TapResult): StopMark[] {
  const last = result.steps[result.steps.length - 1];
  if (!last) return [];
  return last.transfers.map(({ from, dir, to, landed }) => ({
    from,
    dir,
    to,
    kind: landed ? 'short' : to < 0 ? 'edge' : 'open',
  }));
}
