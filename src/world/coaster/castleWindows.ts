import { type Object3D, Raycaster, Vector3 } from 'three';
import {
  CASTLE_INNER_X,
  CASTLE_INNER_Z,
  CASTLE_OUTER_X,
  CASTLE_OUTER_Z,
  CASTLE_WALL_HEIGHT,
  CROSSING_MAX_Y,
  CROSSING_MIN_Y,
  TOWER_CENTRES,
  TOWER_KEEPOUT_RADIUS,
  TOWER_MASONRY_MARGIN,
  WINDOW_ABOVE_TRACK,
  WINDOW_BELOW_TRACK,
  WINDOW_HALF_WIDTH,
  WINDOW_TRACK_Y,
  toCastleLocal,
} from '../building/cruiserWindow';
import { BUILDING_BASE_Y } from '../building/layout';
import { CART_ENVELOPE } from './cart';
import { COASTER_PLANS } from './plan';
import type { CoasterRoute } from './route';

/** Tower body plus its conical roof — `Shell.ts`'s 10.6 + 4.2. */
const TOWER_FULL_HEIGHT = 14.8;
/** `Shell.ts`'s `CASTLE_MERLON_HEIGHT`: the battlement above the wall top. */
const MERLON_HEIGHT = 1.05;
/** How finely the car's envelope is walked through the castle. */
const ENVELOPE_STEP = 0.1;
/** Hop length for the swept ray test. Short enough that nothing is stepped over. */
const RAY_STEP = 0.2;

/**
 * **The holes the Sky Cruiser makes in the castle** — measured off the solved
 * loop, never chosen (issue #113).
 *
 * Nothing here decides where a window goes. The loop is solved first, against a
 * castle described as real masonry with the middle of each side wall passable
 * (`building/cruiserWindow.ts`); then this walks the **built curve** through the
 * two wall slabs and reports the opening that the car actually needs. `Shell.ts`
 * cuts exactly that and frames it in stone.
 *
 * Doing it this way round is the whole point. A hole placed at one set of
 * numbers and a route steered by a second set is the failure that produced both
 * the invisible hood face (CLAUDE.md) and the ginormous slide's twelve
 * hand-authored coordinates that ended up inside the castle (#118): two
 * formulas obliged to agree, and nothing checking that they did. Here there is
 * one formula, and the wall is downstream of it.
 *
 * **A park with no windows is a correct park.** On a seed whose loop goes round
 * the castle instead of through it, this is empty, `Shell.ts` builds the two
 * plain wall bands it always did, and the castle is unbroken. Every consumer has
 * to cope with that rather than assume a window exists.
 */

/** Which side wall an opening is cut in. The door faces +Z, so ±X are sides. */
export type SideWall = 'east' | 'west';

/** One opening, in castle-local metres. */
export interface WallOpening {
  readonly wall: SideWall;
  readonly minZ: number;
  readonly maxZ: number;
  /** Where the centre line itself passed through, for the boot assert. */
  readonly trackZ: number;
  readonly trackY: number;
}

/**
 * Sill and head, castle-local.
 *
 * Shared by both openings rather than measured per wall, because the profile
 * through the castle is carved dead level: every control point in the span is
 * pinned to the same *absolute* height, and a Catmull-Rom spline through points
 * of equal height is flat between them. Both holes therefore sit at the same
 * height by construction, which is what lets `Shell.ts` cut them as one band of
 * wall rather than two independently-placed slots — and what makes the pass
 * read as architecture rather than as damage. The boot assert measures the
 * built curve against these rather than trusting the paragraph above.
 */
export const WINDOW_SILL_Y = WINDOW_TRACK_Y - WINDOW_BELOW_TRACK;
export const WINDOW_HEAD_Y = WINDOW_TRACK_Y + WINDOW_ABOVE_TRACK;

/** How finely the built curve is walked through a 0.45 m wall slab. */
const SLAB_STEP = 0.05;

/**
 * The openings a route needs, or none if it never enters a side wall.
 *
 * The z extent is the union of the car's full half-width over every sample
 * inside the slab, which is deliberately conservative: the car's beam is
 * perpendicular to *travel*, so an oblique crossing projects **less** than a
 * half-width onto the wall, never more. Taking the half-width flat means the
 * hole cannot come out too small because someone forgot a cosine.
 */
