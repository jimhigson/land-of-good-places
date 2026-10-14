/**
 * **How a page bends as it turns** — the paper half of Jim's brief for the
 * reader: *"have a page-turning effect that simulates real paper on a mesh of
 * a page"* (#717).
 *
 * Pure arithmetic over a grid, no three.js, so `test/library/pageCurl.test.ts`
 * can hold it to the things paper actually does.
 *
 * ## The model: paper bends, it does not stretch
 *
 * Each row of the page (a line of vertices from the spine to the fore-edge) is
 * treated as an **inextensible curve**: it is laid down by walking out from the
 * spine in equal steps of arc length, turning a little at each step. So however
 * hard it curls, a row is always exactly one page wide — which is the one
 * property that makes a bent plane look like paper rather than rubber. A rigid
 * rotation about the spine plus a vertex displacement would stretch it, and
 * the stretching is what reads as fake.
 *
 * The turn at distance `s` along the row is the **tangent angle**
 *
 *     φ(s) = θ(t) + b(t) · (s / W)²
 *
 * - `θ(t)` is how far the leaf has swung about the spine — 0 lying flat on the
 *   right, π lying flat on the left — eased so it lifts gently and settles
 *   gently ({@link turnAngle}).
 * - `b(t)` is the **bend**: how much further the fore-edge has gone than the
 *   spine. The `(s/W)²` puts the curvature towards the free edge — the paper
 *   by the spine is held flat by the binding, the fore-edge is free — so the
 *   page wraps round a curve whose radius shrinks towards the edge, the
 *   "cylinder-like curve whose radius changes through the turn" of the brief.
 *   `b` is positive for the first half (the edge **leads**: you lifted it by
 *   the corner and are pulling it over) and negative for the second (the edge
 *   **trails**: the page settles from the spine outwards and the fore-edge
 *   floats down last), and zero at both ends, so a page always starts and
 *   finishes perfectly flat ({@link bendAt}).
 * - The **corner lift**: rows nearer the bottom bend a little more than rows
 *   nearer the top, so the bottom fore-edge corner — the one a finger would
 *   take — comes up first and the page turns with a slight diagonal twist.
 *
 * Both halves keep `φ` within [0, π] for every row (asserted by the test), so
 * every point of a turning page is on or above the paper it is turning over:
 * it can never dip into either stack.
 *
 * Running backwards is the same function with `t` going from 1 to 0, and it
 * comes out right for free: going back, the edge leads at the start (b < 0
 * near t = 1) and trails at the end (b > 0 near t = 0).
 */

/** The bend at its largest, in radians of fore-edge lead (or lag) over the spine. */
export const CURL_BEND = 1.15;
/** How much more the bottom row bends than the middle (and the top row less). */
export const CURL_CORNER = 0.35;

/** Seconds one page takes to turn. */
export const TURN_SECONDS = 0.8;

/**
 * Smootherstep: zero velocity *and* acceleration at both ends. Exported so the
 * reader's camera pan on a tall screen eases exactly as the page it follows.
 */
export function smootherstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** How far the leaf has swung about the spine at turn progress `t` — 0 flat on the right, π flat on the left. */
export function turnAngle(t: number): number {
  return Math.PI * smootherstep(t);
}

/** The fore-edge's lead over the spine at progress `t` — see the file comment. */
export function bendAt(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return CURL_BEND * Math.sin(2 * Math.PI * x);
}

/** The grid a leaf is drawn on. Must match the `PlaneGeometry` it writes into. */
export interface LeafGrid {
  /** Segments from the spine to the fore-edge. */
  readonly columns: number;
  /** Segments from the bottom of the page to the top. */
  readonly rows: number;
  /** Page width, spine to fore-edge, metres. */
  readonly width: number;
  /** Page height, metres. */
  readonly height: number;
}

/**
 * Writes a leaf's vertex positions at turn progress `t` into `out`, in the
 * reader's book-local frame (`reader/readerAssets.ts`): x across, spine at
 * x = 0; y up the page; z out of the paper.
 *
 * `out` is laid out exactly as three's `PlaneGeometry(width, height, columns,
 * rows)` lays out its vertices — row `iy` from the **top** (iy = 0) down, column
 * `ix` from the spine (ix = 0) out — so it can be copied straight into that
 * geometry's position attribute and the plane's own UVs stay right: u runs
 * spine → fore-edge, v bottom → top.
 *
 * `zRight` and `zLeft` are the height of the paper under the leaf on each side,
 * which is where its spine edge sits at t = 0 and t = 1; between, it slides
 * from one to the other on the same easing as the swing.
 */
export function writeLeaf(t: number, grid: LeafGrid, zRight: number, zLeft: number, out: Float32Array): void {
  const { columns, rows, width, height } = grid;
  const theta = turnAngle(t);
  const bend = bendAt(t);
  const baseZ = zRight + (zLeft - zRight) * smootherstep(t);
  const step = width / columns;
  let index = 0;
  for (let iy = 0; iy <= rows; iy += 1) {
    const y = height - (iy / rows) * height;
    // 1 at the bottom row, -1 at the top — the bottom corner leads.
    const lowness = 1 - (2 * y) / height;
    const rowBend = bend * (1 + CURL_CORNER * lowness);
    let x = 0;
    let z = baseZ;
    for (let ix = 0; ix <= columns; ix += 1) {
      out[index] = x;
      out[index + 1] = y;
      out[index + 2] = z;
      index += 3;
      // Step to the next vertex along the tangent at the *middle* of the step
      // (midpoint rule), so the arc length of each step is exactly `step`.
      const sMid = (ix + 0.5) * step;
      const phi = theta + rowBend * (sMid / width) * (sMid / width);
      x += step * Math.cos(phi);
      z += step * Math.sin(phi);
    }
  }
}

/** The largest tangent angle any row reaches at `t`, and the smallest — for the test's "never into the stack". */
export function tangentRange(t: number): { min: number; max: number } {
  const theta = turnAngle(t);
  const bend = bendAt(t);
  const ends = [bend * (1 + CURL_CORNER), bend * (1 - CURL_CORNER), 0];
  return { min: theta + Math.min(...ends), max: theta + Math.max(...ends) };
}
