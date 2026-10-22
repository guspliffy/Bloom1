import { tuning } from './tuning';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const DROP_SVG = '<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M6 1C4.4 3.6 1.5 6.6 1.5 9.9a4.5 4.5 0 0 0 9 0C10.5 6.6 7.6 3.6 6 1Z"/></svg>';
const BLOOM_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true">' +
  [0, 72, 144, 216, 288].map((a) => `<ellipse cx="8" cy="4.2" rx="2.4" ry="3.6" transform="rotate(${a} 8 8)"/>`).join('') +
  '<circle cx="8" cy="8" r="2" fill="#fff4d6"/></svg>';

export interface Summary {
  pollen: number;
  best: number;
  newBest: boolean;
  longest: number;
  blooms: number;
}

/** DOM overlay: drop pips, pollen counter, chain count, title, coach, toasts and the bottom sheets. */
export class Hud {
  private hud = $('hud');
  private pips = $('drops');
  private pollen = $('pollen');
  private pollenValue = this.pollen.querySelector('.value') as HTMLElement;
  private star = this.pollen.querySelector('.star') as SVGElement;
  private chain = $('chain');
  private title = $('title');
  private toastEl = $('toast');
  private summary = $('summary');
  private howto = $('howto');
  private coachEl = $('coach');
  private coachText = $('coach-text');
  private coachSteps = $('coach-steps');
  private shownPollen = 0;
  private starTurn = 0;
  private drops = 0;
  private chainHide = 0;
  private toastHide = 0;
  private titleHide = 0;

  setStatsVisible(v: boolean): void {
    this.hud.classList.toggle('hide-stats', !v);
  }

  /** Pixel y of the bed's top edge, so the title and chain count sit just above it. */
  setBedTop(y: number): void {
    document.documentElement.style.setProperty('--bed-top', `${Math.round(y)}px`);
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

  /** Refunded drops fly from (x, y) into the first empty pips, one by one. */
  async refundDrops(count: number, x: number, y: number, onEach: () => void): Promise<void> {
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
      const mx = (x + tx) / 2 + (k % 2 ? 60 : -60);
      const my = Math.min(y, ty) - 30;
      const frames: Keyframe[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const u = 1 - t;
        const px = u * u * x + 2 * u * t * mx + t * t * tx;
        const py = u * u * y + 2 * u * t * my + t * t * ty;
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

  /** Chain count "×n", shown from the third bloom of a chain, in the latest flower's colour; it glows and grows on long chains. */
  setChain(n: number, color = '#ffe9c4'): void {
    clearTimeout(this.chainHide);
    if (n < 3) return;
    this.chain.textContent = `×${n}`;
    this.chain.style.setProperty('--chain-color', color);
    this.chain.classList.toggle('long', n >= tuning.feel.holdBreathChain);
    this.chain.classList.toggle('finale', n >= tuning.audio.finaleChain);
    this.chain.classList.add('show', 'bump');
    requestAnimationFrame(() => requestAnimationFrame(() => this.chain.classList.remove('bump')));
  }

  endChain(): void {
    clearTimeout(this.chainHide);
    this.chainHide = window.setTimeout(() => this.chain.classList.remove('show'), 600);
  }

  showTitle(): void {
    this.title.classList.add('show');
    clearTimeout(this.titleHide);
    this.titleHide = window.setTimeout(() => this.hideTitle(), tuning.feel.titleMs + 900);
  }

  hideTitle(): void {
    clearTimeout(this.titleHide);
    this.title.classList.remove('show');
  }

  toast(text: string, ms = tuning.feel.toastMs): void {
    clearTimeout(this.toastHide);
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastHide = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** The garden rests: the sheet rises and the pollen tally counts up, ticking as it goes. */
  showSummary(s: Summary, onTick: (i: number) => void): void {
    $('sum-longest').textContent = String(s.longest);
    $('sum-blooms').textContent = String(s.blooms);
    const best = $('sum-best');
    best.textContent = s.newBest ? 'New best' : s.best > s.pollen ? `Best ${s.best}` : '';
    best.classList.toggle('new', s.newBest);
    const big = $('sum-pollen');
    big.textContent = '0';
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
    this.summary.classList.add('hidden');
  }

  /** Tutorial coach line at the top, with seed dots that bloom as lessons pass. */
  coach(text: string, step: number, total: number): void {
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
    this.coachEl.classList.remove('show');
    this.coachText.textContent = '';
  }

  showHowto(): void {
    this.howto.classList.remove('hidden');
  }

  hideHowto(): void {
    this.howto.classList.add('hidden');
  }

  get howtoOpen(): boolean {
    return !this.howto.classList.contains('hidden');
  }
}
