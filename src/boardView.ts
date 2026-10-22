import { LANTERN_SVG, STAR_SVG, type Hud } from './hud';
import {
  COPY,
  DAILY_EXISTS,
  asOfLabel,
  dateLabel,
  readBoardCache,
  reflag,
  writeBoardCache,
  type BoardCache,
  type Segment,
} from './net/board';
import type { BoardRow, GameRow } from './net/online';
import type { Social } from './social';
import { tuning } from './tuning';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** One row as drawn: Gardeners and Today have a rank, Evenings a date. */
interface Line {
  lead: string;
  name: string;
  gardensLit: number;
  stars: number;
  pollen: number;
  isMe: boolean;
  /** Evenings: the seed that tapping the row plants. */
  seed?: number;
}

export interface BoardActions {
  /** Tap on an Evenings row: close the sheet and plant that evening's seed. */
  plant(seed: number, gardener: string): void;
  /** "Add your name to the board": open the name sheet. */
  addName(): void;
}

/** The "Gardeners" sheet (GDD §8 "Boards"): a segmented control, a scrolling list, a pinned own row. */
export class BoardView {
  private segment: Segment = 'gardeners';
  private list = $('lb-list');
  private pin = $('lb-pin');
  private note = $('lb-note');
  private segs = [...document.querySelectorAll<HTMLButtonElement>('#segs .seg')];
  /** Bumped on every load; an answer that arrives for an older one is dropped. */
  private token = 0;

  constructor(
    private hud: Hud,
    private social: Social,
    private act: BoardActions,
  ) {
    for (const b of this.segs) {
      b.hidden = b.dataset.seg === 'today' && !DAILY_EXISTS;
      b.addEventListener('click', () => void this.load(b.dataset.seg as Segment));
    }
  }

  /** Open the sheet; it lands on the player's own row and pulses it once. */
  open(seg: Segment = this.segment): void {
    this.hud.showSheet('board');
    void this.load(seg);
  }

