import { Container, Graphics, Sprite } from 'pixi.js';
import { tuning } from '../tuning';
import { lerpColor, palette } from './palette';
import { glowTexture } from './textures';
import { ease, type Tweener } from './tween';

// Lantern materials (GDD §6 palette); stone and glass are used only here.
const STONE = 0x5e5249;
const DARK_GLASS = 0x1a1424;

/**
 * A garden lantern post (GDD §6): a real object 0.9s tall standing in the gap above its bud, drawn
 * behind the buds: a short stone post, an iron frame, a hexagonal pane with a cross-bar, a cap and a wick dot.
 * Its bud sits in a stone ring. Dark, the pane breathes a cool tint in normal blend (found at a glance
 * without spending light); lit, the glass warms to pollen and one pollen pool settles at `goal.litGlowAlpha`.
 * The container sits on the bud; everything else is offset from it.
 */
export class LanternView extends Container {
  lit = false;
  /** 0 dark, 1 lit: drives the glass, ring and pool colours. */
  private level = 0;
  /** Glow envelope while a fresh light settles (0.6 swell, then the resting alpha). */
  private swell = 0;
  private settled = false;
  private s = 40;
  /** Pulse (0..1) on the pane while the post is being planted. */
  private pulseK = 0;
  private pool = new Sprite(glowTexture());
  private ring = new Graphics();
  /** The post: origin at its base, drawn upward. */
  private post = new Container();
  private stone = new Graphics();
  private frame = new Graphics();
  private glow = new Sprite(glowTexture());
  /** The pane group, centred on the pane so a pulse scales it in place. */
  private paneC = new Container();
  private glass = new Graphics();
  private tintG = new Graphics();
  private wick = new Graphics();
  private paneY = 0;

  constructor(readonly cell: number) {
    super();
    this.pool.anchor.set(0.5);
    this.pool.tint = palette.moonGlow;
    this.pool.alpha = 0.1;
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.tint = palette.pollen;
    this.glow.alpha = 0;
    this.paneC.addChild(this.glass, this.tintG, this.wick);
    this.post.addChild(this.stone, this.frame, this.glow, this.paneC);
    this.addChild(this.pool, this.ring, this.post);
    this.eventMode = 'none';
  }

  /** Place on a bud at (x, y) for cell size s; `rot` is the board rotation. */
  layout(x: number, y: number, s: number, rot: number): void {
    this.s = s;
    this.position.set(x, y);
    // Straight up is a gap on a flat board; on the turned (portrait) board the gap is 30° to the right.
    const a = -Math.PI / 2 + rot;
    // The post is centred 1.0s away and stands upright; its base is 0.45s below that centre.
    this.post.position.set(Math.cos(a) * s, Math.sin(a) * s + 0.45 * s);
    this.paneY = -0.46 * s;
    this.paneC.position.set(0, this.paneY);
    this.glow.position.set(0, this.paneY);

    this.pool.width = this.pool.height = s * 2.6;
    this.ring.clear().circle(0, 0, s * 0.82).stroke({ width: Math.max(1.5, s * 0.08), color: 0xffffff });

    const w = Math.max(1.5, s * 0.06);
    this.stone
      .clear()
      .rect(-0.14 * s, -0.04 * s, 0.28 * s, 0.04 * s)
      .fill({ color: STONE })
      .poly([-0.08 * s, -0.04 * s, 0.08 * s, -0.04 * s, 0.062 * s, -0.12 * s, -0.062 * s, -0.12 * s])
      .fill({ color: STONE });
    const r = s * 0.3;
    // Iron: socket, hexagonal frame around the pane, cap and hook.
    const f = this.frame.clear();
    f.poly([-0.09 * s, -0.12 * s, 0.09 * s, -0.12 * s, 0.07 * s, -0.16 * s, -0.07 * s, -0.16 * s]).fill({ color: palette.lanternIron });
    f.poly(hexPts(r * 1.14, this.paneY)).stroke({ width: w, color: palette.lanternIron, alpha: 0.95 });
    f.poly([-r * 0.62, this.paneY - r * 1.12, r * 0.62, this.paneY - r * 1.12, r * 0.34, this.paneY - r * 1.42, -r * 0.34, this.paneY - r * 1.42]).fill({ color: palette.lanternIron });
    f.circle(0, this.paneY - r * 1.55, r * 0.12).stroke({ width: Math.max(1, s * 0.035), color: palette.lanternIron });

    this.glow.width = this.glow.height = s * 2.2;
    this.drawPane();
  }

