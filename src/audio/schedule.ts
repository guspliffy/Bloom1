/** One bloom on the note grid: its chain index k, when it opens (ms from now), and whether it sounds. */
export interface BloomCue {
  cell: number;
  k: number;
  wave: number;
  at: number;
  audible: boolean;
}

export interface ChainSchedule {
  cues: BloomCue[];
  /** Start time of each wave (ms from now). */
  waveAt: number[];
  /** Index of the wave preceded by a held breath, or -1. */
  holdWave: number;
  /** Time of the last bloom. */
  lastAt: number;
  /** One eighth after the last bloom: where the chord lands. */
  chordAt: number;
  eighthMs: number;
  sixteenthMs: number;
}

export interface ScheduleOpts {
  bpm: number;
  eighthWaves: number;
  strumMs: number;
  maxVoicesPerWave: number;
  firstStepDelayMs: number;
  holdBreathChain: number;
  holdBreathMs: number;
  holdBreathScale: number;
  /** False under prefers-reduced-motion. */
  holdBreath: boolean;
}

/**
 * Put a cascade on the note grid (GDD §4): the first wave on the first sixteenth at least
 * `firstStepDelayMs` away, the next `eighthWaves` waves an eighth apart, then sixteenths, so long
 * chains accelerate into a flourish. Blooms in a wave strum `strumMs` apart. `clockMs` is a running
 * clock that keeps successive chains on the same grid.
 */
export function scheduleChain(waves: readonly (readonly number[])[], o: ScheduleOpts, clockMs = 0): ChainSchedule {
  const sixteenth = 60000 / o.bpm / 4;
  const eighth = sixteenth * 2;
  const total = waves.reduce((n, w) => n + w.length, 0);
  const holdWave = o.holdBreath && total >= o.holdBreathChain && waves.length >= 2 ? waves.length - 1 : -1;
  const first = Math.ceil((clockMs + o.firstStepDelayMs) / sixteenth) * sixteenth - clockMs;
  const waveAt: number[] = [];
  const cues: BloomCue[] = [];
  let t = first;
  let k = 0;
  waves.forEach((cells, w) => {
    if (w > 0) t += w <= o.eighthWaves ? eighth : sixteenth;
    if (w === holdWave) t += Math.ceil((o.holdBreathMs * (1 - o.holdBreathScale)) / sixteenth) * sixteenth;
    waveAt.push(t);
    cells.forEach((cell, j) => cues.push({ cell, k: k++, wave: w, at: t + j * o.strumMs, audible: j < o.maxVoicesPerWave }));
  });
  const lastAt = cues.length ? cues[cues.length - 1].at : 0;
  const lastWave = waveAt.length ? waveAt[waveAt.length - 1] : 0;
  return { cues, waveAt, holdWave, lastAt, chordAt: lastWave + eighth, eighthMs: eighth, sixteenthMs: sixteenth };
}
