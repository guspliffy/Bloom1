export interface AdaptParams {
  start: number;
  step: number;
  goodRatio: number;
  poorRatio: number;
  streak: number;
}

export type Mood = 'Gentle' | 'Lively' | 'Wild';

/**
 * Adjusts how wild new sprouts are from how close each tap came to the best tap available.
 * Taps where nothing could bloom, and small priming taps, tell us nothing and count as neutral.
 */
export class Adapter {
  difficulty: number;
  private good = 0;
  private poor = 0;
  private ratios: number[] = [];

  constructor(private p: AdaptParams) {
    this.difficulty = p.start;
  }

  record(playerBlooms: number, bestBlooms: number): void {
    if (bestBlooms === 0) return;
    if (playerBlooms === 0 && bestBlooms < 3) return;
    const ratio = Math.min(1, playerBlooms / bestBlooms);
    this.ratios.push(ratio);
    if (ratio >= this.p.goodRatio) {
      this.good++;
      this.poor = 0;
    } else if (ratio < this.p.poorRatio) {
      this.poor++;
      this.good = 0;
    }
    if (this.good >= this.p.streak) {
      this.difficulty = Math.min(1, this.difficulty + this.p.step);
      this.good = 0;
    }
    if (this.poor >= this.p.streak) {
      this.difficulty = Math.max(0, this.difficulty - this.p.step);
      this.poor = 0;
    }
  }

  /** Average share of the best available chain the player found, 0..1, or null before any signal. */
  efficiency(): number | null {
    if (this.ratios.length === 0) return null;
    return this.ratios.reduce((a, b) => a + b, 0) / this.ratios.length;
  }

  get mood(): Mood {
    return this.difficulty < 1 / 3 ? 'Gentle' : this.difficulty < 2 / 3 ? 'Lively' : 'Wild';
  }
}
