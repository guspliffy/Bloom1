import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { tuning } from '../tuning';
import { lerpColor, palette } from './palette';
import { glowTexture, gradientTexture, grainTexture, hedgeTexture, leafTexture, vignetteTexture } from './textures';

interface Fly {
  s: Sprite;
  x: number;
  y: number;
  phase: number;
  speed: number;
  pull: { x: number; y: number; until: number; k: number } | null;
}

interface Star {
  s: Sprite;
  period: number;
  phase: number;
}

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The blue-hour scene around the garden bed (GDD §6 layers): sky that darkens as the run goes on,
 * stars, moon, hedges, ground, foreground leaves, fireflies, vignette and grain. `back` sits behind
 * the board and `front` in front of it.
 */
export class Scene {
  readonly back = new Container();
  readonly front = new Container();
  /** Night factor: 0 at dusk, 1 at night, up to 1.15 when the garden rests. */
  night = 0;
  private nightTarget = 0;
  private nightFrom = 0;
  private nightT = 1;
  private nightMs = 1800;
  private skyDusk = new Sprite(gradientTexture('skyDusk', palette.sky.dusk));
  private skyNight = new Sprite(gradientTexture('skyNight', palette.sky.night));
  private groundDusk = new Sprite(gradientTexture('ground', palette.ground));
  private groundNight = new Sprite(gradientTexture('groundNight', palette.groundNight));
  private starLayer = new Container();
  private stars: Star[] = [];
  private moon = new Sprite(glowTexture());
  private moonDisc = new Graphics();
  private horizonGlow = new Sprite(glowTexture());
  private hedgeFar = new Sprite();
  private hedgeNear = new Sprite();
  private leaves: Sprite[] = [];
  private leafBase: { x: number; y: number; rot: number }[] = [];
  private flyLayer = new Container();
  private flies: Fly[] = [];
  private vignette = new Sprite(vignetteTexture());
  private grain = new TilingSprite({ texture: grainTexture(), width: 1, height: 1 });
  private t = 0;
  private frame = 0;
  private w = 1;
  private h = 1;
  private horizon = 0;
  private parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  /** Gathering point for fireflies when the garden rests (screen coords), or null. */
  gather: { x: number; y: number; r: number } | null = null;
  fireflyBoost = 1;
  /** Garden-lit sky lift: the night factor drops by `amount` in `up` ms, then eases back over `down` ms. */
  private lift: { amount: number; up: number; down: number; t: number } | null = null;
  private liftNow = 0;

  constructor() {
    this.horizonGlow.anchor.set(0.5);
    this.horizonGlow.tint = palette.moonGlow;
    this.moon.anchor.set(0.5);
    this.moon.tint = palette.moonGlow;
    this.moon.blendMode = 'add';
    this.horizonGlow.blendMode = 'add';
    this.hedgeFar.anchor.set(0.5, 1);
    this.hedgeNear.anchor.set(0.5, 1);
    this.back.addChild(this.skyDusk, this.skyNight, this.starLayer, this.moon, this.moonDisc, this.horizonGlow, this.hedgeFar, this.groundDusk, this.groundNight, this.hedgeNear);

    for (let i = 0; i < tuning.scene.stars; i++) {
      const s = new Sprite(glowTexture());
      s.anchor.set(0.5);
      s.tint = palette.star;
      s.blendMode = 'add';
      s.width = s.height = 3 + Math.random() * 4;
      this.starLayer.addChild(s);
      this.stars.push({ s, period: 2 + Math.random() * 3, phase: Math.random() * 10 });
    }

    for (let i = 0; i < 4; i++) {
      const leaf = new Sprite(leafTexture());
      leaf.anchor.set(0, 0.5);
      leaf.tint = palette.leafFore;
      leaf.alpha = 0.95;
      this.leaves.push(leaf);
      this.front.addChild(leaf);
    }
    this.front.addChild(this.flyLayer);
    for (let i = 0; i < tuning.scene.fireflies; i++) {
      const s = new Sprite(glowTexture());
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = palette.firefly;
      s.width = s.height = 10 + Math.random() * 6;
      this.flyLayer.addChild(s);
      this.flies.push({ s, x: Math.random(), y: Math.random(), phase: Math.random() * 10, speed: 0.6 + Math.random() * 0.6, pull: null });
    }
    this.vignette.anchor.set(0.5);
    this.front.addChild(this.vignette, this.grain);

    if (typeof window !== 'undefined' && matchMedia('(pointer: fine)').matches && !REDUCED_MOTION) {
      window.addEventListener('pointermove', (e) => {
        this.parallax.tx = (e.clientX / this.w) * 2 - 1;
        this.parallax.ty = (e.clientY / this.h) * 2 - 1;
      });
    }
  }

