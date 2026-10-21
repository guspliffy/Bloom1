import { Texture } from 'pixi.js';

/**
 * Every soft or shaded shape in the game is baked once to a canvas texture and then drawn as a
 * tinted sprite, so the renderer never runs a filter per frame (GDD §6).
 */
const cache = new Map<string, Texture>();

function bake(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = Texture.from(c);
  cache.set(key, tex);
  return tex;
}

/** Soft radial glow, white, for halos, motes, fireflies and light. */
export function glowTexture(): Texture {
  return bake('glow', 128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
}

/** Black soft ellipse for contact shadows (drawn at 2:1). */
export function shadowTexture(): Texture {
  return bake('shadow', 128, 64, (g) => {
    g.save();
    g.scale(1, 0.5);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.9)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.restore();
  });
}

/** Petal length in texture pixels; sprites scale it to len·s. */
export const PETAL_TEX_LEN = 128;
export const PETAL_TEX_W = 100;
/** Petal half-width as a fraction of its length (0.21s / 0.55s). */
export const PETAL_ASPECT = 0.382;

function petalPath(g: CanvasRenderingContext2D, len: number, wid: number, cy: number): void {
  // Base at x=0, tip at x=len, pointing right.
  g.beginPath();
  g.moveTo(0, cy);
  g.bezierCurveTo(len * 0.35, cy - wid, len * 0.95, cy - wid * 0.55, len, cy);
  g.bezierCurveTo(len * 0.95, cy + wid * 0.55, len * 0.35, cy + wid, 0, cy);
  g.closePath();
}

/** White teardrop petal: lit tip, shaded base, faint inner rim. Tinted per use. Anchor (0, 0.5). */
export function petalTexture(): Texture {
  return bake('petal', PETAL_TEX_LEN, PETAL_TEX_W, (g) => {
    const len = PETAL_TEX_LEN - 2;
    const wid = len * PETAL_ASPECT;
    const cy = PETAL_TEX_W / 2;
    petalPath(g, len, wid, cy);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, '#a8a8a8');
    grad.addColorStop(0.55, '#e6e6e6');
    grad.addColorStop(1, '#ffffff');
    g.fillStyle = grad;
    g.fill();
    // Light from the top: a soft sheen on the upper half.
    const sheen = g.createLinearGradient(0, cy - wid, 0, cy + wid);
    sheen.addColorStop(0, 'rgba(255,255,255,0.28)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = sheen;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.stroke();
  });
}

/** Cream bud core with radial shading and a specular dot (top-left light). */
export function coreTexture(): Texture {
  return bake('core', 64, 64, (g) => {
    const grad = g.createRadialGradient(26, 26, 2, 32, 32, 31);
    grad.addColorStop(0, '#fffaf0');
    grad.addColorStop(0.7, '#fbe9c6');
    grad.addColorStop(1, '#f0d9a8');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(32, 32, 31, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.arc(22, 22, 8, 0, Math.PI * 2);
    g.fill();
  });
}

/** Vertical gradient strip (2 px wide) for skies and ground; stretch to fill. */
export function gradientTexture(key: string, stops: [number, string][]): Texture {
  return bake(`grad:${key}`, 2, 512, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 512);
    for (const [o, c] of stops) grad.addColorStop(o, c);
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 512);
  });
}

/** Dark corners, transparent centre. */
export function vignetteTexture(): Texture {
  return bake('vignette', 256, 256, (g) => {
    const grad = g.createRadialGradient(128, 128, 60, 128, 128, 181);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  });
}

/** Film grain tile. */
export function grainTexture(): Texture {
  return bake('grain', 256, 256, (g) => {
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

/** Hedge silhouette: overlapping circles along the bottom, white (tinted per layer). */
export function hedgeTexture(key: string, width: number, height: number, radii: [number, number], spacing: number, seed: number): Texture {
  return bake(`hedge:${key}:${width}x${height}`, Math.max(2, Math.ceil(width)), Math.max(2, Math.ceil(height)), (g) => {
    let x = seed;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    g.fillStyle = '#ffffff';
    g.fillRect(0, height * 0.72, width, height);
    for (let cx = -radii[1]; cx < width + radii[1]; cx += spacing * (0.7 + rnd() * 0.6)) {
      const r = radii[0] + rnd() * (radii[1] - radii[0]);
      g.beginPath();
      g.arc(cx, height * 0.72 + (rnd() - 0.5) * radii[0] * 0.6, r, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** One large plain leaf silhouette, base at left-centre, pointing right. */
export function leafTexture(): Texture {
  return bake('leaf', 256, 96, (g) => {
    petalPath(g, 254, 44, 48);
    g.fillStyle = '#ffffff';
    g.fill();
  });
}

/** Small teardrop "drop" glyph, white, pointing up. */
export function dropTexture(): Texture {
  return bake('drop', 48, 64, (g) => {
    g.beginPath();
    g.moveTo(24, 3);
    g.bezierCurveTo(16, 18, 6, 30, 6, 42);
    g.arc(24, 42, 18, Math.PI, 0, true);
    g.bezierCurveTo(42, 30, 32, 18, 24, 3);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 48, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#bfe6ff');
    g.fillStyle = grad;
    g.fill();
  });
}
