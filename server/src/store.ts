import type { DatabaseSync } from 'node:sqlite';
import { newToken, tokenHash } from './auth';
import type { RunInput, RunMode } from './validate';

export const SESSION_DAYS = 180;
const RANK = 'gardens_lit DESC, stars DESC, pollen DESC, played_at ASC, id ASC';

export interface UserRow {
  id: number;
  name: string;
  password: string;
}

export interface BoardRowOut {
  rank: number;
  name: string;
  gardensLit: number;
  stars: number;
  pollen: number;
  longest: number;
  playedAt: string;
  isMe: boolean;
}

export interface GameRowOut {
  id: number;
  name: string;
  seed: number;
  gardensLit: number;
  stars: number;
  pollen: number;
  longest: number;
  playedAt: string;
  isMe: boolean;
}

type Row = Record<string, string | number>;

/** All SQL lives here; the HTTP layer only passes values in. */
export class Store {
  constructor(private db: DatabaseSync) {}

  userByKey(key: string): UserRow | undefined {
    return this.db.prepare('SELECT id, name, password FROM users WHERE name_key = ?').get(key) as UserRow | undefined;
  }

  /** Null when the name is already taken (checked by the unique index, so two racing sign-ups cannot both win). */
  createUser(name: string, key: string, passwordHash: string): number | null {
    try {
      const r = this.db.prepare('INSERT INTO users (name, name_key, password, created_at) VALUES (?, ?, ?, ?)').run(name, key, passwordHash, new Date().toISOString());
      return Number(r.lastInsertRowid);
    } catch (e) {
      if (String((e as { message?: string }).message).includes('UNIQUE')) return null;
      throw e;
    }
  }

