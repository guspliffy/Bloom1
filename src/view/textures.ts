import { Texture } from 'pixi.js';

let glow: Texture | null = null;

/** Soft radial glow used for halos, pollen and fireflies (additive blend, tinted per use). */
export function glowTexture(): Texture {
  if (glow) return glow;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glow = Texture.from(c);
  return glow;
}
