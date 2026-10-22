import list from '../../config/names-blocklist.json';
import { tuning } from '../tuning';

/**
 * Player names (GDD §8 "Names"): Unicode letters, digits and single inner spaces, trimmed, unique after
 * lowercasing. Pure helpers shared by the name sheet and the online layer.
 *
 * The blocklist and the reserved names live in config/names-blocklist.json; the server imports the same
 * file, so one list rules both sides.
 */

export type NameProblem = 'short' | 'long' | 'chars' | 'blocked';
export type NameCheck = { ok: true; name: string } | { ok: false; reason: NameProblem };

/** Trim, compose to NFC, and squeeze runs of whitespace to one space, so "Fern  Moss " and "Fern Moss" are one name. */
export function normalizeName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Letters or digits (marks may follow a letter), words joined by single spaces. */
const SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}]*( [\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*$/u;

/** The digit and symbol look-alikes undone before a listed word is looked for (spec order: 0 1 3 4 5 $). */
const FOLD_FROM = '01345$';
const FOLD_TO = 'oieass';

/** Lowercase, spaces removed, look-alikes mapped: what the blocklist is matched against. */
export function foldForBlocklist(name: string): string {
  let out = '';
  for (const ch of name.toLowerCase().replace(/ /g, '')) {
    const i = FOLD_FROM.indexOf(ch);
    out += i >= 0 ? FOLD_TO[i] : ch;
  }
  return out;
}

/** Listed words (substring after folding) and the reserved names (the whole name). */
export function isBlocked(name: string): boolean {
  const flat = foldForBlocklist(name);
  if (list.reserved.includes(name.toLowerCase())) return true;
  return list.words.some((w) => flat.includes(w));
}

/** Check a name as typed. On success the normalized name is what to store and show. */
export function validateName(raw: string): NameCheck {
  const name = normalizeName(raw);
  const { nameMin, nameMax } = tuning.leaderboard;
  const length = [...name].length;
  if (name !== '' && !SHAPE.test(name)) return { ok: false, reason: 'chars' };
  if (length < nameMin) return { ok: false, reason: 'short' };
  if (length > nameMax) return { ok: false, reason: 'long' };
  if (isBlocked(name)) return { ok: false, reason: 'blocked' };
  return { ok: true, name };
}