  createSession(userId: number): string {
    const token = newToken();
    const now = Date.now();
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash(token), userId, new Date(now).toISOString(), new Date(now + SESSION_DAYS * 86_400_000).toISOString());
    return token;
  }

  userByToken(token: string): { id: number; name: string } | null {
    const row = this.db
      .prepare('SELECT u.id AS id, u.name AS name, s.expires_at AS expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
      .get(tokenHash(token)) as { id: number; name: string; expires_at: string } | undefined;
    if (!row || row.expires_at < new Date().toISOString()) return null;
    return { id: row.id, name: row.name };
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  }

  purgeExpiredSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  }

  findRun(userId: number, r: RunInput): { id: number; verified: number } | undefined {
    return this.db
      .prepare('SELECT id, verified FROM runs WHERE user_id = ? AND mode = ? AND seed = ? AND played_at = ?')
      .get(userId, r.mode, r.seed, r.playedAt) as { id: number; verified: number } | undefined;
  }

  /** Insert, or return the row already there for the same (user, mode, seed, playedAt). */
  addRun(userId: number, r: RunInput, verified: boolean): { id: number; verified: boolean } {
    const res = this.db
      .prepare(
        `INSERT INTO runs (user_id, mode, seed, day, gardens_lit, stars, pollen, longest, taps, tap_log, game_version, played_at, verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, mode, seed, played_at) DO NOTHING`,
      )
      .run(userId, r.mode, r.seed, r.day, r.gardensLit, r.stars, r.pollen, r.longest, r.taps, JSON.stringify(r.tapLog), r.gameVersion, r.playedAt, verified ? 1 : 0);
    if (Number(res.changes) > 0) return { id: Number(res.lastInsertRowid), verified };
    const old = this.findRun(userId, r)!;
    return { id: old.id, verified: old.verified === 1 };
  }

  /** Runs stored without a replay, for `--reverify`. */
  unverifiedRuns(): (RunInput & { id: number })[] {
    const rows = this.db.prepare('SELECT * FROM runs WHERE verified = 0 ORDER BY id').all() as Row[];
    return rows.map((x) => ({
      id: Number(x.id),
      mode: x.mode as RunMode,
      seed: Number(x.seed),
      day: x.day === null ? null : String(x.day),
      gardensLit: Number(x.gardens_lit),
      stars: Number(x.stars),
      pollen: Number(x.pollen),
      longest: Number(x.longest),
      taps: Number(x.taps),
      tapLog: JSON.parse(String(x.tap_log)) as number[],
      gameVersion: String(x.game_version),
      playedAt: String(x.played_at),
    }));
  }

  setVerified(id: number, v: 1 | -1): void {
    this.db.prepare('UPDATE runs SET verified = ? WHERE id = ?').run(v, id);
  }

  /**
   * One row per player. Daily: their first verified evening of the day (so grinding does not help);
   * every other mode: their best. Then ranked by the one rule.
   */
  private playersCte(mode: RunMode, day: string | null): { sql: string; args: (string | number)[] } {
    const daily = mode === 'daily';
    const pick = daily ? 'played_at ASC, id ASC' : RANK;
    return {
      sql: `WITH cand AS (
              SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY ${pick}) AS rn
              FROM runs r WHERE r.verified = 1 AND r.mode = ? ${daily ? 'AND r.day = ?' : ''}
            ), best AS (
              SELECT c.*, u.name AS name FROM cand c JOIN users u ON u.id = c.user_id WHERE c.rn = 1
            ), ranked AS (
              SELECT best.*, ROW_NUMBER() OVER (ORDER BY ${RANK}) AS rank FROM best
            )`,
      args: daily ? [mode, day ?? ''] : [mode],
    };
  }

  playersBoard(mode: RunMode, day: string | null, limit: number, meId: number | null) {
    const { sql, args } = this.playersCte(mode, day);
    const out = (x: Row): BoardRowOut => ({
      rank: Number(x.rank),
      name: String(x.name),
      gardensLit: Number(x.gardens_lit),
      stars: Number(x.stars),
      pollen: Number(x.pollen),
      longest: Number(x.longest),
      playedAt: String(x.played_at),
      isMe: meId !== null && Number(x.user_id) === meId,
    });
    const rows = (this.db.prepare(`${sql} SELECT * FROM ranked ORDER BY rank LIMIT ?`).all(...args, limit) as Row[]).map(out);
    const total = Number((this.db.prepare(`${sql} SELECT COUNT(*) AS n FROM best`).get(...args) as Row).n);
    let me: BoardRowOut | null = null;
    if (meId !== null && !rows.some((r) => r.isMe)) {
      const mine = this.db.prepare(`${sql} SELECT * FROM ranked WHERE user_id = ?`).get(...args, meId) as Row | undefined;
      if (mine) me = out(mine);
    }
    return { rows, me, total };
  }

  gamesBoard(mode: RunMode, day: string | null, limit: number, before: string | null, meId: number | null) {
    const where = ['r.verified = 1', 'r.mode = ?'];
    const args: (string | number)[] = [mode];
    if (mode === 'daily') {
      where.push('r.day = ?');
      args.push(day ?? '');
    }
    if (before) {
      where.push('r.played_at < ?');
      args.push(before);
    }
    const rows = (
      this.db
        .prepare(
          `SELECT r.id, r.user_id, u.name, r.seed, r.gardens_lit, r.stars, r.pollen, r.longest, r.played_at
           FROM runs r JOIN users u ON u.id = r.user_id WHERE ${where.join(' AND ')}
           ORDER BY r.played_at DESC, r.id DESC LIMIT ?`,
        )
        .all(...args, limit) as Row[]
    ).map(
      (x): GameRowOut => ({
        id: Number(x.id),
        name: String(x.name),
        seed: Number(x.seed),
        gardensLit: Number(x.gardens_lit),
        stars: Number(x.stars),
        pollen: Number(x.pollen),
        longest: Number(x.longest),
        playedAt: String(x.played_at),
        isMe: meId !== null && Number(x.user_id) === meId,
      }),
    );
    return { rows, next: rows.length === limit ? rows[rows.length - 1].playedAt : null };
  }
}
