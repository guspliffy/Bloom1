import { chainStep, type Synth } from './audio/synth';
import { resolveTap } from './core/rules';
import { Run } from './core/run';
import { tutorialLessons, type Lesson } from './core/tutorial';
import type { Bud } from './core/rules';
import type { Hud } from './hud';
import { tuning } from './tuning';
import type { GardenView } from './view/garden';
import type { Tweener } from './view/tween';

const TUTORIAL_KEY = 'bloom.tutorialDone.v2';
const BEST_KEY = 'bloom.best';

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Flow: guided tutorial (first visit, or on request), how-to card, then runs until the drops are spent, then the summary. */
export class Game {
  run: Run | null = null;
  private lessons: Lesson[] = [];
  private lessonIdx = 0;
  private lessonBuds: Bud[] = [];
  private wantTutorial: boolean;
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
    this.wantTutorial = params.has('tutorial') || params.has('intro') || store(TUTORIAL_KEY) !== '1';
  }

  start(): void {
    if (this.wantTutorial) this.startTutorial();
    else this.newRun();
  }

  startTutorial(): void {
    this.epoch++;
    this.busy = false;
    this.tw.clear();
    this.hud.hideSummary();
    this.hud.hideHowto();
    this.lessons = tutorialLessons();
    this.lessonIdx = 0;
    this.showLesson();
  }

  private get inTutorial(): boolean {
    return this.lessonIdx < this.lessons.length;
  }

  private showLesson(say?: string): void {
    const l = this.lessons[this.lessonIdx];
    this.lessonBuds = l.start();
    this.garden.setGarden(l.board, this.lessonBuds);
    this.garden.hintCells = l.hint;
    this.garden.highlightArrows = this.lessonIdx === 1;
    this.hud.setStatsVisible(false);
    this.hud.coach(say ?? l.say, this.lessonIdx, this.lessons.length);
    this.relayout();
  }

  newRun(): void {
    if (this.inTutorial) store(TUTORIAL_KEY, '1');
    this.epoch++;
    this.busy = false;
    this.tw.clear();
    this.hud.hideSummary();
    const seed = this.fixedSeed ?? (Math.random() * 2 ** 32) >>> 0;
    this.run = new Run(tuning, seed);
    this.lessons = [];
    this.hud.hideCoach();
    this.garden.hintCells = [];
    this.garden.highlightArrows = false;
    this.garden.setGarden(this.run.board, this.run.buds);
    this.hud.setStatsVisible(true);
    this.hud.setDrops(this.run.drops);
    this.hud.setPollen(0);
    this.hud.setMood(this.run.adapter.mood);
    this.relayout();
  }

  private async tap(cell: number): Promise<void> {
    this.synth.unlock();
    if (this.busy || this.hud.howtoOpen) return;
    if (this.inTutorial) return this.lessonTap(cell);
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

  private async lessonTap(cell: number): Promise<void> {
    const l = this.lessons[this.lessonIdx];
    const epoch = this.epoch;
    this.busy = true;
    const result = resolveTap(l.board, this.lessonBuds, cell);
    const fb = l.judge(result, this.lessonBuds);
    this.garden.tapFeedback(cell);
    if (result.bloomed.length === 0) this.synth.drop();
    if (fb.outcome === 'continue') this.hud.coach(fb.say, this.lessonIdx, this.lessons.length);
    await this.garden.playChain(result, this.bloomHooks());
    if (epoch !== this.epoch) return;
    this.hud.endChain();
    this.lessonBuds = this.lessonBuds.map((b, i) => ({ petals: result.petals[i], arrows: b.arrows }));
    if (fb.outcome === 'continue') {
      this.busy = false;
      return;
    }
    this.hud.coach(fb.say, this.lessonIdx + (fb.outcome === 'pass' ? 1 : 0), this.lessons.length);
    await this.tw.wait(fb.outcome === 'pass' ? 2600 : 2200);
    if (epoch !== this.epoch) return;
    this.busy = false;
    if (fb.outcome === 'retry') return this.showLesson(fb.say);
    this.lessonIdx++;
    if (this.inTutorial) return this.showLesson();
    store(TUTORIAL_KEY, '1');
    this.newRun();
    this.hud.showHowto();
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
