import { tuning } from '../tuning';

const PENTATONIC = [0, 2, 4, 7, 9];
const MAX_VOICES = 12;

/** Scale step k of the major pentatonic above the root, as a MIDI note. */
export function pentatonicMidi(root: number, k: number): number {
  return root + 12 * Math.floor(k / 5) + PENTATONIC[((k % 5) + 5) % 5];
}

/** The i-th bloom of a chain climbs the scale, then turns and walks back down, so long chains form phrases. */
export function chainStep(i: number, steps: number): number {
  const period = Math.max(2, steps) * 2;
  const p = i % period;
  return p <= steps ? p : period - p;
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

interface Voice {
  g: GainNode;
  start: number;
  end: number;
}

/** Small Web Audio synth: bell notes on a shared grid, a pad, chords and an evening-air bed. No sound files. */
export class Synth {
  muted = false;
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private bus!: BiquadFilterNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private delaySend!: GainNode;
  private bed: GainNode | null = null;
  private pad: { g: GainNode; oscs: OscillatorNode[] } | null = null;
  private voices: Voice[] = [];

  /** Must run inside a user gesture (first tap) for iOS and Chrome autoplay rules. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.build(this.ctx);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  private build(ctx: AudioContext): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.connect(comp);

    this.bus = ctx.createBiquadFilter();
    this.bus.type = 'lowpass';
    this.bus.frequency.value = 3000;
    this.dry = ctx.createGain();
    this.bus.connect(this.dry).connect(this.out);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(ctx, 2.8);
    this.wet = ctx.createGain();
    this.bus.connect(this.wet).connect(reverb).connect(this.out);

    const delay = ctx.createDelay(1);
    delay.delayTime.value = (60 / tuning.audio.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.delaySend = ctx.createGain();
    this.bus.connect(this.delaySend).connect(delay).connect(lp).connect(fb).connect(delay);
    lp.connect(this.out);
    this.startBed(ctx);
    this.applyMix();
  }

  /** Re-read volume and send levels from tuning (the dev panel changes them live). */
  applyMix(): void {
    if (!this.ctx) return;
    const a = tuning.audio;
    this.out.gain.value = this.muted ? 0 : a.masterVolume;
    this.wet.gain.value = a.reverbMix;
    this.delaySend.gain.value = a.delayMix;
    if (this.bed) this.bed.gain.value = a.bedGain;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMix();
  }

  private impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    return buf;
  }

  /** Evening air: pink noise through a 500 Hz lowpass with a slow wobble, felt not heard. */
  private startBed(ctx: AudioContext): void {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.05) * 2.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const wobble = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const depth = ctx.createGain();
    depth.gain.value = 0.35;
    lfo.connect(depth).connect(wobble.gain);
    wobble.gain.value = 0.65;
    this.bed = ctx.createGain();
    src.connect(lp).connect(wobble).connect(this.bed).connect(this.out);
    src.start();
    lfo.start();
  }

  private at(delayMs: number): number {
    return this.ctx!.currentTime + Math.max(0, delayMs) / 1000;
  }

  private voice(freq: number, type: OscillatorType, peak: number, decay: number, at: number, attack = 0.006): void {
    const ctx = this.ctx!;
    this.voices = this.voices.filter((v) => v.end > ctx.currentTime);
    // Polyphony cap (partials count a third each): the oldest voice sounding at `at` releases over 30 ms.
    const sounding = this.voices.filter((v) => v.start <= at && v.end > at);
    if (sounding.length >= MAX_VOICES * 3) {
      const old = sounding[0];
      const gain = old.g.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
      if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(at);
      else gain.cancelScheduledValues(at);
      gain.setTargetAtTime(0, at, 0.01);
      old.end = at + 0.05;
      this.voices = this.voices.filter((v) => v !== old);
    }
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    osc.connect(g).connect(this.bus);
    const end = at + attack + decay + 0.05;
    osc.start(at);
    osc.stop(end);
    this.voices.push({ g, start: at, end });
  }

  private bell(midi: number, at: number, gain: number, decay = tuning.audio.noteDecay): void {
    const f = hz(midi);
    this.voice(f, 'sine', 0.26 * gain, decay, at);
    this.voice(f * 2, 'triangle', 0.045 * gain, decay * 0.5, at);
    this.voice(f * 3.01, 'sine', 0.03 * gain, decay * 0.25, at);
  }

  /** Bloom note: scale step k above the root, `delayMs` from now; `doubled` adds an octave below at -9 dB. */
  note(k: number, delayMs = 0, gain = 1, doubled = false): void {
    if (!this.ctx || this.muted) return;
    const at = this.at(delayMs);
    const midi = pentatonicMidi(tuning.audio.rootMidi, k);
    this.bell(midi, at, gain);
    if (doubled) this.voice(hz(midi - 12), 'sine', 0.26 * gain * 0.355, tuning.audio.noteDecay, at);
  }

  /** Tonic chord that resolves a chain (root, fifth, octave; the major third too on long chains). */
  chord(delayMs: number, withThird: boolean, gain = 0.7): void {
    if (!this.ctx || this.muted) return;
    const at = this.at(delayMs);
    const root = tuning.audio.rootMidi;
    const decay = tuning.audio.noteDecay * tuning.audio.chordDecayMult;
    for (const m of withThird ? [0, 4, 7, 12] : [0, 7, 12]) this.bell(root + m, at + m * 0.004, gain * 0.55, decay);
  }

  /** Finale flourish: a five-note rise an octave up on sixteenths, with the reverb lifted for two seconds. */
  finale(delayMs: number, sixteenthMs: number): void {
    if (!this.ctx || this.muted) return;
    const root = tuning.audio.rootMidi + 12;
    [0, 2, 4, 7, 9].forEach((m, i) => this.bell(root + m, this.at(delayMs + (i + 1) * sixteenthMs), 0.5));
    const at = this.at(delayMs);
    const a = tuning.audio;
    this.wet.gain.setTargetAtTime(a.finaleReverbMix, at, 0.15);
    this.wet.gain.setTargetAtTime(a.reverbMix, at + 2, 0.6);
  }

  /** Pad (two detuned triangles on root and fifth, lowpass 900 Hz) for long chains. */
  padOn(delayMs: number): void {
    if (!this.ctx || this.muted || this.pad) return;
    const ctx = this.ctx;
    const at = this.at(delayMs);
    const a = tuning.audio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(a.padGain, at + a.padAttackMs / 1000);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.connect(lp).connect(this.out);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    lp.connect(send).connect(this.wet);
    const oscs: OscillatorNode[] = [];
    for (const [m, det] of [[-12, -6], [-12, 6], [-5, -5], [-5, 5]] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz(a.rootMidi + m);
      o.detune.value = det;
      o.connect(g);
      o.start(at);
      oscs.push(o);
    }
    this.pad = { g, oscs };
  }

  padOff(delayMs = 0): void {
    if (!this.ctx || !this.pad) return;
    const at = this.at(delayMs);
    const rel = tuning.audio.padReleaseMs / 1000;
    const { g, oscs } = this.pad;
    g.gain.cancelScheduledValues(at);
    g.gain.setTargetAtTime(0, at, rel / 4);
    for (const o of oscs) o.stop(at + rel + 0.2);
    this.pad = null;
  }

  /** Water drop for a tap: 900 → 400 Hz over 80 ms plus a tiny noise tick, pitched to a tonic chord tone. */
  drop(): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const at = ctx.currentTime;
    const shift = 2 ** ([0, 4, 7, 12][Math.floor(Math.random() * 4)] / 12);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900 * shift, at);
    osc.frequency.exponentialRampToValueAtTime(400 * shift, at + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.3 * tuning.audio.tapVolume, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(g).connect(this.bus);
    osc.start(at);
    osc.stop(at + 0.2);
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.015), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    n.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = ctx.createGain();
    ng.gain.value = 0.12 * tuning.audio.tapVolume;
    n.connect(hp).connect(ng).connect(this.dry);
    n.start(at);
  }

  /** Soft tick when pollen reaches the counter, on a tonic chord tone. */
  tick(i = 0): void {
    if (!this.ctx || this.muted) return;
    const m = [12, 16, 19, 24][i % 4];
    this.voice(hz(tuning.audio.rootMidi + m + 12), 'sine', 0.9 * tuning.audio.tickVolume, 0.12, this.ctx.currentTime);
  }

  /** Three-note sixteenth rise for drops given back. */
  refund(delayMs = 0): void {
    const six = 60000 / tuning.audio.bpm / 4;
    for (let i = 0; i < 3; i++) this.note(10 + i * 2, delayMs + i * six, 0.5);
  }

  /** Slow tonic chord with the pad when a run ends. */
  endChord(): void {
    if (!this.ctx || this.muted) return;
    const at = this.ctx.currentTime + 0.05;
    for (const k of [0, 2, 4, 5]) this.voice(hz(pentatonicMidi(tuning.audio.rootMidi - 12, k)), 'sine', 0.09, 3.6, at, 0.35);
    this.padOn(0);
    this.padOff(2400);
  }
}
