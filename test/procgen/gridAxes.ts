/**
 * **Where the park's paving runs off the grid, measured as painted ground
 * rather than as route objects.**
 *
 * One owner for the question `pathsRunOnGridAxes` asks. It lives in its own
 * module rather than inside `invariants.ts` so the measurement can be driven
 * directly from fabricated geometry — see `gridAxes.test.ts`, which proves the
 * property this module exists to give: **the verdict does not change when the
 * same painted metres are carried by different route objects.**
 *
 * ### The bug this replaced
 *
 * `pathsRunOnGridAxes` used to walk one `PathEdgeFact` at a time, merging
 * consecutive off-axis hops and flushing the run whenever a hop came back on
 * axis. Its unit was therefore the *route object*, and a route object is not
 * a thing anybody can see. Two of them routinely paint the same metres — a
 * spur arrives at a door along a lead, and a connector leaving that same door
 * retraces it — and the two carriers sample that shared ground differently,
 * so they disagreed about it.
 *
 * Measured on `feat/grid-paths` @ `b8da4593`, seed 225, at the `building`
 * door — the two edges' own drawn samples, verbatim:
 *
 * - `spur-building` arrives along the lead at off-axis fraction ~0.32, but the
 *   hop `(37.86, 12.85) -> (38.35, 12.92)` measures **0.141** — a hair under
 *   the 0.15 threshold — so its run was flushed there. That carrier called the
 *   lead two short approach runs, ~1.3 m and ~2.4 m.
 * - `connector-building-ballPit` starts at `(40.34, 13.58)`, the same door,
 *   and retraces that ground at 0.317…0.325 with no dip at all, carrying
 *   straight on to `(24.16, 3.50)`: one unbroken run of **15.89 m**.
 *
 * Same park, same metres, two verdicts. Under an earlier build of the same
 * branch the carrier past that door was `connector-building-exit-ginormousSlide`,
 * whose curve straightened 0.3 m later, and the identical diagonal was reported
 * as **16.2 m** — a failure. Whether that seed passed was decided by where
 * somebody else's route happened to stop.
 *
 * ### What is measured instead
 *
 * The input is the set of drawn centre lines; the output is a function of that
 * set alone.
 *
 * 1. Every non-backbone paved edge is walked exactly as before, collecting its
 *    maximal stretches of off-axis hops. Nothing about the hop classifier
 *    changed: same {@link OFF_AXIS_FRACTION}, same railway exemption.
 * 2. Stretches that are **the same painted ground** are then unioned, whichever
 *    edge drew them — see {@link samePaintedGround}. This is what removes the
 *    observer: a stretch and its retracing by another ribbon become one thing,
 *    and so does a stretch that carries on across a node into the next ribbon.
 * 3. A stretch's size is the **diameter** of its samples — the furthest any two
 *    points of it stand apart. For a single stretch whose ends are its extremes
 *    that is exactly the chord the old code measured, so nothing was loosened;
 *    for a merged one it is the extent of the whole piece of ground, which is
 *    the thing a person standing on it would see.
 *
 * This is a **legibility** measure (issue #269 — paths should read as an
 * approximate grid, with no pointless twists). It is not a walkability
 * measure: a child walks the same diagonal whichever route object owns it, and
 * reachability is owned by `poi.stranded` and `check:park`.
 */
import type { PathEdgeFact } from './parkFacts.ts';

export type GroundPoint = readonly [number, number];

/**
 * A hop counts as off-axis when the smaller of its x/z movement is more than
 * 15% of its own length (~8.6 degrees off a grid axis) — loose enough that
 * ordinary curve-sampling jitter on a straight run never counts, tight enough
 * that a genuinely diagonal run cannot hide inside it.
 *
 * Unchanged from the per-edge version of this check, deliberately: this
 * module changes *what is measured*, never how hard the measurement is.
 */
export const OFF_AXIS_FRACTION = 0.15;

