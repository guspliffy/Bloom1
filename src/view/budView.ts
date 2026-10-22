import { Circle, Container, Graphics, Sprite } from 'pixi.js';
import { dirAngle } from '../core/hex';
import { MAX_PETALS, type Bud } from '../core/rules';
import { tuning } from '../tuning';
import { jitterColor, lerpColor, palette } from './palette';
import { coreTexture, dropTexture, glowTexture, PETAL_ASPECT, PETAL_TEX_LEN, petalTexture, shadowTexture } from './textures';

const PETAL_HALF = (PETAL_TEX_LEN - 2) * PETAL_ASPECT;

export function petalSprite(): Sprite {
  const p = new Sprite(petalTexture());
  p.anchor.set(0, 0.5);
  return p;
}

/** Size a petal sprite: base `inner` from the centre, `len` long, `halfW` half-width, pointing at `angle`. */
export function shapePetal(p: Sprite, len: number, halfW: number, inner: number, angle: number): void {
  p.scale.set(len / (PETAL_TEX_LEN - 2), halfW / PETAL_HALF);
  p.rotation = angle;
  p.position.set(Math.cos(angle) * inner, Math.sin(angle) * inner);
}

function hash(i: number, salt: number): number {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * One bud (GDD §6): a contact shadow, lit petal sprites pointing along its arrows, a cream core,
 * and when ready a warm halo and chevrons. Open, it becomes a flower of 16 petals around a pistil.
 */
export class BudView extends Container {
  readonly shadow = new Sprite(shadowTexture());
  readonly halo = new Sprite(glowTexture());
  readonly hintRing = new Graphics();
  readonly hintDrop = new Sprite(dropTexture());
  /** Chevrons, drawn white; the garden sets their alpha and tint each frame. */
  readonly arrowsG = new Graphics();
  readonly budC = new Container();
  private petalSprites: Sprite[] = [];
  /** The petal a tap would add, shown faintly while this bud is previewed. */
  readonly ghost = petalSprite();
  private core = new Sprite(coreTexture());
  readonly flower = new Container();
  readonly flowerPetals: Sprite[] = [];
  private pistil = new Graphics();
  private flowerCore = new Sprite(coreTexture());
  /** Additive light of the open flower; lives in the garden's light layer. */
  bloomHalo: Sprite | null = null;
  petals = 0;
  isOpen = false;
  /** Name of a scale animation in progress on budC ('' when idle breathing owns it). */
  anim = '';
  hovered = false;
  /** Base angle of each visible petal (for the idle lean). */
  petalAngles: number[] = [];
  arrows: number[] = [];
  s: number;
  rot = 0;
  readonly phase: number;
  readonly period: number;
  readonly jitterRot: number;
  readonly jitterScale: number;
  private hue1: number;
  private hue2: number;

  constructor(s: number, readonly cell: number) {
    super();
    this.s = s;
    this.phase = hash(cell, 1) * Math.PI * 2;
    this.period = 3 + hash(cell, 2) * 1.5;
    this.jitterRot = ((hash(cell, 3) - 0.5) * 2 * tuning.feel.jitterDeg * Math.PI) / 180;
    this.jitterScale = 1 + (hash(cell, 4) - 0.5) * 2 * tuning.feel.jitterScale;
    this.hue1 = hash(cell, 5);
    this.hue2 = hash(cell, 6);

    this.shadow.anchor.set(0.5);
    this.halo.anchor.set(0.5);
    this.halo.blendMode = 'add';
    this.halo.alpha = 0;
    this.halo.tint = palette.ready;
    this.hintRing.blendMode = 'add';
    this.hintRing.alpha = 0;
    this.hintDrop.anchor.set(0.5, 1);
    this.hintDrop.tint = palette.hint;
    this.hintDrop.alpha = 0;
    this.core.anchor.set(0.5);
    this.flowerCore.anchor.set(0.5);
    for (let i = 0; i < MAX_PETALS; i++) {
      const p = petalSprite();
      this.petalSprites.push(p);
      this.budC.addChild(p);
    }
    this.ghost.visible = false;
    this.budC.addChild(this.ghost, this.core);
    for (let i = 0; i < 16; i++) {
      const p = petalSprite();
      this.flowerPetals.push(p);
      this.flower.addChild(p);
    }
    this.flower.addChild(this.pistil, this.flowerCore);
    this.flower.visible = false;
    this.arrowsG.alpha = 0;
    this.addChild(this.shadow, this.halo, this.hintRing, this.arrowsG, this.flower, this.budC, this.hintDrop);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerover', () => (this.hovered = true));
    this.on('pointerout', () => (this.hovered = false));
    this.layout(s, 0);
  }

  layout(s: number, rot: number): void {
    this.s = s;
    this.rot = rot;
    this.hitArea = new Circle(0, 0, s * 0.95);
    this.halo.width = this.halo.height = s * 2.6;
    this.hintRing.clear().circle(0, 0, s * 0.85).stroke({ width: 2, color: palette.hint });
    this.hintDrop.width = s * 0.32;
    this.hintDrop.height = s * 0.42;
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

  angleOf(dir: number): number {
    return dirAngle(dir) + this.rot;
  }

  private drawArrows(): void {
    const s = this.s;
    const g = this.arrowsG.clear();
    for (const d of this.arrows) {
      const a = this.angleOf(d);
      const c = Math.cos(a);
      const n = Math.sin(a);
      const tip = s * 0.82;
      const base = s * 0.66;
      const notch = s * 0.72;
      const w = s * 0.13;
      g.poly([c * tip, n * tip, c * base - n * w, n * base + c * w, c * notch, n * notch, c * base + n * w, n * base - c * w]).fill({ color: 0xffffff });
    }
  }

  private drawPetals(): void {
    const s = this.s;
    const n = Math.min(this.petals, MAX_PETALS);
    const base = n >= MAX_PETALS ? palette.petalReady : palette.petalIdle;
    const tint = jitterColor(base, this.hue1, this.hue2, tuning.feel.jitterHueDeg / 120);
    this.petalAngles = [];
    this.petalSprites.forEach((p, i) => {
      p.visible = i < n && i < this.arrows.length;
      if (!p.visible) return;
      const a = this.angleOf(this.arrows[i]);
      this.petalAngles.push(a);
      shapePetal(p, s * 0.55, s * 0.21, s * 0.08, a);
      p.tint = tint;
    });
    const seed = n === 0;
    this.core.width = this.core.height = s * (seed ? 0.18 : 0.26);
    this.core.tint = seed ? palette.seed : 0xffffff;
    this.core.alpha = seed ? 0.55 : 1;
    this.shadow.width = s * 0.9 * (seed ? 0.5 : 1);
    this.shadow.height = s * 0.45 * (seed ? 0.5 : 1);
    this.shadow.position.set(0, s * 0.16);
    this.shadow.alpha = 0.3;
  }

  /** Show where a tap would add its petal (preview); false hides it. */
  setGhost(show: boolean): void {
    const n = this.petals;
    this.ghost.visible = show && !this.isOpen && n < MAX_PETALS && n < this.arrows.length;
    if (!this.ghost.visible) return;
    shapePetal(this.ghost, this.s * 0.55, this.s * 0.21, this.s * 0.08, this.angleOf(this.arrows[n]));
    this.ghost.tint = n + 1 >= MAX_PETALS ? palette.petalReady : palette.petalIdle;
  }

  /** Idle life, called every frame: petals lean on their own phase. */
  lean(t: number): void {
    const amp = (tuning.feel.idleLeanDeg * Math.PI) / 180;
    let j = 0;
    for (const p of this.petalSprites) {
      if (!p.visible) continue;
      const a = this.petalAngles[j] + Math.sin(t * Math.PI * 0.6 + this.phase + j * 2.1) * amp;
      const inner = this.s * 0.08;
      p.rotation = a;
      p.position.set(Math.cos(a) * inner, Math.sin(a) * inner);
      j++;
    }
  }

  /** Prepare the open flower in the chain hue (petals start folded; `unfold` animates them). */
  setFlower(color: number): void {
    const s = this.s;
    const inner = lerpColor(color, 0xfff4e0, 0.55);
    this.flowerPetals.forEach((p, i) => {
      p.tint = i < 8 ? color : inner;
    });
    this.flowerCore.width = this.flowerCore.height = s * 0.3;
    const g = this.pistil.clear();
    for (let k = 0; k < 5; k++) {
      const a = (k * Math.PI * 2) / 5 - Math.PI / 2;
      g.circle(Math.cos(a) * s * 0.12, Math.sin(a) * s * 0.12, s * 0.04).fill({ color: palette.pollen });
    }
    this.unfold(0);
  }

  /** Flower petals unfold from -25° to rest, each `petalUnfoldStaggerMs` after the last. `ms` is time since opening. */
  unfold(ms: number): void {
    const s = this.s;
    const f = tuning.feel;
    const span = Math.max(1, f.bloomOpenMs - 15 * f.petalUnfoldStaggerMs);
    this.flowerPetals.forEach((p, i) => {
      const t = Math.max(0, Math.min(1, (ms - i * f.petalUnfoldStaggerMs) / span));
      const e = 1 - (1 - t) ** 3;
      const outer = i < 8;
      const k = i % 8;
      const rest = (k * Math.PI) / 4 + (outer ? Math.PI / 8 : 0) + this.rot;
      const a = rest - (25 * Math.PI * (1 - e)) / 180;
      if (outer) shapePetal(p, s * 0.82 * (0.6 + 0.4 * e), s * 0.26, s * 0.08, a);
      else shapePetal(p, s * 0.5 * (0.6 + 0.4 * e), s * 0.16, s * 0.06, a);
      p.alpha = Math.min(1, t * 3) * (outer ? 0.95 : 0.8);
    });
  }
}
