import { Application, Container } from 'pixi.js';
import { Synth } from './audio/synth';
import { bestSingleTap } from './core/solver';
import { Game } from './game';
import { Hud } from './hud';
import './style.css';
import { Fireflies } from './view/fireflies';
import { GardenView } from './view/garden';
import { Tweener } from './view/tween';

const TOP_HUD = 96;
const BOTTOM_HUD = 76;

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
  const fireflies = new Fireflies();
  const garden = new GardenView(tw);
  const root = new Container();
  root.addChild(fireflies, garden);
  app.stage.addChild(root);

  const hud = new Hud();
  const synth = new Synth();

  const relayout = () => {
    const w = app.screen.width;
    const h = app.screen.height;
    fireflies.resize(w, h);
    if (garden.board) garden.layout(12, TOP_HUD, w - 24, h - TOP_HUD - BOTTOM_HUD);
  };
  const game = new Game(garden, hud, synth, tw, relayout);
  app.renderer.on('resize', relayout);

  app.ticker.add((t) => {
    const dt = Math.min(t.deltaMS, 50);
    tw.tick(dt);
    garden.tick(dt);
    fireflies.tick(dt);
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
  document.getElementById('btn-new')!.addEventListener('click', () => game.newRun());
  document.getElementById('btn-help')!.addEventListener('click', () => hud.showHowto());
  document.getElementById('btn-start')!.addEventListener('click', () => {
    synth.unlock();
    hud.hideHowto();
    hud.toast('Tip: start from a glowing bud whose arrows point at other glowing buds.', 5000);
  });
  document.getElementById('btn-tutorial')!.addEventListener('click', () => {
    synth.unlock();
    game.startTutorial();
  });
  document.getElementById('btn-again')!.addEventListener('click', () => {
    synth.unlock();
    game.newRun();
  });
  const fullBtn = document.getElementById('btn-full')!;
  if (!document.documentElement.requestFullscreen) fullBtn.style.display = 'none';
  fullBtn.addEventListener('click', () => {
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
    panel = createPanel({ onAudio: () => synth.applyMix(), onNewGarden: () => game.newRun(), seed: () => game.run?.seed });
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
    state: () => ({ lesson: (game as unknown as { lessonIdx: number }).lessonIdx, busy: game.busy, ended: game.run?.ended ?? false, drops: game.run?.drops, pollen: game.run?.pollen, longest: game.run?.longest }),
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
