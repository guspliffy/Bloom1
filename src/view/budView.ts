import { Circle, Container, Graphics, Sprite } from 'pixi.js';
import { dirAngle } from '../core/hex';
import { MAX_PETALS, type Bud } from '../core/rules';
import { palette } from './palette';
import { glowTexture } from './textures';

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

/**
 * One bud, drawn with as little ink as possible (GDD §6): one petal per petal, each pointing along one
 * of the bud's arrows, and arrow heads only when the bud is ready (or hovered on desktop).
 */
export class BudView extends Container {
  readonly halo: Sprite;
  /** Arrow heads, drawn white; the garden sets their alpha and tint each frame. */
  readonly arrowsG = new Graphics();
  readonly budC = new Container();
  readonly petalsG = new Graphics();
  readonly flower = new Container();
  private flowerG = new Graphics();
  readonly hintRing = new Graphics();
  petals = 0;
  isOpen = false;
  hovered = false;
  private arrows: number[] = [];
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
    this.arrowsG.alpha = 0;
    this.addChild(this.halo, this.hintRing, this.arrowsG, this.flower, this.budC);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerover', () => (this.hovered = true));
    this.on('pointerout', () => (this.hovered = false));
    this.layout(s);
  }

  layout(s: number): void {
    this.s = s;
    this.hitArea = new Circle(0, 0, s * 0.95);
    this.halo.width = this.halo.height = s * 2.6;
    this.hintRing.clear().circle(0, 0, s * 0.92).stroke({ width: Math.max(1.5, s * 0.05), color: 0xffffff, alpha: 0.8 });
    this.hintRing.alpha = 0;
    this.drawArrows();
    this.drawPetals();
  }

  setBud(bud: Bud): void {
    this.petals = bud.petals;
    this.arrows = [...bud.arrows].sort((a, b) => a - b);
    this.drawArrows();
    this.drawPetals();
  }

  setPetals(n: number): void {
    this.petals = n;
    this.drawPetals();
  }

  get ready(): boolean {
    return !this.isOpen && this.petals >= MAX_PETALS;
  }

  private drawArrows(): void {
    const s = this.s;
    const g = this.arrowsG.clear();
    for (const d of this.arrows) {
      const a = dirAngle(d);
      const c = Math.cos(a);
      const n = Math.sin(a);
      const tip = s * 0.85;
      const base = s * 0.66;
      const notch = s * 0.72;
      const w = s * 0.15;
      g.poly([c * tip, n * tip, c * base - n * w, n * base + c * w, c * notch, n * notch, c * base + n * w, n * base - c * w]).fill({ color: 0xffffff });
    }
  }

  private drawPetals(): void {
    const s = this.s;
    const g = this.petalsG.clear();
    const n = Math.min(this.petals, MAX_PETALS);
    const color = palette.petalByCount[n];
    for (let i = 0; i < n && i < this.arrows.length; i++) {
      drawPetal(g, dirAngle(this.arrows[i]), s * 0.55, s * 0.21, s * 0.08).fill({ color, alpha: n === MAX_PETALS ? 0.95 : 0.9 });
    }
    if (n === 0) g.circle(0, 0, s * 0.1).fill({ color: palette.core, alpha: 0.45 });
    else g.circle(0, 0, s * 0.12).fill({ color: palette.core, alpha: 0.95 });
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
