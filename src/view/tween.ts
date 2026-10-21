export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t ** 3,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
  outElastic: (t: number) =>
    t === 0 || t === 1 ? t : 2 ** (-9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3.2)) + 1,
} satisfies Record<string, Ease>;

interface Tween {
  start: number;
  dur: number;
  ease: Ease;
  update: (v: number) => void;
  resolve: () => void;
}

/** Time-based tweens and waits driven by the render ticker, so a hidden tab pauses everything together. */
export class Tweener {
  private now = 0;
  private list: Tween[] = [];

  tick(dtMs: number): void {
    this.now += dtMs;
    const done: Tween[] = [];
    for (const tw of this.list) {
      if (this.now < tw.start) continue;
      const p = tw.dur <= 0 ? 1 : Math.min(1, (this.now - tw.start) / tw.dur);
      tw.update(tw.ease(p));
      if (p >= 1) done.push(tw);
    }
    if (done.length) {
      this.list = this.list.filter((t) => !done.includes(t));
      for (const t of done) t.resolve();
    }
  }

  to(dur: number, update: (v: number) => void, opts: { delay?: number; ease?: Ease } = {}): Promise<void> {
    return new Promise((resolve) => {
      this.list.push({ start: this.now + (opts.delay ?? 0), dur, ease: opts.ease ?? ease.outCubic, update, resolve });
    });
  }

  wait(ms: number): Promise<void> {
    return this.to(ms, () => {}, { ease: ease.linear });
  }

  /** Drop every running tween without resolving it (used when a run restarts mid-animation). */
  clear(): void {
    this.list = [];
  }
}