/**
 * How nearly two stretches must run the same way to count as the same ground.
 *
 * **Chosen by measurement, not derived.** An earlier draft of this comment
 * claimed the value fell out of {@link OFF_AXIS_FRACTION}, and that claim does
 * not hold: `OFF_AXIS_FRACTION` bounds **one hop's** deviation from an axis, so
 * two ribbons sampling the *same* line can each sit up to 8.63 degrees off it
 * in opposite directions and so differ from **each other** by roughly 17.3
 * degrees. The expression below is kept because writing `asin(0.15)` ties this
 * number to something already meaningful in the file rather than adding a
 * seventh bare constant — but that is a tidiness argument, not a proof, and a
 * derivation that does not hold is exactly the kind of promise this repo keeps
 * getting caught by.
 *
 * **What justifies the value is the plateau**, swept over the sixteen-seed pool
 * against the real cached geometry, and re-run after {@link hopDistance}
 * landed rather than quoted from the version before it — a measurement of
 * superseded code is not a measurement:
 *
 * | tolerance | pieces over 16 m | longest piece |
 * |---|---|---|
 * | 0.5 - 22 deg | none | 13.69 m |
 * | 22.5 - 28 deg | seed 5 at 16.8 m | 16.83 m |
 * | 29 - 30 deg | seeds 5, 24 (the dogleg, 21.9 m) | 21.93 m |
 * | 35 - 40 deg | seeds 5, 24, 131, 267 | 21.93 m |
 *
 * So the answer is *identical* everywhere from 0.5 to 22 degrees, and the first
 * thing the measurement invents is a 16.8 m piece on seed 5, which appears
 * between 22 and 22.5. **8.627 degrees sits inside that plateau with 8.1
 * degrees of room below it and 13.4 above** — that is the whole claim, and it
 * is a claim about where the value sits rather than about where it came from.
 *
 * Note what the plateau does *not* cover: **cut-invariance held at every
 * tolerance swept, 0.5 through 40 degrees.** That property comes from asking
 * about hops rather than about ends ({@link hopDistance}), not from this
 * constant — which is how it should be, since a structural property that
 * depended on a tuning value would not be structural.
 */
const PARALLEL_COS = Math.cos(Math.asin(OFF_AXIS_FRACTION));

/** One maximal stretch of off-axis hops as a single route object drew it. */
interface CarriedStretch {
  readonly carrier: string;
  readonly halfWidth: number;
  readonly points: GroundPoint[];
}

/**
 * One piece of off-axis painted ground, and every ribbon that draws it.
 *
 * `carriers` is reported so a failure can be traced back to the routes that
 * made it, but nothing about `extent`, `from` or `to` depends on which of them
 * you ask — that is the whole point of this type.
 */
export interface OffAxisGround {
  readonly carriers: readonly string[];
  readonly extent: number;
  readonly from: GroundPoint;
  readonly to: GroundPoint;
}

const unit = (a: GroundPoint, b: GroundPoint): GroundPoint => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return length > 1e-9 ? [(b[0] - a[0]) / length, (b[1] - a[1]) / length] : [1, 0];
};

const pointToSegment = (p: GroundPoint, a: GroundPoint, b: GroundPoint): number => {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const lengthSq = vx * vx + vz * vz;
  const t =
    lengthSq > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / lengthSq)) : 0;
  return Math.hypot(a[0] + t * vx - p[0], a[1] + t * vz - p[1]);
};

/**
 * Exact distance between two drawn hops.
 *
 * **Every hop against every hop, never "the nearest point on the polyline".**
 * That shortcut looks equivalent and is not: it reports the direction of
 * whichever segment happens to hold the closest point, so cutting a stretch
 * can remove that segment from the piece being asked and hand back a
 * different direction — the answer then depends on the carving again, which
 * is the entire disease. Measured while sweeping {@link PARALLEL_COS}: with
 * the shortcut, seed 451 at 22 degrees and seed 208 at 40 gave different
 * verdicts before and after a re-cut. Hops do not move when an edge is cut,
 * so asking about hops cannot do that.
 */