  private drawPane(): void {
    const s = this.s;
    const r = s * 0.3;
    const k = this.level;
    const pts = hexPts(r, 0);
    const g = this.glass.clear();
    g.poly(pts).fill({ color: lerpColor(DARK_GLASS, palette.pollen, k), alpha: 0.7 + 0.25 * k });
    g.poly(pts).stroke({ width: Math.max(1.5, s * 0.05), color: lerpColor(palette.ink, palette.lanternIron, k), alpha: 0.45 + 0.45 * k });
    // A cross-bar, so the glass reads as a lantern pane rather than a dot.
    g.moveTo(-r * 0.8, 0).lineTo(r * 0.8, 0).stroke({ width: Math.max(1, s * 0.03), color: palette.lanternIron, alpha: 0.6 });
    // Normal-blend tint that breathes while dark (counts 0 in the light budget); drawn once, alpha set per frame.
    this.tintG.clear().poly(pts).fill({ color: palette.moonGlow });
    this.wick
      .clear()
      .circle(0, r * 0.32, Math.max(1.5, s * 0.05))
      .fill({ color: lerpColor(palette.ink, palette.hint, k), alpha: 0.35 + 0.65 * k });
  }

  /** Lit at once, with no animation (a garden restored mid-run). */
  lightNow(): void {
    this.lit = true;
    this.settled = true;
    this.level = 1;
    this.drawPane();
  }

  /** Hide the post until `plant` (the first-run beat plants posts one by one). */
  hide(): void {
    this.visible = false;
  }

  /** Plant the post: it rises from its base with a back-ease, its ring fades in, then the pane pulses once. */
  async plant(tw: Tweener): Promise<void> {
    this.visible = true;
    this.alpha = 0;
    this.post.scale.set(1, 0);
    await tw.to(300, (t) => {
      if (this.destroyed) return;
      this.alpha = Math.min(1, t * 2);
      this.post.scale.set(1, Math.max(0.001, t));
    }, { ease: ease.outBack });
    this.post.scale.set(1);
    await this.pulse(tw);
  }

  /** One pane pulse: it swells and the cool tint flashes, then settles. */
  async pulse(tw: Tweener): Promise<void> {
    await tw.to(360, (t) => {
      if (this.destroyed) return;
      this.pulseK = Math.sin(Math.PI * t);
      this.paneC.scale.set(1 + 0.3 * this.pulseK);
    }, { ease: ease.linear });
    this.pulseK = 0;
    this.paneC.scale.set(1);
  }

  /** Light the lantern: the glass warms over 400 ms and the pool swells to 0.6, then settles. */
  async light(tw: Tweener): Promise<void> {
    if (this.lit) return;
    this.lit = true;
    void tw.to(1000, (t) => {
      if (this.destroyed) return;
      // 0..0.4 swell to 0.6, then ease to the resting alpha.
      this.swell = t < 0.4 ? 0.6 * ease.outCubic(t / 0.4) : 0.6 + (tuning.goal.litGlowAlpha - 0.6) * ease.inOutSine((t - 0.4) / 0.6);
      if (t >= 1) this.settled = true;
    }, { ease: ease.linear });
    await tw.to(400, (t) => {
      if (this.destroyed) return;
      this.level = t;
      this.drawPane();
    }, { ease: ease.outCubic });
  }

  /** The pane's screen position, for fireflies and flying drops. */
  paneGlobal(): { x: number; y: number } {
    return this.paneC.getGlobalPosition();
  }

  /**
   * Called every frame. `flare` (0..1) is the garden-lit moment: pool alpha +0.5, scale ×1.6, easing back.
   * `ready` (0..1) is the bud's ready halo, which the ring joins.
   */
  tick(t: number, flare: number, ready: number): void {
    const k = this.level;
    this.pool.alpha = 0.1 * (1 - k);
    this.ring.tint = lerpColor(STONE, palette.pollen, k);
    this.ring.alpha = 0.55 + (0.48 - 0.55) * k + 0.25 * ready * (1 - k);
    // Dark: the pane breathes a cool tint, alpha 0.12–0.22 at 0.3 Hz.
    this.tintG.alpha = (0.17 + 0.05 * Math.sin(t * Math.PI * 2 * 0.3 + this.cell)) * (1 - k) + 0.35 * this.pulseK;
    this.tintG.visible = this.tintG.alpha > 0.005;
    if (!this.lit) {
      this.glow.visible = false;
      return;
    }
    const rest = tuning.goal.litGlowAlpha + 0.06 * Math.sin(t * Math.PI * 2 * 0.4 + this.cell);
    const base = this.settled ? rest : this.swell;
    this.glow.visible = true;
    this.glow.alpha = Math.min(1, base + 0.5 * flare);
    this.glow.width = this.glow.height = this.s * 2.2 * (1 + 0.6 * flare);
  }
}

/** Pointy-top hexagon of vertical radius r centred at (0, cy), a little narrower than tall like a lantern pane. */
function hexPts(r: number, cy: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push(Math.cos(t) * r * 0.8, cy + Math.sin(t) * r);
  }
  return pts;
}