  /** Lay the scene out around the garden bed. `s` is the board's hex radius, for proportions. */
  resize(w: number, h: number, s: number): void {
    this.w = w;
    this.h = h;
    const portrait = h > w;
    this.horizon = h * (portrait ? tuning.scene.horizonY : tuning.scene.horizonYLandscape);
    const hz = this.horizon;
    for (const sky of [this.skyDusk, this.skyNight]) {
      sky.position.set(-30, -30);
      sky.width = w + 60;
      sky.height = hz + 30;
    }
    for (const g of [this.groundDusk, this.groundNight]) {
      g.position.set(-30, hz - 2);
      g.width = w + 60;
      g.height = h - hz + 32;
    }
    for (const st of this.stars) st.s.position.set(Math.random() * w, Math.random() * hz * 0.85);
    const unit = Math.max(16, Math.min(s, 48));
    this.moonDisc.position.set(w * 0.74, h * 0.14);
    this.moonDisc.clear().circle(0, 0, unit * 0.66).fill({ color: palette.moon });
    this.moon.position.copyFrom(this.moonDisc.position);
    this.moon.width = this.moon.height = unit * 6;
    this.horizonGlow.position.set(w / 2, hz);
    this.horizonGlow.width = w * 1.4;
    this.horizonGlow.height = unit * 8;

    const farH = Math.round(unit * 3.4);
    this.hedgeFar.texture = hedgeTexture('far', w + 80, farH, [unit * 0.9, unit * 2.4], unit * 1.2, 7);
    this.hedgeFar.position.set(w / 2, hz + unit * 0.3);
    const nearH = Math.round(unit * 3.6);
    this.hedgeNear.texture = hedgeTexture('near', w + 80, nearH, [unit * 1.2, unit * 3], unit * 1.4, 19);
    this.hedgeNear.position.set(w / 2, hz + unit * 1.2);

    const leafCount = portrait ? 3 : 4;
    const leafLen = unit * (portrait ? 4.2 : 5);
    const spots = [
      { x: -unit * 0.4, y: h + unit * 0.2, rot: -0.75 },
      { x: -unit * 0.8, y: h - unit * 1.6, rot: -0.35 },
      { x: w + unit * 0.4, y: h + unit * 0.3, rot: Math.PI + 0.7 },
      { x: w + unit * 0.6, y: h - unit * 2.2, rot: Math.PI + 0.35 },
    ];
    this.leafBase = [];
    this.leaves.forEach((leaf, i) => {
      leaf.visible = i < leafCount;
      const sp = spots[i];
      leaf.width = leafLen * (0.8 + 0.2 * (i % 2));
      leaf.height = leaf.width * 0.38;
      leaf.position.set(sp.x, sp.y);
      leaf.rotation = sp.rot;
      this.leafBase.push(sp);
    });

    this.vignette.position.set(w / 2, h / 2);
    this.vignette.width = w * 1.1;
    this.vignette.height = h * 1.1;
    this.grain.width = w;
    this.grain.height = h;
  }

