/**
 * **The park map tells the truth about the park.** GitHub issues #234 and #334.
 *
 * ```
 * npm run check:park-map
 * npm run check:park-map -- --mutate=viewport   # prove assertion 1 can fail
 * npm run check:park-map -- --mutate=position   # prove assertion 2 can fail
 * npm run check:park-map -- --mutate=stretch    # prove assertion 3 can fail
 * ```
 *
 * #234 is the reason this exists, and it is worth stating exactly, because it
 * is the class of bug a screenshot cannot catch: `ParkMap` sized its viewport
 * to a constant that meant "the edge of the park" when the park was a circle.
 * #115 made the boundary a radius-per-bearing spline running 59.7-101.4 m, the
 * constant stayed at 66 m, and the map quietly clipped roughly 35 m off the
 * park's bulge. Everything still *looked* like a map. Nothing was red.
 *
 * So this measures the map the way the map is actually built — through
 * `outdoorParkMapProjection`, the one function `ParkMap` is allowed to get its
 * viewport from, and `parkMapFeatures`, the one list it draws — against the
 * park `buildHeadlessPark()` really generated. Three assertions:
 *
 * 1. **Nothing is clipped.** Every vertex of `PARK_BOUNDARY.outline()` lands
 *    inside the canvas, at every canvas size from a small phone to a desktop.
 * 2. **Every attraction is where the park put it** — measured, wherever it can
 *    be, against **the object that actually stands in the scene**.
 *
 *    This assertion's comment used to claim its truth positions were "derived
 *    independently" and were "deliberately not a round-trip through the same
 *    list twice". That was **false**, and PR #353's review caught it: every
 *    branch read the same module and the same field `parkMapContent.ts` had
 *    written, so the whole thing was an affine round-trip, exact by
 *    construction — which is exactly why it reported `0.0000` rather than
 *    float noise. It could not have failed, and it did not catch three rides
 *    being drawn up to 22 m from where they stand. A comment asserting the
 *    opposite of what the code does is the disease CLAUDE.md's "a check can
 *    pass without checking anything" section is about, so it is worth being
 *    plain about what each branch is worth now:
 *
 *    - **Anchors** — truth is `scene.getObjectByName('anchor:<id>')`, the real
 *      `Group` the park built, read out of the finished scene graph. This is
 *      genuine independence: `AnchorPlots` positions that group itself, so a
 *      map that picked the wrong field (the entrance rather than the centre,
 *      say — an 8.9-16.9 m error) is caught.
 *    - **The castle** — truth is the `castle-walls` group, the masonry that
 *      actually stands in the park. Deliberately **not** `anchor:building`:
 *      that is the reserved *plot*, and the castle is nudged in from it, so
 *      the two are 3.54 m apart and the plot would be the wrong answer. An
 *      earlier version of this comment lumped the castle in with the anchors
 *      while the code returned `BUILDING_CENTRE` and never touched the scene —
 *      the same over-broad claim, in miniature, caught in re-review.
 *    - **Stalls, the fountain and stations** — truth still comes from the same
 *      owner the content list read, because no separately-positioned scene
 *      object exists to ask. For these the assertion proves the *projection*
 *      round-trips and that every drawn feature has a real owner and a
 *      resolvable id; it does **not** independently prove the content list
 *      chose the right field. Stated here rather than dressed up.
 * 3. **The map is conformal.** Between every pair of features, the bearing on
 *    the map matches the bearing in the world, and the map-metres-per-world-
 *    metre ratio is the same for all pairs. That is what "relative position,
 *    scale and bearing are preserved" means as a measurement, and it catches a
 *    stretched or rotated projection, which assertions 1 and 2 both survive.
 *
 * ### Thresholds
 *
 * Taken from the game, per CLAUDE.md, never from this file's own convenience:
 *
 * - **Position**: `PLAYER_RADIUS` (0.62 m). A map that puts an attraction
 *   further than the child's own body-width from where it really is has told
 *   her something false about where to walk.
 * - **Clipping**: zero. There is no acceptable amount of park to leave off the
 *   map, so the tolerance is a pixel of float slop and nothing more.
 * - **Bearing**: 0.5°, and **scale spread**: 0.1%. Both are float-noise
 *   allowances on a transform that is exactly uniform when it is right.
 *
 * ### Proving it red
 *
 * Every assertion has a `--mutate` mode that breaks the thing it describes
 * while leaving the rest of the map correct — `viewport` reinstates the 66 m
 * square that caused #234, `position` nudges one attraction, `stretch` scales
 * one axis, and **`entrance` draws every ride at its queue rather than at the
 * ride**, which is the exact class of error the vacuous version of assertion 2
 * could not see and the scene-graph comparison now can. Each was run and each
 * goes red; the messages are in the PR.
 */

