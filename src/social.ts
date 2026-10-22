import type { Run } from './core/run';
import type { Hud } from './hud';
import { GAME_VERSION } from './net/clean';
import { bestGuestRun } from './net/board';
import { guestRuns } from './net/guestRuns';
import type { Online, Player, RunRecord } from './net/online';
import { tuning } from './tuning';

const EVENINGS_KEY = 'bloom.eveningsDone';

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Who is playing and where finished evenings go (GDD §8). Owns the online layer for the page: the board
 * and name sheets read `online` and `player` from here, and the game hands it every finished evening.
 * Nothing here waits for the network; the end sheet never does.
 */
export class Social {
  player: Player | null = null;

  constructor(
    public online: Online,
    private hud: Hud,
  ) {
    // Back on the network: send whatever the account has queued.
    window.addEventListener('online', () => void this.online.flushPending());
  }

  /** Launch: find the saved session, show the right account row, retry queued evenings. */
  async init(): Promise<void> {
    const o = this.online;
    this.player = await o.me();
    this.sync();
    if (this.player) void o.flushPending();
  }

  /** Swap the online layer (the debug hook's fake client). */
  async setOnline(o: Online): Promise<void> {
    this.online = o;
    this.player = null;
    this.sync();
    await this.init();
  }

  get isGuest(): boolean {
    return this.player === null;
  }

  /** Finished evenings on this device, signed in or not. */
  get evenings(): number {
    return Number(store(EVENINGS_KEY) ?? 0) || 0;
  }

  /** A guest's best evening on this device, for the pinned "You" row. */
  guestBest(): RunRecord | null {
    return bestGuestRun(guestRuns());
  }

  setPlayer(p: Player | null): void {
    this.player = p;
    this.sync();
  }

  /** The settings row and the end sheet's quiet link follow who is playing. */
  sync(): void {
    this.hud.setAccountRow(this.player?.name ?? null);
    this.hud.setOffer(this.isGuest && this.evenings >= tuning.leaderboard.offerAfterEvenings);
  }

  /**
   * An evening ended. Counts it, and when it is a clean run queues it for the boards (the account's
   * queue, or the guest list) and sends what can be sent. Never awaited by the sheet.
   */
  evening(run: Run, clean: boolean): void {
    store(EVENINGS_KEY, String(this.evenings + 1));
    this.sync();
    if (!clean) return;
    const record: RunRecord = {
      mode: 'endless',
      seed: run.seed,
      gardensLit: run.gardensLit,
      stars: run.stars.reduce((a, b) => a + b, 0),
      pollen: run.pollen,
      longest: run.longest,
      taps: run.taps,
      tapLog: [...run.tapLog],
      gameVersion: GAME_VERSION,
      playedAt: new Date().toISOString(),
    };
    void this.online.submitRun(record).then(() => this.sync());
  }
}
