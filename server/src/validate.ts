import { normalizeName } from '../../src/net/names';

export const MAX_TAPS = 2000;
export type RunMode = 'endless' | 'daily' | 'journey';

/** A run as the client sends it, after shape checks (not yet replayed). `playedAt` is normalized to ISO with milliseconds. */
export interface RunInput {
  mode: RunMode;
  seed: number;
  day: string | null;
  gardensLit: number;
  stars: number;
  pollen: number;
  longest: number;
  taps: number;
  tapLog: number[];
  gameVersion: string;
  playedAt: string;
}

const isInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
export const isDay = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** Null when the record is malformed. `now` is injectable for tests. */
export function parseRun(raw: unknown, now = Date.now()): RunInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.mode !== 'endless' && r.mode !== 'daily' && r.mode !== 'journey') return null;
  if (!isInt(r.seed, 4294967295) || !isInt(r.gardensLit, 1000)) return null;
  if (!isInt(r.stars, 3 * (r.gardensLit as number)) || !isInt(r.pollen, 100_000_000)) return null;
  if (!isInt(r.longest, 1000) || !isInt(r.taps, MAX_TAPS)) return null;
  if (!Array.isArray(r.tapLog) || r.tapLog.length !== r.taps) return null;
  if (!r.tapLog.every((c) => isInt(c, 100_000))) return null;
  if (typeof r.gameVersion !== 'string' || r.gameVersion.length < 1 || r.gameVersion.length > 40) return null;
  if (typeof r.playedAt !== 'string') return null;
  const t = Date.parse(r.playedAt);
  if (Number.isNaN(t) || t < Date.UTC(2024, 0, 1) || t > now + 86_400_000) return null;
  let day: string | null = null;
  if (r.mode === 'daily') {
    if (!isDay(r.day)) return null;
    // The day is when it was dealt; allow a day either side of the finish for runs that cross midnight UTC.
    if (Math.abs(Date.parse(`${r.day}T00:00:00Z`) - Date.UTC(...ymd(t))) > 86_400_000) return null;
    day = r.day;
  } else if (r.day !== undefined && r.day !== null) return null;
  return {
    mode: r.mode,
    seed: r.seed as number,
    day,
    gardensLit: r.gardensLit as number,
    stars: r.stars as number,
    pollen: r.pollen as number,
    longest: r.longest as number,
    taps: r.taps as number,
    tapLog: r.tapLog as number[],
    gameVersion: r.gameVersion,
    playedAt: new Date(t).toISOString(),
  };
}

function ymd(t: number): [number, number, number] {
  const d = new Date(t);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

/** The key names are unique by: normalized, then lowercased (same as the client's `nameToEmail`). */
export const nameKey = (name: string): string => normalizeName(name).toLowerCase();
