import onlineConfig from '../../config/online.json';
import { tuning } from '../tuning';
import { addGuestRun, clearGuestRuns, pendingRuns, restoreGuestRuns, takeGuestRuns } from './guestRuns';
import { normalizeName, validateName } from './names';

/**
 * The online layer: accounts and boards on the game's own server. No UI here, and the UI talks only to
 * this class. Every method resolves, never throws: `{ ok: true, ... }` or `{ ok: false, reason }`. With
 * config/online.json's `apiUrl` empty every call answers 'offline' and nothing touches the network.
 *
 * HTTP contract (bearer token from sign-up / sign-in):
 *   POST   /api/accounts       {name,password}            201 {token,id,name} | 409 {error:'taken'} | 400 {error:'short'|'long'|'chars'|'blocked'|'password'}
 *   POST   /api/sessions       {name,password}            200 {token,id,name} | 401 {error:'wrong'}
 *   DELETE /api/sessions       (bearer)                   204
 *   POST   /api/runs           (bearer) RunRecord         201 {id,verified} | 400 {error:'invalid'} | 401
 *   POST   /api/runs/batch     (bearer) {runs: RunRecord[]} (max 20)  200 {saved}
 *   GET    /api/board/players  ?mode&limit[&day]          {rows:[{rank,name,gardensLit,stars,pollen,longest,playedAt,isMe}], me, total}
 *   GET    /api/board/games    ?mode&limit[&before]       {rows:[{id,name,seed,gardensLit,stars,pollen,longest,playedAt,isMe}], next}
 * A request that cannot reach the server, or times out, is 'offline'; a 5xx or an unreadable answer is 'error'.
 */

export type Mode = 'endless' | 'daily' | 'journey';
export type FailReason = 'offline' | 'taken' | 'wrong' | 'invalid' | 'error';
/**
 * `detail` says more when it helps the UI: a name problem ('short'|'long'|'chars'|'blocked') or 'password'
 * for 'invalid'; 'timeout' for an 'offline' that was a slow server rather than no connection.
 */
export interface Fail {
  ok: false;
  reason: FailReason;
  detail?: string;
}
export type Result<T> = ({ ok: true } & T) | Fail;

/** One finished run, as the game records it. `playedAt` and `day` are ISO strings (day is `YYYY-MM-DD`, daily only). */
export interface RunRecord {
  mode: Mode;
  seed: number;
  day?: string;
  gardensLit: number;
  /** Total stars over every lit garden. */
  stars: number;
  pollen: number;
  longest: number;
  taps: number;
  /** Board cell index of each tap, in order. */
  tapLog: number[];
  gameVersion: string;
  playedAt: string;
}

export interface Player {
  id: string;
  name: string;
}

export interface BoardRow {
  rank: number;
  name: string;
  gardensLit: number;
  stars: number;
  pollen: number;
  longest: number;
  playedAt: string;
  isMe: boolean;
}

export interface GameRow {
  id?: number;
  name: string;
  /** The evening's seed: planting it gives that evening's first garden. */
  seed: number;
  gardensLit: number;
  stars: number;
  pollen: number;
  longest: number;
  playedAt: string;
  isMe: boolean;
}

export interface BoardQuery {
  mode: Mode;
  /** Default `leaderboard.topRows` (players board) or `leaderboard.feedRows` (all games). */
  limit?: number;
  /** Daily only: `YYYY-MM-DD`, default today (UTC). */
  day?: string;
}

export interface GamesQuery extends BoardQuery {
  /** Page cursor: the `next` of the previous page; rows strictly older than this come back. */
  before?: string;
}

/** The only thing that touches the network. Rejects when the server cannot be reached; a TimeoutError when it is too slow. */
export interface Transport {
  request(method: string, path: string, body?: unknown, token?: string | null): Promise<{ status: number; json: any }>;
}

export interface OnlineConfig {
  apiUrl: string;
}

export interface OnlineOptions {
  config?: OnlineConfig;
  transport?: Transport;
}

/** The session: the opaque token the server issued, and who it belongs to. */
export const AUTH_STORAGE_KEY = 'bloom.auth';
export interface Session {
  token: string;
  id: string;
  name: string;
}

const MAX_TAPS = 2000;
const BATCH_MAX = 20;
/** Writes may take longer than reads: a slow sign-up is better finished than abandoned. */
const WRITE_TIMEOUT_MS = 10000;

