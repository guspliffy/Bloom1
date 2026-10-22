import { Container, Graphics, Sprite } from 'pixi.js';
import { palette } from './palette';
import { glowTexture } from './textures';
import { ease, type Tweener } from './tween';

/**
 * A garden lantern on a thin stem beside its bud (GDD §6). It stands in the gap between the two
 * neighbours above the bud, so petals and arrows rarely cover it. Dark until its bud blooms, then lit.
 */
export class LanternView extends Container {
  lit = false;
  private stem = new Graphics();
  private glass = new Graphics();
  /** A ring on the soil around the lantern's bud, so it is clear which bud lights it. */
  private ring = new Graphics();
  private toBud = { x: 0, y: 0 };
  private glow = new Sprite(glowTexture());
  private level = 0;

  constructor(readonly cell: number) {
    super();
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.tint = palette.pollen;
    this.glow.alpha = 0;
    this.addChild(this.ring, this.glow, this.stem, this.glass);
    this.eventMode = 'none';
  }

  /** Place beside a bud at (x, y) for cell size s; `rot` is the board rotation. */
  layout(x: number, y: number, s: number, rot: number): void {
    // Straight up is a gap on a flat board; on the turned (portrait) board the gap is 30° to the right.
    const a = -Math.PI / 2 + rot;
    const d = s * 0.95;
    this.position.set(x + Math.cos(a) * d, y + Math.sin(a) * d);
    this.toBud = { x: -Math.cos(a) * d, y: -Math.sin(a) * d };
    const base = { x: -Math.cos(a) * s * 0.55, y: -Math.sin(a) * s * 0.55 };
    this.stem.clear().moveTo(base.x, base.y).lineTo(0, s * 0.2).stroke({ width: Math.max(2, s * 0.07), color: palette.lanternIron, alpha: 0.95 });
    this.glow.width = this.glow.height = s * 2.2;
    this.draw(s);
  }

  private s = 40;

  private draw(s = this.s): void {
    this.s = s;
    const r = s * 0.3;
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t = Math.PI / 6 + (i * Math.PI) / 3;
      pts.push(Math.cos(t) * r * 0.8, Math.sin(t) * r);
    }
    const k = this.level;
    const g = this.glass.clear();
    g.poly(pts).fill({ color: k > 0.5 ? palette.pollen : palette.moonGlow, alpha: 0.45 + 0.5 * k });
    g.poly(pts).stroke({ width: Math.max(1.5, s * 0.05), color: k > 0.5 ? palette.lanternIron : palette.ink, alpha: 0.9 });
    // A cross-bar, so the glass reads as a lantern pane rather than a dot.
    g.moveTo(-r * 0.8, 0).lineTo(r * 0.8, 0).stroke({ width: Math.max(1, s * 0.03), color: palette.lanternIron, alpha: 0.6 });
    this.ring
      .clear()
      .circle(this.toBud.x, this.toBud.y, s * 0.82)
      .stroke({ width: Math.max(1.5, s * 0.05), color: k > 0.5 ? palette.pollen : palette.moonGlow, alpha: 0.28 + 0.2 * k });
    // Cap and hook.
    g.rect(-r * 0.5, -r * 1.18, r, r * 0.22).fill({ color: palette.lanternIron });
  }

  /** Lit at once, with no animation (a garden restored mid-run). */
  lightNow(): void {
    this.lit = true;
    this.level = 1;
    this.draw();
  }

  /** Light the lantern: the glass warms over 400 ms and a soft glow swells and settles. */
  async light(tw: Tweener): Promise<void> {
    if (this.lit) return;
    this.lit = true;
    await tw.to(400, (t) => {
      if (this.destroyed) return;
      this.level = t;
      this.draw();
      this.glow.alpha = 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.4)) + 0.35 * t;
    }, { ease: ease.outCubic });
  }

  /** Called every frame: a lit lantern breathes; `flare` (0..1) brightens it for the garden-lit moment. */
  tick(t: number, flare: number): void {
    if (!this.lit) return;
    this.glow.alpha = 0.32 + 0.06 * Math.sin(t * 2.4 + this.cell) + 0.5 * flare;
    this.glow.scale.set((this.s * 2.2 * (1 + 0.6 * flare)) / 128);
  }
}
