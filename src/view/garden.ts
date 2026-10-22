import { Container, Graphics, Sprite, type FederatedPointerEvent } from 'pixi.js';
import type { BloomCue, ChainSchedule } from '../audio/schedule';
import { cellCenter, dirAngle, type Board } from '../core/hex';
import type { PreviewPlan } from '../core/preview';
import { MAX_PETALS, type Bud, type TapResult } from '../core/rules';
import type { Sprout } from '../core/run';
import { tuning } from '../tuning';
import { bedTexture } from './bed';
import { BudView, petalSprite, shapePetal } from './budView';
import { dropTexture, glowTexture } from './textures';
import { LanternView } from './lantern';
import { palette } from './palette';
import { ease, type Tweener } from './tween';

const FINE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
export const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Pollen motes that fly to the HUD for a chain of n blooms (the counter ticks once per mote). */
export function hudMoteCount(n: number): number {
  return Math.min(n, 8) * tuning.feel.pollenToHudMotes;
}

export interface PlayHooks {
  /** A bud opens (screen position), for fireflies and the chain count. */
  onBloom(cue: BloomCue, x: number, y: number): void;
  /** Where pollen motes fly to (screen coords). */
  pollenTarget(): { x: number; y: number };
  /** One pollen mote reached the counter. */
  onMote(): void;
  /** Send motes to the HUD counter (off in the tutorial, where the counter is hidden). */
  toHud: boolean;
  /** A lantern's bud opened and the lantern lights. */
  onLantern?(cell: number): void;
}

/** Draws the garden bed and buds, and replays a resolved tap as a cascade of light on the note grid. */
export class GardenView extends Container {
  board!: Board;
  buds: BudView[] = [];
  s = 40;
  rot = 0;
  onTap: (cell: number) => void = () => {};
  /** Asked for a preview of a tap on `cell`; null when no preview should show (a chain is playing). */
  onPreview: (cell: number) => PreviewPlan | null = () => null;
  /** Buds circled by a breathing ring with a waiting drop (tutorial and first-run hint). */
  hintCells: number[] = [];
  /** Pulse the chevrons of the hinted buds (tutorial lesson on arrows). */
  highlightArrows = false;
  /** Buds rest dimmer when the garden sleeps at the end of a run. */
  restDim = false;
  private bed = new Sprite();
  private light = new Container();
  private budLayer = new Container();
  private fx = new Container();
  /** Fallen petals that show why a chain stopped; cleared with the garden. */
  private marks = new Container();
  private lanternLayer = new Container();
  private lanterns = new Map<number, LanternView>();
  private flare = 0;
  private chainLight = new Sprite(glowTexture());
  private chainTarget = { x: 0, y: 0, size: 0, alpha: 0 };
  /** Open-flower halos in bloom order: only the latest `light.haloHoldCount` stay bright (GDD §6 light budget). */
  private halos: { halo: Sprite; open: number; sink: number }[] = [];
  /** A chain is playing: ready halos and the hint ring are off so the frontier is the one bright thing. */
  private chainPlaying = false;
  /** Garden-lit moment: flower halos and the chain light are off until the next garden sprouts. */
  private litDim = false;
  private haloMul = 1;
  private dimmed = new Set<number>();
  private zoomTarget = 1;
  private zoom = 1;
  private time = 0;
  private particles = 0;
  private baseX = 0;
  private baseY = 0;
  private previewG = new Graphics();
  private preview: PreviewPlan | null = null;
  private previewSet = new Set<number>();
  private press: { id: number; cell: number; touch: boolean; x: number; y: number; held: boolean; timer: number } | null = null;
  private hoverTimer = 0;

