import { describe, expect, it } from 'vitest';
import { scheduleChain } from '../src/audio/schedule';
import { chainStep, pentatonicMidi } from '../src/audio/synth';

describe('melody', () => {
  it('walks the major pentatonic', () => {
    expect([0, 1, 2, 3, 4, 5].map((k) => pentatonicMidi(60, k))).toEqual([60, 62, 64, 67, 69, 72]);
  });
  it('climbs then turns back', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => chainStep(i, 3))).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });
});

describe('note grid', () => {
  const opts = { bpm: 96, eighthWaves: 2, strumMs: 38, maxVoicesPerWave: 2, firstStepDelayMs: 140, holdBreathChain: 8, holdBreathMs: 220, holdBreathScale: 0.35, holdBreath: true };
  const six = 60000 / 96 / 4;
  it('lands the first wave on the grid, then eighths, then sixteenths', () => {
    const s = scheduleChain([[1], [2], [3], [4], [5]], opts, 0);
    expect(s.waveAt[0]).toBeCloseTo(six * Math.ceil(140 / six));
    const gaps = s.waveAt.slice(1).map((t, i) => t - s.waveAt[i]);
    expect(gaps.map((g) => Math.round(g / six))).toEqual([2, 2, 1, 1]);
    expect(s.chordAt).toBeCloseTo(s.waveAt[4] + 2 * six);
  });
  it('stays on the grid from any clock time', () => {
    const s = scheduleChain([[1]], opts, 1000);
    expect(((1000 + s.waveAt[0]) / six) % 1).toBeCloseTo(0);
    expect(s.waveAt[0]).toBeGreaterThanOrEqual(140);
  });
  it('strums a wave and caps the voices', () => {
    const s = scheduleChain([[1, 2, 3]], opts, 0);
    expect(s.cues.map((c) => c.at - s.waveAt[0])).toEqual([0, 38, 76]);
    expect(s.cues.map((c) => c.audible)).toEqual([true, true, false]);
  });
  it('holds its breath before the last wave of a long chain', () => {
    const waves = [[1, 2], [3, 4], [5, 6], [7, 8]];
    const held = scheduleChain(waves, opts, 0);
    const calm = scheduleChain(waves, { ...opts, holdBreath: false }, 0);
    expect(held.holdWave).toBe(3);
    expect(held.waveAt[3] - calm.waveAt[3]).toBeCloseTo(six);
    expect(calm.holdWave).toBe(-1);
  });
});
