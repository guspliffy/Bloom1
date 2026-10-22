import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import defaults from '../config/tuning.json';
import { Run } from '../src/core/run';
import { bestSingleTap } from '../src/core/solver';
import { createApp, type App } from '../server/src/app';
import { readConfig } from '../server/src/config';
import type { Limits } from '../server/src/ratelimit';
import { replayMatches } from '../server/src/verify';
import { ownVersion } from '../server/src/version';

const BIG: Limits = { accounts: 10_000, signIns: 10_000, runs: 10_000 };
const dir = mkdtempSync(join(tmpdir(), 'bloom-server-'));
const apps: App[] = [];
let n = 0;

async function start(limits: Partial<Limits> = BIG, origins = ['https://guspliffy.github.io']) {
  const app = createApp({
    config: { port: 0, host: '127.0.0.1', dbPath: join(dir, `t${n++}.sqlite`), allowedOrigins: origins, trustProxy: false },
    limits,
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  apps.push(app);
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { app, call };
}

interface Rec {
  mode: string;
  seed: number;
  day?: string;
  gardensLit: number;
  stars: number;
  pollen: number;
  longest: number;
  taps: number;
  tapLog: number[];
  gameVersion: string;
  playedAt: string;
}

/** A real evening played by a greedy bot: the longest chain on offer each tap, else a cell that cycles. */
function play(seed: number, maxTaps = 2000): Rec | null {
  const run = new Run(structuredClone(defaults), seed);
  let k = 0;
  while (!run.ended && run.taps < maxTaps) {
    const best = bestSingleTap(run.board, run.buds);
    run.tap(best.cell >= 0 && best.blooms > 0 ? best.cell : (k++ * 7) % run.board.size);
  }
  if (!run.ended) return null;
  return {
    mode: 'endless',
    seed,
    gardensLit: run.gardensLit,
    stars: run.stars.reduce((a, b) => a + b, 0),
    pollen: run.pollen,
    longest: run.longest,
    taps: run.taps,
    tapLog: [...run.tapLog],
    gameVersion: ownVersion(),
    playedAt: '2026-10-01T10:00:00.000Z',
  };
}

const real = (seed: number, playedAt = '2026-10-01T10:00:00.000Z', extra: Partial<Rec> = {}): Rec => {
  const r = cache.get(seed) ?? play(seed)!;
  cache.set(seed, r);
  return { ...r, playedAt, ...extra };
};
const cache = new Map<number, Rec>();

const signUp = async (call: Awaited<ReturnType<typeof start>>['call'], name: string) => {
  const r = await call('POST', '/api/accounts', { name, password: 'secret1' });
  expect(r.status).toBe(201);
  return r.json.token as string;
};

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  rmSync(dir, { recursive: true, force: true });
});

