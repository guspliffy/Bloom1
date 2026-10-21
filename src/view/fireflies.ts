import { Container, Sprite } from 'pixi.js';
import { palette } from './palette';
import { glowTexture } from './textures';

interface Fly {
  s: Sprite;
  x: number;
  y: number;
  phase: number;
  speed: number;
}

/** A few slow drifting lights behind the garden for atmosphere. */
export class Fireflies extends Container {
  private flies: Fly[] = [];
  private t = 0;
  private w = 1;
  private h = 1;

  constructor(count = 22) {
    super();
    for (let i = 0; i < count; i++) {
      const s = new Sprite(glowTexture());
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = palette.firefly;
      s.width = s.height = 10 + Math.random() * 16;
      this.addChild(s);
      this.flies.push({ s, x: Math.random(), y: Math.random(), phase: Math.random() * 10, speed: 0.4 + Math.random() * 0.6 });
    }
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
  }

  tick(dtMs: number): void {
    this.t += dtMs / 1000;
    for (const f of this.flies) {
      const k = this.t * 0.05 * f.speed + f.phase;
      f.s.x = (f.x + 0.06 * Math.sin(k * 1.3)) * this.w;
      f.s.y = (f.y + 0.05 * Math.cos(k * 1.7) - ((this.t * 0.004 * f.speed) % 1.2)) * this.h;
      if (f.s.y < -20) f.s.y += this.h * 1.2;
      f.s.alpha = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(this.t * f.speed * 1.4 + f.phase));
    }
  }
}