  constructor(
    private tw: Tweener,
    /** Screen-space layer above everything, for motes flying to the HUD. */
    private overlay: Container,
  ) {
    super();
    this.bed.anchor.set(0.5);
    this.chainLight.anchor.set(0.5);
    this.chainLight.blendMode = 'add';
    this.chainLight.tint = palette.cascadeLight;
    this.chainLight.alpha = 0;
    this.light.addChild(this.chainLight);
    // Lantern posts stand behind the buds (GDD §6); their lit pools sit under the flower lights.
    this.addChild(this.bed, this.lanternLayer, this.light, this.budLayer, this.marks, this.previewG, this.fx);
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', (e) => this.pointerMove(e));
      window.addEventListener('pointerup', (e) => this.pointerUp(e, false));
      window.addEventListener('pointercancel', (e) => this.pointerUp(e, true));
    }
  }

  // Input: a quick press is a tap. On touch, holding (or sliding) previews the bud under the finger
  // and letting go cancels; a mouse previews on hover and taps on click (GDD §7 preview).
  private pointerDown(i: number, e: FederatedPointerEvent): void {
    if (this.press) return;
    const touch = e.pointerType !== 'mouse';
    this.press = { id: e.pointerId, cell: i, touch, x: e.global.x, y: e.global.y, held: false, timer: 0 };
    if (touch) {
      this.press.timer = window.setTimeout(() => {
        if (!this.press) return;
        this.press.held = true;
        this.showPreview(this.press.cell);
      }, tuning.preview.holdMs);
    }
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.press;
    if (!p || p.id !== e.pointerId || !p.touch) return;
    if (!p.held && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) {
      clearTimeout(p.timer);
      p.held = true;
    }
    if (p.held) {
      const cell = this.cellAt(e.clientX, e.clientY);
      if (cell !== this.preview?.cell) this.showPreview(cell);
    }
  }

  private pointerUp(e: PointerEvent, cancel: boolean): void {
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    clearTimeout(p.timer);
    this.press = null;
    if (p.touch) this.showPreview(-1);
    if (!cancel && !p.held) {
      if (!p.touch) this.showPreview(-1);
      this.onTap(p.cell);
    }
  }

  private hover(i: number, on: boolean): void {
    clearTimeout(this.hoverTimer);
    if (!FINE_POINTER || this.press) return;
    if (!on) {
      if (this.preview?.cell === i) this.showPreview(-1);
      return;
    }
    this.hoverTimer = window.setTimeout(() => this.showPreview(i), tuning.preview.hoverDelayMs);
  }

  /** Bud under a screen point, or -1. */
  private cellAt(x: number, y: number): number {
    const p = this.toLocal({ x, y });
    let best = -1;
    let bestD = this.s * 0.95;
    this.buds.forEach((v, i) => {
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** Show what a tap on `cell` would do; -1 clears. */
  showPreview(cell: number): void {
    const plan = cell >= 0 && !this.buds[cell]?.isOpen ? this.onPreview(cell) : null;
    for (const v of this.buds) v.setGhost(false);
    this.preview = plan;
    this.previewSet.clear();
    const g = this.previewG.clear();
    if (!plan) return;
    const v = this.buds[plan.cell];
    this.previewSet.add(plan.cell);
    if (plan.blooms.length === 0) {
      v.setGhost(true);
      return;
    }
    const s = this.s;
    const ink = palette.hint;
    for (const c of plan.blooms) {
      this.previewSet.add(c);
      const b = this.buds[c];
      g.circle(b.x, b.y, s * 0.78).stroke({ width: 2, color: palette.petalReady, alpha: 0.85 });
    }
    for (const tr of plan.transfers) {
      const path = this.flightPath(tr.from, tr.dir, tr.to);
      const dots = 7;
      for (let k = 1; k <= dots; k++) {
        const q = path((k / (dots + 1)) * (tr.landed ? 0.82 : 1));
        g.circle(q.x, q.y, Math.max(2, s * 0.06)).fill({ color: ink, alpha: tr.landed ? 0.75 : 0.35 });
      }
      if (tr.landed) {
        this.previewSet.add(tr.to);
        const t = this.buds[tr.to];
        g.circle(t.x, t.y, s * 0.12).fill({ color: ink, alpha: 0.5 });
      } else {
        // A petal that would be lost: a short drop and a faint mark where it falls.
        const end = path(1);
        g.moveTo(end.x, end.y).lineTo(end.x, end.y + s * 0.3).stroke({ width: 1.5, color: ink, alpha: 0.3 });
        g.circle(end.x, end.y + s * 0.34, s * 0.05).fill({ color: ink, alpha: 0.3 });
      }
    }
    for (const c of plan.next) {
      this.previewSet.add(c);
      const b = this.buds[c];
      g.circle(b.x, b.y, s * 0.78).stroke({ width: 2, color: palette.petalReady, alpha: 0.5 });
      g.circle(b.x, b.y, s * 0.92).stroke({ width: 1, color: palette.petalReady, alpha: 0.3 });
    }
  }

  setGarden(board: Board, buds: readonly Bud[]): void {
    this.board = board;
    this.alpha = 1;
    for (const b of this.buds) {
      b.bloomHalo?.destroy();
      b.destroy({ children: true });
    }
    for (const m of this.marks.removeChildren()) m.destroy();
    this.setLanterns([], []);
    this.dimmed.clear();
    this.halos = [];
    this.litDim = false;
    this.haloMul = 1;
    this.chainPlaying = false;
    this.restDim = false;
    this.preview = null;
    this.previewSet.clear();
    this.previewG.clear();
    this.buds = buds.map((bud, i) => {
      const v = new BudView(this.s, i);
      v.layout(this.s, this.rot);
      v.setBud(bud);
      v.on('pointerdown', (e) => this.pointerDown(i, e));
      v.on('pointerover', (e) => e.pointerType === 'mouse' && this.hover(i, true));
      v.on('pointerout', (e) => e.pointerType === 'mouse' && this.hover(i, false));
      this.budLayer.addChild(v);
      return v;
    });
    this.place();
  }

  /** The garden's lanterns; `lit[k]` for `cells[k]`. `hidden` posts stay unseen until `plantLanterns`. */
  setLanterns(cells: readonly number[], lit: readonly boolean[], hidden = false): void {
    for (const l of this.lanternLayer.removeChildren()) l.destroy({ children: true });
    this.lanterns.clear();
    cells.forEach((c, k) => {
      const l = new LanternView(c);
      if (lit[k]) l.lightNow();
      if (hidden) l.hide();
      this.lanterns.set(c, l);
      this.lanternLayer.addChild(l);
    });
    this.placeLanterns();
  }

  /** First-run beat: hidden posts plant one by one, `beatMs` apart; `onEach(k)` rings the bell for post k. */
  async plantLanterns(beatMs: number, onEach: (k: number) => void): Promise<void> {
    const jobs = [...this.lanterns.values()].map((l, k) =>
      this.tw.wait(k * beatMs).then(() => {
        if (l.destroyed) return;
        onEach(k);
        return l.plant(this.tw);
      }),
    );
    await Promise.all(jobs);
  }

  /** Screen positions of the lantern panes, for fireflies and flying drops. */
  lanternPoints(): { x: number; y: number }[] {
    return [...this.lanterns.values()].map((l) => l.paneGlobal());
  }

  private placeLanterns(): void {
    for (const l of this.lanterns.values()) {
      const b = this.buds[l.cell];
      if (b) l.layout(b.x, b.y, this.s, this.rot);
    }
  }

  /**
   * Garden lit (GDD §6 light budget): flower halos and the chain light fade to 0 over 300 ms so the
   * lanterns take the stage. Resolves when they are dark; the next sprout or garden turns them back on.
   */
  async dimForGardenLit(): Promise<void> {
    this.litDim = true;
    this.chainTarget = { ...this.chainTarget, alpha: 0 };
    await this.tw.wait(300);
  }

  /**
   * Visible additive lights in the bed (alpha over 0.1): ready and flower halos, hint rings, the chain
   * light, lit lanterns, pollen, trails and ripples. Feeds the dev panel's "lights" readout.
   */
  lightCount(): number {
    const lit = (s: Sprite | Graphics) => s.visible && s.alpha > 0.1 && s.blendMode === 'add';
    let n = 0;
    for (const b of this.buds) {
      if (lit(b.halo)) n++;
      if (lit(b.hintRing)) n++;
    }
    for (const layer of [this.light, this.fx, this.marks]) for (const c of layer.children) if (lit(c as Sprite)) n++;
    for (const l of this.lanterns.values()) if (l.lit) n++;
    return n;
  }

  /**
   * Every lantern flares together when the garden is lit: a quick rise, then it eases back over
   * `goal.flareMs`, with one pollen ripple spreading from the bed centre.
   */
  async flareLanterns(): Promise<void> {
    this.pollenRipple();
    await this.tw.to(tuning.goal.flareMs, (t) => (this.flare = t < 0.15 ? ease.outCubic(t / 0.15) : 1 - ease.inOutSine((t - 0.15) / 0.85)), { ease: ease.linear });
    this.flare = 0;
  }

  /** One thin pollen ring crossing the bed from its centre (a single additive light, 700 ms). */
  private pollenRipple(): void {
    const ring = new Graphics();
    ring.blendMode = 'add';
    this.light.addChild(ring);
    const reach = this.centre().r;
    void this.tw.to(700, (t) => {
      if (ring.destroyed) return;
      ring.clear().circle(0, 0, this.s * 0.6 + reach * t).stroke({ width: Math.max(2, this.s * 0.1), color: palette.pollen, alpha: 0.4 * (1 - t) });
    }).then(() => ring.destroy());
  }

  /** The lit garden fades out before the next one is planted. */
  async fadeOut(ms: number): Promise<void> {
    await this.tw.to(ms, (t) => (this.alpha = 1 - t), { ease: ease.linear });
  }

  /** Fit bed and board into the box. Portrait screens turn the board 30°, which fits them better. */
  layout(x: number, y: number, w: number, h: number): void {
    const R = this.board.radius;
    const portrait = h > w * 1.1;
    const across = Math.sqrt(3) * (2 * R + 1) + 2.4;
    const down = 3 * R + 2 + 2.6;
    const [ew, eh] = portrait ? [down, across] : [across, down];
    this.s = Math.min(R <= 1 ? 80 : 64, Math.min(w / ew, h / eh));
    this.rot = portrait ? Math.PI / 6 : 0;
    this.baseX = x + w / 2;
    this.baseY = y + h / 2;
    this.position.set(this.baseX, this.baseY);
    for (const b of this.buds) {
      b.layout(this.s, this.rot);
      b.setPetals(b.petals);
      if (b.isOpen && b.bloomHalo) b.bloomHalo.width = b.bloomHalo.height = this.s * 3.2;
    }
    this.place();
    this.placeLanterns();
    const res = Math.min(2, window.devicePixelRatio || 1);
    this.bed.texture = bedTexture(R, this.s, this.rot, this.buds.map((b) => ({ x: b.x, y: b.y })), res);
    this.bed.scale.set(1 / res);
  }

  /** Centre of the bed and a radius that covers it (screen coords). */
  centre(): { x: number; y: number; r: number } {
    return { x: this.baseX, y: this.baseY, r: 0.866 * (2 * this.board.radius + 1) * this.s };
  }

  /** Top of the bed and its centre (screen coords), for the title and the chain count. */
  bedTop(): { x: number; y: number } {
    const rb = 0.866 * (2 * this.board.radius + 1) * this.s + this.s;
    return { x: this.baseX, y: this.baseY - rb * (this.rot ? 1 : 0.866) };
  }

  private local(i: number): { x: number; y: number } {
    const c = cellCenter(this.board, i, this.s);
    const cs = Math.cos(this.rot);
    const sn = Math.sin(this.rot);
    return { x: c.x * cs - c.y * sn, y: c.x * sn + c.y * cs };
  }

  private place(): void {
    this.buds.forEach((v, i) => {
      const c = this.local(i);
      v.position.set(c.x, c.y);
      v.bloomHalo?.position.set(c.x, c.y);
    });
  }

  cellGlobal(i: number): { x: number; y: number } {
    return this.buds[i].getGlobalPosition();
  }

  tick(dtMs: number): void {
    const f = tuning.feel;
    this.time += dtMs / 1000;
    const t = this.time;
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * f.readyPulseHz);
    const k = Math.min(1, dtMs / 120);
    // Light budget: with many ready buds every ready halo dims by fullCount/n, never below the floor.
    const L = tuning.light;
    let readyCount = 0;
    for (const b of this.buds) if (b.ready && b.anim !== 'grow') readyCount++;
    const haloScale = readyCount > L.readyHaloFullCount ? Math.max(L.readyHaloFloor, L.readyHaloFullCount / readyCount) : 1;
    for (let i = 0; i < this.buds.length; i++) {
      const v = this.buds[i];
      const ready = v.ready && v.anim !== 'grow';
      v.halo.alpha += ((ready && !this.chainPlaying && !this.litDim ? (0.22 + 0.22 * pulse) * haloScale : 0) - v.halo.alpha) * k;
      if (!v.isOpen) {
        const idle = 1 + f.idleBreathe * Math.sin((t * Math.PI * 2) / v.period + v.phase);
        const breathe = ready ? 1 + f.readyBreathe * pulse : idle;
        if (!v.anim) v.budC.scale.set(breathe * v.jitterScale);
        v.budC.rotation = v.jitterRot;
        v.lean(t);
      }
      const previewDim = this.preview && !this.previewSet.has(i);
      const dimTo = this.restDim ? 0.6 : this.dimmed.has(i) ? f.cascadeDimAlpha : previewDim ? tuning.preview.dimAlpha : 1;
      v.alpha += (dimTo - v.alpha) * Math.min(1, dtMs / 250);

      const hinted = !v.isOpen && !this.chainPlaying && !this.litDim && this.hintCells.includes(i);
      const hp = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      v.hintRing.alpha += ((hinted ? 0.4 + 0.5 * hp : 0) - v.hintRing.alpha) * k;
      v.hintDrop.alpha += ((hinted ? 0.85 : 0) - v.hintDrop.alpha) * k;
      v.hintDrop.y = -this.s * 0.7 - 4 * hp;
      // Skip drawing what cannot be seen (fill rate matters on phones).
      v.halo.visible = v.halo.alpha > 0.01;
      v.hintRing.visible = v.hintRing.alpha > 0.01;
      v.hintDrop.visible = v.hintDrop.alpha > 0.01;
      v.arrowsG.renderable = v.arrowsG.alpha > 0.01;

      if (v.ghost.visible) v.ghost.alpha = 0.3 + 0.25 * pulse;
      // Chevrons: warm on ready buds and on the previewed bud, otherwise hidden.
      const previewed = !v.isOpen && this.preview?.cell === i;
      const hover = !ready && previewed;
      // Under a finger the chevrons reach out from beneath it: full alpha and heldArrowScale (touch only).
      const held = previewed && !!this.press?.touch && this.press.held;
      v.heldArrow += ((held ? 1 : 0) - v.heldArrow) * Math.min(1, dtMs / Math.max(1, f.arrowRevealMs));
      const target = held ? 1 : ready ? 0.9 : hover ? 0.85 : 0;
      const rate = target > v.arrowsG.alpha ? (ready ? 180 : f.arrowRevealMs) : 200;
      const step = (dtMs / Math.max(1, rate)) * Math.max(target, 0.4);
      v.arrowsG.alpha = target > v.arrowsG.alpha ? Math.min(target, v.arrowsG.alpha + step) : Math.max(target, v.arrowsG.alpha - step);
      if (ready) v.arrowsG.tint = palette.petalReady;
      else if (hover) v.arrowsG.tint = palette.arrow;
      const baseScale = hinted && this.highlightArrows ? 1 + 0.12 * pulse : ready ? 1 + f.readyBreathe * pulse : 1;
      v.arrowsG.scale.set(baseScale * (1 + (tuning.preview.heldArrowScale - 1) * v.heldArrow));
    }

    for (const l of this.lanterns.values()) {
      // The lantern bud's ring joins its ready halo.
      const bud = this.buds[l.cell];
      l.tick(t, this.flare, bud ? Math.min(1, bud.halo.alpha / 0.3) : 0);
    }

    // Open-flower halos: the latest few hold their glow, older ones sink to a faint rest over 600 ms.
    this.haloMul += ((this.litDim ? 0 : 1) - this.haloMul) * Math.min(1, dtMs / 100);
    this.halos = this.halos.filter((h) => !h.halo.destroyed);
    const holdFrom = this.halos.length - L.haloHoldCount;
    this.halos.forEach((h, j) => {
      const target = j < holdFrom ? 1 : 0;
      const step = dtMs / 600;
      h.sink = target > h.sink ? Math.min(target, h.sink + step) : Math.max(target, h.sink - step);
      h.halo.alpha = (h.open + (L.haloRestAlpha - h.open) * h.sink) * this.haloMul;
      h.halo.visible = h.halo.alpha > 0.005;
    });

    const ct = this.chainTarget;
    const ck = Math.min(1, dtMs / 300);
    this.chainLight.x += (ct.x - this.chainLight.x) * ck;
    this.chainLight.y += (ct.y - this.chainLight.y) * ck;
    const size = this.chainLight.width + (ct.size - this.chainLight.width) * ck;
    this.chainLight.width = this.chainLight.height = Math.max(1, size);
    this.chainLight.alpha += (ct.alpha - this.chainLight.alpha) * Math.min(1, dtMs / (ct.alpha > this.chainLight.alpha ? 300 : this.litDim ? 100 : 900));
    this.chainLight.visible = this.chainLight.alpha > 0.005;

    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dtMs / (tuning.feel.cascadeZoomMs / 3));
    this.scale.set(this.zoom);
  }

  /** The finger lands: a drop falls onto the bud, it pops, a ripple spreads. */
  async tapFeedback(cell: number): Promise<void> {
    const v = this.buds[cell];
    const f = tuning.feel;
    if (f.vibrateTapMs > 0) navigator.vibrate?.(f.vibrateTapMs);
    const drop = new Sprite(dropTexture());
    drop.anchor.set(0.5, 1);
    drop.tint = palette.drop;
    drop.width = this.s * 0.26;
    drop.height = this.s * 0.34;
    this.fx.addChild(drop);
    await this.tw.to(f.dropFallMs, (t) => {
      drop.position.set(v.x, v.y - this.s * 0.9 * (1 - t));
      drop.alpha = 0.4 + 0.6 * t;
    }, { ease: ease.inCubic });
    drop.destroy();
    v.anim = 'pop';
    void this.tw.to(f.tapPopMs, (t) => v.budC.scale.set(v.jitterScale * (1 + 0.18 * Math.sin(Math.PI * t))), { ease: ease.linear }).then(() => (v.anim = ''));
    this.ripple(v.x, v.y, palette.drop, 0.55);
  }

  private catchRing(x: number, y: number, color: number): void {
    const ring = new Graphics();
    ring.position.set(x, y);
    this.fx.addChild(ring);
    void this.tw.to(300, (t) => {
      if (ring.destroyed) return;
      ring.clear().circle(0, 0, this.s * (0.5 + 0.4 * t)).stroke({ width: 2, color, alpha: 0.35 * (1 - t) });
    }).then(() => ring.destroy());
  }

  private ripple(x: number, y: number, color: number, alpha: number): void {
    const ring = new Sprite(glowTexture());
    ring.anchor.set(0.5);
    ring.blendMode = 'add';
    ring.tint = color;
    ring.position.set(x, y);
    this.light.addChild(ring);
    void this.tw.to(520, (t) => {
      ring.width = ring.height = this.s * (0.6 + 1.8 * t);
      ring.alpha = alpha * (1 - t);
    }).then(() => ring.destroy());
  }

  /** Add the tapped petal once the drop has landed. */
  addTappedPetal(cell: number): void {
    const v = this.buds[cell];
    v.setPetals(Math.min(MAX_PETALS, v.petals + 1));
  }

  /** Replays a resolved tap on its note-grid schedule. Resolves when the cascade has settled. */
  async playChain(result: TapResult, sched: ChainSchedule, hooks: PlayHooks): Promise<void> {
    const f = tuning.feel;
    if (result.steps.length === 0) return;
    this.chainPlaying = true;
    const inChain = new Set([result.tapped, ...result.bloomed]);
    this.dimmed = new Set(this.buds.map((_, i) => i).filter((i) => !inChain.has(i)));
    if (!REDUCED_MOTION) this.zoomTarget = 1 + f.cascadeZoom;
    const opened: number[] = [];
    const jobs: Promise<void>[] = [];

    for (const cue of sched.cues) {
      jobs.push(
        this.tw.wait(cue.at).then(() => {
          this.bloom(cue, hooks);
          opened.push(cue.cell);
          let cx = 0;
          let cy = 0;
          for (const c of opened) {
            cx += this.buds[c].x;
            cy += this.buds[c].y;
          }
          const n = opened.length;
          this.chainTarget = {
            x: cx / n,
            y: cy / n,
            size: Math.min(f.chainLightMaxSize, 2 + f.chainLightSizePerBloom * n) * this.s,
            alpha: Math.min(f.chainLightMaxAlpha, f.chainLightAlphaPerBloom * n),
          };
          const g = this.buds[cue.cell].getGlobalPosition();
          hooks.onBloom(cue, g.x, g.y);
        }),
      );
    }
    // Held breath: the light swells while the last petals hang in the air.
    if (sched.holdWave > 0) {
      void this.tw.wait(sched.waveAt[sched.holdWave - 1] + sched.sixteenthMs).then(() => {
        this.chainTarget = { ...this.chainTarget, size: this.chainTarget.size * 1.2, alpha: Math.min(f.chainLightMaxAlpha * 1.2, this.chainTarget.alpha * 1.2) };
      });
    }

    const cueOf = new Map(sched.cues.map((c) => [c.cell, c]));
    let flightsEnd = 0;
    const lastWave = result.steps.length - 1;
    result.steps.forEach((step, w) => {
      const nextAt = sched.waveAt[w + 1];
      for (const tr of step.transfers) {
        const src = cueOf.get(tr.from)!;
        const start = src.at + 30;
        const dur = nextAt !== undefined ? Math.max(100, nextAt - start) : f.petalFlightMs;
        flightsEnd = Math.max(flightsEnd, start + dur);
        const color = palette.bloom[src.k % palette.bloom.length];
        jobs.push(this.tw.wait(start).then(() => this.flyPetal(tr.from, tr.dir, tr.to, tr.landed, color, dur, w === lastWave)));
      }
    });

    jobs.push(this.tw.wait(Math.max(sched.lastAt + f.bloomOpenMs * 0.6, flightsEnd)));
    await Promise.all(jobs);
    this.settle();
  }

  /** The cascade is over: light fades, the board breathes back out, dimmed buds return. */
  settle(): void {
    this.dimmed.clear();
    this.chainPlaying = false;
    this.zoomTarget = 1;
    this.chainTarget = { ...this.chainTarget, alpha: 0 };
  }

  private bloom(cue: BloomCue, hooks: PlayHooks): void {
    const v = this.buds[cue.cell];
    const f = tuning.feel;
    const color = palette.bloom[cue.k % palette.bloom.length];
    // Later flowers in a chain open a little bigger: the chain reads as a garden growing.
    const grow = 1 + f.flowerGrowPerBloom * Math.min(cue.k, f.flowerGrowMaxK);
    v.isOpen = true;
    v.petals = 0;
    const lantern = this.lanterns.get(cue.cell);
    if (lantern && !lantern.lit) {
      void lantern.light(this.tw);
      hooks.onLantern?.(cue.cell);
    }
    v.arrowsG.visible = false;
    v.halo.alpha = 0;
    v.anim = 'squash';
    // Squash, then open through one overshoot.
    void this.tw.to(f.squashMs, (t) => {
      v.budC.scale.set(v.jitterScale * (1 - (1 - f.squashScale) * t));
      v.budC.tint = 0xe6e6e6;
    }, { ease: ease.outCubic }).then(() => {
      v.budC.visible = false;
      v.anim = '';
      v.budC.tint = 0xffffff;
      v.setFlower(color, cue.k);
      v.flower.visible = true;
      v.flower.alpha = 1;
      const o = f.bloomOvershoot;
      void this.tw.to(f.bloomOpenMs, (t) => {
        const sc = t < 0.45 ? 0.9 + (o - 0.9) * ease.outCubic(t / 0.45) : o + (1 - o) * ease.inOutSine((t - 0.45) / 0.55);
        v.flower.scale.set(sc * grow);
        v.unfold(t * f.bloomOpenMs);
      }, { ease: ease.linear });

      const halo = new Sprite(glowTexture());
      halo.anchor.set(0.5);
      halo.blendMode = 'add';
      halo.tint = color;
      halo.position.copyFrom(v.position);
      halo.width = halo.height = this.s * 3.2 * grow;
      this.light.addChild(halo);
      v.bloomHalo?.destroy();
      v.bloomHalo = halo;
      const [a0, a1] = f.haloOpenAlpha;
      halo.alpha = a0 * this.haloMul;
      const entry = { halo, open: a0, sink: 0 };
      this.halos.push(entry);
      void this.tw.to(f.haloOpenMs, (t) => {
        entry.open = a0 + (a1 - a0) * t;
      });

      this.motes(v.x, v.y, color, hooks, cue.k);
    });
  }

  private spawnOk(n: number): number {
    const cap = tuning.feel.particleCap;
    const want = REDUCED_MOTION ? Math.ceil(n / 2) : n;
    return Math.max(0, Math.min(want, cap - this.particles));
  }

  private glowDot(color: number, size: number, layer: Container = this.fx): Sprite {
    const d = new Sprite(glowTexture());
    d.anchor.set(0.5);
    d.blendMode = 'add';
    d.tint = color;
    d.width = d.height = size;
    layer.addChild(d);
    this.particles++;
    d.on('destroyed', () => this.particles--);
    return d;
  }

  /** Pollen motes rise and scatter; a few fly to the HUD counter. */
  private motes(x: number, y: number, color: number, hooks: PlayHooks, k: number): void {
    const f = tuning.feel;
    // Light budget: from the 8th bloom of a chain only half the motes scatter.
    const n = this.spawnOk(k >= 7 ? Math.ceil(f.pollenMotesPerBloom / 2) : f.pollenMotesPerBloom);
    for (let i = 0; i < n; i++) {
      const d = this.glowDot(i % 3 === 0 ? color : palette.pollen, 6 + Math.random() * 6);
      const a = Math.random() * Math.PI * 2;
      const dist = this.s * (0.5 + Math.random() * 0.9);
      void this.tw.to(900, (t) => {
        d.position.set(x + Math.cos(a) * dist * t, y + Math.sin(a) * dist * t * 0.6 - this.s * 0.8 * t);
        d.alpha = (1 - t) * 0.9;
      }).then(() => d.destroy());
    }
    if (k >= 8 || !hooks.toHud) return;
    const from = this.toGlobal({ x, y });
    for (let i = 0; i < f.pollenToHudMotes; i++) {
      const d = this.glowDot(palette.pollen, 12, this.overlay);
      d.position.set(from.x, from.y);
      d.alpha = 0;
      const side = (Math.random() - 0.5) * 160;
      void this.tw.to(f.pollenFlightMs, (t) => {
        const to = hooks.pollenTarget();
        const cx = (from.x + to.x) / 2 + side;
        const cy = Math.min(from.y, to.y) - 40;
        const u = 1 - t;
        d.position.set(u * u * from.x + 2 * u * t * cx + t * t * to.x, u * u * from.y + 2 * u * t * cy + t * t * to.y);
        d.alpha = Math.min(1, t * 6);
        d.width = d.height = 12 - 4 * t;
      }, { delay: 120 + i * f.pollenFlightStaggerMs, ease: ease.inOutSine }).then(() => {
        d.destroy();
        hooks.onMote();
      });
    }
  }

  /** The arc a petal flies along from `from` in direction `dir`; t in 0..1. */
  private flightPath(from: number, dir: number, to: number): (t: number) => { x: number; y: number } {
    const a = this.buds[from].position;
    const ang = dirAngle(dir) + this.rot;
    const dist = Math.sqrt(3) * this.s;
    const bx = to >= 0 ? this.buds[to].x : a.x + Math.cos(ang) * dist * 0.75;
    const by = to >= 0 ? this.buds[to].y : a.y + Math.sin(ang) * dist * 0.75;
    const arc = tuning.feel.petalArc * dist;
    const cx = (a.x + bx) / 2 - Math.sin(ang) * arc;
    const cy = (a.y + by) / 2 + Math.cos(ang) * arc;
    const ax = a.x;
    const ay = a.y;
    return (t: number) => {
      const u = 1 - t;
      return { x: u * u * ax + 2 * u * t * cx + t * t * bx, y: u * u * ay + 2 * u * t * cy + t * t * by };
    };
  }

  private flyPetal(from: number, dir: number, to: number, landed: boolean, color: number, ms: number, last: boolean): void {
    const ang = dirAngle(dir) + this.rot;
    const at = this.flightPath(from, dir, to);

    const trail = Array.from({ length: tuning.feel.trailDots }, (_, i) => this.glowDot(color, this.s * (0.26 - i * 0.04)));
    const petal = petalSprite();
    petal.tint = color;
    shapePetal(petal, this.s * 0.46, this.s * 0.17, 0, 0);
    petal.anchor.set(0.5);
    this.fx.addChild(petal);
    void this.tw.to(ms, (t) => {
      const p = at(t);
      petal.position.set(p.x, p.y);
      petal.rotation = ang + 1.2 * (t - 0.5);
      trail.forEach((d, i) => {
        const q = at(Math.max(0, t - 0.06 * (i + 1)));
        d.position.set(q.x, q.y);
        d.alpha = 0.65 - i * 0.12;
      });
    }, { ease: ease.inOutSine }).then(() => {
      for (const d of trail) {
        void this.tw.to(180, (t) => (d.alpha *= 1 - t)).then(() => d.destroy());
      }
      if (landed) {
        petal.destroy();
        const v = this.buds[to];
        v.setPetals(Math.min(MAX_PETALS, v.petals + 1));
        v.anim = 'pop';
        void this.tw.to(220, (t) => v.budC.scale.set(v.jitterScale * (1 + 0.28 * Math.sin(Math.PI * t))), { ease: ease.linear }).then(() => {
          if (v.anim === 'pop') v.anim = '';
        });
        // A small ring in the petal's colour marks the catch.
        this.catchRing(v.x, v.y, color);
        return;
      }
      if (last) return this.restPetal(petal, to, ang);
      // Lost petals flutter down and fade.
      const x0 = petal.x;
      const y0 = petal.y;
      const r0 = petal.rotation;
      const fall = tuning.feel.fallenPetalMs;
      void this.tw.to(fall, (t) => {
        const ft = Math.min(1, (t * fall) / 1200);
        petal.position.set(x0 + Math.sin(ft * 9) * this.s * 0.15, y0 + ft * this.s * 0.9);
        petal.rotation = r0 + Math.sin(ft * 7) * 0.35;
        petal.alpha = 1 - t;
      }, { ease: ease.linear }).then(() => petal.destroy());
    });
  }

  /**
   * A petal of the chain's last wave was lost, so it stays a moment where it fell to show why the chain
   * stopped: off the edge it drops onto the rim; onto an open flower it bounces back off the petals.
   */
  private restPetal(petal: Sprite, to: number, ang: number): void {
    const f = tuning.feel;
    const s = this.s;
    this.marks.addChild(petal);
    const x0 = petal.x;
    const y0 = petal.y;
    const r0 = petal.rotation;
    const sx = petal.scale.x;
    const sy = petal.scale.y;
    const bounce = to >= 0;
    // A bounced petal rests in the gap halfway back, clear of the bud that sprouts where the flower was.
    const x1 = bounce ? x0 - Math.cos(ang) * s * 0.8 : x0 + s * 0.08;
    const y1 = bounce ? y0 - Math.sin(ang) * s * 0.8 : y0 + s * 0.32;
    const shade = this.glowDot(Number(petal.tint), s * 0.8, this.marks);
    shade.position.set(x1, y1 + s * 0.04);
    shade.alpha = 0;
    const alive = () => !petal.destroyed && !shade.destroyed;
    void this.tw.to(bounce ? 380 : 480, (t) => {
      if (!alive()) return;
      const hop = bounce ? Math.sin(Math.PI * t) * s * 0.28 : Math.sin(t * 6) * s * 0.06 * (1 - t);
      petal.position.set(x0 + (x1 - x0) * t + (bounce ? 0 : hop), y0 + (y1 - y0) * t - (bounce ? hop : 0));
      petal.rotation = r0 + (bounce ? 2.4 : 0.9) * t;
      petal.scale.set(sx * (1 + 0.15 * t), sy * (1 + 0.15 * t));
      shade.alpha = 0.35 * t;
    }, { ease: ease.outCubic })
      .then(() => {
        // A faint ring where it comes to rest draws the eye without a sound or a word.
        if (alive()) this.ripple(x1, y1, Number(petal.tint), 0.3);
        return this.tw.wait(f.stopMarkMs);
      })
      .then(() => this.tw.to(f.stopMarkFadeMs, (t) => {
        if (!alive()) return;
        petal.alpha = 1 - t;
        shade.alpha = 0.35 * (1 - t);
      }))
      .then(() => {
        if (!petal.destroyed) petal.destroy();
        if (!shade.destroyed) shade.destroy();
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
    this.litDim = false;
    const jobs = sprouts.map(({ cell, bud }, j) => {
      const v = this.buds[cell];
      const delay = j * 35;
      const halo = v.bloomHalo;
      v.bloomHalo = null;
      // The sprout's own fade takes over this halo from here.
      this.halos = this.halos.filter((h) => h.halo !== halo);
      const h0 = halo?.alpha ?? 0;
      const fs = v.flower.scale.x;
      const fade = this.tw.to(320, (t) => {
        v.flower.alpha = 1 - t;
        v.flower.scale.set(fs * (1 - 0.35 * t));
        if (halo && !halo.destroyed) halo.alpha = h0 * (1 - t);
      }, { delay }).then(() => halo?.destroy());
      return this.tw.wait(delay + 140).then(() => {
        v.isOpen = false;
        v.setBud(bud);
        v.budC.visible = true;
        v.arrowsG.visible = true;
        v.arrowsG.alpha = 0;
        v.anim = 'grow';
        v.budC.scale.set(0);
        this.dust(v.x, v.y);
        return Promise.all([fade, this.tw.to(f.sproutMs, (t) => v.budC.scale.set(t * v.jitterScale), { ease: ease.outBack })]);
      }).then(() => {
        v.flower.visible = false;
        v.anim = '';
      });
    });
    await Promise.all(jobs);
  }

  private dust(x: number, y: number): void {
    const n = this.spawnOk(4);
    for (let i = 0; i < n; i++) {
      const d = this.glowDot(0xd8e0c8, 6);
      const a = -Math.PI / 2 + (i - 1.5) * 0.6;
      void this.tw.to(600, (t) => {
        d.position.set(x + Math.cos(a) * this.s * 0.4 * t, y + this.s * 0.1 + Math.sin(a) * this.s * 0.25 * t);
        d.alpha = 0.5 * (1 - t);
      }).then(() => d.destroy());
    }
  }

  /** Title moment: the board sprouts cell by cell, centre outward. */
  sproutIn(delayMs = 0): void {
    const order = this.buds.map((_, i) => i).sort((a, b) => Math.hypot(this.buds[a].x, this.buds[a].y) - Math.hypot(this.buds[b].x, this.buds[b].y));
    order.forEach((i, j) => {
      const v = this.buds[i];
      v.anim = 'grow';
      v.budC.scale.set(0);
      void this.tw.to(tuning.feel.sproutMs, (t) => v.budC.scale.set(t * v.jitterScale), { delay: delayMs + 200 + j * 12, ease: ease.outBack }).then(() => (v.anim = ''));
    });
  }
}