describe('accounts', () => {
  it('creates, rejects taken (any case or spacing), short, long, chars, blocked, password', async () => {
    const { call } = await start();
    const ok = await call('POST', '/api/accounts', { name: ' Fern  Moss ', password: 'secret1' });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ name: 'Fern Moss' });
    expect(typeof ok.json.token).toBe('string');
    expect(ok.json.token.length).toBeGreaterThanOrEqual(43);
    expect((await call('POST', '/api/accounts', { name: 'fern moss', password: 'secret1' })).json).toEqual({ error: 'taken' });
    expect((await call('POST', '/api/accounts', { name: 'ab', password: 'secret1' })).json).toEqual({ error: 'short' });
    expect((await call('POST', '/api/accounts', { name: 'a'.repeat(17), password: 'secret1' })).json).toEqual({ error: 'long' });
    expect((await call('POST', '/api/accounts', { name: 'no!pe', password: 'secret1' })).json).toEqual({ error: 'chars' });
    const blocked = await call('POST', '/api/accounts', { name: 'Sh1t head', password: 'secret1' });
    expect(blocked.status).toBe(400);
    expect(blocked.json).toEqual({ error: 'blocked' });
    expect((await call('POST', '/api/accounts', { name: 'Reed Fern', password: '12345' })).json).toEqual({ error: 'password' });
    expect((await call('POST', '/api/accounts', { name: 'Reed Fern', password: 'x'.repeat(73) })).json).toEqual({ error: 'password' });
  });

  it('signs in, refuses a wrong password or unknown name, and signs out', async () => {
    const { call, app } = await start();
    await signUp(call, 'Nira');
    const s = await call('POST', '/api/sessions', { name: 'NIRA', password: 'secret1' });
    expect(s.status).toBe(200);
    expect(s.json.name).toBe('Nira');
    expect((await call('POST', '/api/sessions', { name: 'Nira', password: 'nope' })).status).toBe(401);
    expect((await call('POST', '/api/sessions', { name: 'Nira', password: 'nope' })).json).toEqual({ error: 'wrong' });
    expect((await call('POST', '/api/sessions', { name: 'Ghost', password: 'secret1' })).status).toBe(401);
    // Only a digest of the token is stored.
    const stored = app.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(stored.every((r) => r.token_hash !== s.json.token && r.token_hash.length === 64)).toBe(true);
    expect((await call('DELETE', '/api/sessions', undefined, s.json.token)).status).toBe(204);
    const run = real(1);
    expect((await call('POST', '/api/runs', run, s.json.token)).status).toBe(401);
  });

  it('requires a bearer token to submit runs', async () => {
    const { call } = await start();
    expect((await call('POST', '/api/runs', real(1))).status).toBe(401);
    expect((await call('POST', '/api/runs', real(1), 'garbage')).status).toBe(401);
    expect((await call('POST', '/api/runs/batch', { runs: [] })).status).toBe(401);
  });

  it('answers /api/health and unknown routes', async () => {
    const { call } = await start();
    expect((await call('GET', '/api/health')).json).toEqual({ ok: true, version: ownVersion() });
    expect((await call('GET', '/api/nope')).status).toBe(404);
  });
});

describe('run verification', () => {
  it('the bot produces a finished evening that replays', () => {
    const r = real(11);
    expect(r.taps).toBeGreaterThan(5);
    expect(replayMatches({ ...r, mode: 'endless', day: null })).toBe(true);
  });

  it('accepts a real run, is idempotent, and rejects tampering', async () => {
    const { call } = await start();
    const t = await signUp(call, 'Bot One');
    const r = real(21);
    const a = await call('POST', '/api/runs', r, t);
    expect(a.status).toBe(201);
    expect(a.json.verified).toBe(true);
    const again = await call('POST', '/api/runs', r, t);
    expect(again.json).toEqual(a.json);
    for (const bad of [
      { ...r, pollen: r.pollen + 1, playedAt: '2026-10-02T10:00:00.000Z' },
      { ...r, stars: r.stars + 1, playedAt: '2026-10-02T10:00:01.000Z' },
      { ...r, gardensLit: r.gardensLit + 1, stars: r.stars, playedAt: '2026-10-02T10:00:02.000Z' },
      { ...r, longest: r.longest + 1, playedAt: '2026-10-02T10:00:03.000Z' },
      { ...r, seed: r.seed + 1, playedAt: '2026-10-02T10:00:04.000Z' },
    ]) {
      const res = await call('POST', '/api/runs', bad, t);
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: 'invalid' });
    }
    const truncated = { ...r, tapLog: r.tapLog.slice(0, -1), taps: r.taps - 1, playedAt: '2026-10-02T11:00:00.000Z' };
    expect((await call('POST', '/api/runs', truncated, t)).status).toBe(400); // not ended: no score yet
    const malformed = { ...r, playedAt: 'yesterday' };
    expect((await call('POST', '/api/runs', malformed, t)).status).toBe(400);
    expect((await call('POST', '/api/runs', { ...r, day: '2026-10-01', playedAt: '2026-10-03T10:00:00.000Z' }, t)).status).toBe(400); // endless has no day
    const board = await call('GET', '/api/board/players?mode=endless');
    expect(board.json.total).toBe(1);
    expect(board.json.rows[0]).toMatchObject({ name: 'Bot One', pollen: r.pollen, rank: 1, isMe: false });
  });

  it('stores another version unverified and keeps it off the boards until --reverify-style recheck', async () => {
    const { call, app } = await start();
    const t = await signUp(call, 'Old Hand');
    const old = real(31, '2026-10-01T10:00:00.000Z', { gameVersion: '0.0.1+deadbeef' });
    const res = await call('POST', '/api/runs', old, t);
    expect(res.status).toBe(201);
    expect(res.json.verified).toBe(false);
    // Even a tampered score is only stored, not judged, when the version differs.
    expect((await call('POST', '/api/runs', { ...old, pollen: 1, playedAt: '2026-10-01T10:00:01.000Z' }, t)).json.verified).toBe(false);
    expect((await call('GET', '/api/board/players?mode=endless')).json.total).toBe(0);
    expect((await call('GET', '/api/board/games?mode=endless')).json.rows).toEqual([]);
    // After the owner updates the server, a same-version run that was stored unverified verifies.
    app.db.prepare('UPDATE runs SET game_version = ?').run(ownVersion());
    const hidden = app.store.unverifiedRuns();
    expect(hidden).toHaveLength(2);
    for (const r of hidden) app.store.setVerified(r.id, replayMatches(r) ? 1 : -1);
    const board = (await call('GET', '/api/board/players?mode=endless')).json;
    expect(board.total).toBe(1);
    expect(board.rows[0].pollen).toBe(old.pollen);
  });

  it('batch saves valid runs, skips bad ones, caps at 20', async () => {
    const { call } = await start();
    const t = await signUp(call, 'Batcher');
    const runs = [real(41, '2026-10-01T10:00:00.000Z'), real(42, '2026-10-01T11:00:00.000Z'), { ...real(43), pollen: 7 }, { nonsense: true }];
    const res = await call('POST', '/api/runs/batch', { runs }, t);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ saved: 2 });
    expect((await call('POST', '/api/runs/batch', { runs }, t)).json).toEqual({ saved: 2 }); // idempotent
    expect((await call('GET', '/api/board/games?mode=endless')).json.rows).toHaveLength(2);
    expect((await call('POST', '/api/runs/batch', { runs: Array.from({ length: 21 }, () => runs[0]) }, t)).status).toBe(400);
  });
});

