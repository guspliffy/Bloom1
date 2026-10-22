/** Sliding-window counters per key, in memory (a restart forgets them, which is fine for abuse limits). */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private now: () => number = Date.now) {}

  private live(key: string, windowMs: number): number[] {
    const t = this.now() - windowMs;
    const list = (this.hits.get(key) ?? []).filter((x) => x > t);
    if (list.length > 0) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** True and counted if `cost` more fit under `max` within the window; false (nothing counted) otherwise. */
  take(key: string, max: number, windowMs: number, cost = 1): boolean {
    const list = this.live(key, windowMs);
    if (list.length + cost > max) return false;
    const t = this.now();
    for (let i = 0; i < cost; i++) list.push(t);
    this.hits.set(key, list);
    return true;
  }

  /** Drop keys that have gone quiet; call now and then so the map cannot grow without bound. */
  sweep(windowMs: number): void {
    for (const key of [...this.hits.keys()]) this.live(key, windowMs);
  }
}

export interface Limits {
  /** Account creations per IP per hour. */
  accounts: number;
  /** Sign-in attempts per IP per 10 minutes. */
  signIns: number;
  /** Runs per IP per hour. */
  runs: number;
}

export const DEFAULT_LIMITS: Limits = { accounts: 5, signIns: 20, runs: 120 };
export const HOUR = 3_600_000;
export const TEN_MIN = 600_000;