  private async load(seg: Segment): Promise<void> {
    const token = ++this.token;
    this.segment = seg;
    for (const b of this.segs) {
      const on = b.dataset.seg === seg;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    this.note.textContent = '';
    this.note.className = 'lb-note';
    this.list.scrollTop = 0;
    this.pin.replaceChildren();
    const o = this.social.online;
    const cache = readBoardCache(seg);
    // Pinned row and links work in every state: a guest's comes from this device, a member's from the last answer.
    this.renderPin(this.cachedMine(cache), cache?.total ?? null);

    if (!o.enabled || navigator.onLine === false) {
      this.showCache(seg, cache, { offline: true });
      return;
    }
    this.showDots();
    const res = seg === 'evenings' ? await o.allGames({ mode: 'endless' }) : await o.playersBoard({ mode: seg === 'today' ? 'daily' : 'endless' });
    if (token !== this.token) return;
    if (!res.ok) {
      // A slow server reads as "out of reach"; no route at all as offline.
      this.showCache(seg, cache, { offline: res.reason === 'offline' && res.detail !== 'timeout' });
      return;
    }
    const me = this.social.player?.name ?? null;
    if ('myRank' in res) {
      writeBoardCache(seg, { at: Date.now(), rows: res.rows, myRank: res.myRank, total: res.total, me });
      this.renderRows(seg, res.rows);
      this.renderPin(res.myRank, res.total);
    } else {
      writeBoardCache(seg, { at: Date.now(), rows: res.rows, me });
      this.renderRows(seg, res.rows);
    }
  }

  private showDots(): void {
    this.list.replaceChildren(el('div', 'lb-dots', ['i', 'i', 'i'].map(() => el('i'))));
  }

  /** Cached rows under "As of Tuesday" when offline, under the out-of-reach line otherwise; with none, a centred line. */
  private showCache(seg: Segment, cache: BoardCache | null, o: { offline: boolean }): void {
    if (!cache || cache.rows.length === 0) {
      this.list.replaceChildren(el('div', 'lb-empty', [text(o.offline ? COPY.needsConnection : COPY.outOfReach)]));
      return;
    }
    if (o.offline) {
      this.note.textContent = asOfLabel(cache.at);
      this.note.className = 'lb-note caps';
    } else {
      this.note.textContent = COPY.outOfReach;
      this.note.className = 'lb-note';
    }
    const me = this.social.player?.name ?? null;
    this.renderRows(seg, reflag(cache.rows as { name: string; isMe: boolean }[], me) as (BoardRow | GameRow)[]);
    this.renderPin(this.cachedMine(cache), cache.total ?? null);
  }

  /** The cached own row, only if it was fetched for whoever is signed in now. */
  private cachedMine(cache: BoardCache | null): BoardRow | null {
    const me = this.social.player?.name.toLowerCase();
    return cache?.myRank && me && cache.me?.toLowerCase() === me ? cache.myRank : null;
  }

  private lines(seg: Segment, rows: (BoardRow | GameRow)[]): Line[] {
    return rows.map((r) => ({
      lead: seg === 'evenings' ? dateLabel(r.playedAt) : String((r as BoardRow).rank),
      name: r.name,
      gardensLit: r.gardensLit,
      stars: r.stars,
      pollen: r.pollen,
      isMe: r.isMe,
      seed: seg === 'evenings' ? (r as GameRow).seed : undefined,
    }));
  }

  private renderRows(seg: Segment, rows: (BoardRow | GameRow)[]): void {
    this.list.classList.toggle('feed', seg === 'evenings');
    const max = seg === 'evenings' ? tuning.leaderboard.feedRows : tuning.leaderboard.topRows;
    const lines = this.lines(seg, rows).slice(0, max);
    if (lines.length === 0) {
      this.list.replaceChildren(el('div', 'lb-empty', [text(COPY.empty)]));
      return;
    }
    const nodes = lines.map((l) => this.row(l, (seed) => this.act.plant(seed, l.name)));
    this.list.replaceChildren(...nodes);
    // Land on the own row (Gardeners and Today), centred, and let it pulse once.
    const mine = seg === 'evenings' ? -1 : lines.findIndex((l) => l.isMe);
    if (mine >= 0) {
      const n = nodes[mine];
      this.list.scrollTop = Math.max(0, n.offsetTop - (this.list.clientHeight - n.offsetHeight) / 2);
      n.classList.add('pulse');
    }
  }

  /** Under the list when the own row is not in it: a member's true rank, or a guest's best evening as "You". */
  private renderPin(mine: BoardRow | null, total: number | null): void {
    this.pin.replaceChildren();
    if (this.segment === 'evenings') return;
    const among = total ? el('div', 'caps among', [text(`Among ${total} ${total === 1 ? 'gardener' : 'gardeners'}`)]) : null;
    if (this.social.player) {
      if (!mine) return;
      this.pin.append(this.row({ lead: String(mine.rank), name: mine.name, gardensLit: mine.gardensLit, stars: mine.stars, pollen: mine.pollen, isMe: true }), ...(among ? [among] : []));
      return;
    }
    const best = this.social.guestBest();
    if (!best) return;
    const link = el('button', 'link add', [text(COPY.addName)]);
    link.addEventListener('click', () => this.act.addName());
    this.pin.append(this.row({ lead: '', name: 'You', gardensLit: best.gardensLit, stars: best.stars, pollen: best.pollen, isMe: true }), ...(among ? [among] : []), link);
  }

  private row(l: Line, onTap?: (seed: number) => void): HTMLElement {
    const tappable = l.seed !== undefined && onTap !== undefined;
    const r = el(tappable ? 'button' : 'div', `lb-row${l.isMe ? ' me' : ''}`);
    const lead = el('span', `rk${this.segment === 'evenings' ? ' date' : ''}`, [text(l.lead)]);
    const name = el('span', 'nm', [text(l.name)]);
    const gardens = el('span', 'g');
    gardens.innerHTML = `<i class="lantern">${LANTERN_SVG}</i>`;
    gardens.append(text(String(l.gardensLit)));
    const stars = el('span', 's');
    stars.innerHTML = `<i class="star">${STAR_SVG}</i>`;
    stars.append(text(String(l.stars)));
    const pollen = el('span', 'p', [text(String(l.pollen))]);
    r.append(lead, name, gardens, stars, pollen);
    if (tappable) {
      r.setAttribute('aria-label', `Plant ${l.name}'s garden`);
      r.addEventListener('click', () => onTap(l.seed!));
    }
    return r;
  }
}

const text = (s: string) => document.createTextNode(s);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', kids: Node[] = []): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}
