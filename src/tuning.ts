import defaults from '../config/tuning.json';

export type Tuning = typeof defaults;

/** Live tuning values. The dev panel mutates this object in place; code reads it at use time. */
export const tuning: Tuning = structuredClone(defaults);

/** Restore the file values in place, keeping every object and array identity (the panel stays bound). */
export function resetTuning(): void {
  const copy = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src)) {
      if (Array.isArray(v)) (dst[k] as unknown[]).splice(0, Infinity, ...v);
      else if (v && typeof v === 'object') copy(dst[k] as Record<string, unknown>, v as Record<string, unknown>);
      else dst[k] = v;
    }
  };
  copy(tuning as unknown as Record<string, unknown>, defaults as unknown as Record<string, unknown>);
}
