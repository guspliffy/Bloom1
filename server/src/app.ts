import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { validateName } from '../../src/net/names';
import { checkPassword, hashPassword } from './auth';
import type { Config } from './config';
import { openDb } from './db';
import { DEFAULT_LIMITS, HOUR, RateLimiter, TEN_MIN, type Limits } from './ratelimit';
import { Store } from './store';
import { isDay, nameKey, parseRun, type RunInput, type RunMode } from './validate';
import { replayMatches } from './verify';
import { ownVersion } from './version';

const MAX_BODY = 64 * 1024;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72;
const PLAYERS_MAX = 100;
const GAMES_MAX = 200;
const BATCH_MAX = 20;

export interface AppOptions {
  config: Config;
  version?: string;
  limits?: Partial<Limits>;
}

export interface App {
  server: Server;
  db: DatabaseSync;
  store: Store;
  version: string;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(String(body.error));
  }
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

export function createApp(opts: AppOptions): App {
  const { config } = opts;
  const version = opts.version ?? ownVersion();
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const db = openDb(config.dbPath);
  const store = new Store(db);
  const limiter = new RateLimiter();
  const sweeper = setInterval(() => {
    limiter.sweep(HOUR);
    store.purgeExpiredSessions();
  }, 10 * 60_000);
  sweeper.unref();

  const allowAll = config.allowedOrigins.includes('*');
  const originAllowed = (o: string | undefined) => !!o && (allowAll || config.allowedOrigins.includes(o));

  function clientIp(req: IncomingMessage): string {
    if (config.trustProxy) {
      // Our own proxy appends the address it saw as the last entry; earlier ones are whatever the client claimed.
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length > 0) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function send(res: ServerResponse, status: number, body?: unknown): void {
    if (body === undefined) {
      res.writeHead(status);
      res.end();
      return;
    }
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
  }

  function readJson(req: IncomingMessage): Promise<unknown> {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) throw new HttpError(415, { error: 'invalid' });
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new HttpError(413, { error: 'toolarge' }));
          req.removeAllListeners('data');
          req.resume();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new HttpError(400, { error: 'invalid' }));
        }
      });
      req.on('error', reject);
    });
  }

  function bearer(req: IncomingMessage): string | null {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
    return m ? m[1] : null;
  }

  /** Signed-in user from the bearer token, or null (unknown, expired, or none). */
  function authed(req: IncomingMessage): { id: number; name: string } | null {
    const t = bearer(req);
    return t ? store.userByToken(t) : null;
  }

  const credentials = (body: unknown): { name: string; password: string } => {
    const b = body as Record<string, unknown> | null;
    if (!b || typeof b.name !== 'string' || typeof b.password !== 'string') throw new HttpError(400, { error: 'invalid' });
    return { name: b.name, password: b.password };
  };

  async function createAccount(req: IncomingMessage, ip: string) {
    const { name, password } = credentials(await readJson(req));
    const v = validateName(name);
    if (!v.ok) throw new HttpError(400, { error: v.reason });
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) throw new HttpError(400, { error: 'password' });
    const key = nameKey(v.name);
    if (store.userByKey(key)) throw new HttpError(409, { error: 'taken' });
    // After the cheap checks, so a mistyped name does not eat the allowance; before the costly hash.
    if (!limiter.take(`acct:${ip}`, limits.accounts, HOUR)) throw new HttpError(429, { error: 'slow' });
    const id = store.createUser(v.name, key, await hashPassword(password));
    if (id === null) throw new HttpError(409, { error: 'taken' });
    return { status: 201, body: { token: store.createSession(id), id, name: v.name } };
  }

  async function signIn(req: IncomingMessage, ip: string) {
    if (!limiter.take(`sign:${ip}`, limits.signIns, TEN_MIN)) throw new HttpError(429, { error: 'slow' });
    const { name, password } = credentials(await readJson(req));
    const user = store.userByKey(nameKey(name));
    const ok = await checkPassword(password.slice(0, 1024), user?.password ?? null);
    if (!user || !ok) throw new HttpError(401, { error: 'wrong' });
    return { status: 200, body: { token: store.createSession(user.id), id: user.id, name: user.name } };
  }

  /** Shape-checked run to stored result. Throws HttpError(400) when a replay of this server's own version fails. */
  function saveRun(userId: number, r: RunInput): { id: number; verified: boolean } {
    const existing = store.findRun(userId, r);
    if (existing) return { id: existing.id, verified: existing.verified === 1 };
    if (r.gameVersion !== version) return store.addRun(userId, r, false);
    if (!replayMatches(r)) throw new HttpError(400, { error: 'invalid' });
    return store.addRun(userId, r, true);
  }

  async function postRun(req: IncomingMessage, ip: string) {
    const user = authed(req);
    if (!user) throw new HttpError(401, { error: 'unauthorized' });
    if (!limiter.take(`run:${ip}`, limits.runs, HOUR)) throw new HttpError(429, { error: 'slow' });
    const r = parseRun(await readJson(req));
    if (!r) throw new HttpError(400, { error: 'invalid' });
    return { status: 201, body: saveRun(user.id, r) };
  }

  async function postBatch(req: IncomingMessage, ip: string) {
    const user = authed(req);
    if (!user) throw new HttpError(401, { error: 'unauthorized' });
    const body = (await readJson(req)) as { runs?: unknown } | null;
    if (!body || !Array.isArray(body.runs) || body.runs.length > BATCH_MAX) throw new HttpError(400, { error: 'invalid' });
    if (!limiter.take(`run:${ip}`, limits.runs, HOUR, body.runs.length)) throw new HttpError(429, { error: 'slow' });
    let saved = 0;
    for (const raw of body.runs) {
      const r = parseRun(raw);
      if (!r) continue;
      try {
        saveRun(user.id, r);
        saved++;
      } catch (e) {
        if (!(e instanceof HttpError)) throw e; // a failed replay is skipped, not fatal for the others
      }
    }
    return { status: 200, body: { saved } };
  }

  function boardParams(url: URL, maxLimit: number, fallback: number) {
    const mode = url.searchParams.get('mode') ?? 'endless';
    if (mode !== 'endless' && mode !== 'daily' && mode !== 'journey') throw new HttpError(400, { error: 'invalid' });
    const rawLimit = url.searchParams.get('limit');
    const n = rawLimit === null ? fallback : Number(rawLimit);
    if (!Number.isFinite(n)) throw new HttpError(400, { error: 'invalid' });
    const day = mode === 'daily' ? (url.searchParams.get('day') ?? todayUtc()) : null;
    if (day !== null && !isDay(day)) throw new HttpError(400, { error: 'invalid' });
    return { mode: mode as RunMode, day, limit: Math.max(1, Math.min(maxLimit, Math.floor(n))) };
  }

  function playersBoard(req: IncomingMessage, url: URL) {
    const { mode, day, limit } = boardParams(url, PLAYERS_MAX, 50);
    return { status: 200, body: store.playersBoard(mode, day, limit, authed(req)?.id ?? null) };
  }

  function gamesBoard(req: IncomingMessage, url: URL) {
    const { mode, day, limit } = boardParams(url, GAMES_MAX, 100);
    const before = url.searchParams.get('before');
    if (before !== null && Number.isNaN(Date.parse(before))) throw new HttpError(400, { error: 'invalid' });
    // Normalise so the comparison against stored ISO strings is exact.
    const cursor = before === null ? null : new Date(before).toISOString();
    return { status: 200, body: store.gamesBoard(mode, day, limit, cursor, authed(req)?.id ?? null) };
  }

  async function route(req: IncomingMessage, url: URL, ip: string): Promise<{ status: number; body?: unknown }> {
    const m = req.method ?? 'GET';
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const routes: Record<string, string[]> = {
      '/api/health': ['GET'],
      '/api/accounts': ['POST'],
      '/api/sessions': ['POST', 'DELETE'],
      '/api/runs': ['POST'],
      '/api/runs/batch': ['POST'],
      '/api/board/players': ['GET'],
      '/api/board/games': ['GET'],
    };
    const allowed = routes[p];
    if (!allowed) throw new HttpError(404, { error: 'notfound' });
    if (!allowed.includes(m) && !(m === 'HEAD' && allowed.includes('GET'))) throw new HttpError(405, { error: 'method' });
    switch (`${m} ${p}`) {
      case 'GET /api/health':
      case 'HEAD /api/health':
        return { status: 200, body: { ok: true, version } };
      case 'POST /api/accounts':
        return createAccount(req, ip);
      case 'POST /api/sessions':
        return signIn(req, ip);
      case 'DELETE /api/sessions': {
        const t = bearer(req);
        if (t) store.deleteSession(t);
        return { status: 204 };
      }
      case 'POST /api/runs':
        return postRun(req, ip);
      case 'POST /api/runs/batch':
        return postBatch(req, ip);
      case 'GET /api/board/players':
        return playersBoard(req, url);
      case 'GET /api/board/games':
        return gamesBoard(req, url);
    }
    throw new HttpError(404, { error: 'notfound' });
  }

  const server = createServer((req, res) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (originAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin!);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      if (originAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
      }
      send(res, 204);
      return;
    }
    const url = new URL(req.url ?? '/', 'http://local');
    route(req, url, clientIp(req))
      .then((r) => send(res, r.status, r.body))
      .catch((e) => {
        if (e instanceof HttpError) {
          if (e.status === 413) res.setHeader('Connection', 'close');
          send(res, e.status, e.body);
          return;
        }
        console.error(`${new Date().toISOString()} ${req.method} ${url.pathname}`, e);
        if (!res.headersSent) send(res, 500, { error: 'server' });
      });
  });
  // A stalled client must not hold a socket open forever.
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  return {
    server,
    db,
    store,
    version,
    close: () =>
      new Promise((resolve) => {
        clearInterval(sweeper);
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
