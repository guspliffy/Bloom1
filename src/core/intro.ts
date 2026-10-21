import { cellIndex, makeBoard, type Board } from './hex';
import type { Bud } from './rules';

export interface IntroGarden {
  board: Board;
  buds: Bud[];
  /** The bud that glows as the suggested first tap. */
  hint: number;
}

/** Two hand-made 7-bud gardens shown once before the first run: a single bloom, then a chain of three. */
export function introGardens(): IntroGarden[] {
  const board = makeBoard(1);
  const at = (q: number, r: number) => cellIndex(board, q, r);

  const first: Bud[] = board.q.map(() => ({ petals: 1, arrows: [0, 2, 4] }));
  first[at(0, 0)] = { petals: 3, arrows: [0, 2, 4] };
  first[at(1, 0)].petals = 2;
  first[at(-1, 1)].petals = 0;
  first[at(0, -1)].petals = 2;
  for (let i = 0; i < board.size; i++) if (i !== at(0, 0)) first[i].arrows = [1, 3, 5];

  const second: Bud[] = board.q.map(() => ({ petals: 1, arrows: [1, 3, 5] }));
  second[at(-1, 0)] = { petals: 3, arrows: [0, 1, 5] };
  second[at(0, 0)] = { petals: 3, arrows: [0, 2, 4] };
  second[at(1, 0)] = { petals: 3, arrows: [2, 3, 4] };
  second[at(0, -1)].petals = 0;
  second[at(-1, 1)].petals = 0;

  return [
    { board, buds: first, hint: at(0, 0) },
    { board, buds: second, hint: at(-1, 0) },
  ];
}