const hopDistance = (
  a0: GroundPoint,
  a1: GroundPoint,
  b0: GroundPoint,
  b1: GroundPoint,
): number => {
  const d1x = a1[0] - a0[0];
  const d1z = a1[1] - a0[1];
  const d2x = b1[0] - b0[0];
  const d2z = b1[1] - b0[1];
  const denominator = d1x * d2z - d1z * d2x;
  if (Math.abs(denominator) > 1e-12) {
    const rx = b0[0] - a0[0];
    const rz = b0[1] - a0[1];
    const t = (rx * d2z - rz * d2x) / denominator;
    const u = (rx * d1z - rz * d1x) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    pointToSegment(a0, b0, b1),
    pointToSegment(a1, b0, b1),
    pointToSegment(b0, a0, a1),
    pointToSegment(b1, a0, a1),
  );
};

const parallel = (a: GroundPoint, b: GroundPoint): boolean =>
  Math.abs(a[0] * b[0] + a[1] * b[1]) >= PARALLEL_COS;

/**
 * Are these two stretches the same piece of painted ground?
 *
 * **Two ways, and both are questions about points rather than about ends.**
 * That is what makes the answer a property of the paving:
 *
 * 1. **The two share a drawn sample**, so the paving is continuous there.
 *    **No direction clause, and none is possible** — see the limitation below.
 * 2. **One is drawn along the other**: some point of one lies within reach of
 *    the other and the two run the same way there — asked hop against hop, see
 *    {@link hopDistance}. Reach is `min` of the two
 *    ribbons' own half-widths, read off the park rather than typed — at that
 *    distance the narrower ribbon's centre line is inside the wider one, so
 *    they really do cover the same paving. Running the same way is what keeps
 *    a crossing from qualifying **here, in rule 2 only**; see
 *    {@link PARALLEL_COS}.
 *
 * ### Known limitation: rule 1 welds at any angle
 *
 * This used to say "running the same way is what keeps a *crossing* from
 * qualifying" without saying which rule it was talking about, and that was
 * false of rule 1. Rule 1 has no direction test at all, so two stretches that
 * merely **share a node sample** are welded however sharply they meet.
 *
 * Driven with two 9.90 m arms meeting at a **right angle** on a shared sample,
 * this module reports them as one 14.00 m piece — the very shape the seed 24
 * dogleg fixture exists to reject, sneaking back in through the other rule.
 * `gridAxes.test.ts` pins that number so nobody discovers it by surprise.
 *
 * It happens on the real park, and it is measured rather than feared. Over
 * seventeen seeds — the sixteen of `PARK_SEED_POOL` plus seed 18, which the
 * invariant suite runs but the pool does not contain — there are **ten**
 * stretch pairs welded by rule 1 that rule 2 would have refused, at angles from
 * 17.0 to **83.6 degrees**.
 *
 * **What that costs, measured on the thing that is actually compared against
 * {@link MAX_DIAGONAL_APPROACH}:** nothing. Re-running every seed with rule 1
 * restricted to welds that *also* pass rule 2's angle test, the largest piece
 * of off-axis ground is **identical to two decimal places on every seed** — so
 * rule 1's angle-blindness contributes **0.00 m** to any verdict. The welds it
 * makes are all inside pieces that something else already bounds. (Per *pair*
 * the worst it adds is 0.44 m, on seed 225's 3.88 m arm; that inflation never
 * reaches the piece being tested.)
 *
 * The tightest any measured piece comes to the limit is **2.31 m of headroom**
 * — 13.69 m against 16, on seeds 11 and 288. So there is real room, but it is
 * a way this measurement could overstate, and it should be read as a known
 * bound rather than as a proof of correctness.
 *
 * **Why it cannot simply be fixed by requiring collinearity**, the way rule 2's
 * predecessor was: the spur into seed 225's building door turns **37 degrees**
 * between the two hops either side of a seam, so any angle test tight enough to
 * reject a 90-degree junction also tears that genuine stretch in half — and
 * tearing it in half is the carrier-dependence this whole module exists to
 * remove. Contiguity and direction are in real tension here; contiguity wins,
 * because it is the one that keeps the answer a property of the paving.
 *
 * **Neither may be asked about ends.** An earlier version asked whether the
 * stretches' *ends* met, and that is not a property of the paving: cutting a
 * stretch in half creates two new ends in its middle, which can then reach
 * something the whole stretch never offered an end to. Measured, that is not
 * hypothetical — on the canonical seed it merged a 1.84 m and a 9.60 m stretch
 * into one 9.97 m piece only *after* the re-cut, and
 * `gridAxisVerdictsIgnoreTheCarrier` went red on four of the sixteen seeds.
 *
 * Asked of points, cutting changes neither the samples nor their local
 * directions, so every pair available to the pieces was already available to
 * the whole and the components come out the same however the paving is carved
 * — which `gridAxes.test.ts` asserts over every single cut of a real lead,
 * not over a handful of carvings that happen to occur in today's pool.
 */
