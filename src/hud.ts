import { tuning } from './tuning';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface Summary {
  pollen: number;
  best: number;
  newBest: boolean;
  longest: number;
  blooms: number;
  taps: number;
  efficiency: number | null;
}

/** DOM overlay: counters, chain banner, toasts, floating numbers and the end-of-run card. */
export class Hud {
  private drops = $('drops');
  private pollen = $('pollen');
  private mood = $('mood');
  private chain = $('chain');
  private toastEl = $('toast');
  private summary = $('summary');
  private howto = $('howto');
  private coachEl = $('coach');
  private coachText = $('coach-text');
  private coachSteps = $('coach-steps');
  private shownPollen = 0;
  private pollenAnim = 0;
  private chainHide = 0;
  private toastHide = 0;

  setStatsVisible(v: boolean): void {
    for (const el of [this.drops, this.pollen, this.mood]) el.style.visibility = v ? 'visible' : 'hidden';
  }

  setDrops(n: number, pop = false): void {
    this.drops.querySelector('.value')!.textContent = String(n);
    this.drops.classList.toggle('low', n <= 2);
    if (pop) this.pop(this.drops);
  }

  setPollen(n: number, animate = false): void {
    cancelAnimationFrame(this.pollenAnim);
    const el = this.pollen.querySelector('.value')!;
    if (!animate) {
      this.shownPollen = n;
      el.textContent = String(n);
      return;
    }
    const from = this.shownPollen;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      this.shownPollen = Math.round(from + (n - from) * (1 - (1 - t) ** 3));
      el.textContent = String(this.shownPollen);
      if (t < 1) this.pollenAnim = requestAnimationFrame(step);
    };
    this.pollenAnim = requestAnimationFrame(step);
    this.pop(this.pollen);
  }

  setMood(m: string): void {
    this.mood.textContent = m;
  }

  /** Chain banner, shown from the second bloom of a chain. */
  setChain(n: number): void {
    clearTimeout(this.chainHide);
    if (n < 2) return;
    this.chain.querySelector('.n')!.textContent = `×${n}`;
    this.chain.classList.add('show', 'bump');
    setTimeout(() => this.chain.classList.remove('bump'), 120);
  }

  endChain(): void {
    clearTimeout(this.chainHide);
    this.chainHide = window.setTimeout(() => this.chain.classList.remove('show'), 900);
  }

  toast(text: string, ms = 3500): void {
    clearTimeout(this.toastHide);
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastHide = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  float(text: string, x: number, y: number, kind: 'pollen-f' | 'drop-f'): void {
    const el = document.createElement('div');
    el.className = `float ${kind}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--dur', `${tuning.feel.floatTextMs}ms`);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), tuning.feel.floatTextMs + 50);
  }

  dropsAnchor(): { x: number; y: number } {
    const r = this.drops.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom + 14 };
  }

  showSummary(s: Summary): void {
    $('sum-pollen').textContent = String(s.pollen);
    $('sum-longest').textContent = String(s.longest);
    $('sum-blooms').textContent = String(s.blooms);
    $('sum-taps').textContent = String(s.taps);
    $('sum-eff').textContent = s.efficiency === null ? '–' : `${Math.round(s.efficiency * 100)}%`;
    const best = $('sum-best');
    best.textContent = s.newBest ? 'A new best garden' : `Best: ${s.best}`;
    best.classList.toggle('new', s.newBest);
    this.summary.classList.remove('hidden');
  }

  hideSummary(): void {
    this.summary.classList.add('hidden');
  }

  /** Tutorial coach line at the top, with progress dots. */
  coach(text: string, step: number, total: number): void {
    this.coachSteps.innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < step ? 'done' : i === step ? 'now' : ''}"></i>`).join('');
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

  private pop(el: HTMLElement): void {
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 180);
  }
}
