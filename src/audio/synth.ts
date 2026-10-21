import { tuning } from '../tuning';

const PENTATONIC = [0, 2, 4, 7, 9];

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

/** Small Web Audio synth: bell-like notes through a shared delay and generated reverb. No sound files. */
export class Synth {
  muted = false;
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private delaySend!: GainNode;

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

    this.dry = ctx.createGain();
    this.dry.connect(this.out);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(ctx, 2.6);
    this.wet = ctx.createGain();
    this.wet.connect(reverb).connect(this.out);

    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.34;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.delaySend = ctx.createGain();
    this.delaySend.connect(delay).connect(lp).connect(fb).connect(delay);
    lp.connect(this.out);
    this.applyMix();
  }

  /** Re-read volume and send levels from tuning (the dev panel changes them live). */
  applyMix(): void {
    if (!this.ctx) return;
    const a = tuning.audio;
    this.out.gain.value = this.muted ? 0 : a.masterVolume;
    this.wet.gain.value = a.reverbMix;
    this.delaySend.gain.value = a.delayMix;
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

  private voice(freq: number, type: OscillatorType, peak: number, decay: number, at: number, attack = 0.006): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    osc.connect(g);
    g.connect(this.dry);
    g.connect(this.wet);
    g.connect(this.delaySend);
    osc.start(at);
    osc.stop(at + attack + decay + 0.05);
  }

  /** Bloom note: scale step k above the root, `delayMs` from now. */
  note(k: number, delayMs = 0, gain = 1): void {
    if (!this.ctx || this.muted) return;
    const at = this.ctx.currentTime + delayMs / 1000;
    const f = hz(pentatonicMidi(tuning.audio.rootMidi, k));
    const d = tuning.audio.noteDecay;
    this.voice(f, 'sine', 0.26 * gain, d, at);
    this.voice(f * 2, 'triangle', 0.045 * gain, d * 0.5, at);
    this.voice(f * 3.01, 'sine', 0.03 * gain, d * 0.25, at);
  }

  /** Water-drop blip for a tap that does not bloom. */
  drop(): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const at = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1300, at);
    osc.frequency.exponentialRampToValueAtTime(420, at + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.3 * tuning.audio.tapVolume, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(g);
    g.connect(this.dry);
    g.connect(this.wet);
    osc.start(at);
    osc.stop(at + 0.2);
  }

  /** Sparkle for drops given back. */
  refund(count: number): void {
    for (let i = 0; i < count + 1; i++) this.note(10 + i * 2, i * 70, 0.6);
  }

  /** Soft closing chord when a run ends. */
  endChord(): void {
    if (!this.ctx || this.muted) return;
    const at = this.ctx.currentTime + 0.05;
    for (const k of [0, 2, 4, 5]) this.voice(hz(pentatonicMidi(tuning.audio.rootMidi - 12, k)), 'sine', 0.09, 3.2, at, 0.35);
  }
}
