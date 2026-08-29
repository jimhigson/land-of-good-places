/**
 * **The park map tells the truth about the park.** GitHub issues #234 and #334.
 *
 * ```
 * npm run check:park-map
 * npm run check:park-map -- --mutate=viewport   # prove assertion 1 can fail
 * npm run check:park-map -- --mutate=position   # prove assertion 2 can fail
 * npm run check:park-map -- --mutate=stretch    # prove assertion 3 can fail
 * npm run check:park-map -- --mutate=entrance   # ... at the rides' queues
 * npm run check:park-map -- --mutate=gateway    # ... at the gate and the bus
 * npm run check:park-map -- --mutate=zoom-axis  # prove assertion 5 can fail
 * npm run check:park-map -- --mutate=clamp-loose  # prove assertion 6 can fail
 * npm run check:park-map -- --mutate=clamp-tight  # prove assertion 7 can fail
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
 * park `buildHeadlessPark()` really generated. Seven assertions — 1-3 on the
 * default framing, 4-7 once #359 let the child zoom and pan, and the note
 * above `viewSamples` sets out which zoom properties are genuinely falsifiable
 * and which are structural and therefore written down instead of tested:
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
 *      the same over-broad claim, in miniature, caught in re-review. A missing
 *      `castle-walls` now **fails** rather than falling back, because a silent
 *      fallback here restores the vacuous version without changing the output.
 *
 *      **What the scene-graph branches buy, precisely**: they catch the map
 *      reading the wrong *field* — the plot instead of the masonry, the queue
 *      instead of the ride — which is the error that actually happens and the
 *      one no round-trip can see. They do not catch a wrong *constant* shared
 *      by the map and the park alike: if `BUILDING_CENTRE` itself were wrong,
 *      the castle would stand in the wrong place and the map would faithfully
 *      draw it there. That is a different check's job (`check:park`), and the
 *      distinction is worth keeping straight, because "measured against the
 *      scene" sounds like it covers both and does not.
 *    - **The entrance gate** — truth is `park-gate-arch`, the crossbar
 *      `Entrance.ts` stands over the gap in the boundary wall. Genuine
 *      independence, and it earned its keep on the first run: the obvious
 *      name `entrance-arch` is already the castle's own front-door arch, so
 *      the check measured the park gate against the castle and reported the
 *      map 65.65 m out. A real name collision, found by the assertion rather
 *      than by reading.
 *    - **Stalls, the fountain, stations and the cat bus** — truth still comes
 *      from the same owner the content list read, because no
 *      separately-positioned scene object exists to ask. For these the
 *      assertion proves the *projection* round-trips and that every drawn
 *      feature has a real owner and a resolvable id; it does **not**
 *      independently prove the content list chose the right field. Stated
 *      here rather than dressed up.
 *
 *      The cat bus is in this group for a reason peculiar to it: for most of
 *      a save **there is no bus in the world at all**, so there is nothing to
 *      ask. That is also why the map draws the *stop* rather than the vehicle
 *      — see `parkMapContent.ts`'s note on the `catBus` feature.
 * 3. **The map is conformal.** Between every pair of features, the bearing on
 *    the map matches the bearing in the world, and the map-metres-per-world-
 *    metre ratio is the same for all pairs. That is what "relative position,
 *    scale and bearing are preserved" means as a measurement, and it catches a
 *    stretched or rotated projection, which assertions 1 and 2 both survive.
 *
 *    **Assertion 3 only ever runs on the default framing**, which is why 5
 *    exists. Measured: `--mutate=zoom-axis` (zoom applied to one axis) raises
 *    **140** failures under assertion 5 and **zero** under assertion 3 — the
 *    shear is a no-op at zoom 1 by construction and appears only as the child
 *    zooms in. A check that stopped at the default view would have been blind
 *    to it, which is #234's own shape one level up.
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
 * one axis, **`entrance` draws every ride at its queue rather than at the
 * ride** — the exact class of error the vacuous version of assertion 2 could
 * not see and the scene-graph comparison now can — and **`gateway` swaps the
 * entrance arch with the cat bus stop**, the plausible-looking 9 m error at
 * the way in. Each was run and each goes red; the messages are in the PR.
 */

