import { Rng } from '../core/rng';
import { validateName } from './names';
import { Online, type RunRecord, type Transport } from './online';

/**
 * An in-memory stand-in for the game server, speaking the HTTP contract in online.ts: accounts, sessions,
 * run uploads (deduplicated), and the two boards. Tests drive the online layer with it, and
 * `__bloom.fakeOnline()` swaps it into the running game for screenshots. Loaded only by dynamic import,
 * never by the game itself.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Res = { status: number; json: any };

export class FakeServer {
  users: { id: string; name: string; password: string }[] = [];
  tokens = new Map<string, string>();
  runs: (RunRecord & { id: number; userId: string })[] = [];
  /** Every request fails like a dropped connection. */
  down = false;
  /** Every request answers 500. */
  broken = false;
  /** Runs endpoints answer 500 (accounts and boards still work). */
  failRunWrites = false;
  /** Each request waits this long first. */
  latencyMs = 0;
  /** Requests seen, `METHOD path`. */
  log: string[] = [];

  private userByName(name: string) {
    return this.users.find((u) => u.name.toLowerCase() === name.toLowerCase());
  }

  private userOf(token?: string | null) {
    const id = token ? this.tokens.get(token) : undefined;
    return this.users.find((u) => u.id === id);
  }

  private better(a: RunRecord, b: RunRecord) {
    return b.gardensLit - a.gardensLit || b.stars - a.stars || b.pollen - a.pollen || Date.parse(a.playedAt) - Date.parse(b.playedAt);
  }

  private name(userId: string) {
    return this.users.find((u) => u.id === userId)!.name;
  }

  private row(r: RunRecord & { userId: string }, rank: number, meId?: string) {
    return {
      rank,
      name: this.name(r.userId),
      gardensLit: r.gardensLit,
      stars: r.stars,
      pollen: r.pollen,
      longest: r.longest,
      playedAt: r.playedAt,
      isMe: r.userId === meId,
    };
  }

  async request(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
    this.log.push(`${method} ${path}`);
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.down) throw new Error('Failed to fetch');
    if (this.broken) return { status: 500, json: { error: 'boom' } };
    const url = new URL(path, 'http://fake');
    const q = url.searchParams;
    const b = (body ?? {}) as Row;
    const me = this.userOf(token);
    const route = `${method} ${url.pathname}`;
    if (token && !me && route !== 'DELETE /api/sessions') return { status: 401, json: { error: 'unauthorized' } };

    if (route === 'POST /api/accounts') {
      const v = validateName(String(b.name ?? ''));
      if (!v.ok) return { status: 400, json: { error: v.reason } };
      if (String(b.password ?? '').length < 6) return { status: 400, json: { error: 'password' } };
      if (this.userByName(v.name)) return { status: 409, json: { error: 'taken' } };
      return { status: 201, json: this.signUp(v.name, String(b.password)) };
    }
    if (route === 'POST /api/sessions') {
      const u = this.userByName(String(b.name ?? '').trim().replace(/\s+/g, ' '));
      if (!u || u.password !== b.password) return { status: 401, json: { error: 'wrong' } };
      return { status: 200, json: this.issue(u.id, u.name) };
    }
    if (route === 'DELETE /api/sessions') {
      if (token) this.tokens.delete(token);
      return { status: 204, json: null };
    }
    if (route === 'POST /api/runs' || route === 'POST /api/runs/batch') {
      if (!me) return { status: 401, json: { error: 'unauthorized' } };
      if (this.failRunWrites) return { status: 500, json: { error: 'boom' } };
      const list: RunRecord[] = route.endsWith('batch') ? b.runs : [b as RunRecord];
      if (!Array.isArray(list) || list.length > 20) return { status: 400, json: { error: 'invalid' } };
      let saved = 0;
      let id = 0;
      for (const r of list) {
        const dup = this.runs.find((x) => x.userId === me.id && x.mode === r.mode && x.seed === r.seed && x.playedAt === r.playedAt);
        if (!dup) {
          id = this.runs.length + 1;
          this.runs.push({ ...r, id, userId: me.id });
        }
        saved++;
      }
      return route.endsWith('batch') ? { status: 200, json: { saved } } : { status: 201, json: { id, verified: true } };
    }
    if (route === 'GET /api/board/players') {
      const mode = q.get('mode');
      const day = q.get('day');
      const best = new Map<string, RunRecord & { userId: string }>();
      for (const r of [...this.runs].sort((a, c) => this.better(a, c))) {
        if (r.mode === mode && (mode !== 'daily' || r.day === day) && !best.has(r.userId)) best.set(r.userId, r);
      }
      const ranked = [...best.values()].sort((a, c) => this.better(a, c)).map((r, i) => this.row(r, i + 1, me?.id));
      return {
        status: 200,
        json: { rows: ranked.slice(0, Number(q.get('limit') ?? 50)), me: ranked.find((r) => r.isMe) ?? null, total: ranked.length },
      };
    }
    if (route === 'GET /api/board/games') {
      const before = q.get('before');
      const limit = Number(q.get('limit') ?? 100);
      const rows = this.runs
        .filter((r) => r.mode === q.get('mode') && (!before || Date.parse(r.playedAt) < Date.parse(before)))
        .sort((a, c) => Date.parse(c.playedAt) - Date.parse(a.playedAt))
        .slice(0, limit)
        .map((r) => ({ id: r.id, seed: r.seed, ...this.row(r, 0, me?.id), rank: undefined }));
      return { status: 200, json: { rows, next: rows.length === limit ? rows[rows.length - 1].playedAt : null } };
    }
    return { status: 404, json: { error: 'not found' } };
  }

  private issue(id: string, name: string) {
    const token = `tok-${id}-${this.tokens.size + 1}`;
    this.tokens.set(token, id);
    return { token, id, name };
  }

  private signUp(name: string, password: string) {
    const id = `u${this.users.length + 1}`;
    this.users.push({ id, name, password });
    return this.issue(id, name);
  }

  transport(): Transport {
    return { request: (m, p, b, t) => this.request(m, p, b, t) };
  }

  /** An Online instance wired to this server. */
  online(): Online {
    return new Online({ config: { apiUrl: 'http://fake' }, transport: this.transport() });
  }

  /** A gardener with a login (password 'secret1') and the given finished evenings. */
  addPlayer(name: string, runs: Omit<RunRecord, 'gameVersion'>[]): string {
    const id = `u${this.users.length + 1}`;
    this.users.push({ id, name, password: 'secret1' });
    for (const r of runs) this.runs.push({ ...r, gameVersion: 'fake', id: this.runs.length + 1, userId: id });
    return id;
  }
}