export function openingsFor(route: CoasterRoute): WallOpening[] {
  if (!route.castleSpan) return [];
  const point = new Vector3();
  const { from, to } = route.castleSpan;
  const openings: WallOpening[] = [];

  // One opening per **crossing**, found by contiguity, not one per wall.
  //
  // Keying by wall was the first attempt and three of the five CI seeds caught
  // it: a loop is perfectly entitled to duck into the courtyard and come back
  // out of the side it came in, and merging those two crossings into a single
  // opening produced one enormous slot spanning the gap between them — a
  // missing wall rather than a window. Each pass through the 0.45 m slab is its
  // own hole, and `segmentsMinusGaps` is happy to leave two gaps in one run.
  let run: { wall: SideWall; minZ: number; maxZ: number; sumZ: number; sumY: number; n: number } | null = null;
  const close = (): void => {
    if (!run) return;
    openings.push({
      wall: run.wall,
      minZ: run.minZ - WINDOW_HALF_WIDTH,
      maxZ: run.maxZ + WINDOW_HALF_WIDTH,
      trackZ: run.sumZ / run.n,
      trackY: run.sumY / run.n,
    });
    run = null;
  };

  for (let d = from; d <= to; d += SLAB_STEP) {
    route.pointAt(d, point);
    const { lx, lz } = toCastleLocal(point.x, point.z);
    const depth = Math.abs(lx);
    if (depth < CASTLE_INNER_X || depth > CASTLE_OUTER_X) {
      close();
      continue;
    }
    const wall: SideWall = lx > 0 ? 'east' : 'west';
    const ly = point.y - BUILDING_BASE_Y;
    if (run && run.wall !== wall) close();
    if (!run) {
      run = { wall, minZ: lz, maxZ: lz, sumZ: lz, sumY: ly, n: 1 };
      continue;
    }
    run.minZ = Math.min(run.minZ, lz);
    run.maxZ = Math.max(run.maxZ, lz);
    run.sumZ += lz;
    run.sumY += ly;
    run.n += 1;
  }
  close();

  return openings;
}

/**
 * The park's own openings, solved at module load along with everything else.
 *
 * `Shell.ts` reads this when it builds the curtain wall. The import direction
 * matters: the castle depends on the coaster, never the reverse, because the
 * hole is a consequence of the route.
 */
export const CASTLE_WINDOWS: readonly WallOpening[] = openingsFor(COASTER_PLANS.cruiser.route);

/**
 * **What the car actually hits**, cast against the scene that was built.
 *
 * `checkCastleWindows` below reasons about the castle from numbers; this asks
 * the meshes. Four rays — one per corner of the car's envelope — are swept
 * along the pass in short hops and fired at *everything under `castleRoot`*,
 * whatever that turns out to contain. Nothing here names a wall, a tower or a
 * slide, so a fixture added to the castle next month is covered on the day it
 * appears rather than on the day somebody remembers to extend a list.
 *
 * It is the difference between an assert that stays true and one that rots, and
 * it is deliberately the *second* of the two checks: the arithmetic one gives a
 * readable diagnosis ("the window leaves 0.3 m of wall by the tower"), this one
 * gives the truth ("you are inside `tower-bodies` at 41.2 m along").
 */
export function sweptCartHits(route: CoasterRoute, castleRoot: Object3D): string[] {
  if (!route.castleSpan) return [];

  // **Raycasting reads `matrixWorld`, and nothing has computed one yet.**
  //
  // three.js refreshes world matrices during `render`, and a headless park
  // never renders — so every mesh here still sat at the identity, the rays
  // passed through a castle that was nowhere near the coaster, and this
  // reported a clean sweep no matter what was wrong. Found by building the
  // wall deliberately solid while still declaring the openings: the arithmetic
  // assert caught it and this one said "clear of every mesh in the castle".
  // An assert nobody has watched fail is a decoration.
  //
  // Updated from the topmost ancestor rather than from `castleRoot`, because
  // `updateMatrixWorld` composes with the parent's matrix and would otherwise
  // faithfully compose with a stale one.
  let root: Object3D = castleRoot;
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);

  const caster = new Raycaster();
  const point = new Vector3();
  const tangent = new Vector3();
  const previous = new Map<string, Vector3>();
  const direction = new Vector3();
  const hits: string[] = [];
  const { from, to } = route.castleSpan;

  for (let d = from; d <= to; d += RAY_STEP) {
    route.pointAt(d, point);
    route.tangentAt(d, tangent);
    const flat = Math.hypot(tangent.x, tangent.z) || 1;
    const sideX = -tangent.z / flat;
    const sideZ = tangent.x / flat;
    for (const lateral of [-CART_ENVELOPE.halfWidth, CART_ENVELOPE.halfWidth]) {
      for (const rise of [-CART_ENVELOPE.below, CART_ENVELOPE.above]) {
        const key = `${lateral},${rise}`;
        const here = new Vector3(
          point.x + sideX * lateral,
          point.y + rise,
          point.z + sideZ * lateral,
        );
        const before = previous.get(key);
        previous.set(key, here);
        if (!before) continue;
        direction.subVectors(here, before);
        const span = direction.length();
        if (span < 1e-6) continue;
        caster.set(before, direction.normalize());
        caster.near = 0;
        caster.far = span;
        const struck = caster.intersectObject(castleRoot, true);
        const first = struck[0];
        if (first) {
          hits.push(
            `the car's ${rise > 0 ? 'roofline' : 'underside'} strikes ` +
              `'${first.object.name || first.object.type}' at ${d.toFixed(1)} m along the loop, ` +
              `world (${first.point.x.toFixed(2)}, ${first.point.y.toFixed(2)}, ${first.point.z.toFixed(2)})`,
          );
        }
      }
    }
    // One complaint per fault, not one per centimetre of it.
    if (hits.length >= 6) break;
  }
  return hits;
}

