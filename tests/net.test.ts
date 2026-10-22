import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import defaults from '../config/tuning.json';
import blocklist from '../config/names-blocklist.json';
import { Run } from '../src/core/run';
import { bestSingleTap } from '../src/core/solver';
import { addGuestRun, clearGuestRuns, guestRuns, pendingRuns, restoreGuestRuns, takeGuestRuns } from '../src/net/guestRuns';
import { FakeServer, sampleServer } from '../src/net/fake';
import { foldForBlocklist, isBlocked, normalizeName, validateName } from '../src/net/names';
import { AUTH_STORAGE_KEY, Online, fetchTransport, type RunRecord, type Transport } from '../src/net/online';
import { COPY, accountMessage, asOfLabel, bestGuestRun, compareRuns, dateLabel, readBoardCache, reflag, writeBoardCache } from '../src/net/board';
import { isCleanRun, tuningIsDefault } from '../src/net/clean';
import { tuning } from '../src/tuning';

// ---- helpers ---------------------------------------------------------------------------------------------

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

let seq = 0;
function rec(over: Partial<RunRecord> = {}): RunRecord {
  seq++;
  return {
    mode: 'endless',
    seed: 1000 + seq,
    gardensLit: 2,
    stars: 4,
    pollen: 1000,
    longest: 6,
    taps: 20,
    tapLog: [1, 2, 3],
    gameVersion: '0.1.0+abcd1234',
    playedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    ...over,
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- names -------------------------------------------------------------------------------------------------

describe('names', () => {
  it('accepts Unicode letters, digits and single inner spaces', () => {
    for (const n of ['Fern', 'moss3', 'Ann Marie', 'A b c', 'x'.repeat(16), 'Søren', 'Åsa', 'Zoë Ng', '李雷文', 'Дарья', 'élan']) {
      expect(validateName(n).ok, n).toBe(true);
    }
  });

  it('trims, squeezes spaces and composes accents', () => {
    expect(normalizeName('  Fern   Moss ')).toBe('Fern Moss');
    expect(validateName('  Fern   Moss ')).toEqual({ ok: true, name: 'Fern Moss' });
    expect(validateName('élan')).toEqual({ ok: true, name: 'élan' });
  });

  it('reports why a name is rejected', () => {
    expect(validateName('ab')).toEqual({ ok: false, reason: 'short' });
    expect(validateName('')).toEqual({ ok: false, reason: 'short' });
    expect(validateName('x'.repeat(17))).toEqual({ ok: false, reason: 'long' });
    expect(validateName('李'.repeat(17))).toEqual({ ok: false, reason: 'long' });
    for (const bad of ['bad!name', 'dot.name', 'under_score', 'dash-ed', 'a😀bcd', '<b>hey</b>']) expect(validateName(bad), bad).toEqual({ ok: false, reason: 'chars' });
  });

  it('counts characters, not bytes', () => {
    expect(validateName('李雷').ok).toBe(false);
    expect(validateName('李雷文').ok).toBe(true);
  });

  it('follows tuning for the length limits at use time', () => {
    const was = tuning.leaderboard.nameMax;
    tuning.leaderboard.nameMax = 5;
    try {
      expect(validateName('Fernie')).toEqual({ ok: false, reason: 'long' });
    } finally {
      tuning.leaderboard.nameMax = was;
    }
  });

  it('blocks listed words after folding, and the reserved names', () => {
    for (const bad of ['shithead', 'Sh1t head', 'f u c k', 'Fu(k'.replace('(', 'c'), 'H1tler fan', 'n4zi', 'Fvck $hit']) {
      expect(validateName(bad), bad).toMatchObject({ ok: false });
    }
    expect(validateName('shithead')).toEqual({ ok: false, reason: 'blocked' });
    expect(validateName('Sh1t head')).toEqual({ ok: false, reason: 'blocked' });
    for (const r of ['you', 'Guest', 'BLOOM', 'Admin']) expect(validateName(r), r).toEqual({ ok: false, reason: 'blocked' });
    expect(validateName('Admin Fern').ok).toBe(true);
  });

  it('does not block innocent look-alikes', () => {
    for (const ok of ['Grape', 'Peacock', 'Torpedo', 'Classic', 'Assam', 'Spice', 'Nira', 'Fern Moss', 'Hancock', 'Dickens', 'Mississippi', 'Therapist', 'Scrap', 'Essex', 'Parse']) {
      expect(validateName(ok).ok, ok).toBe(true);
    }
  });

  it('folds the way the spec says', () => {
    expect(foldForBlocklist('A B 0 1 3 4 5 $')).toBe('abo ieass'.replace(' ', ''));
    expect(isBlocked('P0RN')).toBe(true);
  });

  it('the shared blocklist is about sixty clean, lowercase, unique words', () => {
    const w = blocklist.words;
    expect(w.length).toBeGreaterThanOrEqual(55);
    expect(w.length).toBeLessThanOrEqual(70);
    expect(new Set(w).size).toBe(w.length);
    // every entry already folded, so a name can only match it by being folded the same way
    for (const x of w) {
      expect(x).toMatch(/^[a-z]{3,}$/);
      expect(foldForBlocklist(x)).toBe(x);
    }
    expect(blocklist.reserved).toEqual(['you', 'guest', 'bloom', 'admin']);
  });
});

// ---- guest runs and queues ---------------------------------------------------------------------------------

describe('guest runs', () => {
  it('keeps the most recent leaderboard.guestRunsKept', () => {
    const cap = tuning.leaderboard.guestRunsKept;
    const all = Array.from({ length: cap + 5 }, () => rec());
    all.forEach(addGuestRun);
    const kept = guestRuns();
    expect(kept).toHaveLength(cap);
    expect(kept[0]).toEqual(all[5]);
    expect(kept[cap - 1]).toEqual(all[all.length - 1]);
  });

  it('take drains, restore puts them back in front', () => {
    const a = rec();
    const b = rec();
    addGuestRun(a);
    addGuestRun(b);
    const taken = takeGuestRuns();
    expect(taken).toEqual([a, b]);
    expect(guestRuns()).toEqual([]);
    const c = rec();
    addGuestRun(c);
    restoreGuestRuns(taken);
    expect(guestRuns()).toEqual([a, b, c]);
    clearGuestRuns();
    expect(guestRuns()).toEqual([]);
  });

  it('keeps each account queue apart from the guest list and from other accounts', () => {
    pendingRuns('u1').add(rec());
    pendingRuns('u2').add(rec());
    pendingRuns('u2').add(rec());
    expect(pendingRuns('u1').list()).toHaveLength(1);
    expect(pendingRuns('u2').list()).toHaveLength(2);
    expect(guestRuns()).toEqual([]);
  });

  it('survives corrupt or unavailable storage', () => {
    localStorage.setItem('bloom.guestRuns.v1', '{not json');
    expect(guestRuns()).toEqual([]);
    localStorage.setItem('bloom.guestRuns.v1', '{"a":1}');
    expect(guestRuns()).toEqual([]);
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(() => addGuestRun(rec())).not.toThrow();
    expect(takeGuestRuns()).toEqual([]);
  });
});

// ---- Online ------------------------------------------------------------------------------------------------

describe('Online offline mode', () => {
  it('answers offline everywhere, never builds a transport, never throws', async () => {
    const request = vi.fn<Transport['request']>(async () => {
      throw new Error('should not be called');
    });
    const o = new Online({ config: { apiUrl: '' }, transport: { request } });
    expect(o.enabled).toBe(false);
    const off = { ok: false, reason: 'offline' };
    expect(await o.me()).toBeNull();
    expect(await o.createAccount('Fern', 'secret1')).toEqual(off);
    expect(await o.signIn('Fern', 'secret1')).toEqual(off);
    expect(await o.signOut()).toEqual(off);
    expect(await o.playersBoard({ mode: 'endless' })).toEqual(off);
    expect(await o.allGames({ mode: 'endless' })).toEqual(off);
    expect(await o.flushPending()).toEqual(off);
    expect(await o.submitRun(rec())).toEqual(off);
    expect(guestRuns()).toHaveLength(1); // still kept on the device
    expect(request).not.toHaveBeenCalled();
  });

  it('the shipped config is offline until the owner fills it in', async () => {
    const shipped = new Online();
    if (!shipped.enabled) expect(await shipped.signIn('Fern', 'secret1')).toEqual({ ok: false, reason: 'offline' });
  });
});

describe('Online accounts', () => {
  it('creates an account and keeps the session in bloom.auth', async () => {
    const s = new FakeServer();
    const o = s.online();
    const res = await o.createAccount('  Fern  Moss ', 'secret1');
    expect(res).toMatchObject({ ok: true, player: { name: 'Fern Moss' }, uploaded: 0 });
    const saved = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!);
    expect(saved).toMatchObject({ id: 'u1', name: 'Fern Moss' });
    expect(typeof saved.token).toBe('string');
    expect(s.users).toHaveLength(1);
    // a fresh page load: a new Online on the same browser, no network needed
    const down = s.online();
    s.down = true;
    expect(await down.me()).toEqual({ id: 'u1', name: 'Fern Moss' });
  });

  it('me() is null without a session', async () => {
    const s = new FakeServer();
    expect(await s.online().me()).toBeNull();
    expect(s.log).toEqual([]);
  });

  it('maps a name already in use, in any case, to taken', async () => {
    const s = new FakeServer();
    expect((await s.online().createAccount('Fern', 'secret1')).ok).toBe(true);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    expect(await s.online().createAccount('FERN', 'other-secret')).toEqual({ ok: false, reason: 'taken' });
    expect(s.users).toHaveLength(1);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('rejects bad names and passwords before touching the network', async () => {
    const s = new FakeServer();
    const o = s.online();
    expect(await o.createAccount('ab', 'secret1')).toEqual({ ok: false, reason: 'invalid', detail: 'short' });
    expect(await o.createAccount('Fern', '12345')).toEqual({ ok: false, reason: 'invalid', detail: 'password' });
    expect(await o.createAccount('shit', 'secret1')).toEqual({ ok: false, reason: 'invalid', detail: 'blocked' });
    expect(await o.createAccount('Bad!', 'secret1')).toEqual({ ok: false, reason: 'invalid', detail: 'chars' });
    expect(s.log).toEqual([]);
  });

  it('passes the server\'s verdicts through', async () => {
    const request = vi.fn<Transport['request']>(async () => ({ status: 400, json: { error: 'blocked' } }));
    const o = new Online({ config: { apiUrl: 'http://x' }, transport: { request } });
    expect(await o.createAccount('Fernie', 'secret1')).toEqual({ ok: false, reason: 'invalid', detail: 'blocked' });
    request.mockResolvedValueOnce({ status: 409, json: { error: 'taken' } });
    expect(await o.createAccount('Fernie', 'secret1')).toEqual({ ok: false, reason: 'taken' });
    request.mockResolvedValueOnce({ status: 503, json: null });
    expect(await o.createAccount('Fernie', 'secret1')).toMatchObject({ ok: false, reason: 'error' });
    request.mockResolvedValueOnce({ status: 201, json: { nope: true } });
    expect(await o.createAccount('Fernie', 'secret1')).toMatchObject({ ok: false, reason: 'error' });
  });

  it('signs in (any case, loose spacing) and maps bad credentials to wrong', async () => {
    const s = new FakeServer();
    await s.online().createAccount('Fern Moss', 'secret1');
    localStorage.removeItem(AUTH_STORAGE_KEY);
    const o = s.online();
    expect(await o.signIn('Fern Moss', 'nope-nope')).toEqual({ ok: false, reason: 'wrong' });
    expect(await o.signIn('Nobody Here', 'secret1')).toEqual({ ok: false, reason: 'wrong' });
    expect(await o.me()).toBeNull();
    expect(await o.signIn('fern  MOSS', 'secret1')).toMatchObject({ ok: true, player: { name: 'Fern Moss' } });
    expect(await o.me()).toMatchObject({ name: 'Fern Moss' });
    expect(await o.signOut()).toEqual({ ok: true });
    expect(await o.me()).toBeNull();
    expect(s.tokens.size).toBe(1); // the sign-up token; the sign-in token was deleted server-side
  });

  it('sends the bearer token and never the password after sign-in', async () => {
    const s = new FakeServer();
    const o = s.online();
    await o.createAccount('Fern', 'secret1');
    const spy = vi.spyOn(s, 'request');
    await o.playersBoard({ mode: 'endless' });
    expect(spy.mock.calls[0][3]).toBe(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!).token);
  });

  it('maps no connection and timeouts to offline, 5xx to error, and never throws', async () => {
    const s = new FakeServer();
    const o = s.online();
    s.down = true;
    expect(await o.signIn('Fern', 'secret1')).toEqual({ ok: false, reason: 'offline' });
    expect(await o.playersBoard({ mode: 'endless' })).toEqual({ ok: false, reason: 'offline' });
    const slow = new Online({
      config: { apiUrl: 'http://x' },
      transport: {
        request: async () => {
          throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
        },
      },
    });
    expect(await slow.allGames({ mode: 'endless' })).toEqual({ ok: false, reason: 'offline', detail: 'timeout' });
    s.down = false;
    s.broken = true;
    expect(await o.signIn('Fern', 'secret1')).toMatchObject({ ok: false, reason: 'error' });
    expect(await o.playersBoard({ mode: 'endless' })).toMatchObject({ ok: false, reason: 'error' });
    expect(await o.allGames({ mode: 'endless' })).toMatchObject({ ok: false, reason: 'error' });
  });

  it('a base of "/" (or "https://host/") reaches /api/... on that origin; "/" counts as configured', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => (seen.push(u), { status: 200, json: async () => ({}) }));
    await fetchTransport('/').request('GET', '/api/board/players?mode=endless');
    await fetchTransport('https://game.example//').request('GET', '/api/board/games');
    expect(seen).toEqual(['/api/board/players?mode=endless', 'https://game.example/api/board/games']);
    expect(new Online({ config: { apiUrl: '/' } }).enabled).toBe(true);
  });

  it('the fetch transport aborts after the read timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
      const p = fetchTransport('http://x/').request('GET', '/api/board/players');
      const caught = p.catch((e) => e);
      await vi.advanceTimersByTimeAsync(tuning.leaderboard.fetchTimeoutMs + 1);
      expect(await caught).toMatchObject({ name: 'TimeoutError' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a dead token ends the session', async () => {
    const s = new FakeServer();
    const o = s.online();
    await o.createAccount('Fern', 'secret1');
    s.tokens.clear();
    expect((await o.playersBoard({ mode: 'endless' })).ok).toBe(true); // retried anonymously
    expect(await o.me()).toBeNull();
  });
});

describe('Online runs', () => {
  it('uploads guest runs after createAccount', async () => {
    const s = new FakeServer();
    const o = s.online();
    expect(await o.submitRun(rec())).toEqual({ ok: true, saved: 'guest' });
    expect(await o.submitRun(rec())).toEqual({ ok: true, saved: 'guest' });
    expect(guestRuns()).toHaveLength(2);
    expect(s.runs).toHaveLength(0);
    const res = await o.createAccount('Fern', 'secret1');
    expect(res).toMatchObject({ ok: true, uploaded: 2 });
    expect(s.runs).toHaveLength(2);
    expect(s.runs.every((r) => r.userId === 'u1')).toBe(true);
    expect(s.log.filter((l) => l.startsWith('POST /api/runs/batch'))).toHaveLength(1);
    expect(guestRuns()).toEqual([]);
  });

  it('uploads guest runs after signIn too (the player brought them), and keeps them if it fails', async () => {
    const s = new FakeServer();
    s.addPlayer('Fern', []);
    const o = s.online();
    await o.submitRun(rec());
    s.failRunWrites = true;
    expect(await o.signIn('Fern', 'secret1')).toMatchObject({ ok: true, uploaded: 0 });
    expect(guestRuns()).toHaveLength(1);
    s.failRunWrites = false;
    await o.signOut(); // clears the guest list
    expect(guestRuns()).toEqual([]);
    await o.submitRun(rec());
    expect(await o.signIn('Fern', 'secret1')).toMatchObject({ ok: true, uploaded: 1 });
    expect(s.runs).toHaveLength(1);
    expect(s.log.some((l) => l === 'POST /api/runs')).toBe(true); // a single run goes to /api/runs
  });

  it('signed in: runs go through the account queue; a failure keeps them there, not in the guest list', async () => {
    const s = new FakeServer();
    const o = s.online();
    await o.createAccount('Fern', 'secret1');
    const r = rec({ tapLog: [5, 6, 7], pollen: 1234 });
    expect(await o.submitRun(r)).toEqual({ ok: true, saved: 'account' });
    expect(guestRuns()).toEqual([]);
    expect(pendingRuns('u1').list()).toEqual([]);
    expect(s.runs[0]).toMatchObject({ userId: 'u1', mode: 'endless', seed: r.seed, pollen: 1234, tapLog: [5, 6, 7], playedAt: r.playedAt });
    await o.submitRun(r); // same finished run again: stored once
    expect(s.runs).toHaveLength(1);

    s.failRunWrites = true;
    expect(await o.submitRun(rec())).toMatchObject({ ok: false, reason: 'error' });
    s.down = true;
    expect(await o.submitRun(rec())).toEqual({ ok: false, reason: 'offline' });
    expect(guestRuns()).toEqual([]);
    expect(pendingRuns('u1').list()).toHaveLength(2);

    s.down = false;
    s.failRunWrites = false;
    expect(await o.flushPending()).toEqual({ ok: true, uploaded: 2 });
    expect(pendingRuns('u1').list()).toEqual([]);
    expect(s.runs).toHaveLength(3);
    expect(await o.flushPending()).toEqual({ ok: true, uploaded: 0 });
  });

  it('keeps the account queue across sign-out; sign-out clears only the guest list', async () => {
    const s = new FakeServer();
    const o = s.online();
    await o.createAccount('Fern', 'secret1');
    s.down = true;
    await o.submitRun(rec());
    s.down = false;
    addGuestRun(rec());
    await o.signOut();
    expect(guestRuns()).toEqual([]);
    expect(pendingRuns('u1').list()).toHaveLength(1);
    expect(await o.submitRun(rec())).toEqual({ ok: true, saved: 'guest' }); // signed out again: guest
    await o.signIn('Fern', 'secret1');
    expect(s.runs).toHaveLength(2); // queue and the guest run both arrived
  });

  it('does not reuse one account\'s queue for another', async () => {
    const s = new FakeServer();
    s.addPlayer('Fern', []);
    s.addPlayer('Moss', []);
    const o = s.online();
    await o.signIn('Fern', 'secret1');
    s.down = true;
    await o.submitRun(rec());
    await o.signOut();
    s.down = false;
    await o.signIn('Moss', 'secret1');
    expect(s.runs).toHaveLength(0);
    expect(pendingRuns('u1').list()).toHaveLength(1);
    await o.signOut();
    await o.signIn('Fern', 'secret1');
    expect(s.runs).toHaveLength(1);
  });

  it('refuses records the server would reject', async () => {
    const o = new FakeServer().online();
    for (const bad of [
      rec({ stars: 7, gardensLit: 2 }),
      rec({ pollen: -1 }),
      rec({ tapLog: new Array(2001).fill(0) }),
      rec({ mode: 'daily' }), // daily needs a day
      rec({ day: '2026-01-01' }), // day only for daily
      rec({ seed: 1.5 }),
      rec({ playedAt: 'yesterday-ish' }),
    ])
      expect(await o.submitRun(bad)).toEqual({ ok: false, reason: 'invalid' });
    expect(guestRuns()).toEqual([]);
  });

  it('sends at most 20 runs per batch request', async () => {
    const s = new FakeServer();
    s.addPlayer('Fern', []);
    const o = s.online();
    for (let i = 0; i < 20; i++) addGuestRun(rec());
    pendingRuns('u1').add(rec());
    pendingRuns('u1').add(rec());
    await o.signIn('Fern', 'secret1');
    expect(s.runs).toHaveLength(22);
    expect(s.log.filter((l) => l.includes('/batch'))).toHaveLength(2);
  });
});

describe('Online boards', () => {
  function seeded() {
    const s = new FakeServer();
    const mk = (r: Partial<RunRecord>) => rec(r);
    s.addPlayer('Ada', [mk({ gardensLit: 5, stars: 12, pollen: 5000 }), mk({ gardensLit: 1, stars: 1, pollen: 10 })]);
    s.addPlayer('Bobo', [mk({ gardensLit: 5, stars: 12, pollen: 4000 })]);
    s.addPlayer('Cyrus', [mk({ gardensLit: 5, stars: 11, pollen: 9000 })]);
    s.addPlayer('Dina', [mk({ gardensLit: 3, stars: 5, pollen: 100 })]);
    s.addPlayer('Eddy', [mk({ gardensLit: 0, stars: 0, pollen: 50 })]);
    return s;
  }

  it('ranks each player by their best run and reports the total', async () => {
    const s = seeded();
    const o = s.online();
    await o.signIn('Ada', 'secret1');
    const res = await o.playersBoard({ mode: 'endless', limit: 10 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows.map((r) => [r.rank, r.name])).toEqual([[1, 'Ada'], [2, 'Bobo'], [3, 'Cyrus'], [4, 'Dina'], [5, 'Eddy']]);
    expect(res.rows.map((r) => r.isMe)).toEqual([true, false, false, false, false]);
    expect(res.rows[0]).toMatchObject({ gardensLit: 5, stars: 12, pollen: 5000, longest: 6 });
    expect(res.myRank).toBeNull();
    expect(res.total).toBe(5);
  });

  it('adds my own row as myRank only when I am outside the limit', async () => {
    const s = seeded();
    const o = s.online();
    await o.signIn('Dina', 'secret1');
    const res = await o.playersBoard({ mode: 'endless', limit: 2 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows.map((r) => r.name)).toEqual(['Ada', 'Bobo']);
    expect(res.rows.some((r) => r.isMe)).toBe(false);
    expect(res.myRank).toMatchObject({ rank: 4, name: 'Dina', isMe: true, gardensLit: 3 });
    expect(res.total).toBe(5);
    const inside = await o.playersBoard({ mode: 'endless', limit: 4 });
    if (!inside.ok) throw new Error('expected ok');
    expect(inside.myRank).toBeNull();
    await o.signOut();
    const anon = await o.playersBoard({ mode: 'endless', limit: 2 });
    if (!anon.ok) throw new Error('expected ok');
    expect(anon.myRank).toBeNull();
    expect(anon.rows.some((r) => r.isMe)).toBe(false);
  });

  it('asks for leaderboard.topRows and feedRows by default and clamps the limit', async () => {
    const s = seeded();
    const o = s.online();
    await o.playersBoard({ mode: 'endless' });
    await o.allGames({ mode: 'endless' });
    await o.playersBoard({ mode: 'endless', limit: 9999 });
    expect(s.log[0]).toBe(`GET /api/board/players?mode=endless&limit=${tuning.leaderboard.topRows}`);
    expect(s.log[1]).toBe(`GET /api/board/games?mode=endless&limit=${tuning.leaderboard.feedRows}`);
    expect(s.log[2]).toContain('limit=200');
  });

  it('keeps the modes apart and sends the day for daily', async () => {
    const s = seeded();
    const o = s.online();
    s.addPlayer('Fay', [rec({ mode: 'daily', day: '2026-02-01', gardensLit: 1, stars: 2 })]);
    const d1 = await o.playersBoard({ mode: 'daily', day: '2026-02-01' });
    const d2 = await o.playersBoard({ mode: 'daily', day: '2026-02-02' });
    const journey = await o.playersBoard({ mode: 'journey' });
    if (!d1.ok || !d2.ok || !journey.ok) throw new Error('expected ok');
    expect(d1.rows.map((r) => r.name)).toEqual(['Fay']);
    expect(d2.rows).toEqual([]);
    expect(journey.rows).toEqual([]);
    expect(s.log[0]).toContain('day=2026-02-01');
  });

  it('lists all games newest first with seeds, pages with next, and flags mine', async () => {
    const s = seeded();
    const o = s.online();
    await o.signIn('Bobo', 'secret1');
    const first = await o.allGames({ mode: 'endless', limit: 4 });
    if (!first.ok) throw new Error('expected ok');
    expect(first.rows).toHaveLength(4);
    const times = first.rows.map((r) => Date.parse(r.playedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(first.next).toBe(first.rows[3].playedAt);
    expect(first.rows.every((r) => Number.isInteger(r.seed))).toBe(true);
    expect(first.rows.find((r) => r.name === 'Bobo')?.isMe).toBe(true);
    expect(first.rows.filter((r) => r.name !== 'Bobo').every((r) => !r.isMe)).toBe(true);
    const second = await o.allGames({ mode: 'endless', limit: 4, before: first.next! });
    if (!second.ok) throw new Error('expected ok');
    expect(second.rows).toHaveLength(2); // 6 games in all
    expect(second.next).toBeNull();
    expect(Date.parse(second.rows[0].playedAt)).toBeLessThan(Date.parse(first.rows[3].playedAt));
    expect(second.rows[0]).not.toHaveProperty('rank');
  });

  it('the sample server has 60 gardeners with Nira in the top 50 and Wren below it', async () => {
    const s = sampleServer();
    const o = s.online();
    await o.signIn('Wren', 'secret1');
    const res = await o.playersBoard({ mode: 'endless' });
    if (!res.ok) throw new Error('expected ok');
    expect(res.total).toBe(60);
    expect(res.rows).toHaveLength(50);
    expect(res.myRank?.rank).toBeGreaterThan(50);
    await o.signIn('Nira', 'secret1');
    const nira = await o.playersBoard({ mode: 'endless' });
    if (!nira.ok) throw new Error('expected ok');
    expect(nira.rows.find((r) => r.isMe)?.rank).toBeLessThan(15);
    const feed = await o.allGames({ mode: 'endless' });
    if (!feed.ok) throw new Error('expected ok');
    expect(feed.rows.length).toBeGreaterThan(60);
  });
});

// ---- board helpers -------------------------------------------------------------------------------------------

describe('board helpers', () => {
  it('ranks by gardens, stars, pollen, then the earlier date', () => {
    const a = rec({ gardensLit: 3, stars: 5, pollen: 100 });
    expect(compareRuns(rec({ gardensLit: 4, stars: 0, pollen: 0 }), a)).toBeLessThan(0);
    expect(compareRuns(rec({ gardensLit: 3, stars: 6, pollen: 0 }), a)).toBeLessThan(0);
    expect(compareRuns(rec({ gardensLit: 3, stars: 5, pollen: 101 }), a)).toBeLessThan(0);
    const earlier = rec({ gardensLit: 3, stars: 5, pollen: 100, playedAt: '2025-01-01T00:00:00Z' });
    expect(compareRuns(earlier, a)).toBeLessThan(0);
    expect(bestGuestRun([a, earlier, rec({ gardensLit: 1 })])).toBe(earlier);
    expect(bestGuestRun([])).toBeNull();
    expect(bestGuestRun([rec({ mode: 'daily', day: '2026-01-01' })])).toBeNull();
  });

  it('labels dates: a weekday within the week, day and month after', () => {
    const now = new Date(2026, 9, 22, 12).getTime(); // Thu 22 Oct 2026, local
    expect(dateLabel(new Date(2026, 9, 20, 9).getTime(), now)).toBe('Tue');
    expect(dateLabel(new Date(2026, 9, 12, 9).getTime(), now)).toBe('12 Oct');
    expect(asOfLabel(new Date(2026, 9, 20, 9).getTime(), now)).toBe('As of Tuesday');
    expect(asOfLabel(new Date(2026, 8, 1, 9).getTime(), now)).toBe('As of 1 Sep');
  });

  it('caches a segment and re-flags rows for whoever is signed in', () => {
    expect(readBoardCache('gardeners')).toBeNull();
    const row = { rank: 1, name: 'Nira', gardensLit: 1, stars: 1, pollen: 1, longest: 1, playedAt: 'x', isMe: false };
    writeBoardCache('gardeners', { at: 5, rows: [row], total: 1, myRank: null, me: null });
    expect(localStorage.getItem('bloom.board.gardeners')).not.toBeNull();
    const c = readBoardCache('gardeners')!;
    expect(c.rows).toHaveLength(1);
    expect(reflag([row], 'nira')[0].isMe).toBe(true);
    expect(reflag([row], null)[0].isMe).toBe(false);
    localStorage.setItem('bloom.board.gardeners', 'garbage');
    expect(readBoardCache('gardeners')).toBeNull();
  });

  it('says the spec lines', () => {
    expect(accountMessage({ ok: false, reason: 'invalid', detail: 'short' })).toBe('Three to sixteen characters.');
    expect(accountMessage({ ok: false, reason: 'invalid', detail: 'long' })).toBe('Three to sixteen characters.');
    expect(accountMessage({ ok: false, reason: 'invalid', detail: 'chars' })).toBe('Letters, numbers and spaces only.');
    expect(accountMessage({ ok: false, reason: 'taken' })).toBe('That name is taken.');
    expect(accountMessage({ ok: false, reason: 'invalid', detail: 'blocked' })).toBe('Choose a kinder name.');
    expect(accountMessage({ ok: false, reason: 'invalid', detail: 'password' })).toBe('Password: six characters or more.');
    expect(accountMessage({ ok: false, reason: 'wrong' })).toBe('Name or password is wrong.');
    expect(accountMessage({ ok: false, reason: 'offline' })).toBe("You're offline. The garden still grows; try again later.");
    expect(accountMessage({ ok: false, reason: 'error' })).toBe('The board is out of reach right now.');
    expect(accountMessage({ ok: false, reason: 'error' }, true)).toBe(COPY.offline);
  });
});

// ---- clean runs ----------------------------------------------------------------------------------------------

describe('clean runs', () => {
  it('only fresh, unfixed, default-tuning evenings qualify', () => {
    expect(tuningIsDefault()).toBe(true);
    expect(isCleanRun({ fromKey: false, fixedSeed: false })).toBe(true);
    expect(isCleanRun({ fromKey: true, fixedSeed: false })).toBe(false);
    expect(isCleanRun({ fromKey: false, fixedSeed: true })).toBe(false);
    const was = tuning.run.startDrops;
    tuning.run.startDrops = was + 1;
    try {
      expect(tuningIsDefault()).toBe(false);
      expect(isCleanRun({ fromKey: false, fixedSeed: false })).toBe(false);
    } finally {
      tuning.run.startDrops = was;
    }
    expect(tuningIsDefault()).toBe(true);
  });
});

// ---- what the game must record ----------------------------------------------------------------------------

describe('replayable runs', () => {
  it('seed plus the run\'s own tap log reproduces the recorded score', () => {
    for (const seed of [1, 42, 987654321]) {
      const run = new Run(structuredClone(defaults), seed);
      while (!run.ended) {
        const best = bestSingleTap(run.board, run.buds);
        run.tap(best.cell >= 0 ? best.cell : run.taps % run.board.size);
      }
      expect(run.tapLog).toHaveLength(run.taps);
      const replay = new Run(structuredClone(defaults), seed);
      for (const c of run.tapLog) replay.tap(c);
      expect(replay.ended).toBe(true);
      expect(replay.pollen).toBe(run.pollen);
      expect(replay.gardensLit).toBe(run.gardensLit);
      expect(replay.stars).toEqual(run.stars);
      expect(replay.longest).toBe(run.longest);
      expect(replay.tapLog).toEqual(run.tapLog);
    }
  });
});
