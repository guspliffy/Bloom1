import { Texture } from 'pixi.js';
import { palette } from './palette';

const hex = (c: number, a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

/** Rounded hexagon with corners at `rot` + i·60°, radius `r`, corner radius `cr`, centred on (cx, cy). */
function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, cr: number, rot: number): void {
  const pts = Array.from({ length: 6 }, (_, i) => [cx + Math.cos(rot + (i * Math.PI) / 3) * r, cy + Math.sin(rot + (i * Math.PI) / 3) * r]);
  g.beginPath();
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[5], pts[0]);
  g.moveTo(start[0], start[1]);
  for (let i = 0; i < 6; i++) {
    const p = pts[i];
    const n = pts[(i + 1) % 6];
    const m = mid(p, n);
    g.arcTo(p[0], p[1], m[0], m[1], cr);
  }
  g.closePath();
}

const cache = new Map<string, Texture>();

/**
 * The raised garden bed under the board (GDD §6), baked once per board size and rotation: drop
 * shadow, dark side, soil top with moss and one dimple per cell, a rim light on the upper edges and
 * a few grass tufts on the front edge. Returns a texture centred on the board centre, at `res`× scale.
 */
export function bedTexture(radius: number, s: number, rot: number, cells: { x: number; y: number }[], res: number): Texture {
  const key = `${radius}:${Math.round(s * 10)}:${rot.toFixed(3)}:${res}`;
  const hit = cache.get(key);
  if (hit) return hit;
  for (const t of cache.values()) t.destroy(true);
  cache.clear();

  const rb = 0.866 * (2 * radius + 1) * s + 1.0 * s;
  const cr = 0.5 * s;
  const half = Math.ceil(rb * 1.08 + s * 1.6);
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(half * 2 * res);
  const g = c.getContext('2d')!;
  g.scale(res, res);
  g.translate(half, half);

  let seed = radius * 7919 + 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Drop shadow and side.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = s * 0.9 * res;
  g.shadowOffsetY = s * 0.18 * res;
  hexPath(g, 0, s * 0.22, rb * 1.02, cr, rot);
  const side = g.createLinearGradient(0, -rb, 0, rb);
  side.addColorStop(0, '#121c1f');
  side.addColorStop(1, '#0a1012');
  g.fillStyle = side;
  g.fill();
  g.restore();

  // Top face.
  hexPath(g, 0, 0, rb, cr, rot);
  const top = g.createLinearGradient(0, -rb, 0, rb);
  top.addColorStop(0, '#1c2a2e');
  top.addColorStop(1, '#0f171a');
  g.fillStyle = top;
  g.fill();

  g.save();
  g.clip();
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * rb * 0.75;
    const r = s * (2 + rnd() * 1.5);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    const mg = g.createRadialGradient(x, y, 0, x, y, r);
    mg.addColorStop(0, hex(0x24383a, 0.55));
    mg.addColorStop(1, hex(0x24383a, 0));
    g.fillStyle = mg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (const p of cells) {
    const r = s * 0.7;
    const dg = g.createRadialGradient(p.x, p.y + s * 0.05, 0, p.x, p.y + s * 0.05, r);
    dg.addColorStop(0, 'rgba(0,0,0,0.2)');
    dg.addColorStop(0.6, 'rgba(0,0,0,0.08)');
    dg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = dg;
    g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  }
  // A soft lift of light toward the top-left.
  const sheen = g.createRadialGradient(-rb * 0.35, -rb * 0.45, 0, -rb * 0.35, -rb * 0.45, rb * 1.1);
  sheen.addColorStop(0, 'rgba(160,190,200,0.07)');
  sheen.addColorStop(1, 'rgba(160,190,200,0)');
  g.fillStyle = sheen;
  g.fillRect(-rb, -rb, rb * 2, rb * 2);
  g.restore();

  // Rim light on the upper edges, fading toward the front.
  hexPath(g, 0, 0, rb - 1, cr, rot);
  const rim = g.createLinearGradient(0, -rb, 0, rb * 0.35);
  rim.addColorStop(0, hex(0x7a9a88, 0.45));
  rim.addColorStop(1, hex(0x7a9a88, 0));
  g.strokeStyle = rim;
  g.lineWidth = 2;
  g.stroke();

  // Grass tufts standing on the front edge.
  const front: [number, number][] = [];
  for (let i = 0; i < 400; i++) {
    const a = (i / 400) * Math.PI * 2;
    const k = Math.cos(Math.PI / 6) / Math.cos(((((a - rot) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6);
    const x = Math.cos(a) * rb * k * 0.97;
    const y = Math.sin(a) * rb * k * 0.97 + s * 0.2;
    if (y > rb * 0.55) front.push([x, y]);
  }
  g.fillStyle = hex(palette.leafFore, 0.8);
  for (let t = 0; t < 5 && front.length; t++) {
    const [x, y] = front[Math.floor(((t + 0.3 + rnd() * 0.4) / 5) * front.length)];
    for (let b = 0; b < 3; b++) {
      const h = s * (0.6 + rnd() * 0.3);
      const lean = (b - 1) * 0.35 + (rnd() - 0.5) * 0.2;
      const bx = x + (b - 1) * s * 0.08;
      g.beginPath();
      g.moveTo(bx - s * 0.05, y);
      g.quadraticCurveTo(bx + Math.sin(lean) * h * 0.4, y - h * 0.6, bx + Math.sin(lean) * h, y - h);
      g.quadraticCurveTo(bx + Math.sin(lean) * h * 0.4 + s * 0.04, y - h * 0.5, bx + s * 0.05, y);
      g.closePath();
      g.fill();
    }
  }

  const tex = Texture.from(c);
  cache.set(key, tex);
  return tex;
}
