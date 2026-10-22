import { scheduleChain, type ChainSchedule } from './audio/schedule';
import { chainStep, type Synth } from './audio/synth';
import { resolveTap, type Bud, type TapResult } from './core/rules';
import { Run, type GardenKey } from './core/run';
import { previewTap } from './core/preview';
import { nudgeCell } from './core/nudge';
import { chainStop } from './core/stop';
import { tutorialLessons, type Lesson } from './core/tutorial';
import { lerpColor, palette } from './view/palette';
import { previewHint, type Hud } from './hud';
import { isCleanRun } from './net/clean';
import { tuning } from './tuning';
import { hudMoteCount, REDUCED_MOTION, type GardenView, type PlayHooks } from './view/garden';
import type { Scene } from './view/scene';
import type { Tweener } from './view/tween';

const TUTORIAL_KEY = 'bloom.tutorialDone.v3';
const BEST_STARS_KEY = 'bloom.bestStars';
const FIRST_RUN_KEY = 'bloom.firstRunDone';
const PREVIEW_HINT_KEY = 'bloom.previewHintDone';
const SCORE_HINT_KEY = 'bloom.scoreHintDone';
const EDGE_HINT_KEY = 'bloom.edgeHintDone';
const OPEN_HINT_KEY = 'bloom.openHintDone';

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Flow: title moment, guided tutorial (first visit, or on request), runs until the drops are spent, then the garden rests. */
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
  /** Key of the garden left on the board when the evening ended; the summary's replay link starts it. */
  private restKey: GardenKey | null = null;
  /** The evening on the board began at a replay key, not at garden 0: it never reaches the boards. */
  private fromKey = false;
  /** Set by main: an evening ended (clean = eligible for the boards). Never awaited. */
  onEvening: ((run: Run, clean: boolean) => void) | null = null;
  private idleTimer = 0;
  /** The first gesture's unlock; the session's first chain waits for it (at most 200 ms). */
  private unlocking: Promise<void> = Promise.resolve();
  private audioWaited = false;
  /** The current lesson already showed its preview line (hold or hover happened). */
  private lessonPreviewed = false;
  /** The next run is the first after the tutorial: its lantern posts plant one by one. */
  private plantBeat = false;

  constructor(
    private garden: GardenView,
    private scene: Scene,
    private hud: Hud,
    private synth: Synth,
    private tw: Tweener,
    private relayout: () => void,
  ) {
    const params = new URLSearchParams(location.search);
    const seed = params.get('seed');
    this.fixedSeed = seed !== null && seed !== '' ? Number(seed) >>> 0 : null;
    document.getElementById('btn-replay')!.addEventListener('click', () => {
      synth.unlock();
      if (this.restKey) this.newRun(this.restKey);
    });
    garden.onTap = (cell) => void this.tap(cell);
    garden.onPreview = (cell) => {
      if (this.busy || this.hud.sheetOpen) return null;
      if (this.inTutorial) {
        const l = this.lessons[this.lessonIdx];
        const line = this.lessonPreviewed ? null : (l.onPreview?.(cell) ?? null);
        if (line) {
          // Taught by doing: the hold itself retires the run's later "Hold a bud" toast.
          this.lessonPreviewed = true;
          store(PREVIEW_HINT_KEY, '1');
          this.hud.coach(line, this.lessonIdx, this.lessons.length);
        }
        return previewTap(l.board, this.lessonBuds, cell, tuning.preview.depth);
      }
      const run = this.run;
      if (!run || run.ended) return null;
      return previewTap(run.board, run.buds, cell, tuning.preview.depth);
    };
    this.wantTutorial = params.has('tutorial') || params.has('intro') || store(TUTORIAL_KEY) !== '1';
  }

  start(): void {
    // The title is up before lesson 1's coach line, which fades in after it.
    this.hud.showTitle();
    if (this.wantTutorial) this.startTutorial();
    else this.newRun();
  }

  private resetScene(): void {
    this.epoch++;
    this.busy = false;
    this.tw.clear();
    this.synth.padOff();
    this.hud.hideSummary();
    this.hud.closeSheets();
    this.hud.hideGardenLit();
    this.hud.hideChain();
    this.scene.gather = null;
    this.scene.clearLift();
    this.scene.fireflyBoost = 1;
    this.scene.setNight(0);
  }

  /** Tapping an Evenings row: that gardener's evening, planted fresh. */
  plantSeed(seed: number, gardener: string): void {
    this.newRun(undefined, seed >>> 0);
    this.hud.toast(`${gardener}'s garden`);
  }

  /** Debug hook: end the evening now without sending it anywhere. */
  debugEnd(): void {
    const run = this.run;
    if (!run) return;
    run.ended = true;
    void this.finish(run, this.epoch, false);
  }

  startTutorial(): void {
    this.resetScene();
    this.lessons = tutorialLessons(matchMedia('(pointer: fine)').matches);
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
    this.garden.setLanterns(l.lanterns ?? [], (l.lanterns ?? []).map(() => false));
    this.lessonPreviewed = false;
    this.garden.hintCells = l.hint;
    this.garden.highlightArrows = this.lessonIdx === 1;
    this.hud.setStatsVisible(false);
    this.hud.coach(say ?? l.say, this.lessonIdx, this.lessons.length);
    this.relayout();
    this.garden.sproutIn();
  }

  /**
   * A fresh evening; with `from`, one that starts at exactly that garden (same buds and lanterns, full
   * drops); with `plant`, a fresh evening of that seed (an Evenings row), which still starts at garden 0.
   */
  newRun(from?: GardenKey, plant?: number): void {
    if (this.inTutorial) store(TUTORIAL_KEY, '1');
    this.resetScene();
    const seed = plant ?? this.fixedSeed ?? (Math.random() * 2 ** 32) >>> 0;
    this.fromKey = !!from;
    this.run = new Run(tuning, seed, from);
    this.lessons = [];
    this.hud.hideCoach();
    this.garden.hintCells = [];
    this.garden.highlightArrows = false;
    this.garden.setGarden(this.run.board, this.run.buds);
    const beat = this.plantBeat;
    this.plantBeat = false;
    this.garden.setLanterns(this.run.lanterns, this.run.lit, beat);
    this.hud.setStatsVisible(true);
    this.hud.setDrops(this.run.drops);
    this.hud.setPollen(0);
    this.relayout();
    if (beat) {
      // After the tutorial, wordless: the three posts plant one by one, each ringing once, then the buds sprout.
      const gap = tuning.feel.lanternBeatMs;
      const epoch = this.epoch;
      this.garden.sproutIn(this.run.lanterns.length * gap);
      void this.garden.plantLanterns(gap, () => epoch === this.epoch && this.synth.lantern());
    } else this.garden.sproutIn();
    this.armIdleHint();
  }

  /** First real run only: after a quiet spell, circle the best bud so the first minute explains itself. */
  private armIdleHint(): void {
    clearTimeout(this.idleTimer);
    if (store(FIRST_RUN_KEY) === '1') return;
    const run = this.run;
    this.idleTimer = window.setTimeout(() => {
      if (!run || run !== this.run || run.ended || this.busy) return;
      const cell = nudgeCell(run.board, run.buds, run.lanterns, run.lit);
      if (cell >= 0) this.garden.hintCells = [cell];
    }, tuning.feel.idleHintMs);
  }

  /** The run is one evening: each drop spent moves the sky toward night, refunds move it back. */
  private updateNight(drops: number): void {
    const start = tuning.run.startDrops;
    this.scene.setNight(Math.max(0, Math.min(1, (start - drops) / start)));
    this.scene.fireflyBoost = drops <= 2 ? 1.2 : 1;
  }

  /**
   * The very first chain of a session waits for the audio context to be running (at most 200 ms) so
   * no note is scheduled into a suspended context and lost, notably on iOS.
   */
  private async awaitAudio(): Promise<void> {
    if (this.audioWaited || this.synth.running) return;
    this.audioWaited = true;
    await Promise.race([this.unlocking, this.tw.wait(200)]);
  }

  /** Put the cascade on the note grid and schedule every note, chord and pad ahead of time. */
  private schedule(result: TapResult): ChainSchedule {
    const f = tuning.feel;
    const a = tuning.audio;
    const sched = scheduleChain(
      result.steps.map((s) => s.blooms),
      { ...a, firstStepDelayMs: f.firstStepDelayMs, holdBreathChain: f.holdBreathChain, holdBreathMs: f.holdBreathMs, holdBreathScale: f.holdBreathScale, holdBreath: !REDUCED_MOTION },
      performance.now(),
    );
    const n = sched.cues.length;
    for (const cue of sched.cues) {
      if (cue.audible) this.synth.note(chainStep(cue.k, a.noteSteps), cue.at, 1, cue.k + 1 >= a.octaveDoubleChain);
    }
    if (n >= a.padChain) {
      this.synth.padOn(sched.cues[a.padChain - 1].at);
      this.synth.padOff(sched.chordAt + 400);
    }
    if (n >= a.chordChain) this.synth.chord(sched.chordAt, n >= 8);
    if (n >= a.finaleChain) {
      this.synth.finale(sched.chordAt, sched.sixteenthMs);
      const pattern = tuning.feel.vibrateFinale;
      setTimeout(() => navigator.vibrate?.(pattern), sched.chordAt);
    }
    return sched;
  }

  private hooks(onMote: () => void, toHud: boolean): PlayHooks {
    return {
      onLantern: () => this.synth.lantern(),
      onBloom: (cue, x, y) => {
        const hue = lerpColor(palette.bloom[cue.k % palette.bloom.length], 0xffe9c4, 0.5);
        this.hud.setChain(cue.k + 1, `#${hue.toString(16).padStart(6, '0')}`, REDUCED_MOTION ? undefined : { x, y });
        this.scene.attract(x, y);
      },
      pollenTarget: () => this.hud.pollenAnchor(),
      onMote,
      toHud,
    };
  }

  private async tap(cell: number): Promise<void> {
    this.unlocking = this.synth.unlock();
    this.hud.hideTitle();
    if (this.busy || this.hud.sheetOpen) return;
    if (this.inTutorial) return this.lessonTap(cell);
    const run = this.run;
    if (!run || run.ended) return;

    const epoch = this.epoch;
    this.busy = true;
    clearTimeout(this.idleTimer);
    this.garden.hintCells = [];
    const pollenBefore = run.pollen;
    const out = run.tap(cell);
    const n = out.result.bloomed.length;
    const refill = out.gardenLit ? tuning.goal.refillOnLit : 0;
    this.hud.spendDrop();
    this.updateNight(run.drops - out.refund - refill);

    await this.garden.tapFeedback(cell);
    if (epoch !== this.epoch) return;
    this.garden.addTappedPetal(cell);
    if (n === 0) this.synth.drop();

    // Pollen reaches the counter mote by mote; the number ticks on each arrival.
    const motes = hudMoteCount(n);
    let arrived = 0;
    let motesDone: () => void = () => {};
    const motesIn = new Promise<void>((r) => (motesDone = r));
    if (motes === 0) motesDone();
    const onMote = () => {
      if (epoch !== this.epoch) return;
      arrived++;
      this.hud.setPollen(Math.round(pollenBefore + (out.pollen * arrived) / motes), true);
      this.synth.tick(arrived);
      if (arrived >= motes) motesDone();
    };

    await this.awaitAudio();
    if (epoch !== this.epoch) return;
    await this.garden.playChain(out.result, this.schedule(out.result), this.hooks(onMote, true));
    if (epoch !== this.epoch) return;
    this.hud.endChain();

    const jobs: Promise<unknown>[] = [Promise.race([motesIn, this.tw.wait(1600)])];
    if (out.refund > 0) {
      const last = this.garden.cellGlobal(out.result.bloomed[n - 1]);
      this.synth.refund();
      jobs.push(this.hud.refundDrops(out.refund, last.x, last.y, () => {}));
      this.updateNight(run.drops - refill);
    }
    // The lit garden does not sprout: its flowers stay open for the garden-lit moment.
    if (n > 0 && !out.gardenLit) {
      jobs.push(this.tw.wait(tuning.feel.sproutDelayMs).then(() => (epoch === this.epoch ? this.garden.sprout(out.sprouts) : undefined)));
    }
    await Promise.all(jobs);
    if (epoch !== this.epoch) return;
    this.hud.setPollen(run.pollen);
    if (out.gardenLit) {
      await this.gardenLit(run, out.gardenLit.stars, epoch);
      if (epoch !== this.epoch) return;
    } else this.garden.sync(run.buds);
    this.hud.setDrops(run.drops);
    this.busy = false;
    if (!out.ended && !out.gardenLit) this.teach(out.result);
    if (out.ended) {
      store(FIRST_RUN_KEY, '1');
      await this.finish(run, epoch);
    } else this.armIdleHint();
  }

  /**
   * Garden lit (GDD §7), in order, never stars and refill on one beat: halos dim, the lanterns flare with
   * the chord while the sky lifts and fireflies gather, "Garden lit" and the stars fill one by one, a
   * hold, then drops fly from the lanterns as the words fade, and the next garden sprouts.
   */
  private async gardenLit(run: Run, stars: number, epoch: number): Promise<void> {
    const g = tuning.goal;
    const six = 60000 / tuning.audio.bpm / 4;
    await this.garden.dimForGardenLit();
    if (epoch !== this.epoch) return;

    const points = this.garden.lanternPoints();
    this.synth.chord(0, true);
    this.synth.finale(0, six);
    this.scene.skyLift(g.skyLift, 300, g.skyLiftMs);
    this.scene.gatherTo(points);
    const flare = this.garden.flareLanterns();

    await this.tw.wait(500);
    if (epoch !== this.epoch) return;
    this.hud.showGardenLit();
    for (let i = 0; i < stars; i++) {
      await this.tw.wait(i === 0 ? 250 : g.starStaggerMs);
      if (epoch !== this.epoch) return;
      this.hud.fillLitStar(i);
      this.synth.tick(i);
    }
    await Promise.all([flare, this.tw.wait(320)]);
    if (epoch !== this.epoch) return;
    await this.tw.wait(g.starsHoldMs);
    if (epoch !== this.epoch) return;

    // The consequence, a beat after the stars: drops leave the lanterns while the words fade.
    this.synth.refund();
    this.hud.hideGardenLit();
    this.updateNight(run.drops);
    const drops = this.hud.refundDrops(g.refillOnLit, 0, 0, () => {}, points);
    await this.tw.wait(400);
    if (epoch !== this.epoch) return;
    await this.garden.fadeOut(300);
    if (epoch !== this.epoch) return;
    this.garden.setGarden(run.board, run.buds);
    this.garden.setLanterns(run.lanterns, run.lit);
    this.relayout();
    this.garden.sproutIn();
    await Promise.all([drops, this.tw.wait(700)]);
  }

  /** At most one first-time line after a tap, most useful first: the score, the preview, why a chain stopped. */
  private teach(result: TapResult): void {
    const once = (key: string, text: string, ms = 4200): boolean => {
      if (store(key) === '1') return false;
      store(key, '1');
      this.hud.toast(text, ms);
      return true;
    };
    if (result.bloomed.length >= tuning.hud.scoreHintChain && once(SCORE_HINT_KEY, 'Longer chains are worth much more.')) return;
    const fine = matchMedia('(pointer: fine)').matches;
    if (once(PREVIEW_HINT_KEY, previewHint(fine))) return;
    const kinds = new Set(chainStop(result).map((m) => m.kind));
    if (kinds.has('edge') && once(EDGE_HINT_KEY, 'Petals off the edge are lost.', 3400)) return;
    if (kinds.has('open')) once(OPEN_HINT_KEY, 'Open flowers catch no petals.', 3400);
  }

  private async lessonTap(cell: number): Promise<void> {
    const l = this.lessons[this.lessonIdx];
    const epoch = this.epoch;
    this.busy = true;
    const result = resolveTap(l.board, this.lessonBuds, cell);
    const fb = l.judge(result, this.lessonBuds);
    if (fb.outcome === 'continue') this.hud.coach(fb.say, this.lessonIdx, this.lessons.length);
    await this.garden.tapFeedback(cell);
    if (epoch !== this.epoch) return;
    this.garden.addTappedPetal(cell);
    if (result.bloomed.length === 0) this.synth.drop();
    await this.awaitAudio();
    if (epoch !== this.epoch) return;
    await this.garden.playChain(result, this.schedule(result), this.hooks(() => {}, false));
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
    this.plantBeat = true;
    this.newRun();
  }

  /** The garden rests: stillness, the sky past night, fireflies gather, the chord, then the tally. */
  private async finish(run: Run, epoch: number, report = true): Promise<void> {
    await this.tw.wait(600);
    if (epoch !== this.epoch) return;
    const f = tuning.feel;
    this.scene.setNight(1.15, f.endNightMs);
    this.scene.gather = this.garden.centre();
    this.garden.restDim = true;
    this.synth.endChord();
    await this.tw.wait(f.endNightMs * 0.6);
    if (epoch !== this.epoch) return;
    const prev = Number(store(BEST_STARS_KEY) ?? 0) || 0;
    const total = run.stars.reduce((a, b) => a + b, 0);
    if (total > prev) store(BEST_STARS_KEY, String(total));
    this.restKey = { ...run.key };
    // Queued and sent while the sheet rises; the sheet never waits for the network.
    if (report) this.onEvening?.(run, isCleanRun({ fromKey: this.fromKey, fixedSeed: this.fixedSeed !== null }));
    this.hud.showSummary(
      { stars: [...run.stars], lanternsLit: [...run.lit], pollen: run.pollen, longest: run.longest, prevBestStars: prev },
      (i) => this.synth.tick(i),
    );
  }
}