const offline: Fail = { ok: false, reason: 'offline' };
const fail = (reason: FailReason, detail?: string): Fail => (detail === undefined ? { ok: false, reason } : { ok: false, reason, detail });

/** The default transport: fetch against `apiUrl` ('/' or '' after trimming means the page's own origin), aborting after `fetchTimeoutMs` (reads) or a longer limit (writes). */
export function fetchTransport(apiUrl: string): Transport {
  const base = apiUrl.trim().replace(/\/+$/, '');
  return {
    async request(method, path, body, token) {
      const ctl = new AbortController();
      const ms = method === 'GET' ? tuning.leaderboard.fetchTimeoutMs : WRITE_TIMEOUT_MS;
      const timer = setTimeout(() => ctl.abort(), ms);
      try {
        const res = await fetch(base + path, {
          method,
          signal: ctl.signal,
          headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          /* 204 or an empty body */
        }
        return { status: res.status, json };
      } catch (e) {
        if (ctl.signal.aborted) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function readSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null');
    return s && typeof s.token === 'string' && typeof s.id === 'string' && typeof s.name === 'string' ? { token: s.token, id: s.id, name: s.name } : null;
  } catch {
    return null;
  }
}

function writeSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* storage unavailable: the player stays signed in until the page closes, no longer */
  }
}

/** Mirrors the server's checks, so an obviously bad record never leaves the device. */
function sane(r: RunRecord): boolean {
  const int = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
  return (
    ['endless', 'daily', 'journey'].includes(r.mode) &&
    int(r.seed, 4294967295) &&
    int(r.gardensLit, 1000) &&
    int(r.stars, 3 * r.gardensLit) &&
    int(r.pollen, 100000000) &&
    int(r.longest, 1000) &&
    int(r.taps, MAX_TAPS) &&
    Array.isArray(r.tapLog) &&
    r.tapLog.length <= MAX_TAPS &&
    r.tapLog.every((c) => Number.isInteger(c) && c >= 0) &&
    (r.mode === 'daily') === (r.day !== undefined) &&
    typeof r.gameVersion === 'string' &&
    r.gameVersion.length > 0 &&
    r.gameVersion.length <= 40 &&
    !Number.isNaN(Date.parse(r.playedAt))
  );
}

const clampLimit = (n: number) => Math.max(1, Math.min(200, Math.floor(n)));
const todayUtc = () => new Date().toISOString().slice(0, 10);
const NAME_PROBLEMS = ['short', 'long', 'chars', 'blocked', 'password'];

/** Internal: a request that could not reach the server. */
class Unreachable extends Error {
  constructor(public timeout: boolean) {
    super(timeout ? 'timeout' : 'unreachable');
  }
}

export class Online {
  private config: OnlineConfig;
  private transport: Transport | null;
  /** Uploads of the account's queue run one at a time. */
  private flushing: Promise<unknown> = Promise.resolve();

  constructor(opts: OnlineOptions = {}) {
    // A build-time VITE_BLOOM_API wins (the VPS installer sets it to '/', the game's own origin).
    this.config = opts.config ?? { apiUrl: (import.meta.env.VITE_BLOOM_API as string | undefined) || onlineConfig.apiUrl };
    this.transport = opts.transport ?? null;
  }

  /** False when config/online.json has no `apiUrl`: every call then answers 'offline'. */
  get enabled(): boolean {
    return this.config.apiUrl.trim() !== '';
  }

  private http(): Transport {
    return (this.transport ??= fetchTransport(this.config.apiUrl));
  }

  /** One request. Network trouble throws Unreachable; a 401 on a request that carried a token ends that session. */
  private async call(method: string, path: string, body?: unknown, auth = true): Promise<{ status: number; json: any }> {
    const session = auth ? readSession() : null;
    try {
      const res = await this.http().request(method, path, body, session?.token ?? null);
      if (res.status === 401 && session && readSession()?.token === session.token) writeSession(null);
      return res;
    } catch (e) {
      throw new Unreachable(e instanceof Error && e.name === 'TimeoutError');
    }
  }

  /** Common wrapper: offline check, and anything unexpected becomes 'offline' (no route) or 'error'. */
  private async guard<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
    if (!this.enabled) return offline;
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Unreachable) return fail('offline', e.timeout ? 'timeout' : undefined);
      return fail('error', e instanceof Error ? e.message : String(e));
    }
  }

  /** The signed-in player from the saved session. Reads storage only: no network, so it works offline. */
  async me(): Promise<Player | null> {
    if (!this.enabled) return null;
    const s = readSession();
    return s ? { id: s.id, name: s.name } : null;
  }

  async createAccount(name: string, password: string): Promise<Result<{ player: Player; uploaded: number }>> {
    const v = validateName(name);
    if (!v.ok) return fail('invalid', v.reason);
    if (password.length < tuning.leaderboard.passwordMin) return fail('invalid', 'password');
    return this.guard(() => this.enter('POST', '/api/accounts', { name: v.name, password }));
  }

  async signIn(name: string, password: string): Promise<Result<{ player: Player; uploaded: number }>> {
    const clean = normalizeName(name);
    if (clean === '' || password === '') return fail('invalid');
    return this.guard(() => this.enter('POST', '/api/sessions', { name: clean, password }));
  }

  /** Sign-up and sign-in answer alike: a token, then the evenings brought along are sent. */
  private async enter(method: string, path: string, body: object): Promise<Result<{ player: Player; uploaded: number }>> {
    const res = await this.call(method, path, body, false);
    const j = res.json;
    if (res.status === 409) return fail('taken');
    if (res.status === 401) return fail('wrong');
    if (res.status === 400) {
      const e = String(j?.error ?? '');
      return NAME_PROBLEMS.includes(e) ? fail('invalid', e) : fail('invalid');
    }
    // The server's ids are numbers; keep them as strings on the device so storage keys stay stable.
    const id = typeof j?.id === 'number' || typeof j?.id === 'string' ? String(j.id) : '';
    if (res.status < 200 || res.status >= 300 || typeof j?.token !== 'string' || id === '' || typeof j?.name !== 'string') {
      return fail('error', `status ${res.status}`);
    }
    writeSession({ token: j.token, id, name: j.name });
    const uploaded = await this.uploadOwn(id);
    return { ok: true, player: { id, name: j.name }, uploaded };
  }

  /**
   * Ends the session and clears the evenings queued as a guest (GDD §8). The account's own queue stays on
   * the device, under its user id, for the next time that player signs in. Always clears locally, even offline.
   */
  async signOut(): Promise<Result<object>> {
    const s = readSession();
    writeSession(null);
    clearGuestRuns();
    if (!this.enabled) return offline;
    if (s) {
      try {
        await this.http().request('DELETE', '/api/sessions', undefined, s.token);
      } catch {
        /* the token simply expires on the server */
      }
    }
    return { ok: true };
  }

  /**
   * Save a finished evening. Signed in: it joins the account's queue on this device and the queue is sent
   * now; whatever does not get through stays queued for `flushPending`. Not signed in: kept as a guest run,
   * uploaded at the next sign-up or sign-in. A failure result therefore never means the run is lost.
   */
  async submitRun(run: RunRecord): Promise<Result<{ saved: 'account' | 'guest' }>> {
    if (!sane(run)) return fail('invalid');
    if (!this.enabled) {
      addGuestRun(run);
      return offline;
    }
    const me = await this.me();
    if (!me) {
      addGuestRun(run);
      return { ok: true, saved: 'guest' };
    }
    pendingRuns(me.id).add(run);
    const sent = await this.flushPending();
    return sent.ok ? { ok: true, saved: 'account' } : sent;
  }

  /** Send the signed-in player's queued evenings: on launch, on `online`, when an end sheet opens. */
  flushPending(): Promise<Result<{ uploaded: number }>> {
    const job = this.flushing.then(async (): Promise<Result<{ uploaded: number }>> => {
      if (!this.enabled) return offline;
      const me = await this.me();
      if (!me || pendingRuns(me.id).list().length === 0) return { ok: true, uploaded: 0 };
      return this.guard(async () => {
        const { uploaded, complete, unreachable } = await this.upload([pendingRuns(me.id)]);
        return complete ? { ok: true, uploaded } : unreachable ? fail('offline') : fail('error', 'upload failed');
      });
    });
    this.flushing = job.catch(() => undefined);
    return job;
  }

  /** Send what each queue holds; a queue that fails is put back whole and does not fail the others. */
  private async upload(queues: { take(): RunRecord[]; restore(runs: RunRecord[]): void }[]): Promise<{ uploaded: number; complete: boolean; unreachable: boolean }> {
    let uploaded = 0;
    let complete = true;
    let unreachable = false;
    for (const q of queues) {
      const runs = q.take().filter(sane);
      let sent = 0;
      try {
        for (let i = 0; i < runs.length; i += BATCH_MAX) {
          const chunk = runs.slice(i, i + BATCH_MAX);
          const res = chunk.length === 1 ? await this.call('POST', '/api/runs', chunk[0]) : await this.call('POST', '/api/runs/batch', { runs: chunk });
          // 4xx other than 401 means the server refused these runs for good: retrying would only repeat it.
          if (res.status === 401 || res.status >= 500 || res.status === 0) throw new Error(`status ${res.status}`);
          sent += chunk.length;
          uploaded += res.status < 300 ? (chunk.length === 1 ? 1 : Number(res.json?.saved ?? chunk.length)) : 0;
        }
      } catch (e) {
        q.restore(runs.slice(sent));
        complete = false;
        unreachable ||= e instanceof Unreachable;
      }
    }
    return { uploaded, complete, unreachable };
  }

  /** After sign-up or sign-in: the evenings played as a guest (the player brought them), and this account's own queue. */
  private async uploadOwn(userId: string): Promise<number> {
    return (await this.upload([pendingRuns(userId), { take: takeGuestRuns, restore: restoreGuestRuns }])).uploaded;
  }

  /** One row per player (their best evening), best first. `myRank` is my own row when I rank below the limit; `total` counts all gardeners. */
  async playersBoard(q: BoardQuery): Promise<Result<{ rows: BoardRow[]; myRank: BoardRow | null; total: number }>> {
    return this.guard(async () => {
      const p = new URLSearchParams({ mode: q.mode, limit: String(clampLimit(q.limit ?? tuning.leaderboard.topRows)) });
      if (q.mode === 'daily') p.set('day', q.day ?? todayUtc());
      const res = await this.read(`/api/board/players?${p}`);
      const j = res.json;
      if (res.status !== 200 || !Array.isArray(j?.rows)) return fail('error', `status ${res.status}`);
      const rows: BoardRow[] = j.rows.map(toBoardRow);
      const me: BoardRow | null = j.me ? toBoardRow(j.me) : null;
      return { ok: true, rows, myRank: me && !rows.some((r) => r.isMe) ? { ...me, isMe: true } : null, total: Number(j.total ?? rows.length) };
    });
  }

  /** Every game, newest first. Page with `next` (null when there is nothing older). */
  async allGames(q: GamesQuery): Promise<Result<{ rows: GameRow[]; next: string | null }>> {
    return this.guard(async () => {
      const p = new URLSearchParams({ mode: q.mode, limit: String(clampLimit(q.limit ?? tuning.leaderboard.feedRows)) });
      if (q.before) p.set('before', q.before);
      const res = await this.read(`/api/board/games?${p}`);
      const j = res.json;
      if (res.status !== 200 || !Array.isArray(j?.rows)) return fail('error', `status ${res.status}`);
      const rows: GameRow[] = j.rows.map((r: Record<string, unknown>) => {
        const { rank: _rank, ...row } = toBoardRow({ ...r, rank: 0 });
        return { ...row, id: r.id === undefined ? undefined : Number(r.id), seed: Number(r.seed) };
      });
      return { ok: true, rows, next: typeof j.next === 'string' ? j.next : null };
    });
  }

  /** A board read: with the token (so rows know which is mine), once more anonymously if the token turns out dead. */
  private async read(path: string) {
    const res = await this.call('GET', path);
    return res.status === 401 ? this.call('GET', path, undefined, false) : res;
  }
}

function toBoardRow(r: Record<string, any>): BoardRow {
  return {
    rank: Number(r.rank),
    name: String(r.name),
    gardensLit: Number(r.gardensLit),
    stars: Number(r.stars),
    pollen: Number(r.pollen),
    longest: Number(r.longest),
    playedAt: String(r.playedAt),
    isMe: r.isMe === true,
  };
}

/** The app's shared instance, built from config/online.json. */
export const online = new Online();