import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import { ANCHORS_BY_ID, anchorGroupName, type AnchorId } from '../src/world/anchors.ts';
import { Vector3 } from 'three';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../src/world/building/layout.ts';
import { STALL_PLACEMENTS } from '../src/minigames/stallPlacement.ts';
import { parkMapFeatures, type MapFeature } from '../src/ui/parkMapContent.ts';
import {
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  clampMapView,
  defaultMapView,
  frameExtent,
  outdoorParkMapProjection,
  pannedBy,
  zoomedAboutPoint,
  type MapProjection,
  type MapView,
} from '../src/ui/parkMapProjection.ts';
import {
  ENTRANCE_BUS_DOOR_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
} from '../src/world/entrance/layout.ts';
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
const MUTATIONS = [
  'viewport',
  'position',
  'stretch',
  'entrance',
  'gateway',
  'zoom-axis',
  'clamp-loose',
  'clamp-tight',
  'clamp-letterbox',
  'focal',
  'pan-sign',
] as const;
if (mutation && !MUTATIONS.includes(mutation as (typeof MUTATIONS)[number])) {
  console.error(`Unknown --mutate=${mutation}. Use one of: ${MUTATIONS.join(', ')}.`);
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

// ------------------------------------------------------- zoom and pan (#359)

/**
 * **What is actually falsifiable once the map zooms, and what is not.**
 *
 * Worth stating before the code, because the obvious extension is a check that
 * cannot fail. `toPlane(toCanvas(p))` is the exact inverse of `toCanvas` for
 * **any** invertible affine map — same closure, same constants — so a
 * "position round-trips at every zoom" assertion would return `0.0000` at
 * every zoom by construction, and running the existing assertion 2 over a grid
 * of twenty views would be the same comparison twenty times rather than
 * twenty comparisons. Assertion 2 is in fact **projection-independent**: it
 * reduces to "the content list agrees with the scene graph", which is a real
 * cross-check and is why it stays, but it learns nothing from zoom. Padding it
 * out would have bought a bigger number and no more truth.
 *
 * Two more properties are **structural, not testable**, and are written down
 * here instead of being asserted:
 *
 * - *What is drawn and what a tap inverts cannot diverge.* `ParkMap` holds one
 *   `MapProjection` per render and both `planeToCanvas` and `canvasToPlane`
 *   delegate to it. There is no second path to compare against, so a check
 *   would be comparing a thing to itself. It is guaranteed by there being one
 *   owner, which is the property to defend in review, not in a test.
 * - *Zoom and pan cannot introduce a second transform.* They are inputs to
 *   `outdoorParkMapProjection`, which multiplies one scale and moves one
 *   origin. Same reason.
 *
 * What genuinely can fail, and is asserted below:
 *
 * 4. **Zoom 1 is exactly the map #353 shipped.** Four review rounds bought that
 *    framing; a default view that quietly differed would regress it.
 * 5. **Uniform scale at every zoom.** Apply zoom per-axis and the park shears —
 *    invisible to a round-trip, caught by measuring x-scale against z-scale.
 * 6. **The clamp never reveals blank paper.** At any zoom, from any centre, the
 *    canvas must stay inside the region zoom 1 frames.
 * 7. **The clamp never strands an attraction.** Every feature must be
 *    reachable — centring on it must actually put it on screen — at every
 *    zoom. A clamp tightened to fix 6 breaks 7, which is exactly why both are
 *    here.
 */

/** Zoom levels sampled. The ends matter most; the middle catches sign errors. */
const ZOOM_SAMPLES = [MAP_MIN_ZOOM, 1.5, 2, 3, MAP_MAX_ZOOM];

/** Float slop for a pixel comparison that is exact when it is right. */
const VIEW_EPSILON_PX = 0.5;

/**
 * The least park the map may show, as a fraction of the canvas.
 *
 * Not zero — "at least one pixel of lawn" would pass on a view showing a single
 * green corner, which is not a map. 12% is below anything the honest clamp
 * produces at any sampled view (measured worst is far higher) and far above the
 * 0% the broken clamp allowed, so it fails the bug without being a tripwire on
 * ordinary framing. The park is a lobed blob inside a rectangular extent, so
 * some genuinely lawn-free corner at high zoom is expected and fine.
 */
const MIN_LAWN_FRACTION = 0.12;

/**
 * How much of the canvas is inside the real park boundary, by grid sample.
 *
 * Uses `PARK_BOUNDARY.outline()` — the same 512-point polygon the map draws and
 * the terrain is built from — rather than the extent rectangle, so a view
 * parked over the extent's empty corner is correctly counted as blank.
 */
function canvasLawnFraction(
  projection: MapProjection,
  width: number,
  height: number,
): number {
  const steps = 12;
  let inside = 0;
  let total = 0;
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < steps; j += 1) {
      const px = ((i + 0.5) / steps) * width;
      const py = ((j + 0.5) / steps) * height;
      const [wx, wz] = projection.toPlane(px, py);
      total += 1;
      if (pointInPolygon(wx, wz, outline)) inside += 1;
    }
  }
  return total === 0 ? 0 : inside / total;
}