/**
 * Is castle-local (lx, ly, lz) inside solid castle masonry, given the holes
 * that were cut in it?
 *
 * Deliberately **more** solid than the castle really is, everywhere the
 * difference could hide a fault: the crenellations are treated as a continuous
 * band rather than merlons with gaps, and a tower as a full-height cylinder at
 * its widest rather than a cone that tapers. An assert that errs towards "that
 * is stone" fails loudly on a near miss; one that errs the other way is how a
 * cart ends up inside a battlement with a green build.
 */
export function castleSolidAt(
  lx: number,
  ly: number,
  lz: number,
  openings: readonly WallOpening[],
): boolean {
  if (ly < 0) return true; // the courtyard pavement and the plinth under it
  for (const [tx, tz] of TOWER_CENTRES) {
    if (Math.hypot(lx - tx, lz - tz) <= TOWER_KEEPOUT_RADIUS && ly <= TOWER_FULL_HEIGHT) {
      return true;
    }
  }
  if (ly > CASTLE_WALL_HEIGHT + MERLON_HEIGHT) return false;

  const inNorth = Math.abs(lx) <= CASTLE_OUTER_X && lz >= -CASTLE_OUTER_Z && lz <= -CASTLE_INNER_Z;
  const inSouth = Math.abs(lx) <= CASTLE_OUTER_X && lz >= CASTLE_INNER_Z && lz <= CASTLE_OUTER_Z;
  if (inNorth || inSouth) return true;

  const depth = Math.abs(lx);
  const inSide = depth >= CASTLE_INNER_X && depth <= CASTLE_OUTER_X && Math.abs(lz) <= CASTLE_INNER_Z;
  if (!inSide) return false;

  // Inside a side wall run: solid unless this is one of the holes, and a hole
  // stops being a hole above the wall top, where the battlement carries on.
  if (ly > CASTLE_WALL_HEIGHT) return true;
  const wall: SideWall = lx > 0 ? 'east' : 'west';
  for (const opening of openings) {
    if (opening.wall !== wall) continue;
    if (lz >= opening.minZ && lz <= opening.maxZ && ly >= WINDOW_SILL_Y && ly <= WINDOW_HEAD_Y) {
      return false;
    }
  }
  return true;
}

/**
 * **Boot assert for the castle pass** (issue #113's three, plus the two that
 * turned out to matter as much).
 *
 * Reports; the caller decides. Never adjusts — the same contract as
 * `checkCoasterClearances`, which this sits beside.
 *
 * The one that does the real work is the last: it walks the **built curve**
 * through the castle carrying the car's actual envelope, corner by corner, and
 * asks the **built wall** whether each corner is inside stone. Not the plan, not
 * the generator's corridor, not a rule about where the window was supposed to
 * go. That is the check that would have caught #113 in the first place, and it
 * is the reason the other four can afford to be simple.
 */
