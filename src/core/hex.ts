/** Axial hex coordinates, pointy-top. Direction d points at screen angle -60°·d (0 = east, 1 = north-east, ...). */
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export interface Board {
  radius: number;
  q: number[];
  r: number[];
  /** neighbors[i][d] is the cell index in direction d, or -1 off the board. */
  neighbors: number[][];
  size: number;
}

export function makeBoard(radius: number): Board {
  const q: number[] = [];
  const r: number[] = [];
  for (let rr = -radius; rr <= radius; rr++) {
    for (let qq = -radius; qq <= radius; qq++) {
      if (Math.abs(qq + rr) <= radius) {
        q.push(qq);
        r.push(rr);
      }
    }
  }
  const index = new Map<string, number>();
  q.forEach((qq, i) => index.set(`${qq},${r[i]}`, i));
  const neighbors = q.map((qq, i) => DIRS.map(([dq, dr]) => index.get(`${qq + dq},${r[i] + dr}`) ?? -1));
  return { radius, q, r, neighbors, size: q.length };
}

export function cellIndex(board: Board, q: number, r: number): number {
  for (let i = 0; i < board.size; i++) if (board.q[i] === q && board.r[i] === r) return i;
  return -1;
}

/** Pixel center of a cell for hex circumradius `s`, board centered on the origin. */
export function cellCenter(board: Board, i: number, s: number): { x: number; y: number } {
  return { x: s * Math.sqrt(3) * (board.q[i] + board.r[i] / 2), y: s * 1.5 * board.r[i] };
}

export function dirAngle(d: number): number {
  return (-Math.PI / 3) * d;
}