/** Standard ray-crossing test. */
function pointInPolygon(
  x: number,
  z: number,
  polygon: readonly (readonly [number, number])[],
): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i] as readonly [number, number];
    const b = polygon[j] as readonly [number, number];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * A grid of views: every sampled zoom, panned hard to each corner and edge as
 * well as centred. Deliberately asks for centres far outside the legal range —
 * `clampMapView` is the thing under test, so it must be handed values that
 * would break it if it did nothing.
 */
function viewSamples(width: number, height: number): { label: string; view: MapView }[] {
  const base = defaultMapView(width, height);
  const reach = 400; // metres — far beyond any legal pan, on purpose
  const offsets: readonly (readonly [number, number, string])[] = [
    [0, 0, 'centred'],
    [-reach, 0, 'panned west'],
    [reach, 0, 'panned east'],
    [0, -reach, 'panned north'],
    [0, reach, 'panned south'],
    [-reach, -reach, 'panned NW'],
    [reach, reach, 'panned SE'],
  ];
  const samples: { label: string; view: MapView }[] = [];
  for (const zoom of ZOOM_SAMPLES) {
    for (const [dx, dz, where] of offsets) {
      samples.push({
        label: `zoom ${zoom}x ${where}`,
        view: { zoom, centreX: base.centreX + dx, centreZ: base.centreZ + dz },
      });
    }
  }
  return samples;
}

/**
 * The projection for a view, with `--mutate` applied.
 *
 * `clamp-loose` and `clamp-tight` are applied here rather than inside the
 * module so the honest module stays honest while the check exercises a broken
 * one — the same shape as `viewport` and `stretch` above.
 */
