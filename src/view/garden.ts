import { Container, Graphics, Sprite } from 'pixi.js';
import { cellCenter, dirAngle, type Board } from '../core/hex';
import { MAX_PETALS, type Bud, type TapResult } from '../core/rules';
import type { Sprout } from '../core/run';
import { tuning } from '../tuning';
import { BudView, drawPetal } from './budView';
import { palette } from './palette';
import { glowTexture } from './textures';
import { ease, type Tweener } from './tween';

export interface PlayHooks {
  /** Called as each bud bursts open; `n` counts blooms so far in this chain, from 0. */
  onBloom(n: number, cell: number, delayMs: number): void;
}

/** Draws the garden and replays a resolved tap as an animated cascade. */
export class GardenView extends Container {
  board!: Board;
  buds: BudView[] = [];
  s = 40;
  onTap: (cell: number) => void = () => {};
  hintCell = -1;
  private under = new Container();
  private budLayer = new Container();
  private over = new Container();
  private time = 0;

  constructor(private tw: Tweener) {
    super();
    this.addChild(this.under, this.budLayer, this.over);
  }

  setGarden(board: Board, buds: readonly Bud[]): void {
    this.board = board;
    for (const b of this.buds) b.destroy({ children: true });
    this.buds = buds.map((bud, i) => {
      const v = new BudView(this.s);
      v.setBud(bud);
      v.on('pointerdown', () => this.onTap(i));
      this.budLayer.addChild(v);
      return v;
    });
    this.place();
  }

  /** Fit the garden into the given box. Portrait screens get the board turned 30° (flat-top), which fits them better. */
  layout(x: number, y: number, w: number, h: number): void {
    const R = this.board.radius;
    const portrait = h > w * 1.1;
    const across = Math.sqrt(3) * (2 * R + 1);
    const down = 3 * R + 2;
    const [ew, eh] = portrait ? [down, across] : [across, down];
    this.s = Math.min(72, (Math.min(w / ew, h / eh) * 0.96));
    this.rotation = portrait ? Math.PI / 6 : 0;
    this.position.set(x + w / 2, y + h / 2);
    for (const b of this.buds) b.layout(this.s);
    this.place();
  }

  private place(): void {
    this.buds.forEach((v, i) => {
      const c = cellCenter(this.board, i, this.s);
      v.position.set(c.x, c.y);
    });
  }

  cellGlobal(i: number): { x: number; y: number } {
    return this.buds[i].getGlobalPosition();
  }

