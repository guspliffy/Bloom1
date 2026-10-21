/** Dusk garden palette. Colour means state, not count: cool lavender while filling, warm amber when ready. */
const petalIdle = 0xb4a7ff;
const petalReady = 0xffc27a;
const core = 0xfff4d6;

export const palette = {
  petalIdle,
  petalReady,
  petalByCount: [core, petalIdle, petalIdle, petalReady],
  core,
  arrow: 0xf3ecff,
  ready: 0xffb760,
  /** Open-flower hues walk along a chain, one per bloom. */
  bloom: [0xff8fb8, 0xffa47a, 0xffd36e, 0xb5ec8a, 0x82e0e6, 0x9fb2ff, 0xd59cff],
  firefly: 0xffe7a3,
};