export function checkCastleWindows(
  route: CoasterRoute,
  openings: readonly WallOpening[],
): string[] {
  const complaints: string[] = [];

  if (!route.castleSpan) {
    if (openings.length > 0) {
      complaints.push(
        `${openings.length} castle opening(s) cut but the loop never enters the castle`,
      );
    }
    return complaints;
  }

  // Every way in is also a way out, so the count is even and never zero. An
  // odd count means a crossing was missed, which is the dangerous direction:
  // a wall crossed with no hole cut in it.
  if (openings.length === 0 || openings.length % 2 !== 0) {
    complaints.push(
      `the loop enters the castle but cut ${openings.length} opening(s) — every way in ` +
        `is a way out, so this should be even and at least 2`,
    );
  }

  // The opening's *height* is the same for every window in the park — sill and
  // head are constants, and the run through the castle is pinned level — so it
  // is asked once, here. It used to sit inside the per-opening loop below, where
  // it could do nothing but repeat itself and report the same constant fault
  // once per hole.
  if (WINDOW_SILL_Y <= 0 || WINDOW_HEAD_Y >= CASTLE_WALL_HEIGHT) {
    complaints.push(
      `the castle windows span ${WINDOW_SILL_Y.toFixed(2)}-${WINDOW_HEAD_Y.toFixed(2)} m of an ` +
        `${CASTLE_WALL_HEIGHT} m wall — they break the courtyard floor or the battlement`,
    );
  }
  // And the height the loop is carved to must sit in the band that leaves a sill
  // above the courtyard floor and a lintel under the wall top. `CROSSING_MIN_Y`
  // and `CROSSING_MAX_Y` described that band but nothing consumed them, so
  // retuning `WINDOW_TRACK_Y` through the battlements would have been caught
  // only by the ray sweep, and only once it was bad enough to hit stone.
  if (WINDOW_TRACK_Y < CROSSING_MIN_Y || WINDOW_TRACK_Y > CROSSING_MAX_Y) {
    complaints.push(
      `the level run through the castle is authored at ${WINDOW_TRACK_Y} m, outside the ` +
        `${CROSSING_MIN_Y.toFixed(2)}-${CROSSING_MAX_Y.toFixed(2)} m band a crossing can sit in ` +
        `and still leave masonry above and below it`,
    );
  }

  for (const opening of openings) {
    const width = opening.maxZ - opening.minZ;

    // 1. Fully within a single wall panel: inside the run's own z extent.
    const edge = Math.max(Math.abs(opening.minZ), Math.abs(opening.maxZ));
    if (edge > CASTLE_INNER_Z) {
      complaints.push(
        `the ${opening.wall} window reaches z ${edge.toFixed(2)} m, past the end of its wall ` +
          `panel at ${CASTLE_INNER_Z.toFixed(2)} m — it is not within one panel`,
      );
    }

    // 2. Well clear of the towers. The tower is a cylinder centred on the
    //    wall's outer corner, so it eats the last `TOWER_KEEPOUT_RADIUS - 0.4`
    //    of the panel; what has to survive is masonry beyond that.
    const towerReach = CASTLE_OUTER_Z - (TOWER_KEEPOUT_RADIUS - 0.4);
    const masonry = towerReach - edge;
    if (masonry < TOWER_MASONRY_MARGIN) {
      complaints.push(
        `the ${opening.wall} window leaves only ${masonry.toFixed(2)} m of wall between its edge ` +
          `and the corner tower — ${TOWER_MASONRY_MARGIN} m is the least that reads as a window ` +
          `in a wall rather than a bite out of a turret`,
      );
    }

    // 3. Wide enough for the thing it was cut for, before any sweep is measured.
    if (width < CART_ENVELOPE.halfWidth * 2) {
      complaints.push(
        `the ${opening.wall} window is ${width.toFixed(2)} m wide and the car is ` +
          `${(CART_ENVELOPE.halfWidth * 2).toFixed(2)} m across — it does not fit through it`,
      );
    }
  }

  // 4. The level run really is level, because both openings assume it is: they
  //    share one sill and one head. A profile that sloped through the castle
  //    would put one hole in the right place and the other anywhere.
  const drift = openings.reduce(
    (worst, o) => Math.max(worst, Math.abs(o.trackY - WINDOW_TRACK_Y)),
    0,
  );
  if (drift > 0.05) {
    complaints.push(
      `the track through the castle is ${drift.toFixed(2)} m off the ${WINDOW_TRACK_Y} m it was ` +
        `carved to, so the two openings do not share a height`,
    );
  }

  // 5. The car itself, against the wall that was built. Every corner of the
  //    envelope, every 10 cm of the pass.
  const point = new Vector3();
  const tangent = new Vector3();
  let worstInside: { d: number; lx: number; ly: number; lz: number } | null = null;
  const { from, to } = route.castleSpan;
  for (let d = from; d <= to; d += ENVELOPE_STEP) {
    route.pointAt(d, point);
    route.tangentAt(d, tangent);
    const flat = Math.hypot(tangent.x, tangent.z) || 1;
    // The car's beam is square to travel, in the horizontal plane.
    const sideX = -tangent.z / flat;
    const sideZ = tangent.x / flat;
    for (const lateral of [-CART_ENVELOPE.halfWidth, CART_ENVELOPE.halfWidth]) {
      for (const rise of [-CART_ENVELOPE.below, CART_ENVELOPE.above]) {
        const { lx, lz } = toCastleLocal(point.x + sideX * lateral, point.z + sideZ * lateral);
        const ly = point.y + rise - BUILDING_BASE_Y;
        if (castleSolidAt(lx, ly, lz, openings)) {
          worstInside ??= { d, lx, ly, lz };
        }
      }
    }
  }
  if (worstInside) {
    complaints.push(
      `the car is inside castle masonry at ${worstInside.d.toFixed(1)} m along, castle-local ` +
        `(${worstInside.lx.toFixed(2)}, ${worstInside.ly.toFixed(2)}, ${worstInside.lz.toFixed(2)})`,
    );
  }

  return complaints;
}