import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import { ANCHORS_BY_ID, anchorGroupName, type AnchorId } from '../src/world/anchors.ts';
import { Vector3 } from 'three';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../src/world/building/layout.ts';
import { STALL_PLACEMENTS } from '../src/minigames/stallPlacement.ts';
import { parkMapFeatures, type MapFeature } from '../src/ui/parkMapContent.ts';
import {
  frameExtent,
  outdoorParkMapProjection,
  type MapProjection,
} from '../src/ui/parkMapProjection.ts';
import { buildHeadlessPark } from './park-harness.mts';

// --------------------------------------------------------------- thresholds

/** A map may misplace nothing by more than the width of the child reading it. */
const POSITION_TOLERANCE_M = PLAYER_RADIUS;
/** Clipping allowance: float slop only. There is no acceptable amount. */
const CLIP_TOLERANCE_PX = 0.5;
const BEARING_TOLERANCE_DEG = 0.5;
const SCALE_SPREAD_TOLERANCE = 0.001;

/**
 * Canvas sizes the map is checked at.
 *
 * The map fills a card inside the overlay, so these are representative canvas
 * rectangles rather than device viewports: a small phone in portrait, a phone
 * in landscape, a tablet, and a desktop. A square and both extreme aspect
 * ratios are in here on purpose — framing bugs live at the aspect the author
 * did not try, and #234's viewport was square while the park is not.
 */
const CANVAS_SIZES: readonly (readonly [number, number, string])[] = [
  [320, 380, 'small phone portrait'],
  [700, 300, 'phone landscape'],
  [520, 520, 'square'],
  [900, 620, 'tablet'],
  [1400, 820, 'desktop'],
];

// ------------------------------------------------------------------ mutation

const mutateArg = process.argv.find((a) => a.startsWith('--mutate'));
const mutation = mutateArg ? (mutateArg.split('=')[1] ?? 'position') : null;
if (mutation && !['viewport', 'position', 'stretch', 'entrance'].includes(mutation)) {
  console.error(`Unknown --mutate=${mutation}. Use viewport, position, stretch or entrance.`);
  process.exit(2);
}

/**
 * `--mutate=viewport` reinstates exactly the bug #234 reported: a square
 * viewport of `GARDEN_HALF_SIZE + 4` = 66 m, which was right for a circular
 * park and clips the generated one.
 */
const OLD_CIRCLE_HALF_SIZE = 66;

function projectionFor(width: number, height: number): MapProjection {
  if (mutation === 'viewport') {
    return frameExtent(
      { minX: -OLD_CIRCLE_HALF_SIZE, maxX: OLD_CIRCLE_HALF_SIZE, minZ: -OLD_CIRCLE_HALF_SIZE, maxZ: OLD_CIRCLE_HALF_SIZE },
      width,
      height,
      0,
    );
  }
  const honest = outdoorParkMapProjection(width, height);
  if (mutation !== 'stretch') return honest;
  // Squash one axis by 4%: bearings shear, distances stop agreeing, and yet
  // every attraction is still comfortably on the map.
  const squash = 0.96;
  return {
    ...honest,
    toCanvas: (x, z) => [honest.originPxX + x * honest.scale, honest.originPxY + z * honest.scale * squash],
    toPlane: (px, py) => [
      (px - honest.originPxX) / honest.scale,
      (py - honest.originPxY) / (honest.scale * squash),
    ],
  };
}

// --------------------------------------------------------------- the park

const park = buildHeadlessPark();
const fountain = park.world.fountain;
const stations = park.world.train.stations.map((station) => ({
  id: `station:${station.name}`,
  x: station.standX,
  z: station.standZ,
}));

const features = (() => {
  const list = parkMapFeatures({
    stations,
    fountain: { x: fountain.centre.x, z: fountain.centre.z },
  });
  if (mutation !== 'position') return list;
  // Nudge exactly one attraction 3 m east — a plausible-looking map with one
  // ride in the wrong place, which is the failure this assertion is for.
  const victim = list.find((f) => f.kind === 'stall') ?? list[0];
  return list.map((f) => (f === victim ? { ...f, x: f.x + 3 } : f));
})();

// `--mutate=entrance`: every ride drawn at its path entrance instead of at
// itself. Applied after the list is built, so it exercises assertion 2's
// scene-graph branch specifically.
const checkedFeatures = mutation === 'entrance'
  ? features.map((f) => {
      if (f.kind !== 'anchor') return f;
      const anchor = ANCHORS_BY_ID[f.id as keyof typeof ANCHORS_BY_ID];
      return anchor ? { ...f, x: anchor.entrance[0], z: anchor.entrance[1] } : f;
    })
  : features;

