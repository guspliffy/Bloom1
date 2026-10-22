import { tuning } from '../tuning';
import type { RunRecord } from './online';

/**
 * Finished evenings kept on the device, in two places that never mix:
 * - guest runs (no account yet): uploaded when the player signs up or signs in, cleared at sign-out;
 * - an account's own queue (key includes the user id): evenings played while signed in, kept until they reach the server.
 */
const GUEST_KEY = 'bloom.guestRuns.v1';
const pendingKey = (userId: string) => `bloom.pendingRuns.v1.${userId}`;

/** Beyond this many the oldest are dropped, so a long offline spell cannot fill storage. */
const cap = () => tuning.leaderboard.guestRunsKept;

function read(key: string): RunRecord[] {
  try {
    const raw = localStorage.getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as RunRecord[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, runs: RunRecord[]): void {
  try {
    if (runs.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(runs.slice(-cap())));
  } catch {
    /* storage unavailable or full: the run is simply not kept */
  }
}

const store = (key: string) => ({
  add: (run: RunRecord) => write(key, [...read(key), run]),
  list: () => read(key),
  take: () => {
    const runs = read(key);
    write(key, []);
    return runs;
  },
  /** Put runs back at the front (older than anything added since). */
  restore: (runs: RunRecord[]) => write(key, [...runs, ...read(key)]),
  clear: () => write(key, []),
});

const guest = store(GUEST_KEY);

/** Oldest first; only the most recent `leaderboard.guestRunsKept` are kept. */
export const addGuestRun = guest.add;
export const guestRuns = guest.list;
/** Hand over every kept run and clear the store, for upload after sign-up. Use restoreGuestRuns if the upload fails. */
export const takeGuestRuns = guest.take;
export const restoreGuestRuns = guest.restore;
export const clearGuestRuns = guest.clear;

/** The signed-in player's own queue. */
export const pendingRuns = (userId: string) => store(pendingKey(userId));