  /** Ease toward a night factor (0 dusk, 1 night). */
  setNight(target: number, ms = tuning.scene.nightLerpMs): void {
    if (Math.abs(target - this.nightTarget) < 1e-3) return;
    this.nightFrom = this.night;
    this.nightTarget = target;
    this.nightT = 0;
    this.nightMs = ms;
  }

  /** A few fireflies drift toward a fresh bloom (screen coords). */
  attract(x: number, y: number): void {
    const near = [...this.flies].sort((a, b) => Math.hypot(a.s.x - x, a.s.y - y) - Math.hypot(b.s.x - x, b.s.y - y)).slice(0, 3);
    // Light budget: only so many fireflies are drawn to blooms at once, however long the chain.
    let pulled = this.flies.filter((f) => f.pull && this.t < f.pull.until).length;
    for (const f of near) {
      const active = !!f.pull && this.t < f.pull.until;
      if (!active) {
        if (pulled >= tuning.scene.fireflyPullMax) continue;
        pulled++;
      }
      f.pull = { x, y, until: this.t + tuning.scene.fireflyAttractMs / 1000, k: 0.5 };
    }
  }

  /**
   * Garden lit: the nearest `fireflyPullMax` fireflies drift to the lanterns (screen coords), closing
   * most of the way before they let go.
   */
  gatherTo(points: readonly { x: number; y: number }[]): void {
    if (points.length === 0) return;
    const nearest = (f: Fly) => points.reduce((best, p) => (Math.hypot(f.s.x - p.x, f.s.y - p.y) < Math.hypot(f.s.x - best.x, f.s.y - best.y) ? p : best), points[0]);
    const dist = (f: Fly) => {
      const p = nearest(f);
      return Math.hypot(f.s.x - p.x, f.s.y - p.y);
    };
    for (const f of [...this.flies].sort((a, b) => dist(a) - dist(b)).slice(0, tuning.scene.fireflyPullMax)) {
      const p = nearest(f);
      f.pull = { x: p.x, y: p.y, until: this.t + tuning.scene.fireflyAttractMs / 1000, k: 0.85 };
    }
  }

  /** Lift the sky by `amount` of the night factor in `upMs`, easing back over `downMs` (a backdrop move, not a light). */
  skyLift(amount: number, upMs: number, downMs: number): void {
    this.lift = { amount, up: upMs, down: downMs, t: 0 };
  }

  clearLift(): void {
    this.lift = null;
    this.liftNow = 0;
  }

  /**
   * Additive scene lights for the dev panel's "lights" readout (GDD §6 light budget): the moon and horizon
   * glow, plus fireflies bright enough to see (alpha over 0.1) inside the bed circle.
   */
  lightCount(bed: { x: number; y: number; r: number } | null): number {
    let n = (this.moon.alpha > 0.1 ? 1 : 0) + (this.horizonGlow.alpha > 0.1 ? 1 : 0);
    for (const f of this.flies) {
      if (f.s.alpha <= 0.1) continue;
      if (!bed || Math.hypot(f.s.x - bed.x, f.s.y - bed.y) <= bed.r) n++;
    }
    return n;
  }

