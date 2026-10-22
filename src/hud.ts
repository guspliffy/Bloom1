import { tuning } from './tuning';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const DROP_SVG = '<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M6 1C4.4 3.6 1.5 6.6 1.5 9.9a4.5 4.5 0 0 0 9 0C10.5 6.6 7.6 3.6 6 1Z"/></svg>';
const LANTERN_SVG =
  '<svg viewBox="0 0 16 20" aria-hidden="true"><rect class="cap" x="5.5" y="1" width="5" height="2" rx="0.6"/>' +
  '<path class="glass" d="M8 4.2 13 7v6.2L8 16l-5-2.8V7Z"/></svg>';
/** The four-point pollen star, as the counter draws it. */
const STAR_PATH = 'M12 1.5c.7 5.6 4.9 9.8 10.5 10.5-5.6.7-9.8 4.9-10.5 10.5-.7-5.6-4.9-9.8-10.5-10.5C7.1 11.3 11.3 7.1 12 1.5Z';
const STAR_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;
const BLOOM_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true">' +
  [0, 72, 144, 216, 288].map((a) => `<ellipse cx="8" cy="4.2" rx="2.4" ry="3.6" transform="rotate(${a} 8 8)"/>`).join('') +
  '<circle cx="8" cy="8" r="2" fill="#fff4d6"/></svg>';

/** What the end sheet needs (GDD §7 "The garden rests"). */
export interface Summary {
  /** Stars (1..3) of each garden lit this evening, in order. */
  stars: number[];
  /** The garden on the board: which of its lanterns are lit. */
  lanternsLit: boolean[];
  pollen: number;
  longest: number;
  /** Best star total of earlier evenings (`bloom.bestStars`). */
  prevBestStars: number;
}

export interface SummaryView {
  headline: string;
  /** Three lantern glyphs under the headline, only when no garden was lit. */
  glyphs: boolean[] | null;
  /** One group of three star flags per lit garden, at most `maxGroups`. */
  groups: boolean[][];
  /** Gardens beyond `maxGroups`, shown as "+n". */
  more: number;
  best: string;
  newBest: boolean;
  totalStars: number;
}

export const MAX_STAR_GROUPS = 6;

/** Pure content of the end sheet: gardens and stars lead, pollen is second. */
export function summaryView(s: Summary): SummaryView {
  const lit = s.stars.length;
  const total = s.stars.reduce((a, b) => a + b, 0);
  const lanterns = s.lanternsLit.filter(Boolean).length;
  const newBest = lit > 0 && s.prevBestStars > 0 && total > s.prevBestStars;
  return {
    headline: lit > 0 ? `${lit} ${lit === 1 ? 'garden' : 'gardens'} lit` : `Lanterns lit ${lanterns} of ${s.lanternsLit.length}`,
    glyphs: lit > 0 ? null : s.lanternsLit,
    groups: s.stars.slice(0, MAX_STAR_GROUPS).map((n) => [0, 1, 2].map((i) => i < n)),
    more: Math.max(0, lit - MAX_STAR_GROUPS),
    best: lit === 0 ? '' : newBest ? 'New best' : `Best ★ ${Math.max(s.prevBestStars, total)}`,
    newBest,
    totalStars: total,
  };
}

/** Layout numbers from the GDD (§7 Layout, Title moment): presentation px, not gameplay tuning. */
const TITLE_TOP_MIN = 60;
const TITLE_SMALL_BED_TOP = 110;
const CHAIN_LIFT = 1.4;
const COACH_BLOCK = 64;
const VIEW_MARGIN = 12;
const GEAR_R = 22;

/** Where "Bloom" goes: its bottom at bed-top − 1.2s, never above 60 px from the top, 40 px type when the bed top is tight. */
export function titlePlacement(bedTop: number, s: number): { top: number; size: number } {
  const size = bedTop < TITLE_SMALL_BED_TOP ? 40 : 52;
  return { top: Math.max(TITLE_TOP_MIN, bedTop - 1.2 * s - size * 1.1), size };
}

/**
 * Bottom-centre of the chain count: 1.4s above the latest bloom, or with no bloom point (reduced
 * motion) fixed above the bed at the coach spot. Clamped 12 px inside the viewport.
 */
export function chainSpot(
  bloom: { x: number; y: number } | null,
  bed: { x: number; top: number },
  s: number,
  size: { w: number; h: number },
  vw: number,
): { x: number; y: number } {
  const rawX = bloom ? bloom.x : bed.x;
  const rawY = bloom ? bloom.y - CHAIN_LIFT * s : bed.top - COACH_BLOCK + size.h;
  const lo = VIEW_MARGIN + size.w / 2;
  const hi = vw - VIEW_MARGIN - size.w / 2;
  return { x: hi < lo ? vw / 2 : Math.min(hi, Math.max(lo, rawX)), y: Math.max(VIEW_MARGIN + size.h, rawY) };
}

