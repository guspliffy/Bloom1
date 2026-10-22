import defaults from '../../config/tuning.json';
import { Run } from '../../src/core/run';
import type { RunInput } from './validate';

/**
 * Replays the evening from its seed and tap log with the shipped tuning. Everything the client reported
 * must come out exactly, and the evening must have ended (no drops left): a half-played run is not a score.
 */
export function replayMatches(r: RunInput): boolean {
  try {
    const run = new Run(structuredClone(defaults), r.seed);
    for (const cell of r.tapLog) {
      if (run.ended || cell >= run.board.size) return false;
      run.tap(cell);
    }
    return (
      run.ended &&
      run.gardensLit === r.gardensLit &&
      run.stars.reduce((a, b) => a + b, 0) === r.stars &&
      run.pollen === r.pollen &&
      run.longest === r.longest &&
      run.taps === r.taps
    );
  } catch {
    return false;
  }
}
