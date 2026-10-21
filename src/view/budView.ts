import { Circle, Container, Graphics, Sprite } from 'pixi.js';
import { dirAngle } from '../core/hex';
import { MAX_PETALS, type Bud } from '../core/rules';
import { palette } from './palette';
import { glowTexture } from './textures';

/** Petal slots sit between neighbor directions so they never hide the arrows. Filled clockwise from top left. */
const SLOT_ANGLES = [(-5 * Math.PI) / 6, -Math.PI / 6, Math.PI / 6, (5 * Math.PI) / 6];

/** Teardrop petal from the origin toward angle `a`. */
export function drawPetal(g: Graphics, a: number, len: number, wid: number, inner = 0): Graphics {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const p = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c];
  const [x0, y0] = p(inner, 0);
  const [c1x, c1y] = p(inner + len * 0.35, -wid);
  const [c2x, c2y] = p(inner + len * 0.95, -wid * 0.55);
  const [tx, ty] = p(inner + len, 0);
  const [c3x, c3y] = p(inner + len * 0.95, wid * 0.55);
  const [c4x, c4y] = p(inner + len * 0.35, wid);
  return g.moveTo(x0, y0).bezierCurveTo(c1x, c1y, c2x, c2y, tx, ty).bezierCurveTo(c3x, c3y, c4x, c4y, x0, y0).closePath();
}

export class BudView extends Container {
  readonly halo: Sprite;
  private tile = new Graphics();
  readonly arrowsG = new Graphics();
  readonly budC = new Container();
  private petalsG = new Graphics();
  readonly flower = new Container();
  private flowerG = new Graphics();
  readonly hintRing = new Graphics();
  petals = 0;
  isOpen = false;
  private s: number;

  constructor(s: number) {
    super();
    this.s = s;
    this.halo = new Sprite(glowTexture());
    this.halo.anchor.set(0.5);
    this.halo.blendMode = 'add';
    this.halo.alpha = 0;
    this.halo.tint = palette.ready;
    this.flower.addChild(this.flowerG);
    this.flower.visible = false;
    this.budC.addChild(this.petalsG);
    this.addChild(this.tile, this.halo, this.hintRing, this.arrowsG, this.flower, this.budC);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.layout(s);
  }

  layout(s: number): void {
    this.s = s;
    this.hitArea = new Circle(0, 0, s * 0.95);
    const hex: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      hex.push(Math.cos(a) * s * 0.94, Math.sin(a) * s * 0.94);
    }
    this.tile.clear().poly(hex).fill({ color: palette.tileFill, alpha: 0.035 }).stroke({ width: 1, color: palette.tileFill, alpha: 0.07 });
    this.halo.width = this.halo.height = s * 2.6;
    this.hintRing.clear().circle(0, 0, s * 0.78).stroke({ width: Math.max(1.5, s * 0.05), color: 0xffffff, alpha: 0.8 });
    this.hintRing.alpha = 0;
    this.drawPetals();
  }

  setBud(bud: Bud): void {
    this.petals = bud.petals;
    this.drawArrows(bud.arrows);
    this.drawPetals();
  }

  setPetals(n: number): void {
    this.petals = n;
    this.drawPetals();
  }

  /** Each arrow is a faint spoke from the core plus a chevron head, so it reads as belonging to this bud. */
  private drawArrows(arrows: readonly number[]): void {
    const s = this.s;
    const g = this.arrowsG.clear();
    for (const d of arrows) {
      const a = dirAngle(d);
      const c = Math.cos(a);
      const n = Math.sin(a);
      g.moveTo(c * s * 0.16, n * s * 0.16)
        .lineTo(c * s * 0.56, n * s * 0.56)
        .stroke({ width: Math.max(1, s * 0.045), color: palette.arrow, alpha: 0.3, cap: 'round' });
      const tip = s * 0.74;
      const base = s * 0.52;
      const w = s * 0.14;
      const notch = base + s * 0.08;
      g.poly([c * tip, n * tip, c * base - n * w, n * base + c * w, c * notch, n * notch, c * base + n * w, n * base - c * w]).fill({
        color: palette.arrow,
        alpha: 0.75,
      });
    }
  }

  private drawPetals(): void {
    const s = this.s;
    const g = this.petalsG.clear();
    const n = Math.min(this.petals, MAX_PETALS);
    const color = palette.petalByCount[n];
    SLOT_ANGLES.forEach((a, i) => {
      if (i < n) drawPetal(g, a, s * 0.5, s * 0.2, s * 0.05).fill({ color, alpha: 0.95 });
      else drawPetal(g, a, s * 0.44, s * 0.16, s * 0.07).fill({ color: 0xffffff, alpha: 0.05 }).stroke({ width: 1, color: 0xffffff, alpha: 0.16 });
    });
    g.circle(0, 0, s * (n === MAX_PETALS ? 0.15 : 0.12)).fill({ color: palette.core, alpha: n === 0 ? 0.35 : 0.95 });
  }

  /** Large open flower shown while a bloomed cell waits to sprout. */
  drawFlower(color: number): void {
    const s = this.s;
    const g = this.flowerG.clear();
    for (let k = 0; k < 8; k++) drawPetal(g, (k * Math.PI) / 4 + Math.PI / 8, s * 0.82, s * 0.26, s * 0.08).fill({ color, alpha: 0.9 });
    for (let k = 0; k < 8; k++) drawPetal(g, (k * Math.PI) / 4, s * 0.5, s * 0.16, s * 0.06).fill({ color: 0xffffff, alpha: 0.35 });
    g.circle(0, 0, s * 0.17).fill({ color: palette.core });
  }
}