/**
 * Where each feature really is, re-derived from the module that owns it rather
 * than read back out of the list under test. See assertion 2's note above:
 * this independence is the whole reason the assertion can fail.
 */
function scenePosition(name: string): readonly [number, number] | null {
  const object = park.scene.getObjectByName(name);
  if (!object) return null;
  object.updateWorldMatrix(true, false);
  const world = new Vector3();
  object.getWorldPosition(world);
  return [world.x, world.z];
}

function truePosition(feature: MapFeature): readonly [number, number] | null {
  if (feature.kind === 'castle') {
    // The masonry, not the plot — see the note on assertion 2 above.
    return scenePosition('castle-walls') ?? [BUILDING_CENTRE_X, BUILDING_CENTRE_Z];
  }
  if (feature.kind === 'anchor') {
    // The real Group `AnchorPlots` put in the scene, read out of the finished
    // scene graph — genuinely independent of the table `parkMapContent.ts`
    // read. This is the branch that can actually fail.
    const scene = scenePosition(anchorGroupName(feature.id as AnchorId));
    if (scene) return scene;
    const anchor = ANCHORS_BY_ID[feature.id as keyof typeof ANCHORS_BY_ID];
    return anchor ? anchor.position : null;
  }
  if (feature.kind === 'stall') {
    const placement = STALL_PLACEMENTS[feature.id as keyof typeof STALL_PLACEMENTS];
    return placement ? placement.position : null;
  }
  if (feature.kind === 'fountain') return [fountain.centre.x, fountain.centre.z];
  if (feature.kind === 'station') {
    const station = stations.find((s) => s.id === feature.id);
    return station ? [station.x, station.z] : null;
  }
  return null;
}

// ------------------------------------------------------------- assertions

const failures: string[] = [];
const notes: string[] = [];

// --- 1. nothing is clipped ---------------------------------------------------

const outline = PARK_BOUNDARY.outline();
let worstClipPx = 0;
let worstClipWhere = '';
for (const [width, height, name] of CANVAS_SIZES) {
  const projection = projectionFor(width, height);
  let worstHere = 0;
  for (const [wx, wz] of outline) {
    const [px, py] = projection.toCanvas(wx, wz);
    // How far outside the canvas rect this vertex fell, in pixels.
    const over = Math.max(-px, px - width, -py, py - height, 0);
    if (over > worstHere) worstHere = over;
  }
  const overMetres = worstHere / projection.scale;
  if (worstHere > worstClipPx) {
    worstClipPx = worstHere;
    worstClipWhere = `${name} ${width}x${height}`;
  }
  if (worstHere > CLIP_TOLERANCE_PX) {
    failures.push(
      `CLIPPED on ${name} (${width}x${height}): the park's outline falls up to ` +
        `${worstHere.toFixed(1)} px (${overMetres.toFixed(1)} m) outside the map canvas. ` +
        `The boundary runs ${minRadius(outline).toFixed(1)}-${PARK_BOUNDARY.maxRadius.toFixed(1)} m ` +
        `and spans x ${PARK_BOUNDARY.extent.minX.toFixed(1)}..${PARK_BOUNDARY.extent.maxX.toFixed(1)}, ` +
        `z ${PARK_BOUNDARY.extent.minZ.toFixed(1)}..${PARK_BOUNDARY.extent.maxZ.toFixed(1)} m.`,
    );
  }
}
notes.push(
  `boundary coverage: worst overshoot ${worstClipPx.toFixed(2)} px` +
    (worstClipWhere ? ` (${worstClipWhere})` : '') +
    `, across ${CANVAS_SIZES.length} canvas sizes x ${outline.length} vertices`,
);

// --- 2. every attraction is where the park put it ---------------------------

