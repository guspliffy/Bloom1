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
 * The planter under the board (GDD §6), baked once per board size and rotation: drop shadow, a warm
 * earthy rim and side, speckled soil with moss, a moonlight pool and one dimple per cell, moonlight on
 * the rim's upper edges and grass tufts behind and in front. Returns a texture centred on the board centre, at `res`× scale.
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

  const band = s * 0.36;
  const inner = rb - band;

  // Tufts behind the far edge, drawn first so the planter hides their roots.
  const tuft = (x: number, y: number, h0: number, blades: number) => {
    for (let b = 0; b < blades; b++) {
      const h = h0 * (0.75 + rnd() * 0.45);
      const lean = (b - (blades - 1) / 2) * 0.35 + (rnd() - 0.5) * 0.2;
      const bx = x + (b - (blades - 1) / 2) * s * 0.08;
      g.beginPath();
      g.moveTo(bx - s * 0.05, y);
      g.quadraticCurveTo(bx + Math.sin(lean) * h * 0.4, y - h * 0.6, bx + Math.sin(lean) * h, y - h);
      g.quadraticCurveTo(bx + Math.sin(lean) * h * 0.4 + s * 0.04, y - h * 0.5, bx + s * 0.05, y);
      g.closePath();
      g.fill();
    }
  };
  const edge: [number, number][] = [];
  for (let i = 0; i < 400; i++) {
    const a = (i / 400) * Math.PI * 2;
    const k = Math.cos(Math.PI / 6) / Math.cos(((((a - rot) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6);
    edge.push([Math.cos(a) * rb * k * 0.97, Math.sin(a) * rb * k * 0.97]);
  }
  const back = edge.filter(([, y]) => y < -rb * 0.6);
  g.fillStyle = hex(palette.leafFore, 0.5);
  for (let t = 0; t < 4 && back.length; t++) {
    const [x, y] = back[Math.floor(((t + 0.3 + rnd() * 0.4) / 4) * back.length)];
    tuft(x, y + s * 0.1, s * 0.75, 3);
  }

  // Drop shadow and the planter's side face.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = s * 0.9 * res;
  g.shadowOffsetY = s * 0.18 * res;
  hexPath(g, 0, s * 0.45, rb * 1.01, cr, rot);
  const side = g.createLinearGradient(0, -rb, 0, rb + s * 0.45);
  side.addColorStop(0, '#2a1f1a');
  side.addColorStop(1, '#17110e');
  g.fillStyle = side;
  g.fill();
  g.restore();

  // Planter rim: a warm earthy band around the soil.
  hexPath(g, 0, 0, rb, cr, rot);
  const rimFill = g.createLinearGradient(0, -rb, 0, rb);
  rimFill.addColorStop(0, '#4a3a30');
  rimFill.addColorStop(1, '#2e2420');
  g.fillStyle = rimFill;
  g.fill();

  // Soil.
  hexPath(g, 0, 0, inner, cr * 0.8, rot);
  const top = g.createLinearGradient(0, -inner, 0, inner);
  top.addColorStop(0, '#243530');
  top.addColorStop(1, '#182420');
  g.fillStyle = top;
  g.fill();

  g.save();
  g.clip();
  for (let i = 0; i < 8; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * inner * 0.75;
    const r = s * (1.6 + rnd() * 1.4);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    const mg = g.createRadialGradient(x, y, 0, x, y, r);
    mg.addColorStop(0, hex(0x2e4a3c, 0.42));
    mg.addColorStop(1, hex(0x2e4a3c, 0));
    g.fillStyle = mg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Speckled earth, light and dark grains.
  const grains = Math.round(900 * (inner / (7 * s)) ** 2);
  for (let i = 0; i < grains; i++) {
    g.fillStyle = i % 2 ? 'rgba(205,225,205,0.07)' : 'rgba(0,0,0,0.14)';
    g.fillRect((rnd() * 2 - 1) * inner, (rnd() * 2 - 1) * inner, 1.2, 1.2);
  }
  for (const p of cells) {
    const r = s * 0.75;
    const dg = g.createRadialGradient(p.x, p.y + s * 0.05, 0, p.x, p.y + s * 0.05, r);
    dg.addColorStop(0, 'rgba(0,0,0,0.3)');
    dg.addColorStop(0.6, 'rgba(0,0,0,0.12)');
    dg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = dg;
    g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  }
  // A pool of moonlight toward the top-left.
  const pool = g.createRadialGradient(-rb * 0.2, -rb * 0.3, 0, -rb * 0.2, -rb * 0.3, rb * 1.1);
  pool.addColorStop(0, 'rgba(190,210,230,0.12)');
  pool.addColorStop(1, 'rgba(190,210,230,0)');
  g.fillStyle = pool;
  g.fillRect(-rb, -rb, rb * 2, rb * 2);
  // The rim casts a soft shadow onto the soil.
  for (let i = 0; i < 6; i++) {
    hexPath(g, 0, 0, inner - i * s * 0.03, cr * 0.8, rot);
    g.lineWidth = s * 0.04;
    g.strokeStyle = `rgba(0,0,0,${(0.35 * (1 - i / 6) ** 2).toFixed(3)})`;
    g.stroke();
  }
  g.restore();

  // Moonlight catches the rim's upper edges, fading toward the front.
  hexPath(g, 0, 0, rb - 1, cr, rot);
  const rim = g.createLinearGradient(0, -rb, 0, rb * 0.35);
  rim.addColorStop(0, hex(0xa08868, 0.55));
  rim.addColorStop(1, hex(0xa08868, 0));
  g.strokeStyle = rim;
  g.lineWidth = 2;
  g.stroke();

  // Grass tufts standing on the front edge.
  const front = edge.filter(([, y]) => y + s * 0.2 > rb * 0.55).map(([x, y]): [number, number] => [x, y + s * 0.2]);
  g.fillStyle = hex(palette.leafFore, 0.8);
  for (let t = 0; t < 9 && front.length; t++) {
    const [x, y] = front[Math.floor(((t + 0.3 + rnd() * 0.4) / 9) * front.length)];
    tuft(x, y, s * 0.75, 3);
  }

  const tex = Texture.from(c);
  cache.set(key, tex);
  return tex;
}