  tick(dtMs: number): void {
    this.time += dtMs / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * Math.PI * 2 * tuning.feel.readyPulseHz);
    for (let i = 0; i < this.buds.length; i++) {
      const v = this.buds[i];
      const target = !v.isOpen && v.petals >= MAX_PETALS ? 0.18 + 0.22 * pulse : 0;
      v.halo.alpha += (target - v.halo.alpha) * Math.min(1, dtMs / 120);
      if (i === this.hintCell && !v.isOpen) {
        const p = (this.time * 0.9) % 1;
        v.hintRing.alpha = 0.7 * (1 - p);
        v.hintRing.scale.set(0.7 + p * 0.6);
      } else v.hintRing.alpha = 0;
    }
  }

  /** Small pop and ripple the moment a finger lands, before any chain logic plays. */
  tapFeedback(cell: number): void {
    const v = this.buds[cell];
    const dur = tuning.feel.tapPopMs;
    void this.tw.to(dur, (t) => v.budC.scale.set(1 + 0.22 * Math.sin(Math.PI * t)), { ease: ease.linear });
    const ring = new Graphics().circle(0, 0, this.s).stroke({ width: Math.max(1.5, this.s * 0.05), color: 0xcfe8ff });
    ring.position.copyFrom(v.position);
    this.under.addChild(ring);
    void this.tw.to(520, (t) => {
      ring.scale.set(0.35 + t * 0.85);
      ring.alpha = 0.7 * (1 - t);
    }).then(() => ring.destroy());
  }

  /** Replays a resolved tap step by step. Resolves when the last petal has landed. */
  async playChain(result: TapResult, hooks: PlayHooks): Promise<void> {
    const f = tuning.feel;
    const tapped = this.buds[result.tapped];
    tapped.setPetals(Math.min(MAX_PETALS, tapped.petals + 1));
    if (result.steps.length === 0) return;
    await this.tw.wait(f.firstStepDelayMs);

    let n = 0;
    let stepMs = f.chainStepMs;
    for (const step of result.steps) {
      step.blooms.forEach((cell, j) => {
        const delay = j * tuning.audio.noteStaggerMs;
        const k = n++;
        hooks.onBloom(k, cell, delay);
        if (delay > 0) void this.tw.wait(delay).then(() => this.bloom(cell, k));
        else this.bloom(cell, k);
      });
      const flight = Math.min(f.petalFlightMs, stepMs * 0.95);
      const colorOf = new Map(step.blooms.map((c, j) => [c, palette.bloom[(n - step.blooms.length + j) % palette.bloom.length]]));
      for (const tr of step.transfers) this.flyPetal(tr.from, tr.dir, tr.to, tr.landed, colorOf.get(tr.from) ?? 0xffffff, flight);
      await this.tw.wait(Math.max(stepMs, flight + 20));
      stepMs = Math.max(f.chainStepMinMs, stepMs * f.chainAccel);
    }
  }

  private bloom(cell: number, k: number): void {
    const v = this.buds[cell];
    const f = tuning.feel;
    const color = palette.bloom[k % palette.bloom.length];
    v.isOpen = true;
    v.petals = 0;
    v.budC.visible = false;
    v.arrowsG.visible = false;
    v.drawFlower(color);
    v.flower.visible = true;
    v.flower.alpha = 1;
    void this.tw.to(f.bloomOpenMs, (t) => {
      v.flower.scale.set(0.15 + 0.85 * t);
      v.flower.rotation = -0.5 * (1 - t);
    }, { ease: ease.outElastic }).then(() =>
      this.tw.to(700, (t) => {
        v.flower.alpha = 1 - 0.45 * t;
        v.flower.scale.set(1 - 0.22 * t);
      }, { ease: ease.inOutSine }),
    );

    const burst = new Sprite(glowTexture());
    burst.anchor.set(0.5);
    burst.blendMode = 'add';
    burst.tint = color;
    burst.position.copyFrom(v.position);
    this.over.addChild(burst);
    void this.tw.to(650, (t) => {
      burst.width = burst.height = this.s * (1.2 + 2.6 * t);
      burst.alpha = 0.95 * (1 - t);
    }).then(() => burst.destroy());

    for (let p = 0; p < 9; p++) {
      const dot = new Sprite(glowTexture());
      dot.anchor.set(0.5);
      dot.blendMode = 'add';
      dot.tint = p % 3 === 0 ? 0xffffff : color;
      dot.position.copyFrom(v.position);
      const a = Math.random() * Math.PI * 2;
      const dist = this.s * (0.8 + Math.random() * 0.9);
      const size = this.s * (0.18 + Math.random() * 0.16);
      this.over.addChild(dot);
      void this.tw.to(550 + Math.random() * 400, (t) => {
        dot.position.set(v.x + Math.cos(a) * dist * t, v.y + Math.sin(a) * dist * t - this.s * 0.3 * t * t);
        dot.width = dot.height = size * (1 - 0.5 * t);
        dot.alpha = 1 - t;
      }).then(() => dot.destroy());
    }
  }

  private flyPetal(from: number, dir: number, to: number, landed: boolean, color: number, ms: number): void {
    const a = this.buds[from].position;
    const ang = dirAngle(dir);
    const dist = Math.sqrt(3) * this.s;
    const bx = to >= 0 ? this.buds[to].x : a.x + Math.cos(ang) * dist * 0.75;
    const by = to >= 0 ? this.buds[to].y : a.y + Math.sin(ang) * dist * 0.75;
    const arc = tuning.feel.petalArc * dist;
    const cx = (a.x + bx) / 2 - Math.sin(ang) * arc;
    const cy = (a.y + by) / 2 + Math.cos(ang) * arc;
    const ax = a.x;
    const ay = a.y;

    const trail = new Graphics()
      .moveTo(ax, ay)
      .quadraticCurveTo(cx, cy, bx, by)
      .stroke({ width: this.s * 0.09, color, alpha: 0.55, cap: 'round' });
    trail.blendMode = 'add';
    this.under.addChild(trail);
    void this.tw.to(ms + 650, (t) => (trail.alpha = 1 - t), { ease: ease.inCubic }).then(() => trail.destroy());

    const petal = drawPetal(new Graphics(), 0, this.s * 0.34, this.s * 0.13, -this.s * 0.17).fill({ color });
    this.over.addChild(petal);
    void this.tw.to(ms, (t) => {
      const u = 1 - t;
      petal.position.set(u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by);
      petal.rotation = ang + 1.2 * (t - 0.5);
    }, { ease: ease.inOutSine }).then(() => {
      if (landed) {
        petal.destroy();
        const v = this.buds[to];
        v.setPetals(Math.min(MAX_PETALS, v.petals + 1));
        void this.tw.to(220, (t) => v.budC.scale.set(1 + 0.25 * Math.sin(Math.PI * t)), { ease: ease.linear });
        return;
      }
      const x0 = petal.x;
      const y0 = petal.y;
      void this.tw.to(700, (t) => {
        petal.position.set(x0 + Math.sin(t * 6) * this.s * 0.12, y0 + t * this.s * 0.7);
        petal.rotation += 0.05;
        petal.alpha = 1 - t;
      }, { ease: ease.linear }).then(() => petal.destroy());
    });
  }

  /** Snap displayed petal counts to the logic state (guards against any drift after a chain). */
  sync(buds: readonly Bud[]): void {
    buds.forEach((b, i) => {
      if (!this.buds[i].isOpen && this.buds[i].petals !== b.petals) this.buds[i].setPetals(b.petals);
    });
  }

  /** Bloomed cells close their flowers and fresh buds grow in their place. */
  async sprout(sprouts: readonly Sprout[]): Promise<void> {
    const f = tuning.feel;
    const jobs = sprouts.map(({ cell, bud }, j) => {
      const v = this.buds[cell];
      const delay = j * 35;
      const fade = this.tw.to(300, (t) => {
        v.flower.alpha = 0.55 * (1 - t);
        v.flower.scale.set(0.78 - 0.4 * t);
      }, { delay });
      return this.tw.wait(delay + 120).then(() => {
        v.isOpen = false;
        v.setBud(bud);
        v.budC.visible = true;
        v.arrowsG.visible = true;
        v.budC.scale.set(0);
        return Promise.all([
          fade,
          this.tw.to(f.sproutMs, (t) => {
            v.budC.scale.set(t);
            v.arrowsG.alpha = Math.min(1, t * 1.5);
          }, { ease: ease.outBack }),
        ]);
      }).then(() => {
        v.flower.visible = false;
      });
    });
    await Promise.all(jobs);
  }
}