  tick(dtMs: number): void {
    const sc = tuning.scene;
    const dt = dtMs / 1000;
    this.t += dt;
    this.frame++;
    if (this.nightT < 1) {
      this.nightT = Math.min(1, this.nightT + dtMs / Math.max(1, this.nightMs));
      const e = this.nightT < 0.5 ? 2 * this.nightT * this.nightT : 1 - (-2 * this.nightT + 2) ** 2 / 2;
      this.night = this.nightFrom + (this.nightTarget - this.nightFrom) * e;
    }
    if (this.lift) {
      const l = this.lift;
      l.t += dtMs;
      const e = (u: number) => u * u * (3 - 2 * u);
      this.liftNow = l.amount * (l.t < l.up ? e(l.t / Math.max(1, l.up)) : 1 - e(Math.min(1, (l.t - l.up) / Math.max(1, l.down))));
      if (l.t >= l.up + l.down) {
        this.lift = null;
        this.liftNow = 0;
      }
    }
    const n = Math.max(0, Math.min(1, this.night - this.liftNow));
    const deep = Math.max(0, this.night - 1) / 0.15;
    this.skyNight.alpha = n;
    this.groundNight.alpha = n;
    this.skyDusk.tint = this.skyNight.tint = this.groundDusk.tint = this.groundNight.tint = lerpColor(0xffffff, 0xb8b8d0, deep);
    for (const st of this.stars) st.s.alpha = (0.25 + 0.45 * (0.5 + 0.5 * Math.sin(((this.t + st.phase) * Math.PI * 2) / st.period))) * Math.min(1, n + 0.08);
    this.moon.alpha = 0.25;
    this.moonDisc.alpha = 0.9;
    this.horizonGlow.alpha = 0.18 * (1 - 0.4 * n);
    this.hedgeFar.tint = lerpColor(palette.hedgeFar[0], palette.hedgeFar[1], n);
    this.hedgeNear.tint = lerpColor(palette.hedgeNear[0], palette.hedgeNear[1], n);

    const p = this.parallax;
    p.x += (p.tx - p.x) * 0.08;
    p.y += (p.ty - p.y) * 0.08;
    const px = sc.parallaxPx;
    const sway = Math.sin(this.t * Math.PI * 2 * sc.hedgeSwayHz) * sc.hedgeSwayPx;
    this.starLayer.position.set(-p.x * px[0], -p.y * px[0]);
    this.hedgeFar.x = this.w / 2 - p.x * px[1] + sway;
    this.hedgeNear.x = this.w / 2 - p.x * px[2] - sway;
    this.leaves.forEach((leaf, i) => {
      const b = this.leafBase[i];
      if (!b) return;
      leaf.rotation = b.rot + ((Math.sin(this.t * Math.PI * 2 * sc.leafSwayHz + i * 1.7) * sc.leafSwayDeg) * Math.PI) / 180;
      leaf.position.set(b.x + p.x * px[3], b.y + p.y * px[3] * 0.5);
    });

    const flyAlpha = (0.6 + 0.4 * n) * this.fireflyBoost;
    for (const f of this.flies) {
      const k = this.t * 0.08 * f.speed + f.phase;
      let x = (f.x + 0.05 * Math.sin(k * 1.3) + 0.03 * Math.sin(k * 2.9)) * this.w;
      let y = (f.y + 0.04 * Math.cos(k * 1.7) + 0.02 * Math.sin(k * 3.1)) * this.h;
      if (this.gather) {
        const a = f.phase * 2.3 + this.t * 0.15 * f.speed;
        x = this.gather.x + Math.cos(a) * this.gather.r * (0.4 + 0.6 * ((f.phase * 7) % 1));
        y = this.gather.y + Math.sin(a) * this.gather.r * 0.5 * (0.4 + 0.6 * ((f.phase * 3) % 1));
      }
      if (f.pull && this.t < f.pull.until) {
        const left = (f.pull.until - this.t) / (tuning.scene.fireflyAttractMs / 1000);
        const w = Math.sin(Math.PI * (1 - left)) * f.pull.k;
        x += (f.pull.x - x) * w;
        y += (f.pull.y - y) * w;
      } else f.pull = null;
      f.s.x += (x - f.s.x) * Math.min(1, dt * 1.5);
      f.s.y += (y - f.s.y) * Math.min(1, dt * 1.5);
      f.s.alpha = (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(this.t * (1.6 + f.speed) + f.phase))) * flyAlpha;
    }

    this.vignette.alpha = sc.vignette + 0.1 * deep;
    this.grain.alpha = sc.grainAlpha;
    if (this.frame % 4 === 0) this.grain.tilePosition.set(Math.random() * 256, Math.random() * 256);
  }
}
