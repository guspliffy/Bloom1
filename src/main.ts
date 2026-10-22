import { resolveTap } from './core/rules';
import { Application, Container } from 'pixi.js';
import { Synth } from './audio/synth';
import { bestSingleTap } from './core/solver';
import { Game } from './game';
import { Hud } from './hud';
import './style.css';
import { GardenView } from './view/garden';
import { Scene } from './view/scene';
import { Tweener } from './view/tween';

const TOP_HUD = 84;
const BOTTOM_HUD = 70;

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
  app.stage.addChild(scene.back, garden, scene.front, overlay);

  const hud = new Hud();
  const synth = new Synth();

  const relayout = () => {
    const w = app.screen.width;
    const h = app.screen.height;
    if (garden.board) {
      garden.layout(12, TOP_HUD, w - 24, h - TOP_HUD - BOTTOM_HUD);
      hud.setBedTop(garden.bedTop().y);
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
  });

  const soundBtn = document.getElementById('btn-sound')!;
  try {
    if (localStorage.getItem('bloom.muted') === '1') {
      synth.setMuted(true);
      soundBtn.classList.add('muted');
    }
  } catch {
    /* storage unavailable */
  }
  soundBtn.addEventListener('click', () => {
    synth.unlock();
    synth.setMuted(!synth.muted);
    soundBtn.classList.toggle('muted', synth.muted);
    try {
      localStorage.setItem('bloom.muted', synth.muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  });
  const button = (id: string, fn: () => void) =>
    document.getElementById(id)!.addEventListener('click', () => {
      synth.unlock();
      fn();
    });
  button('btn-help', () => hud.showHowto());
  button('btn-back', () => hud.hideHowto());
  button('btn-tutorial', () => game.startTutorial());
  button('btn-new', () => game.newRun());
  button('btn-again', () => game.newRun());
  const fullBtn = document.getElementById('btn-full')!;
  if (!document.fullscreenEnabled || matchMedia('(pointer: coarse)').matches) fullBtn.style.display = 'none';
  button('btn-full', () => {
    hud.hideHowto();
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