describe('boards', () => {
  /** Insert verified rows directly: the ranking rule is under test here, not the replay. */
  const addRow = (app: App, userId: number, o: { gardens: number; stars: number; pollen: number; at: string; seed?: number; mode?: string; day?: string | null }) =>
    app.store.addRun(
      userId,
      {
        mode: (o.mode ?? 'endless') as 'endless',
        seed: o.seed ?? Math.floor(Math.random() * 1e6),
        day: o.day ?? null,
        gardensLit: o.gardens,
        stars: o.stars,
        pollen: o.pollen,
        longest: 3,
        taps: 1,
        tapLog: [0],
        gameVersion: 'x',
        playedAt: o.at,
      },
      true,
    );

  async function seeded() {
    const { app, call } = await start();
    const ids: Record<string, number> = {};
    const tokens: Record<string, string> = {};
    for (const name of ['Ash', 'Birch', 'Cedar', 'Dune', 'Elm']) {
      const r = await call('POST', '/api/accounts', { name, password: 'secret1' });
      ids[name] = r.json.id;
      tokens[name] = r.json.token;
    }
    return { app, call, ids, tokens };
  }

  it('ranks by gardens, stars, pollen, then the earlier play; one row per player (their best); total; me outside the rows', async () => {
    const { app, call, ids, tokens } = await seeded();
    addRow(app, ids.Ash, { gardens: 3, stars: 6, pollen: 500, at: '2026-10-01T10:00:00.000Z' });
    addRow(app, ids.Ash, { gardens: 2, stars: 9, pollen: 900, at: '2026-10-02T10:00:00.000Z' }); // worse: fewer gardens
    addRow(app, ids.Birch, { gardens: 3, stars: 7, pollen: 100, at: '2026-10-03T10:00:00.000Z' }); // stars beat Ash
    addRow(app, ids.Cedar, { gardens: 3, stars: 6, pollen: 600, at: '2026-10-04T10:00:00.000Z' }); // pollen beats Ash
    addRow(app, ids.Dune, { gardens: 3, stars: 6, pollen: 500, at: '2026-09-30T10:00:00.000Z' }); // ties Ash; earlier sits higher
    addRow(app, ids.Elm, { gardens: 1, stars: 3, pollen: 50, at: '2026-10-05T10:00:00.000Z' });
    const b = await call('GET', '/api/board/players?mode=endless&limit=3', undefined, tokens.Elm);
    expect(b.status).toBe(200);
    expect(b.json.rows.map((r: { name: string; rank: number }) => [r.rank, r.name])).toEqual([
      [1, 'Birch'],
      [2, 'Cedar'],
      [3, 'Dune'],
    ]);
    expect(b.json.total).toBe(5);
    expect(b.json.me).toMatchObject({ name: 'Elm', rank: 5, isMe: true });
    const inside = await call('GET', '/api/board/players?mode=endless&limit=10', undefined, tokens.Elm);
    expect(inside.json.me).toBeNull();
    expect(inside.json.rows.map((r: { name: string }) => r.name)).toEqual(['Birch', 'Cedar', 'Dune', 'Ash', 'Elm']);
    expect(inside.json.rows[4].isMe).toBe(true);
    expect(inside.json.rows.every((r: { name: string; isMe: boolean }) => r.isMe === (r.name === 'Elm'))).toBe(true);
    const anon = await call('GET', '/api/board/players?mode=endless&limit=3');
    expect(anon.json.me).toBeNull();
    expect((await call('GET', '/api/board/players?mode=endless&limit=100000')).status).toBe(200);
    expect((await call('GET', '/api/board/players?mode=nope')).status).toBe(400);
  });

  it('pages the games feed newest first', async () => {
    const { app, call, ids, tokens } = await seeded();
    for (let i = 0; i < 5; i++) addRow(app, i % 2 ? ids.Ash : ids.Birch, { gardens: i, stars: 0, pollen: i, at: `2026-10-0${i + 1}T10:00:00.000Z`, seed: 100 + i });
    const p1 = (await call('GET', '/api/board/games?mode=endless&limit=2', undefined, tokens.Ash)).json;
    expect(p1.rows.map((r: { seed: number }) => r.seed)).toEqual([104, 103]);
    expect(p1.next).toBe('2026-10-04T10:00:00.000Z');
    expect(p1.rows[1]).toMatchObject({ name: 'Ash', isMe: true });
    expect(typeof p1.rows[0].id).toBe('number');
    const p2 = (await call('GET', `/api/board/games?mode=endless&limit=2&before=${p1.next}`)).json;
    expect(p2.rows.map((r: { seed: number }) => r.seed)).toEqual([102, 101]);
    const p3 = (await call('GET', `/api/board/games?mode=endless&limit=2&before=${p2.next}`)).json;
    expect(p3.rows.map((r: { seed: number }) => r.seed)).toEqual([100]);
    expect(p3.next).toBeNull();
  });

  it('daily boards count each player\'s first run of that day only', async () => {
    const { app, call, ids } = await seeded();
    addRow(app, ids.Ash, { mode: 'daily', day: '2026-10-05', gardens: 1, stars: 1, pollen: 10, at: '2026-10-05T08:00:00.000Z', seed: 7 });
    addRow(app, ids.Ash, { mode: 'daily', day: '2026-10-05', gardens: 5, stars: 15, pollen: 900, at: '2026-10-05T09:00:00.000Z', seed: 7 }); // a later replay does not count
    addRow(app, ids.Birch, { mode: 'daily', day: '2026-10-05', gardens: 2, stars: 2, pollen: 20, at: '2026-10-05T10:00:00.000Z', seed: 7 });
    addRow(app, ids.Birch, { mode: 'daily', day: '2026-10-06', gardens: 4, stars: 4, pollen: 40, at: '2026-10-06T10:00:00.000Z', seed: 8 });
    const d = (await call('GET', '/api/board/players?mode=daily&day=2026-10-05')).json;
    expect(d.rows.map((r: { name: string; gardensLit: number }) => [r.name, r.gardensLit])).toEqual([
      ['Birch', 2],
      ['Ash', 1],
    ]);
    expect(d.total).toBe(2);
    expect((await call('GET', '/api/board/players?mode=daily&day=2026-10-06')).json.total).toBe(1);
    expect((await call('GET', '/api/board/players?mode=daily&day=2026-13-40')).status).toBe(400);
    expect((await call('GET', '/api/board/games?mode=daily&day=2026-10-05')).json.rows).toHaveLength(3);
    expect((await call('GET', '/api/board/players?mode=endless')).json.total).toBe(0);
  });

  it('accepts a real daily run with its day', async () => {
    const { call } = await start();
    const t = await signUp(call, 'Daily Dee');
    const r = real(51, '2026-10-05T12:00:00.000Z', { mode: 'daily', day: '2026-10-05' });
    expect((await call('POST', '/api/runs', r, t)).json.verified).toBe(true);
    expect((await call('POST', '/api/runs', { ...r, playedAt: '2026-10-05T13:00:00.000Z', day: undefined }, t)).status).toBe(400); // daily needs its day
    expect((await call('GET', '/api/board/players?mode=daily&day=2026-10-05')).json.total).toBe(1);
  });
});

