import {
  ENTRANCE_GATE_HALF_WIDTH,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_WALK_DEPTH,
} from './layout';

/**
 * **Can a child walk in through the front gate?**
 *
 * The one owner of that question, asked from two places that would otherwise
 * each grow their own answer: `scripts/check-gateway.mts`, which asks it of all
 * sixteen parks in `parkSeedPool.ts`, and `test/procgen/invariants.ts`'s
 * `theWalkInFromTheGateIsWalkable`, which asks it of the canonical seed and the
 * four sweep seeds. Issue #481 was two definitions of *where the way in is*;
 * shipping its check as two definitions of *whether the way in works* would be
 * the same mistake one layer out.
 *
 * It takes a `standable` predicate rather than a `CollisionWorld` so it has no
 * three.js in it and can be handed whatever the caller has: the real park's
 * collision world in both cases today, and a deliberately-broken one when
 * somebody comes to prove this can still fail.
 *
 * ## What it measures
 *
 * A **connected route** through the arch's own opening, from
 * {@link GATE_PROBE_INSET} inside the wall to `ENTRANCE_WALK_DEPTH` inside it.
 * Deliberately not "the forecourt is empty": the park legitimately stands a
 * lamp, a bollard and the welcome sign on that ground, and measured across the
 * sixteen pool seeds every single one has something in that box. Walking in is
 * what a child does, so walking in is what is measured.
 *
 * ## Never probe the gate line itself
 *
 * The soft boundary holds a child *inside* the park, so a `PLAYER_RADIUS` body
 * standing on the gate line overlaps the outside and comes back blocked
 * whatever the gate is doing — 33 of 33 probes across it on the canonical seed.
 * A clause probing there cannot fail, which is why the walk starts a metre in.
 */
export interface GatewayWalk {
  /** True if the walk in reaches `ENTRANCE_WALK_DEPTH` inside the arch. */
  readonly open: boolean;
  /** How deep, in metres inside the arch, the walk actually gets. */
  readonly reachedDepth: number;
  /** Cells of the corridor a player-sized body fits in. */
  readonly standableCells: number;
  /** Cells probed in all. `standableCells === cells` means nothing was seen. */
  readonly cells: number;
  /**
   * The corridor drawn: `.` walkable and reached from the arch, `o` walkable
   * but cut off behind whatever is blocking, `#` no room for a child. The `o`
   * is the tell that a doorway has been *shut* rather than merely furnished.
   */
  readonly map: string[];
}

/**
 * How far in the first row of probes stands — see the header on why it is not
 * zero. One metre is the first inset at which a player-sized body is honestly
 * inside the park.
 */
export const GATE_PROBE_INSET = 1;

/** Metres between probes, along the walk and across it. */
export const GATE_PROBE_STEP = 0.5;

export function measureGatewayWalk(standable: (x: number, z: number) => boolean): GatewayWalk {
  // The walk runs inward along the gate's own radial; across it is the
  // perpendicular. Derived from the gate rather than assumed to be the x axis,
  // so this still measures the doorway if the entrance is ever moved.
  const length = Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z) || 1;
  const inX = -ENTRANCE_GATE_X / length;
  const inZ = -ENTRANCE_GATE_Z / length;
  const acrossX = -inZ;
  const acrossZ = inX;

  // The arch's own opening, not narrowed by the player's radius: `standable`
  // already asks whether a body of that radius fits, so narrowing the span as
  // well would ask her to fit twice and rule out the outermost half-metre of
  // the doorway she legitimately walks in through.
  const halfSpan = ENTRANCE_GATE_HALF_WIDTH;
  const rows = Math.floor((ENTRANCE_WALK_DEPTH - GATE_PROBE_INSET) / GATE_PROBE_STEP) + 1;
  const columns = Math.floor((2 * halfSpan) / GATE_PROBE_STEP) + 1;
  const insetAt = (row: number): number => GATE_PROBE_INSET + row * GATE_PROBE_STEP;
  const index = (row: number, column: number): number => row * columns + column;

  const cells = rows * columns;
  const cellOpen: boolean[] = [];
  let standableCells = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const inset = insetAt(row);
      const across = -halfSpan + column * GATE_PROBE_STEP;
      const ok = standable(
        ENTRANCE_GATE_X + inX * inset + acrossX * across,
        ENTRANCE_GATE_Z + inZ * inset + acrossZ * across,
      );
      cellOpen.push(ok);
      if (ok) standableCells += 1;
    }
  }

  // Flood inward from every open cell on the first row — the ground she stands
  // on the moment she is through the arch — eight-connected, because a walk
  // that has to squeeze diagonally past a lamp post is still a walk.
  const reached = new Array<boolean>(cells).fill(false);
  const stack: number[] = [];
  for (let column = 0; column < columns; column += 1) {
    if (!cellOpen[index(0, column)]) continue;
    reached[index(0, column)] = true;
    stack.push(index(0, column));
  }
  while (stack.length) {
    const cell = stack.pop() as number;
    const row = Math.floor(cell / columns);
    const column = cell % columns;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const r = row + dr;
        const c = column + dc;
        if (r < 0 || r >= rows || c < 0 || c >= columns) continue;
        const next = index(r, c);
        if (reached[next] || !cellOpen[next]) continue;
        reached[next] = true;
        stack.push(next);
      }
    }
  }

  let reachedDepth = 0;
  const map: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    let line = `  ${insetAt(row).toFixed(1).padStart(5)} m in  `;
    for (let column = 0; column < columns; column += 1) {
      const cell = index(row, column);
      if (reached[cell]) reachedDepth = Math.max(reachedDepth, insetAt(row));
      line += cellOpen[cell] ? (reached[cell] ? '.' : 'o') : '#';
    }
    map.push(line);
  }

  const open = Array.from({ length: columns }, (_, column) => reached[index(rows - 1, column)]).some(Boolean);
  return { open, reachedDepth, standableCells, cells, map };
}
