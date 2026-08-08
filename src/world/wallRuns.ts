/**
 * The one owner of "a run of wall, minus its doorways, whose corners close".
 *
 * Two buildings build interior walls out of straight runs: the castle
 * (`building/Shell.ts`, extruded plan rectangles) and the hotel
 * (`hotel/Hotel.ts`, one box per solid span). Both need the same two pieces of
 * arithmetic, and until 8 August 2026 they each had their own — with different
 * answers to the question that matters at every corner: *where does a run
 * end?*
 *
 * The castle answered "at the outer face of the perpendicular wall"
 * (`planRect(-ox, ox, …)` spans the full outer width), so its corners are
 * solid masonry. The hotel answered "at the room's half-extent" — the
 * perpendicular wall's **centre line** — so at every outer corner the two
 * walls each stopped half a thickness short of each other and left an empty
 * see-through column, half a wall square, top to bottom. Jim, live play:
 * *"the walls don't abut each other properly, they stop leaving gaps."*
 * `check:hotel` probe 15 measures exactly that column on the built rooms.
 *
 * So the rule lives here, once:
 *
 *  - {@link segmentsMinusGaps} turns one run plus its doorways into solid
 *    spans (moved here from `building/parts.ts`, unchanged — the castle was
 *    the one already doing this right).
 *  - {@link cornerClosedSpans} stretches the spans that reach the run's own
 *    ends past them by the perpendicular wall's half-thickness, closing the
 *    corner the way the castle's full-width faces do. Spans that stop at a
 *    doorway jamb are left exactly on the jamb.
 *
 * Exactly **one** of the two walls meeting at a corner may be corner-closed
 * (the castle extends north/south and butts east/west between them; the hotel
 * does the same), because both extending would stack two boxes in the corner
 * column and z-fight on their coplanar outer faces.
 */

/** Plan spans that make up one wall run, minus any doorways in it. */
export function segmentsMinusGaps(
  from: number,
  to: number,
  gaps: readonly (readonly [number, number])[],
): [number, number][] {
  let spans: [number, number][] = [[from, to]];
  for (const [gapStart, gapEnd] of gaps) {
    const next: [number, number][] = [];
    for (const [start, end] of spans) {
      if (gapEnd <= start || gapStart >= end) {
        next.push([start, end]);
        continue;
      }
      if (gapStart > start) next.push([start, gapStart]);
      if (gapEnd < end) next.push([gapEnd, end]);
    }
    spans = next;
  }
  return spans;
}

/** A span end within this of the run's own end counts as a corner, not a jamb. */
const CORNER_EPSILON = 1e-6;

/**
 * Closes the corners of a span run: any span end that lies at the run's own
 * end (`from` / `to`) is stretched `by` metres past it, so the box built from
 * it covers the perpendicular wall's thickness and the corner has no
 * see-through notch. Ends that stop at a doorway jamb are untouched.
 *
 * Give this the **drawn** wall only. Collision walls and window glazing keep
 * the logical spans: a collider need not reach outside the room, and a pane
 * slid into the corner column would glaze the inside of a pillar.
 */
export function cornerClosedSpans(
  spans: readonly (readonly [number, number])[],
  from: number,
  to: number,
  by: number,
): [number, number][] {
  return spans.map(([a, b]) => [
    a <= from + CORNER_EPSILON ? a - by : a,
    b >= to - CORNER_EPSILON ? b + by : b,
  ]);
}