function projectionForView(width: number, height: number, view: MapView): MapProjection {
  if (mutation === 'clamp-loose') {
    // No clamping at all: pan wherever asked, off the park into blank paper.
    const base = outdoorParkMapProjection(width, height);
    const scale = base.scale * view.zoom;
    const originPxX = base.canvasWidth / 2 - view.centreX * scale;
    const originPxY = base.canvasHeight / 2 - view.centreZ * scale;
    return {
      scale,
      originPxX,
      originPxY,
      canvasWidth: base.canvasWidth,
      canvasHeight: base.canvasHeight,
      toCanvas: (x, z) => [originPxX + x * scale, originPxY + z * scale],
      toPlane: (px, py) => [(px - originPxX) / scale, (py - originPxY) / scale],
    };
  }
  if (mutation === 'clamp-letterbox') {
    // **The exact bug PR #372's review found**, reinstated: clamp against the
    // world rectangle zoom 1 *frames* rather than against the park. Because
    // `frameExtent` fits the smaller axis, that rectangle is mostly empty
    // letterbox on any canvas whose aspect differs from the park's, so at high
    // zoom the view can sit entirely in the blank band.
    //
    // This mutation exists because the assertion that replaced it must be
    // shown to catch it. The *previous* version of assertion 6 measured escape
    // against this same rectangle, so it agreed with this code by construction
    // and reported `0.00 m` while the map went completely blank.
    const base = outdoorParkMapProjection(width, height);
    const zoom = Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, view.zoom));
    const [lminX, lminZ] = base.toPlane(0, 0);
    const [lmaxX, lmaxZ] = base.toPlane(base.canvasWidth, base.canvasHeight);
    const halfX = base.canvasWidth / 2 / (base.scale * zoom);
    const halfZ = base.canvasHeight / 2 / (base.scale * zoom);
    const old = (v: number, lo: number, hi: number): number =>
      lo >= hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
    const scale = base.scale * zoom;
    const centreX = old(view.centreX, lminX + halfX, lmaxX - halfX);
    const centreZ = old(view.centreZ, lminZ + halfZ, lmaxZ - halfZ);
    const originPxX = base.canvasWidth / 2 - centreX * scale;
    const originPxY = base.canvasHeight / 2 - centreZ * scale;
    return {
      scale,
      originPxX,
      originPxY,
      canvasWidth: base.canvasWidth,
      canvasHeight: base.canvasHeight,
      toCanvas: (x, z) => [originPxX + x * scale, originPxY + z * scale],
      toPlane: (px, py) => [(px - originPxX) / scale, (py - originPxY) / scale],
    };
  }
  if (mutation === 'clamp-tight') {
    // Zoom, but never pan: the centre is pinned to the default framing, so
    // anything not near the middle of the park can never be brought on screen.
    const base = defaultMapView(width, height);
    return outdoorParkMapProjection(width, height, { ...base, zoom: view.zoom });
  }
  const honest = outdoorParkMapProjection(width, height, view);
  if (mutation !== 'zoom-axis') return honest;
  // Zoom applied to one axis only. At zoom 1 this is a no-op, so the check
  // stays green on the default framing and goes red only once the child zooms
  // — which is precisely the bug a zoom-1-only check could not see.
  const squash = 1 / view.zoom ** 0.5;
  return {
    ...honest,
    toCanvas: (x, z) => [
      honest.originPxX + x * honest.scale,
      honest.originPxY + z * honest.scale * squash,
    ],
    toPlane: (px, py) => [
      (px - honest.originPxX) / honest.scale,
      (py - honest.originPxY) / (honest.scale * squash),
    ],
  };
}

/**
 * `zoomedAboutPoint` and `pannedBy` under mutation.
 *
 * **These are separate derived formulae, not the one affine map**, which is
 * why they get real assertions rather than the "structural, cannot drift"
 * note that covers `toCanvas`/`toPlane`. PR #372's review proved the point by
 * gutting the focal pinning and, separately, flipping the pan sign: the map
 * zoomed about the wrong point and dragged the wrong way, and
 * `check:park-map` stayed **fully green** both times. My own vacuity argument
 * was right about the round-trip and wrong about these two, and this is where
 * the distinction actually had to be drawn.
 */
function zoomAboutUnderTest(
  view: MapView,
  nextZoom: number,
  focalPxX: number,
  focalPxY: number,
  width: number,
  height: number,
): MapView {
  if (mutation === 'focal') {
    // Ignore the focal point: zoom about the canvas centre, so whatever the
    // child was pinching on slides away under her fingers.
    return clampMapView({ ...view, zoom: nextZoom }, width, height);
  }
  return zoomedAboutPoint(view, nextZoom, focalPxX, focalPxY, width, height);
}

