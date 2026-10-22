import { generateGarden } from './generator';
import { cellIndex, makeBoard, type Board } from './hex';
import { Rng } from './rng';
import type { Bud, TapResult } from './rules';

export type LessonOutcome = 'pass' | 'retry' | 'continue';

export interface LessonFeedback {
  outcome: LessonOutcome;
  /** Coach line after the tap; on pass it stays up while the player watches the result. */
  say: string;
}

export interface Lesson {
  board: Board;
  /** Fresh copy of the starting garden (a retry restores it). */
  start: () => Bud[];
  /** Buds circled by a pulsing ring. */
  hint: number[];
  /** Coach line shown when the lesson opens. */
  say: string;
  /** Lantern cells (all dark at the start); the lesson passes when one lights. */
  lanterns?: number[];
  /** The preview of `cell` is showing (hold or hover): a new coach line, or null to say nothing. Never fails a lesson. */
  onPreview?: (cell: number) => string | null;
  /** Judge one tap. `buds` is the garden before the tap. */
  judge: (result: TapResult, buds: readonly Bud[]) => LessonFeedback;
}

const fill = (board: Board, petals: number, arrows: number[]): Bud[] => board.q.map(() => ({ petals, arrows: [...arrows] }));

/**
 * Four tiny hand-made gardens that teach by doing: a bud fills to 4 and blooms, a bloom follows its
 * arrows, a full neighbor blooms too (and a hold previews the path), and finding the tap whose
 * chain reaches the lantern. `fine` is a mouse pointer: hover instead of hold.
 */
export function tutorialLessons(fine = false): Lesson[] {
  const small = makeBoard(1);
  const at1 = (q: number, r: number) => cellIndex(small, q, r);
  const center = at1(0, 0);

  const fillLesson: Lesson = {
    board: small,
    start: () => {
      const b = fill(small, 0, [1, 3, 5]);
      b[center] = { petals: 1, arrows: [0, 2, 4] };
      return b;
    },
    hint: [center],
    say: 'Tap the circled bud.',
    judge: (r) => {
      if (r.bloomed.length > 0) return { outcome: 'pass', say: 'Four petals. It blooms!' };
      const n = r.petals[r.tapped];
      return { outcome: 'continue', say: n === 3 ? '3 of 4. One more!' : `${n} of 4.` };
    },
  };

  const arrowLesson: Lesson = {
    board: small,
    start: () => {
      const b = fill(small, 1, [1, 3, 5]);
      b[center] = { petals: 3, arrows: [0, 2, 4] };
      b[at1(1, 0)].petals = 2;
      b[at1(0, -1)].petals = 2;
      b[at1(-1, 1)].petals = 1;
      return b;
    },
    hint: [center],
    say: 'A glowing bud is ready. Tap it.',
    judge: (r) =>
      r.bloomed.length > 0
        ? { outcome: 'pass', say: 'Its petals flew along the arrows.' }
        : { outcome: 'continue', say: 'Tap the glowing one.' },
  };

  const left = at1(-1, 0);
  const chainLesson: Lesson = {
    board: small,
    start: () => {
      const b = fill(small, 1, [1, 3, 5]);
      b[left] = { petals: 3, arrows: [0, 1, 5] };
      b[center] = { petals: 3, arrows: [0, 2, 4] };
      b[at1(1, 0)] = { petals: 3, arrows: [2, 3, 4] };
      b[at1(0, -1)].petals = 0;
      b[at1(-1, 1)].petals = 0;
      return b;
    },
    hint: [left],
    say: fine ? 'Hover the circled bud.' : 'Hold the circled bud.',
    onPreview: (cell) => (cell === left ? (fine ? 'See the path. Now click it.' : 'See the path. Let go, then tap it.') : null),
    judge: (r) => {
      if (r.bloomed.length >= 3) return { outcome: 'pass', say: `A chain of ${r.bloomed.length}. Each bloom sings.` };
      if (r.bloomed.length > 0) return { outcome: 'retry', say: `Only ${r.bloomed.length}. Start from the circled bud.` };
      return { outcome: 'continue', say: 'Tap the circled bud.' };
    },
  };

  const mid = makeBoard(2);
  const at2 = (q: number, r: number) => cellIndex(mid, q, r);
  const lantern = at2(1, -1);
  const lanternLesson: Lesson = {
    board: mid,
    start: () => {
      const rng = new Rng(2024);
      const b = generateGarden(mid, { petalWeightsGentle: [0.3, 0.45, 0.25, 0], petalWeightsWild: [0.3, 0.45, 0.25, 0], alignGentle: 0, alignWild: 0 }, 0, rng);
      b[at2(-1, 0)] = { petals: 3, arrows: [0, 1, 5] };
      b[at2(0, 0)] = { petals: 3, arrows: [0, 1, 5] };
      b[at2(0, -1)] = { petals: 3, arrows: [0, 1, 5] };
      b[at2(1, 0)] = { petals: 3, arrows: [0, 1, 2] };
      // The lantern bud: one petal, so only a chain that feeds it three times lights it.
      b[lantern] = { petals: 1, arrows: [0, 2, 3] };
      b[at2(0, 2)] = { petals: 3, arrows: [1, 2, 3] };
      b[at2(0, 1)].petals = 1;
      b[at2(1, 1)].petals = 0;
      b[at2(-1, 2)].petals = 1;
      return b;
    },
    hint: [],
    lanterns: [lantern],
    say: 'Light the lantern.',
    judge: (r) => {
      if (r.bloomed.includes(lantern)) return { outcome: 'pass', say: 'Lit! Three lanterns light a garden.' };
      if (r.bloomed.length > 0) return { outcome: 'retry', say: 'Still dark. Which chain reaches the lantern?' };
      return { outcome: 'continue', say: 'Tap a glowing bud. Reach the lantern.' };
    },
  };

  return [fillLesson, arrowLesson, chainLesson, lanternLesson];
}