let worstPositionM = 0;
let worstPositionId = '';
for (const [width, height, name] of CANVAS_SIZES) {
  const projection = projectionFor(width, height);
  for (const feature of checkedFeatures) {
    const truth = truePosition(feature);
    if (!truth) {
      failures.push(`NO TRUTH SOURCE for map feature "${feature.id}" (${feature.kind}).`);
      continue;
    }
    const [px, py] = projection.toCanvas(feature.x, feature.z);
    const [backX, backZ] = projection.toPlane(px, py);
    const error = Math.hypot(backX - truth[0], backZ - truth[1]);
    if (error > worstPositionM) {
      worstPositionM = error;
      worstPositionId = `${feature.id} (${feature.kind}) on ${name}`;
    }
    if (error > POSITION_TOLERANCE_M) {
      failures.push(
        `MISPLACED "${feature.id}" (${feature.kind}) on ${name} ${width}x${height}: the map draws it at ` +
          `(${backX.toFixed(2)}, ${backZ.toFixed(2)}) m but the park put it at ` +
          `(${truth[0].toFixed(2)}, ${truth[1].toFixed(2)}) m — out by ${error.toFixed(2)} m, ` +
          `tolerance ${POSITION_TOLERANCE_M.toFixed(2)} m (PLAYER_RADIUS).`,
      );
    }
  }
}
notes.push(
  `position fidelity: ${checkedFeatures.length} features, worst error ${worstPositionM.toFixed(4)} m` +
    (worstPositionId ? ` (${worstPositionId})` : '') +
    `, tolerance ${POSITION_TOLERANCE_M.toFixed(2)} m`,
);

// --- 3. the map is conformal -------------------------------------------------

{
  const projection = projectionFor(900, 620);
  let worstBearingDeg = 0;
  let worstBearingPair = '';
  let minRatio = Infinity;
  let maxRatio = 0;
  for (let i = 0; i < checkedFeatures.length; i += 1) {
    for (let j = i + 1; j < checkedFeatures.length; j += 1) {
      const a = checkedFeatures[i] as MapFeature;
      const b = checkedFeatures[j] as MapFeature;
      const worldDist = Math.hypot(b.x - a.x, b.z - a.z);
      if (worldDist < 1) continue; // two things all but on top of each other
      const [ax, ay] = projection.toCanvas(a.x, a.z);
      const [bx, by] = projection.toCanvas(b.x, b.z);
      const mapDist = Math.hypot(bx - ax, by - ay);
      const ratio = mapDist / worldDist;
      if (ratio < minRatio) minRatio = ratio;
      if (ratio > maxRatio) maxRatio = ratio;

      const worldBearing = Math.atan2(b.z - a.z, b.x - a.x);
      const mapBearing = Math.atan2(by - ay, bx - ax);
      let diff = Math.abs(worldBearing - mapBearing) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      const diffDeg = (diff * 180) / Math.PI;
      if (diffDeg > worstBearingDeg) {
        worstBearingDeg = diffDeg;
        worstBearingPair = `${a.id} -> ${b.id}`;
      }
    }
  }
  const spread = maxRatio > 0 ? (maxRatio - minRatio) / maxRatio : 0;
  if (worstBearingDeg > BEARING_TOLERANCE_DEG) {
    failures.push(
      `BEARING SHEARED: ${worstBearingPair} runs ${worstBearingDeg.toFixed(2)}° apart on the map ` +
        `from its true bearing in the park (tolerance ${BEARING_TOLERANCE_DEG}°). ` +
        `The map is not a faithful rotation-free projection, so relative directions mislead.`,
    );
  }
  if (spread > SCALE_SPREAD_TOLERANCE) {
    failures.push(
      `SCALE NOT UNIFORM: map pixels per world metre ranges ${minRatio.toFixed(4)}..${maxRatio.toFixed(4)} ` +
        `across feature pairs — a spread of ${(spread * 100).toFixed(2)}%, tolerance ` +
        `${(SCALE_SPREAD_TOLERANCE * 100).toFixed(2)}%. Distances on this map are not comparable.`,
    );
  }
  notes.push(
    `conformality: worst bearing error ${worstBearingDeg.toFixed(3)}°, ` +
      `scale spread ${(spread * 100).toFixed(3)}% over ${checkedFeatures.length} features`,
  );
}

// ---------------------------------------------------------------- reporting

function minRadius(points: readonly (readonly [number, number])[]): number {
  let smallest = Infinity;
  for (const [x, z] of points) {
    const r = Math.hypot(x, z);
    if (r < smallest) smallest = r;
  }
  return smallest;
}

console.log('park map fidelity');
console.log(`  park built in ${park.buildMs.toFixed(0)} ms; seed from PARK_SEED`);
for (const note of notes) console.log(`  ${note}`);
if (mutation) console.log(`  --mutate=${mutation} is ACTIVE: failures below are expected`);

if (failures.length > 0) {
  console.error(`\nFAIL: the park map does not match the park (${failures.length} finding(s))${mutation ? ` [--mutate=${mutation}, expected]` : ''}.`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

if (mutation) {
  console.error(`\nFAIL: --mutate=${mutation} did not break anything — this check is not measuring what it claims to.`);
  process.exit(1);
}

console.log('\nOK: the map draws the whole park, in the right places, to one scale.');
