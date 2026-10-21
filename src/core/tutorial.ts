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
  /** Judge one tap. `buds` is the garden before the tap. */
  judge: (result: TapResult, buds: readonly Bud[]) => LessonFeedback;
}

const fill = (board: Board, petals: number, arrows: number[]): Bud[] => board.q.map(() => ({ petals, arrows: [...arrows] }));

/**
 * Four tiny hand-made gardens that teach by doing: a bud fills to 4 and blooms, a bloom follows its
 * arrows, a full neighbor blooms too, and finding the tap whose arrows feed other full buds.
 */
export function tutorialLessons(): Lesson[] {
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
    say: 'Tap the circled bud to water it. Each tap adds one petal.',
    judge: (r) => {
      if (r.bloomed.length > 0) return { outcome: 'pass', say: 'Four petals: it blooms!' };
      const n = r.petals[r.tapped];
      return { outcome: 'continue', say: `${n} of 4 petals. ${n === 3 ? 'One more and it blooms.' : 'Keep tapping.'}` };
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
    say: 'A glowing bud has 3 petals, one tap from blooming. Its arrows show where its petals will fly. Tap it.',
    judge: (r) =>
      r.bloomed.length > 0
        ? { outcome: 'pass', say: 'Each arrow carried a petal to a neighbor.' }
        : { outcome: 'continue', say: 'That bud got a petal. Now tap the glowing one in the middle.' },
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
    say: 'When a petal lands on a glowing bud, that bud blooms too. Tap the circled bud and watch.',
    judge: (r) => {
      if (r.bloomed.length >= 3) return { outcome: 'pass', say: `A chain of ${r.bloomed.length}! Every bloom plays the next note.` };
      if (r.bloomed.length > 0) return { outcome: 'retry', say: `Only ${r.bloomed.length}. Start from the circled bud so its arrow hits the next one.` };
      return { outcome: 'continue', say: 'Tap the circled bud: its arrow points at a glowing neighbor.' };
    },
  };

  const mid = makeBoard(2);
  const at2 = (q: number, r: number) => cellIndex(mid, q, r);
  const good = at2(-1, 0);
  const bad = at2(0, 2);
  const chooseLesson: Lesson = {
    board: mid,
    start: () => {
      const rng = new Rng(2024);
      const b = generateGarden(mid, { petalWeightsGentle: [0.3, 0.45, 0.25, 0], petalWeightsWild: [0.3, 0.45, 0.25, 0], alignGentle: 0, alignWild: 0 }, 0, rng);
      b[good] = { petals: 3, arrows: [0, 1, 5] };
      b[at2(0, 0)] = { petals: 3, arrows: [0, 1, 5] };
      b[at2(0, -1)] = { petals: 3, arrows: [0, 1, 5] };
      b[at2(1, 0)] = { petals: 3, arrows: [0, 1, 2] };
      b[at2(1, -1)] = { petals: 2, arrows: [0, 2, 3] };
      b[bad] = { petals: 3, arrows: [1, 2, 3] };
      b[at2(0, 1)].petals = 1;
      b[at2(1, 1)].petals = 0;
      b[at2(-1, 2)].petals = 1;
      return b;
    },
    hint: [],
    say: 'Glowing buds need just one more petal. Follow the arrows and find a tap that blooms 4 or more.',
    judge: (r) => {
      const n = r.bloomed.length;
      if (n >= 4) return { outcome: 'pass', say: `${n} blooms! Its arrows pointed into glowing buds. That is the whole game.` };
      if (n > 0) return { outcome: 'retry', say: `Only ${n}. Look for a glowing bud whose arrows point at other glowing buds.` };
      return { outcome: 'continue', say: 'That bud just got a petal. Tap one of the glowing buds.' };
    },
  };

  return [fillLesson, arrowLesson, chainLesson, chooseLesson];
}

