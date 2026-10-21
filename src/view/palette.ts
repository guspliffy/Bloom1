/** Blue-hour garden palette (GDD §6). Pairs are [dusk, night]; the scene lerps by the night factor. */
export const palette = {
  sky: {
    dusk: [
      [0, '#1b1a44'],
      [0.45, '#3a2a5e'],
      [0.9, '#7a4a6e'],
      [1, '#d9865e'],
    ] as [number, string][],
    night: [
      [0, '#0b0b21'],
      [0.45, '#1a1640'],
      [0.9, '#352a50'],
      [1, '#5a3a55'],
    ] as [number, string][],
  },
  ground: [
    [0, '#1a2a2c'],
    [1, '#0b1214'],
  ] as [number, string][],
  groundNight: [
    [0, '#0e1a1c'],
    [1, '#06090b'],
  ] as [number, string][],
  hedgeFar: [0x4a3a66, 0x262048] as const,
  hedgeNear: [0x2a2448, 0x15122e] as const,
  leafFore: 0x0a0a16,
  moon: 0xfff2d6,
  moonGlow: 0xffe2b8,
  star: 0xe8e4ff,

  core: 0xfff4d6,
  seed: 0xcfd8c4,
  petalIdle: 0xcdc3ff,
  petalReady: 0xffd9a4,
  ready: 0xffb760,
  arrow: 0xf3ecff,
  /** Open-flower hues walk along a chain, one per bloom. */
  bloom: [0xff8fb8, 0xffa47a, 0xffd36e, 0xb5ec8a, 0x82e0e6, 0x9fb2ff, 0xd59cff],
  cascadeLight: 0xffd8a0,
  pollen: 0xffd36e,
  firefly: 0xffe7a3,
  hint: 0xffe9c4,
  drop: 0x8fd3ff,
};

export function lerpColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ch = (shift: number) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Small hue/brightness jitter for organic variety: scales each channel by up to ±amount. */
export function jitterColor(c: number, r1: number, r2: number, amount: number): number {
  const ch = (shift: number, f: number) => Math.max(0, Math.min(255, Math.round(((c >> shift) & 255) * f)));
  const fr = 1 + (r1 - 0.5) * 2 * amount;
  const fb = 1 + (r2 - 0.5) * 2 * amount;
  return (ch(16, fr) << 16) | (ch(8, 1) << 8) | ch(0, fb);
}