/**
 * Centre of the settings button on the planter's rim, bottom-right, for a board turned 30° (corners
 * straight up and down): the middle of the lower-right edge, a touch outside it. `c` is the bed centre,
 * `rb` its corner radius, `s` the hex radius. Kept fully on screen.
 */
export function gearSpot(c: { x: number; y: number }, rb: number, s: number, vw: number): { x: number; y: number } {
  const d = 0.866 * rb + 0.2 * s;
  const a = Math.PI / 3;
  return { x: Math.min(vw - VIEW_MARGIN - GEAR_R - 6, c.x + d * Math.cos(a)), y: c.y + d * Math.sin(a) };
}

/** The one-time preview line after a run tap (GDD §7): hover on a mouse, hold on touch. */
export function previewHint(fine: boolean): string {
  return fine ? 'Hover a bud to see its path.' : 'Hold a bud to see its path.';
}

/** The bed's place on screen, for everything that speaks (GDD §7 Layout). */
export interface BedFrame {
  x: number;
  top: number;
  bottom: number;
  s: number;
  /** Settings button centre when it rides the planter rim (portrait), else null: bottom-right corner. */
  gear: { x: number; y: number } | null;
}

/** DOM overlay: drop pips, pollen counter, chain count, title, coach, toasts, the settings button and its sheets. */
export class Hud {
  private hud = $('hud');
  private pips = $('drops');
  private litMsg = $('lit');
  private litStars = $('lit-stars');
  private pollen = $('pollen');
  private pollenValue = this.pollen.querySelector('.value') as HTMLElement;
  private star = this.pollen.querySelector('.star') as SVGElement;
  private chain = $('chain');
  private title = $('title');
  private toastEl = $('toast');
  private summary = $('summary');
  private howto = $('howto');
  private settings = $('settings');
  private chainNum = $('chain-num');
  private coachEl = $('coach');
  private coachText = $('coach-text');
  private coachSteps = $('coach-steps');
  private shownPollen = 0;
  private starTurn = 0;
  private drops = 0;
  private chainHide = 0;
  private toastHide = 0;
  private titleHide = 0;
  private titleUp = false;
  private pendingCoach: { text: string; step: number; total: number } | null = null;
  private coachTimer = 0;
  private bed: BedFrame = { x: 0, top: 0, bottom: 0, s: 40, gear: null };
  private sheetWasOpen = false;
  /** Called when the settings or How to play sheet opens or closes (the board dims and scales). */
  onSheet: ((open: boolean) => void) | null = null;

  setStatsVisible(v: boolean): void {
    this.hud.classList.toggle('hide-stats', !v);
  }

  /** Where the bed is: the coach pill, chain count and stars sit above it, the toast below, the title above that. */
  setBed(b: BedFrame): void {
    this.bed = b;
    const root = document.documentElement;
    root.style.setProperty('--bed-top', `${Math.round(b.top)}px`);
    root.style.setProperty('--bed-bottom', `${Math.round(b.bottom)}px`);
    root.classList.toggle('rim', !!b.gear);
    if (b.gear) {
      root.style.setProperty('--gear-x', `${Math.round(b.gear.x)}px`);
      root.style.setProperty('--gear-y', `${Math.round(b.gear.y)}px`);
    }
    const t = titlePlacement(b.top, b.s);
    root.style.setProperty('--title-top', `${Math.round(t.top)}px`);
    root.style.setProperty('--title-size', `${t.size}px`);
  }

