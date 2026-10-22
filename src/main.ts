import { resolveTap } from './core/rules';
import { Application, Container } from 'pixi.js';
import { Synth } from './audio/synth';
import { bestSingleTap } from './core/solver';
import { Game } from './game';
import { gearSpot, Hud } from './hud';
import './style.css';
import { tuning } from './tuning';
import { GardenView, REDUCED_MOTION } from './view/garden';
import { Scene } from './view/scene';
import { Tweener } from './view/tween';

const TOP_HUD = 84;
const BOTTOM_HUD = 70;
/** Board while a sheet is open (GDD §7): dimmed and shrunk over 300 ms. */
const SHEET_ALPHA = 0.4;
const SHEET_SCALE = 0.94;
const DIM_MS = 300;

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.body.prepend(app.canvas);

  const tw = new Tweener();
  const scene = new Scene();
  const overlay = new Container();
  const garden = new GardenView(tw, overlay);
  // Sheets dim and shrink the board and its light overlay as one, so each rides in a wrapper.
  const boardLayer = new Container();
  const overlayLayer = new Container();
  boardLayer.addChild(garden);
  overlayLayer.addChild(overlay);
  app.stage.addChild(scene.back, boardLayer, scene.front, overlayLayer);

  const hud = new Hud();
  let sheetOpen = false;
  let dim = 0;
  let appliedDim = 0;
  hud.onSheet = (open) => (sheetOpen = open);
  const synth = new Synth();

  const relayout = () => {
    const w = app.screen.width;
    const h = app.screen.height;
    if (garden.board) {
      // Portrait: the bed's bottom edge sits at `scene.bedBottomPortrait` of the height, so a board
      // that is narrower than its box slides down to it. Landscape: between the top bar and bottom bar.
      const portraitScreen = h > w;
      const bottom = portraitScreen ? h * tuning.scene.bedBottomPortrait : h - BOTTOM_HUD;
      const bw = w - 24;
      const bh = bottom - TOP_HUD;
      garden.layout(12, TOP_HUD, bw, bh);
      const turned = bh > bw * 1.1;
      const rb = () => garden.centre().r + garden.s;
      const bedBottom = () => garden.centre().y + rb() * (turned ? 1 : 0.866);
      if (portraitScreen) {
        const slide = bottom - bedBottom();
        if (slide > 0.5) garden.layout(12, TOP_HUD + slide, bw, bh);
      }
      const c = garden.centre();
      hud.setBed({
        x: c.x,
        top: garden.bedTop().y,
        bottom: bedBottom(),
        s: garden.s,
        gear: portraitScreen && turned ? gearSpot(c, rb(), garden.s, w) : null,
      });
    }
    scene.resize(w, h, garden.s);
  };
  const game = new Game(garden, scene, hud, synth, tw, relayout);
  app.renderer.on('resize', relayout);

  app.ticker.add((t) => {
    const dt = Math.min(t.deltaMS, 50);
    tw.tick(dt);
    garden.tick(dt);
    scene.tick(dt);
    // Sheets: the board eases to alpha 0.4 and scale 0.94 over 300 ms about the bed's centre.
    const want = sheetOpen ? 1 : 0;
    if (dim !== want) dim = REDUCED_MOTION ? want : Math.max(0, Math.min(1, dim + Math.sign(want - dim) * (dt / DIM_MS)));
    if ((dim > 0 || appliedDim > 0) && garden.board) {
      appliedDim = dim;
      const c = dim > 0 ? garden.centre() : { x: 0, y: 0 };
      for (const layer of [boardLayer, overlayLayer]) {
        layer.pivot.set(c.x, c.y);
        layer.position.set(c.x, c.y);
        layer.alpha = 1 - (1 - SHEET_ALPHA) * dim;
        layer.scale.set(1 - (1 - SHEET_SCALE) * dim);
      }
    }
  });

  // Sound: a switch in the settings sheet, saved as `bloom.muted`.
  try {
    if (localStorage.getItem('bloom.muted') === '1') synth.setMuted(true);
  } catch {
    /* storage unavailable */
  }
  hud.setSound(!synth.muted);
  const button = (id: string, fn: () => void) =>
    document.getElementById(id)!.addEventListener('click', () => {
      synth.unlock();
      fn();
    });
  button('btn-sound', () => {
    synth.setMuted(!synth.muted);
    hud.setSound(!synth.muted);
    try {
      localStorage.setItem('bloom.muted', synth.muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  });
  button('btn-settings', () => hud.showSettings());
  button('btn-back', () => hud.closeSheets());
  button('btn-howto-back', () => hud.closeSheets());
  button('btn-help', () => hud.showHowto());
  button('btn-tutorial', () => game.startTutorial());
  button('btn-new', () => game.newRun());
  button('btn-again', () => game.newRun());
  // A tap on the dimmed board above a sheet, or Escape, goes back to the garden.
  for (const id of ['settings', 'howto']) {
    document.getElementById(id)!.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) hud.closeSheets();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hud.closeSheets();
  });
  const fullBtn = document.getElementById('btn-full')!;
  if (!document.fullscreenEnabled || matchMedia('(pointer: coarse)').matches) fullBtn.hidden = true;
  button('btn-full', () => {
    hud.closeSheets();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  let panel: { dispose(): void } | null = null;
  const togglePanel = async () => {
    if (panel) {
      panel.dispose();
      panel = null;
      return;
    }
    const { createPanel } = await import('./dev/panel');
    panel = createPanel({
      onAudio: () => synth.applyMix(),
      onNewGarden: () => game.newRun(),
      seed: () => game.run?.seed,
      onGray: (on) => document.body.classList.toggle('gray', on),
      onNight: (n) => scene.setNight(n, 0),
      lights: () => ({ count: garden.lightCount() + scene.lightCount(garden.centre()), cascade: game.busy }),
    });
  };
  if (new URLSearchParams(location.search).has('dev')) void togglePanel();
  window.addEventListener('keydown', (e) => {
    if (e.key === '`') void togglePanel();
  });

  // Read-only hook for automated play-throughs (Playwright smoke test).
  (window as unknown as Record<string, unknown>).__bloom = {
    cell: (q: number, r: number) => {
      const b = garden.board;
      for (let i = 0; i < b.size; i++) if (b.q[i] === q && b.r[i] === r) return garden.cellGlobal(i);
      return null;
    },
    state: () => ({ gardensLit: game.run?.gardensLit, lit: game.run?.litCount, lesson: (game as unknown as { lessonIdx: number }).lessonIdx, busy: game.busy, ended: game.run?.ended ?? false, drops: game.run?.drops, pollen: game.run?.pollen, longest: game.run?.longest }),
    /** Like the sim's lantern bot: the tap that lights or feeds the most unlit lanterns. */
    pickLantern: () => {
      const run = game.run!;
      const unlit = run.lanterns.filter((_, k) => !run.lit[k]);
      let pick = { cell: 0, score: -Infinity };
      for (let i = 0; i < run.board.size; i++) {
        const r = resolveTap(run.board, run.buds, i);
        const lights = unlit.filter((c) => r.bloomed.includes(c)).length;
        const fill = unlit.reduce((a, c) => a + (r.bloomed.includes(c) ? 0 : r.petals[c] - run.buds[c].petals), 0);
        const sc = lights * 100 + fill * 8 + r.bloomed.length;
        if (sc > pick.score) pick = { cell: i, score: sc };
      }
      return garden.cellGlobal(pick.cell);
    },
    pick: () => {
      const run = game.run!;
      const best = bestSingleTap(run.board, run.buds);
      return garden.cellGlobal(best.cell >= 0 ? best.cell : Math.floor(Math.random() * run.board.size));
    },
  };

  game.start();
  relayout();
}

void boot();
