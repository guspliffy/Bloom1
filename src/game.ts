import { chainStep, type Synth } from './audio/synth';
import { introGardens, type IntroGarden } from './core/intro';
import { resolveTap } from './core/rules';
import { Run } from './core/run';
import type { Hud } from './hud';
import { tuning } from './tuning';
import type { GardenView } from './view/garden';
import type { Tweener } from './view/tween';

const INTRO_KEY = 'bloom.introDone';
const BEST_KEY = 'bloom.best';

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Flow: two intro gardens (first visit only), then runs until the drops are spent, then the summary. */
export class Game {
  run: Run | null = null;
  private intro: IntroGarden[] = [];
  busy = false;
  /** Bumped on every new garden so continuations from an abandoned chain stop quietly. */
  private epoch = 0;
  private fixedSeed: number | null;

  constructor(
    private garden: GardenView,
    private hud: Hud,
    private synth: Synth,
    private tw: Tweener,
    private relayout: () => void,
  ) {
    const params = new URLSearchParams(location.search);
    const seed = params.get('seed');
    this.fixedSeed = seed !== null && seed !== '' ? Number(seed) >>> 0 : null;
    garden.onTap = (cell) => this.tap(cell);
    if (params.has('intro') || store(INTRO_KEY) !== '1') this.intro = introGardens();
  }

  start(): void {
    if (this.intro.length > 0) this.showIntro();
    else this.newRun();
  }

  private showIntro(): void {
    const g = this.intro[0];
    this.garden.setGarden(g.board, g.buds);
    this.garden.hintCell = g.hint;
    this.hud.setStatsVisible(false);
    this.relayout();
  }

  newRun(): void {
    this.epoch++;
    this.busy = false;
    this.tw.clear();
    this.hud.hideSummary();
    const seed = this.fixedSeed ?? (Math.random() * 2 ** 32) >>> 0;
    this.run = new Run(tuning, seed);
    this.garden.hintCell = -1;
    this.garden.setGarden(this.run.board, this.run.buds);
    this.hud.setStatsVisible(true);
    this.hud.setDrops(this.run.drops);
    this.hud.setPollen(0);
    this.hud.setMood(this.run.adapter.mood);
    this.relayout();
  }

  private async tap(cell: number): Promise<void> {
    this.synth.unlock();
    if (this.busy) return;
    if (this.intro.length > 0) return this.introTap(cell);
    const run = this.run;
    if (!run || run.ended) return;

    const epoch = this.epoch;
    this.busy = true;
    const out = run.tap(cell);
    const n = out.result.bloomed.length;
    this.garden.tapFeedback(cell);
    this.hud.setDrops(run.drops - out.refund, true);
    if (n === 0) this.synth.drop();

    await this.garden.playChain(out.result, this.bloomHooks());
    if (epoch !== this.epoch) return;
    this.hud.endChain();

    if (n > 0) {
      const last = this.garden.cellGlobal(out.result.bloomed[n - 1]);
      this.hud.float(`+${out.pollen}`, last.x, last.y, 'pollen-f');
      this.hud.setPollen(run.pollen, true);
    }
    if (out.refund > 0) {
      const a = this.hud.dropsAnchor();
      this.hud.float(`+${out.refund} drop${out.refund > 1 ? 's' : ''}`, a.x, a.y, 'drop-f');
      this.hud.setDrops(run.drops, true);
      this.synth.refund(out.refund);
    }
    if (n > 0) {
      await this.tw.wait(tuning.feel.sproutDelayMs);
      if (epoch !== this.epoch) return;
      await this.garden.sprout(out.sprouts);
      if (epoch !== this.epoch) return;
    }
    this.garden.sync(run.buds);
    this.hud.setMood(run.adapter.mood);
    this.busy = false;
    if (out.ended) await this.finish(run, epoch);
  }

  private bloomHooks() {
    return {
      onBloom: (k: number, _cell: number, delay: number) => {
        this.synth.note(chainStep(k, tuning.audio.noteSteps), delay);
        setTimeout(() => this.hud.setChain(k + 1), delay);
        if (tuning.feel.vibrateMs > 0) navigator.vibrate?.(tuning.feel.vibrateMs);
      },
    };
  }

  private async introTap(cell: number): Promise<void> {
    const g = this.intro[0];
    const epoch = this.epoch;
    this.busy = true;
    const result = resolveTap(g.board, g.buds, cell);
    this.garden.tapFeedback(cell);
    if (result.bloomed.length === 0) this.synth.drop();
    await this.garden.playChain(result, this.bloomHooks());
    if (epoch !== this.epoch) return;
    this.hud.endChain();
    g.buds = g.buds.map((b, i) => ({ petals: result.petals[i], arrows: b.arrows }));
    if (result.bloomed.length === 0) {
      this.busy = false;
      return;
    }
    await this.tw.wait(1300);
    if (epoch !== this.epoch) return;
    this.intro.shift();
    this.busy = false;
    if (this.intro.length > 0) return this.showIntro();
    store(INTRO_KEY, '1');
    this.newRun();
    this.hud.toast(`${tuning.run.startDrops} drops. Longer chains give drops back.`, 4500);
  }

  private async finish(run: Run, epoch: number): Promise<void> {
    await this.tw.wait(700);
    if (epoch !== this.epoch) return;
    const prev = Number(store(BEST_KEY) ?? 0);
    const newBest = run.pollen > prev;
    if (newBest) store(BEST_KEY, String(run.pollen));
    this.synth.endChord();
    this.hud.showSummary({
      pollen: run.pollen,
      best: Math.max(prev, run.pollen),
      newBest: newBest && prev > 0,
      longest: run.longest,
      blooms: run.totalBlooms,
      taps: run.taps,
      efficiency: run.adapter.efficiency(),
    });
  }
}
