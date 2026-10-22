import defaults from '../../config/tuning.json';
import { tuning } from '../tuning';

declare const __BLOOM_VERSION__: string;

/** Package version plus a short hash of config/tuning.json (set by vite.config.ts); 'dev' where it is not defined. */
export const GAME_VERSION: string = typeof __BLOOM_VERSION__ === 'string' ? __BLOOM_VERSION__ : 'dev';

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** False once the dev panel has changed any tuning value: such an evening would not replay under the shipped rules. */
export function tuningIsDefault(): boolean {
  return same(tuning, defaults);
}

/**
 * Whether a finished evening may reach the boards (GDD §8: one ranking rule, replayable logs). Not from a
 * replay key, not with `?seed` fixing the garden, not with edited tuning.
 */
export function isCleanRun(o: { fromKey: boolean; fixedSeed: boolean }): boolean {
  return !o.fromKey && !o.fixedSeed && tuningIsDefault();
}