describe('http edges', () => {
  it('answers CORS preflight for the allowed origin only', async () => {
    const { call } = await start(BIG, ['https://guspliffy.github.io', 'https://bloom.example.com']);
    const pre = await call('OPTIONS', '/api/runs', undefined, undefined, {
      Origin: 'https://guspliffy.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://guspliffy.github.io');
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/Content-Type/);
    const other = await call('OPTIONS', '/api/runs', undefined, undefined, { Origin: 'https://evil.example' });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const second = await call('GET', '/api/health', undefined, undefined, { Origin: 'https://bloom.example.com' });
    expect(second.headers.get('access-control-allow-origin')).toBe('https://bloom.example.com');
  });

  it('refuses non-JSON and oversized bodies', async () => {
    const { call } = await start();
    const base = `http://127.0.0.1:${(apps[apps.length - 1].server.address() as AddressInfo).port}`;
    const text = await fetch(`${base}/api/accounts`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hi' });
    expect(text.status).toBe(415);
    const big = await call('POST', '/api/accounts', { name: 'x', password: 'y'.repeat(70_000) });
    expect(big.status).toBe(413);
  });

  it('rate limits with 429 {error:slow}', async () => {
    const { call } = await start({ accounts: 2, signIns: 3, runs: 2 });
    expect((await call('POST', '/api/accounts', { name: 'Rate One', password: 'secret1' })).status).toBe(201);
    expect((await call('POST', '/api/accounts', { name: 'Rate Two', password: 'secret1' })).status).toBe(201);
    const third = await call('POST', '/api/accounts', { name: 'Rate Three', password: 'secret1' });
    expect(third.status).toBe(429);
    expect(third.json).toEqual({ error: 'slow' });
    for (let i = 0; i < 3; i++) expect((await call('POST', '/api/sessions', { name: 'Rate One', password: 'bad' })).status).toBe(401);
    expect((await call('POST', '/api/sessions', { name: 'Rate One', password: 'secret1' })).status).toBe(429);
    // A taken name is answered before the allowance is spent.
    expect((await call('POST', '/api/accounts', { name: 'Rate One', password: 'secret1' })).status).toBe(409);
  });

  it('rate limits runs per IP', async () => {
    const { call, app } = await start({ runs: 2 });
    const t = app.store.createSession(app.store.createUser('Runner', 'runner', 'x')!);
    const r = (i: number) => ({ ...real(61), playedAt: `2026-10-01T10:00:0${i}.000Z` });
    expect((await call('POST', '/api/runs', r(1), t)).status).toBe(201);
    expect((await call('POST', '/api/runs', r(2), t)).status).toBe(201);
    expect((await call('POST', '/api/runs', r(3), t)).status).toBe(429);
  });
});

describe('config', () => {
  it('defaults to loopback and the project origin, and reads the environment', () => {
    expect(readConfig({})).toEqual({ port: 8787, host: '127.0.0.1', dbPath: './data/bloom.sqlite', allowedOrigins: ['https://guspliffy.github.io'], trustProxy: false });
    expect(readConfig({ PORT: '9000', HOST: '0.0.0.0', DB_PATH: '/x.db', ALLOWED_ORIGINS: 'https://a.example/, https://b.example', TRUST_PROXY: '1' })).toEqual({
      port: 9000,
      host: '0.0.0.0',
      dbPath: '/x.db',
      allowedOrigins: ['https://a.example', 'https://b.example'],
      trustProxy: true,
    });
  });
});
