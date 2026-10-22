import type { BoardRow, Fail, GameRow, RunRecord } from './online';

/** Pure parts of the board sheet and the name sheet (GDD §8): copy, ordering, dates, the per-segment cache. */

/** The daily does not exist yet; the Today segment stays hidden until a daily mode ships. */
export const DAILY_EXISTS = false;

export type Segment = 'gardeners' | 'evenings' | 'today';

export const COPY = {
  needsConnection: 'The board needs a connection.',
  outOfReach: 'The board is out of reach right now.',
  empty: 'No evenings yet. Yours could be the first.',
  offline: "You're offline. The garden still grows; try again later.",
  length: 'Three to sixteen characters.',
  chars: 'Letters, numbers and spaces only.',
  taken: 'That name is taken.',
  kinder: 'Choose a kinder name.',
  password: 'Password: six characters or more.',
  wrong: 'Name or password is wrong.',
  addName: 'Add your name to the board',
  signedInNote: 'Your evenings stay on the board.',
} as const;

/** The one message line of the name sheet for a failed sign-up or sign-in. */
export function accountMessage(f: Fail, browserOffline = false): string {
  if (f.reason === 'error' && browserOffline) return COPY.offline;
  switch (f.reason) {
    case 'offline':
      return COPY.offline;
    case 'taken':
      return COPY.taken;
    case 'wrong':
      return COPY.wrong;
    case 'invalid':
      if (f.detail === 'short' || f.detail === 'long') return COPY.length;
      if (f.detail === 'chars') return COPY.chars;
      if (f.detail === 'blocked') return COPY.kinder;
      if (f.detail === 'password') return COPY.password;
      return COPY.wrong;
    default:
      return COPY.outOfReach;
  }
}

/** Ranking rule (§8): gardens lit, then stars, then pollen, then the earlier date. Negative when a is better. */
export function compareRuns(a: Pick<RunRecord, 'gardensLit' | 'stars' | 'pollen' | 'playedAt'>, b: typeof a): number {
  return b.gardensLit - a.gardensLit || b.stars - a.stars || b.pollen - a.pollen || Date.parse(a.playedAt) - Date.parse(b.playedAt);
}

/** A guest's best endless evening, for the pinned "You" row. */
export function bestGuestRun(runs: readonly RunRecord[]): RunRecord | null {
  const endless = runs.filter((r) => r.mode === 'endless');
  return endless.length === 0 ? null : [...endless].sort(compareRuns)[0];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK_MS = 7 * 24 * 3600_000;

/** Evenings rows: "Tue" within the week, "12 Oct" beyond (local time). */
export function dateLabel(iso: string | number, now = Date.now()): string {
  const d = new Date(iso);
  if (now - d.getTime() < WEEK_MS) return WEEKDAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "As of Tuesday" under the offline cache; a date once it is older than a week. */
export function asOfLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  return `As of ${now - at < WEEK_MS ? WEEKDAYS_LONG[d.getDay()] : `${d.getDate()} ${MONTHS[d.getMonth()]}`}`;
}

export interface BoardCache {
  at: number;
  rows: (BoardRow | GameRow)[];
  /** Gardeners only: my own row when it was outside the list, and how many gardeners there were. */
  myRank?: BoardRow | null;
  total?: number;
  /** Who the isMe flags were computed for. */
  me?: string | null;
}

const cacheKey = (seg: Segment) => `bloom.board.${seg}`;

export function readBoardCache(seg: Segment): BoardCache | null {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(seg)) ?? 'null');
    return c && typeof c.at === 'number' && Array.isArray(c.rows) ? (c as BoardCache) : null;
  } catch {
    return null;
  }
}

export function writeBoardCache(seg: Segment, c: BoardCache): void {
  try {
    localStorage.setItem(cacheKey(seg), JSON.stringify(c));
  } catch {
    /* storage unavailable or full: no cache */
  }
}

/** Cached rows are re-flagged for whoever is signed in now. */
export function reflag<T extends { name: string; isMe: boolean }>(rows: T[], me: string | null): T[] {
  const m = me?.toLowerCase() ?? null;
  return rows.map((r) => ({ ...r, isMe: m !== null && r.name.toLowerCase() === m }));
}
