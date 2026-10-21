import { describe, expect, it } from 'vitest';
import { chainStep, pentatonicMidi } from '../src/audio/synth';

describe('melody', () => {
  it('walks the major pentatonic', () => {
    expect([0, 1, 2, 3, 4, 5].map((k) => pentatonicMidi(60, k))).toEqual([60, 62, 64, 67, 69, 72]);
  });
  it('climbs then turns back', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => chainStep(i, 3))).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });
});