const SAMPLE_NAMES = [
  'Mira', 'Oak', 'Juniper', 'Søren', 'Ana', 'Fern Moss', 'Tomás', 'Linden', 'Zoë', 'Pippin',
  'Sable', 'Yara', 'Ivy', 'Bartholomew Finc', 'Hana', 'Cedar', 'Elodie', 'Marigold', 'Wil', 'Thistle',
  'Amara', 'Basil', 'Clover', 'Dahlia', 'Ezra', 'Fenn', 'Gwen', 'Hazel', 'Iris', 'Jasper',
  'Kestrel', 'Lark', 'Maple', 'Nettle', 'Olive', 'Poppy', 'Quill', 'Rowan', 'Saffron', 'Tansy',
  'Umber', 'Vesper', 'Willow', 'Xanthe', 'Yarrow', 'Zinnia', 'Åsa', 'Bram', 'Cora', 'Dov',
  'Elm', 'Flora', 'Gale', 'Heron', 'Isla', 'Jory', 'Kit', 'Lumi', 'Moss', 'Noor',
];

/**
 * A populated server for screenshots: 60 gardeners with 1 to 3 evenings each over the last three weeks.
 * "Nira" sits near the top and "Wren" below the top 50, so both pinned-row states can be shown.
 */
export function sampleServer(now = Date.now()): FakeServer {
  const s = new FakeServer();
  const rng = new Rng(2024);
  const total = 60;
  const NIRA = 6;
  const WREN = 56;
  const names = SAMPLE_NAMES.filter((n) => n !== 'Nira' && n !== 'Wren').slice(0, total - 2);
  let k = 0;
  for (let i = 0; i < total; i++) {
    const name = i === NIRA ? 'Nira' : i === WREN ? 'Wren' : names[k++];
    const evenings = 1 + rng.int(3);
    const runs: Omit<RunRecord, 'gameVersion'>[] = [];
    for (let e = 0; e < evenings; e++) {
      const best = e === 0;
      const gardens = best ? Math.max(0, 9 - Math.floor(i / 6)) : rng.int(Math.max(1, 9 - Math.floor(i / 6)));
      const stars = gardens === 0 ? 0 : Math.min(3 * gardens, Math.max(gardens, gardens * 2 - 2 + (i % 3)));
      const pollen = Math.max(40, (best ? 15000 : 4000) - i * 210 - e * 900 + rng.int(150));
      // spread over three weeks, newest evenings first for the better gardeners
      const ageMs = (rng.next() * 21 * 24 + (best ? 0 : 3)) * 3600_000;
      runs.push({
        mode: 'endless',
        seed: rng.int(2 ** 32),
        gardensLit: gardens,
        stars,
        pollen,
        longest: 3 + rng.int(9),
        taps: 20 + rng.int(60),
        tapLog: [],
        playedAt: new Date(now - ageMs - i * 1000 - e * 31).toISOString(),
      });
    }
    s.addPlayer(name, runs);
  }
  return s;
}