const samePaintedGround = (a: CarriedStretch, b: CarriedStretch): boolean => {
  // 1. The paving is literally continuous here: the two share a drawn sample.
  //    This is what a carving seam looks like, and it is why cutting a stretch
  //    can never take it apart — including a stretch curving hard enough that
  //    its own two halves point 37 degrees away from each other, which the
  //    spur into seed 225's building door does. Exact equality, deliberately:
  //    these are the *same* sample, copied, not two samples that landed near
  //    one another, so no tolerance is wanted or safe.
  for (const p of a.points) {
    for (const q of b.points) if (p[0] === q[0] && p[1] === q[1]) return true;
  }

  // 2. ...or one ribbon is drawn along the other, running the same way.
  const reach = Math.min(a.halfWidth, b.halfWidth);
  for (let i = 1; i < a.points.length; i += 1) {
    const a0 = a.points[i - 1]!;
    const a1 = a.points[i]!;
    for (let j = 1; j < b.points.length; j += 1) {
      const b0 = b.points[j - 1]!;
      const b1 = b.points[j]!;
      if (hopDistance(a0, a1, b0, b1) <= reach && parallel(unit(a0, a1), unit(b0, b1))) return true;
    }
  }
  return false;
};

/** The furthest any two of these samples stand apart, and which two they are. */
const spread = (points: readonly GroundPoint[]): { extent: number; from: GroundPoint; to: GroundPoint } => {
  let extent = 0;
  let from = points[0]!;
  let to = points[0]!;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = Math.hypot(points[j]![0] - points[i]![0], points[j]![1] - points[i]![1]);
      if (d > extent) {
        extent = d;
        from = points[i]!;
        to = points[j]!;
      }
    }
  }
  return { extent, from, to };
};

/**
 * Every continuous piece of off-axis painted ground in the park, whichever
 * route objects drew it.
 *
 * `isRailwayGeometry` is the grid rule's one measured exception, passed in
 * rather than derived here so `invariants.ts` keeps a single owner for it
 * (shared with `streetsShareLatticeLines`).
 */