  /** Redraw the pip row for n drops. */
  setDrops(n: number): void {
    this.drops = n;
    const max = tuning.hud.maxPips;
    const count = Math.min(max, Math.max(tuning.run.startDrops, n));
    while (this.pips.children.length > count) this.pips.lastElementChild!.remove();
    this.pips.querySelector('.more')?.remove();
    while (this.pips.children.length < count) {
      const p = document.createElement('span');
      p.className = 'pip';
      p.innerHTML = DROP_SVG;
      this.pips.appendChild(p);
    }
    [...this.pips.children].forEach((p, i) => p.classList.toggle('empty', i >= n));
    if (n > max) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = `+${n - max}`;
      this.pips.appendChild(more);
    }
  }

  /** A tap spends the rightmost full pip. */
  spendDrop(): void {
    const i = this.drops - 1;
    this.setDrops(this.drops - 1);
    const p = this.pips.children[i] as HTMLElement | undefined;
    if (!p) return;
    p.classList.remove('spend');
    void p.offsetWidth;
    p.classList.add('spend');
  }

  /** Refunded drops fly from (x, y), or from `origins` in turn (the lanterns), into the first empty pips, 90 ms apart. */
  async refundDrops(count: number, x: number, y: number, onEach: () => void, origins?: readonly { x: number; y: number }[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (let k = 0; k < count; k++) {
      const target = Math.min(this.drops + k, tuning.hud.maxPips - 1);
      const pip = this.pips.children[Math.min(target, this.pips.children.length - 1)] as HTMLElement | undefined;
      const r = pip?.getBoundingClientRect() ?? this.pips.getBoundingClientRect();
      const tx = r.left + r.width / 2;
      const ty = r.top + r.height / 2;
      const el = document.createElement('div');
      el.className = 'fly-drop';
      el.innerHTML = DROP_SVG;
      document.body.appendChild(el);
      const from = origins && origins.length > 0 ? origins[k % origins.length] : { x, y };
      const mx = (from.x + tx) / 2 + (k % 2 ? 60 : -60);
      const my = Math.min(from.y, ty) - 30;
      const frames: Keyframe[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const u = 1 - t;
        const px = u * u * from.x + 2 * u * t * mx + t * t * tx;
        const py = u * u * from.y + 2 * u * t * my + t * t * ty;
        frames.push({ transform: `translate(${px}px, ${py}px) scale(${1.3 - 0.3 * t})`, opacity: t < 0.1 ? t * 10 : 1 });
      }
      el.style.left = '0';
      el.style.top = '0';
      const anim = el.animate(frames, { duration: 700, delay: k * 90, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', fill: 'both' });
      jobs.push(
        anim.finished.then(() => {
          el.remove();
          this.setDrops(this.drops + 1);
          const p = this.pips.children[Math.min(this.drops - 1, this.pips.children.length - 1)] as HTMLElement | undefined;
          if (p) {
            p.classList.remove('fill');
            void p.offsetWidth;
            p.classList.add('fill');
          }
          onEach();
        }),
      );
    }
    await Promise.all(jobs);
  }

  /** Screen point the pollen motes fly to. */
  pollenAnchor(): { x: number; y: number } {
    const r = this.star.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  setPollen(n: number, pop = false): void {
    this.shownPollen = n;
    this.pollenValue.textContent = String(n);
    if (!pop) return;
    this.starTurn += 15;
    this.star.style.transform = `rotate(${this.starTurn}deg)`;
    this.pollen.classList.remove('pop');
    void this.pollen.offsetWidth;
    this.pollen.classList.add('pop');
    setTimeout(() => this.pollen.classList.remove('pop'), 180);
  }

  get pollenShown(): number {
    return this.shownPollen;
  }

  /**
   * Chain count: the plain number from the third bloom, in the latest flower's colour, glowing and
   * growing on long chains. It eases to `at` (the latest bloom, screen coords) in 120 ms; with no `at`
   * (reduced motion) it stays fixed above the bed.
   */
  setChain(n: number, color = '#ffe9c4', at?: { x: number; y: number }): void {
    clearTimeout(this.chainHide);
    if (n < 3) return;
    const el = this.chain;
    const first = !el.classList.contains('show');
    this.chainNum.textContent = String(n);
    el.style.setProperty('--chain-color', color);
    el.classList.toggle('long', n >= tuning.feel.holdBreathChain);
    el.classList.toggle('finale', n >= tuning.audio.finaleChain);
    el.classList.remove('settled');
    const p = chainSpot(at ?? null, this.bed, this.bed.s, { w: el.offsetWidth, h: el.offsetHeight }, window.innerWidth);
    // A fresh count appears where it belongs instead of sliding in from the last chain's spot.
    if (first) el.classList.add('snap');
    el.style.transform = `translate(${Math.round(p.x - el.offsetWidth / 2)}px, ${Math.round(p.y - el.offsetHeight)}px)`;
    if (first) {
      void el.offsetWidth;
      el.classList.remove('snap');
    }
    el.classList.add('show', 'bump');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('bump')));
  }

  /** The chain settled: the "chain" label appears, and `feel.chainCountFadeMs` later both fade. */
  endChain(): void {
    clearTimeout(this.chainHide);
    if (!this.chain.classList.contains('show')) return;
    this.chain.classList.add('settled');
    this.chainHide = window.setTimeout(() => this.chain.classList.remove('show'), tuning.feel.chainCountFadeMs);
  }

  /** At once, for a new garden. */
  hideChain(): void {
    clearTimeout(this.chainHide);
    this.chain.classList.remove('show', 'settled');
  }

  showTitle(): void {
    this.titleUp = true;
    this.title.classList.add('show');
    clearTimeout(this.titleHide);
    this.titleHide = window.setTimeout(() => this.hideTitle(), tuning.feel.titleMs + 900);
  }

  /** Title fades; a coach line held back behind it fades in once the title is on its way out. */
  hideTitle(): void {
    clearTimeout(this.titleHide);
    this.title.classList.remove('show');
    if (!this.titleUp) return;
    this.titleUp = false;
    if (this.pendingCoach) this.coachTimer = window.setTimeout(() => this.flushCoach(), 450);
  }

  toast(text: string, ms = tuning.feel.toastMs): void {
    clearTimeout(this.toastHide);
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastHide = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** Garden lit: the words and three star outlines appear; the earned ones fill one by one (`fillLitStar`). */
  showGardenLit(): void {
    this.litStars.innerHTML = [0, 1, 2].map(() => `<i>${STAR_SVG}</i>`).join('');
    this.litMsg.classList.add('show');
  }

  /** Star i fills in pollen colour with a 320 ms pop. */
  fillLitStar(i: number): void {
    this.litStars.children[i]?.classList.add('on');
  }

  /** Words and stars fade over 400 ms. */
  hideGardenLit(): void {
    this.litMsg.classList.remove('show');
  }

  /** The garden rests: the sheet rises, the pip row steps aside and the pollen tally counts up, ticking as it goes. */
  showSummary(s: Summary, onTick: (i: number) => void): void {
    const v = summaryView(s);
    $('sum-gardens').textContent = v.headline;
    $('sum-lanterns').innerHTML = (v.glyphs ?? []).map((on) => `<i class="${on ? 'lit' : ''}">${LANTERN_SVG}</i>`).join('');
    $('sum-stars').innerHTML =
      v.groups.map((g) => `<span class="group">${g.map((on) => `<i class="${on ? 'on' : ''}">${STAR_SVG}</i>`).join('')}</span>`).join('') +
      (v.more > 0 ? `<span class="more">+${v.more}</span>` : '');
    $('sum-longest').textContent = String(s.longest);
    const best = $('sum-best');
    best.textContent = v.best;
    best.classList.toggle('new', v.newBest);
    const big = $('sum-pollen');
    big.textContent = '0';
    this.hud.classList.add('resting');
    this.summary.classList.remove('hidden');
    const ms = tuning.feel.tallyMs;
    const start = performance.now() + 300;
    let ticks = 0;
    const step = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / ms));
      big.textContent = String(Math.round(s.pollen * (1 - (1 - t) ** 2)));
      const want = Math.floor(t * 8);
      while (ticks < want && s.pollen > 0) onTick(ticks++);
      if (t < 1 && !this.summary.classList.contains('hidden')) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  hideSummary(): void {
    this.hud.classList.remove('resting');
    this.summary.classList.add('hidden');
  }

  /** Tutorial coach line above the bed, with seed dots that bloom as lessons pass. Held back while the title is up. */
  coach(text: string, step: number, total: number): void {
    if (this.titleUp || this.coachTimer) {
      this.pendingCoach = { text, step, total };
      return;
    }
    this.applyCoach(text, step, total);
  }

  private flushCoach(): void {
    this.coachTimer = 0;
    const c = this.pendingCoach;
    this.pendingCoach = null;
    if (c) this.applyCoach(c.text, c.step, c.total);
  }

  private applyCoach(text: string, step: number, total: number): void {
    if (this.coachSteps.children.length !== total) this.coachSteps.innerHTML = Array.from({ length: total }, () => `<i>${BLOOM_SVG}</i>`).join('');
    [...this.coachSteps.children].forEach((el, i) => (el.className = i < step ? 'done' : i === step ? 'now' : ''));
    this.coachEl.classList.add('show');
    if (this.coachText.textContent === text) return;
    this.coachText.classList.add('swap');
    setTimeout(() => {
      this.coachText.textContent = text;
      this.coachText.classList.remove('swap');
    }, 180);
  }

  hideCoach(): void {
    clearTimeout(this.coachTimer);
    this.coachTimer = 0;
    this.pendingCoach = null;
    this.coachEl.classList.remove('show');
    this.coachText.textContent = '';
  }

  showSettings(): void {
    this.howto.classList.add('hidden');
    this.settings.classList.remove('hidden');
    this.sheetChanged();
  }

  showHowto(): void {
    this.settings.classList.add('hidden');
    this.howto.classList.remove('hidden');
    this.sheetChanged();
  }

  closeSheets(): void {
    this.settings.classList.add('hidden');
    this.howto.classList.add('hidden');
    this.sheetChanged();
  }

  get sheetOpen(): boolean {
    return !this.settings.classList.contains('hidden') || !this.howto.classList.contains('hidden');
  }

  /** The Sound switch in the settings sheet. */
  setSound(on: boolean): void {
    $('btn-sound').setAttribute('aria-checked', String(on));
  }

  /** A sheet hides any toast and dims the board (the end sheet is separate: it keeps its own board dim). */
  private sheetChanged(): void {
    const open = this.sheetOpen;
    this.hud.classList.toggle('sheet-open', open);
    if (open === this.sheetWasOpen) return;
    this.sheetWasOpen = open;
    this.onSheet?.(open);
  }
}