function panUnderTest(
  view: MapView,
  dxPx: number,
  dyPx: number,
  width: number,
  height: number,
): MapView {
  // Drag the map the wrong way — the single most likely sign error here.
  if (mutation === 'pan-sign') return pannedBy(view, -dxPx, -dyPx, width, height);
  return pannedBy(view, dxPx, dyPx, width, height);
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
// `--mutate=gateway`: the gate and the cat bus swapped. This is the mistake
// that is easy to make by eye — they are 9 m apart on the same axis and both
// "at the entrance", so a map that drew the arch on the kerb and the bus in the
// gateway would look entirely plausible and be wrong by 9 m, fourteen times the
// tolerance. Exercises both new branches of assertion 2 at once: the gate's
// against the arch standing in the scene, the bus's against `layout.ts`.
function swapGateAndBus(list: readonly MapFeature[]): readonly MapFeature[] {
  const gate = list.find((f) => f.kind === 'gate');
  const bus = list.find((f) => f.kind === 'catBus');
  if (!gate || !bus) {
    console.error('--mutate=gateway: no gate or cat bus on the map to swap.');
    process.exit(2);
  }
  return list.map((f) => {
    if (f === gate) return { ...f, x: bus.x, z: bus.z };
    if (f === bus) return { ...f, x: gate.x, z: gate.z };
    return f;
  });
}

const checkedFeatures = mutation === 'entrance'
  ? features.map((f) => {
      if (f.kind !== 'anchor') return f;
      const anchor = ANCHORS_BY_ID[f.id as keyof typeof ANCHORS_BY_ID];
      return anchor ? { ...f, x: anchor.entrance[0], z: anchor.entrance[1] } : f;
    })
  : mutation === 'gateway'
    ? swapGateAndBus(features)
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
    //
    // **No `??` fallback here, deliberately.** Falling back to
    // `BUILDING_CENTRE` would turn this branch back into the round-trip it
    // used to be, silently: the assertion would still print `0.0000` and still
    // prove nothing, which is the exact failure mode review caught the first
    // time. A missing `castle-walls` is a real problem — the castle did not
    // build, or was renamed — so it is a failure, loudly, with the name in it.
    const walls = scenePosition('castle-walls');
    if (!walls) {
      failures.push(
        'NO SCENE OBJECT "castle-walls": the castle\'s masonry is not in the built ' +
          'scene, so assertion 2 cannot measure the castle against anything ' +
          'independent. Either the castle failed to build or the group was renamed — ' +
          `do not fall back to BUILDING_CENTRE (${BUILDING_CENTRE_X.toFixed(2)}, ` +
          `${BUILDING_CENTRE_Z.toFixed(2)}), which is the plot and 3.54 m from the walls.`,
      );
      return null;
    }
    return walls;
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
  if (feature.kind === 'gate') {
    // The arch that actually stands in the park, read out of the finished
    // scene graph: `Entrance.ts` builds a half-torus crossbar spanning the
    // opening and centred on it, and names it `park-gate-arch` for this. Real
    // independence, like `castle-walls` — a map that drew the gate at the bus
    // stop, at the shelter or at the wall's radius rather than at the gap in
    // it is caught here.
    //
    // **No `??` fallback, and this branch is where that matters most.**
    // `[ENTRANCE_GATE_X, ENTRANCE_GATE_Z]` is byte-identical to the scene
    // value, so a fallback would make a rename completely invisible: the
    // assertion would go on printing `0.0000` while measuring the constant
    // against itself. A rename is not hypothetical here — naming this
    // `entrance-arch` collided with the castle's own front-door arch and had
    // to be changed, which is precisely the event a silent fallback hides.
    const arch = scenePosition('park-gate-arch');
    if (!arch) {
      failures.push(
        'NO SCENE OBJECT "park-gate-arch": the entrance arch is not in the built ' +
          'scene, so assertion 2 cannot measure the gate against anything independent. ' +
          'Either the entrance failed to build or the crossbar was renamed — do not ' +
          `fall back to ENTRANCE_GATE_X/Z (${ENTRANCE_GATE_X.toFixed(2)}, ` +
          `${ENTRANCE_GATE_Z.toFixed(2)}), which is the very constant under test.`,
      );
      return null;
    }
    return arch;
  }
  if (feature.kind === 'catBus') {
    // Truth is `layout.ts`, the same owner the content list read — the honest
    // status, stated rather than dressed up, exactly as for stalls and
    // stations above.
    //
    // **There is no scene object to ask, and that is the point of the
    // feature.** `Entrance.ts` builds the arrival only when one is due, and
    // disposes the bus once it has driven off past `ENTRANCE_BUS_VANISH_X`, so
    // for most of a save no bus exists anywhere in the world. The map
    // therefore marks the *stop* — where the bus's door comes to rest, dead in
    // front of the gate — which is permanent and owned. See the note on the
    // `catBus` feature in `parkMapContent.ts`.
    //
    // So this branch proves the projection round-trips and that the drawn bus
    // is at the stop `layout.ts` names; it does not independently prove that
    // the stop is the right field to have chosen. What it does catch is drift:
    // move `ENTRANCE_BUS_STOP_Z` or the kerb and leave the map behind, and
    // this goes red.
    return [ENTRANCE_BUS_DOOR_X, ENTRANCE_BUS_STOP_Z];
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

// --- 4. zoom 1 is exactly the map that shipped ------------------------------

{
  for (const [width, height, name] of CANVAS_SIZES) {
    const shipped = outdoorParkMapProjection(width, height);
    const viaView = projectionForView(width, height, defaultMapView(width, height));
    const drift = Math.max(
      Math.abs(shipped.scale - viaView.scale) * 100,
      Math.abs(shipped.originPxX - viaView.originPxX),
      Math.abs(shipped.originPxY - viaView.originPxY),
    );
    if (drift > VIEW_EPSILON_PX) {
      failures.push(
        `DEFAULT VIEW DRIFTED on ${name} ${width}x${height}: the map at zoom 1 no longer ` +
          `matches the projection with no view at all — scale ${viaView.scale.toFixed(4)} vs ` +
          `${shipped.scale.toFixed(4)}, origin (${viaView.originPxX.toFixed(1)}, ` +
          `${viaView.originPxY.toFixed(1)}) vs (${shipped.originPxX.toFixed(1)}, ` +
          `${shipped.originPxY.toFixed(1)}). Zoom must not change the framing four review ` +
          'rounds settled on (#334/#234).',
      );
    }
  }
  notes.push(`zoom-1 equivalence: default view matches the shipped framing at all ${CANVAS_SIZES.length} sizes`);
}

// --- 5, 6, 7. the map holds together at every zoom and pan -------------------

{
  let worstSpread = 0;
  let worstSpreadWhere = '';
  let worstLawnFraction = 1;
  let worstLawnWhere = '';
  let worstStrandedPx = 0;
  let worstStrandedWhere = '';
  let viewsChecked = 0;

  for (const [width, height, name] of CANVAS_SIZES) {
    for (const { label, view } of viewSamples(width, height)) {
      const projection = projectionForView(width, height, view);
      viewsChecked += 1;

      // --- 5. uniform scale. Measured per axis from the projection itself,
      // which is what a per-axis zoom breaks and a round-trip cannot see.
      const [x0, y0] = projection.toCanvas(0, 0);
      const [x1, y1] = projection.toCanvas(100, 100);
      const pxPerMetreX = Math.abs(x1 - x0) / 100;
      const pxPerMetreZ = Math.abs(y1 - y0) / 100;
      const spread =
        Math.max(pxPerMetreX, pxPerMetreZ) > 0
          ? Math.abs(pxPerMetreX - pxPerMetreZ) / Math.max(pxPerMetreX, pxPerMetreZ)
          : 0;
      if (spread > worstSpread) {
        worstSpread = spread;
        worstSpreadWhere = `${name} ${label}`;
      }
      if (spread > SCALE_SPREAD_TOLERANCE) {
        failures.push(
          `SCALE NOT UNIFORM at ${label} on ${name} ${width}x${height}: ` +
            `${pxPerMetreX.toFixed(4)} px/m across but ${pxPerMetreZ.toFixed(4)} px/m down — ` +
            `a spread of ${(spread * 100).toFixed(2)}%, tolerance ` +
            `${(SCALE_SPREAD_TOLERANCE * 100).toFixed(2)}%. The park shears as it zooms.`,
        );
      }

      // --- 6. THE CHILD CAN ALWAYS SEE SOME PARK.
      //
      // **This measures the outcome, not the rule**, and that distinction is
      // the whole reason it was rewritten. The first version compared the
      // visible rectangle against the region zoom 1 frames — the same
      // rectangle `clampMapView` was clamping to — so it agreed with the code
      // by construction and reported `0.00 m` while an 844x390 landscape phone
      // at zoom 4 could be dragged to a **completely blank** map. It was not
      // vacuous (`clamp-loose` was honestly red) but it measured the wrong
      // region, and it permitted exactly the outcome its own failure string
      // described. Found in review of PR #372.
      //
      // So: sample the canvas on a grid and ask how much of it is inside the
      // real `PARK_BOUNDARY` polygon. A clamp that lets the view slide into
      // the letterbox fails this no matter which rectangle it clamped to,
      // because the question is now "is there park on screen" rather than "did
      // the clamp obey itself".
      const lawn = canvasLawnFraction(projection, width, height);
      if (lawn < worstLawnFraction) {
        worstLawnFraction = lawn;
        worstLawnWhere = `${name} ${label}`;
      }
      if (lawn < MIN_LAWN_FRACTION) {
        failures.push(
          `BLANK MAP at ${label} on ${name} ${width}x${height}: only ` +
            `${(lawn * 100).toFixed(1)}% of the canvas is park (minimum ` +
            `${(MIN_LAWN_FRACTION * 100).toFixed(0)}%). The child can pan until there is ` +
            'little or nothing to look at.',
        );
      }
    }

    // --- 7. the clamp never strands an attraction. Centre on each feature in
    // turn: if the clamp is too tight, the far corners can never be reached.
    for (const zoom of ZOOM_SAMPLES) {
      for (const feature of checkedFeatures) {
        const projection = projectionForView(width, height, {
          zoom,
          centreX: feature.x,
          centreZ: feature.z,
        });
        const [px, py] = projection.toCanvas(feature.x, feature.z);
        const outside = Math.max(-px, px - width, -py, py - height, 0);
        if (outside > worstStrandedPx) {
          worstStrandedPx = outside;
          worstStrandedWhere = `${feature.id} at zoom ${zoom}x on ${name}`;
        }
        if (outside > VIEW_EPSILON_PX) {
          failures.push(
            `STRANDED "${feature.id}" at zoom ${zoom}x on ${name} ${width}x${height}: centring ` +
              `the map on it still leaves it ${outside.toFixed(1)} px off the canvas, so there ` +
              'is no view in which the child can see it. The pan clamp is too tight.',
          );
        }
      }
    }
  }

  notes.push(
    `zoom uniformity: worst scale spread ${(worstSpread * 100).toFixed(3)}%` +
      (worstSpreadWhere ? ` (${worstSpreadWhere})` : '') +
      `, over ${viewsChecked} views`,
  );
  notes.push(
    `pan clamp: worst canvas coverage ${(worstLawnFraction * 100).toFixed(1)}% park` +
      (worstLawnWhere ? ` (${worstLawnWhere})` : '') +
      `, minimum ${(MIN_LAWN_FRACTION * 100).toFixed(0)}%`,
  );
  notes.push(
    `reachability: worst stranding ${worstStrandedPx.toFixed(2)} px` +
      (worstStrandedWhere ? ` (${worstStrandedWhere})` : '') +
      `, ${checkedFeatures.length} features x ${ZOOM_SAMPLES.length} zooms`,
  );
}

// --- 8. the gesture formulae do what they say --------------------------------

/**
 * **Zoom pins the point under the finger; a drag moves the map with it.**
 *
 * Both are derived formulae with no other owner, and both were silently broken
 * by the reviewer of PR #372 without a single assertion noticing. Four lines
 * each, and they are the difference between "the castle stays under your
 * thumb" being a claim in a comment and being a fact.
 *
 * **Sampled at maximum zoom, where the clamp provably cannot bind.** That
 * matters: the first version of this assertion sampled at zoom 2 and went red
 * on a 700x300 landscape phone, because at that zoom the park's *width* still
 * fits the canvas entirely, so `clampMapView` correctly pins the x axis and a
 * horizontal drag correctly does nothing. The formula was right and the test
 * was wrong. At `MAP_MAX_ZOOM` the visible span is smaller than the park on
 * both axes at every canvas size here (checked: worst is 45.5 m visible
 * against 89 m of park), so a drag must move the map by exactly the drag and
 * any failure is the formula's.
 */
{
  let worstFocalPx = 0;
  let worstFocalWhere = '';
  let worstPanPx = 0;
  let worstPanWhere = '';

  for (const [width, height, name] of CANVAS_SIZES) {
    // Centred and fully zoomed in: far from every clamp edge, so the formulae
    // are what is being measured.
    const roomy = clampMapView(
      { ...defaultMapView(width, height), zoom: MAP_MAX_ZOOM },
      width,
      height,
    );

    for (const [fx, fy] of [
      [width * 0.5, height * 0.5],
      [width * 0.4, height * 0.45],
      [width * 0.6, height * 0.55],
    ] as const) {
      const before = projectionForView(width, height, roomy);
      const [worldX, worldZ] = before.toPlane(fx, fy);
      // Zoom *out* a little, which stays inside the range and keeps the view
      // clear of the clamp.
      for (const nextZoom of [MAP_MAX_ZOOM * 0.8, MAP_MAX_ZOOM * 0.9]) {
        const after = zoomAboutUnderTest(roomy, nextZoom, fx, fy, width, height);
        const [px, py] = projectionForView(width, height, after).toCanvas(worldX, worldZ);
        const drift = Math.hypot(px - fx, py - fy);
        if (drift > worstFocalPx) {
          worstFocalPx = drift;
          worstFocalWhere = `${name} focal (${fx.toFixed(0)}, ${fy.toFixed(0)}) to ${nextZoom.toFixed(1)}x`;
        }
        if (drift > 1) {
          failures.push(
            `ZOOM DID NOT PIN THE FOCAL POINT on ${name} ${width}x${height}: zooming to ` +
              `${nextZoom.toFixed(1)}x about (${fx.toFixed(0)}, ${fy.toFixed(0)}) moved the world ` +
              `point under it by ${drift.toFixed(1)} px. Whatever the child is pinching on must ` +
              'stay under her fingers.',
          );
        }
      }
    }

    for (const [dx, dy] of [[40, 0], [0, 40], [-30, 25]] as const) {
      const before = projectionForView(width, height, roomy);
      const probeX = width / 2;
      const probeY = height / 2;
      const [worldX, worldZ] = before.toPlane(probeX, probeY);
      const after = panUnderTest(roomy, dx, dy, width, height);
      const [px, py] = projectionForView(width, height, after).toCanvas(worldX, worldZ);
      const drift = Math.hypot(px - (probeX + dx), py - (probeY + dy));
      if (drift > worstPanPx) {
        worstPanPx = drift;
        worstPanWhere = `${name} drag (${dx}, ${dy})`;
      }
      if (drift > 1) {
        failures.push(
          `DRAG MOVED THE MAP WRONG on ${name} ${width}x${height}: dragging by (${dx}, ${dy}) px ` +
            `should carry the world point under the finger to (${(probeX + dx).toFixed(0)}, ` +
            `${(probeY + dy).toFixed(0)}) but it landed at (${px.toFixed(0)}, ${py.toFixed(0)}) — ` +
            `out by ${drift.toFixed(1)} px. The map drags the wrong way or the wrong distance.`,
        );
      }
    }
  }

  notes.push(
    `zoom focal pinning: worst drift ${worstFocalPx.toFixed(2)} px` +
      (worstFocalWhere ? ` (${worstFocalWhere})` : ''),
  );
  notes.push(
    `drag tracking: worst drift ${worstPanPx.toFixed(2)} px` +
      (worstPanWhere ? ` (${worstPanWhere})` : ''),
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
