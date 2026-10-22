/** Small deterministic PRNG (mulberry32) so a seed reproduces a garden exactly. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** Index chosen with probability proportional to its weight. */
  weighted(weights: readonly number[]): number {
    const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
    if (total <= 0) return this.int(weights.length);
    let x = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      x -= Math.max(0, weights[i]);
      if (x < 0) return i;
    }
    return weights.length - 1;
  }
}

/** Seed for garden k of an evening: well-mixed, so neighbouring gardens and seeds share no structure. */
export function mixSeed(seed: number, k: number): number {
  let h = ((seed >>> 0) ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