export function offAxisGround(
  edges: readonly PathEdgeFact[],
  isRailwayGeometry: (a: GroundPoint, b: GroundPoint) => boolean,
): OffAxisGround[] {
  const stretches: CarriedStretch[] = [];
  for (const edge of edges) {
    // The ring is deliberately a circle, not a grid loop — see
    // `ringIsATrueCircleRoundTheStatue`.
    if (edge.backbone) continue;
    const points = edge.points;
    let open: GroundPoint[] | null = null;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1] as GroundPoint;
      const b = points[i] as GroundPoint;
      const dx = Math.abs(b[0] - a[0]);
      const dz = Math.abs(b[1] - a[1]);
      const hop = Math.hypot(dx, dz);
      const off =
        hop > 1e-6 && Math.min(dx, dz) / hop > OFF_AXIS_FRACTION && !isRailwayGeometry(a, b);
      if (off) {
        if (!open) {
          open = [a];
          stretches.push({ carrier: edge.name, halfWidth: edge.halfWidth, points: open });
        }
        open.push(b);
      } else open = null;
    }
  }

  const owner = stretches.map((_, i) => i);
  const rootOf = (i: number): number => (owner[i] === i ? i : (owner[i] = rootOf(owner[i]!)));
  for (let i = 0; i < stretches.length; i += 1) {
    for (let j = i + 1; j < stretches.length; j += 1) {
      if (rootOf(i) === rootOf(j)) continue;
      if (samePaintedGround(stretches[i]!, stretches[j]!)) owner[rootOf(i)] = rootOf(j);
    }
  }

  const grouped = new Map<number, CarriedStretch[]>();
  stretches.forEach((stretch, i) => {
    const root = rootOf(i);
    const group = grouped.get(root);
    if (group) group.push(stretch);
    else grouped.set(root, [stretch]);
  });

  const ground: OffAxisGround[] = [];
  for (const group of grouped.values()) {
    const { extent, from, to } = spread(group.flatMap((stretch) => stretch.points));
    ground.push({
      carriers: [...new Set(group.map((stretch) => stretch.carrier))].sort(),
      extent,
      from,
      to,
    });
  }
  // Deterministic order, so a violation set is comparable run to run.
  ground.sort((a, b) => b.extent - a.extent || a.carriers.join().localeCompare(b.carriers.join()));
  return ground;
}

/**
 * The same painted ground, re-cut into different route objects.
 *
 * Every edge is split in two at the middle of its longest off-axis stretch,
 * with the seam sample belonging to both halves — exactly the shape of the
 * real thing this module exists for, where a spur ends at a door and a
 * connector leaves it along the same lead. Not one metre of paving moves, so
 * {@link offAxisGround} must return the identical answer, and
 * `gridAxisVerdictsIgnoreTheCarrier` asserts it does on every seed.
 */
export function recutCarriers(
  edges: readonly PathEdgeFact[],
  isRailwayGeometry: (a: GroundPoint, b: GroundPoint) => boolean,
): PathEdgeFact[] {
  const recut: PathEdgeFact[] = [];
  for (const edge of edges) {
    let seam = -1;
    if (!edge.backbone) {
      let bestLength = 0;
      let openFrom = -1;
      const closeAt = (end: number): void => {
        if (openFrom < 0) return;
        const a = edge.points[openFrom]!;
        const b = edge.points[end]!;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length > bestLength) {
          bestLength = length;
          seam = Math.floor((openFrom + end) / 2);
        }
        openFrom = -1;
      };
      for (let i = 1; i < edge.points.length; i += 1) {
        const a = edge.points[i - 1] as GroundPoint;
        const b = edge.points[i] as GroundPoint;
        const dx = Math.abs(b[0] - a[0]);
        const dz = Math.abs(b[1] - a[1]);
        const hop = Math.hypot(dx, dz);
        const off =
          hop > 1e-6 && Math.min(dx, dz) / hop > OFF_AXIS_FRACTION && !isRailwayGeometry(a, b);
        if (off) {
          if (openFrom < 0) openFrom = i - 1;
        } else closeAt(i - 1);
      }
      closeAt(edge.points.length - 1);
    }
    if (seam <= 0 || seam >= edge.points.length - 1) {
      recut.push(edge);
      continue;
    }
    recut.push(
      { ...edge, name: `${edge.name}#a`, points: edge.points.slice(0, seam + 1) },
      { ...edge, name: `${edge.name}#b`, points: edge.points.slice(seam) },
    );
  }
  return recut;
}
