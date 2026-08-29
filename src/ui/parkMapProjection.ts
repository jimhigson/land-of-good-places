import { PARK_BOUNDARY, type BoundaryExtent } from '../world/boundary';

/**
 * **World metres to map pixels, and back.** The one owner of the park map's
 * viewport (GitHub issues #234 and #334).
 *
 * This is a file of its own for one reason: it is the thing that was wrong.
 * `ParkMap.render` used to size its viewport to `GARDEN_HALF_SIZE + 4` — a
 * constant that meant "the edge of the park" when the park was a circle, and
 * quietly stopped meaning it when #115 made the boundary a radius-per-bearing
 * spline running 59.7-101.4 m. The map then clipped roughly 35 m off the
 * bulge, and nothing said so, because the number and the shape it described
 * lived in different files with nothing joining them.
 *
 * So the viewport is now derived from the boundary's own {@link BoundaryExtent}
 * and nothing else, and it lives where `scripts/check-park-map.mts` can import
 * it and measure it on the real park. That is the difference between a comment
 * promising the two agree and a mechanism that makes them.
 *
 * ### Why the extent and not `maxRadius`
 *
 * `maxRadius` is the furthest the edge ever gets from the origin, and framing a
 * square of that half-width would work only for a shape centred on the origin.
 * The generated park is not: it is pinned at the gate and swells away from it,
 * so its extent is lopsided by tens of metres. Framing by radius would leave
 * dead lawn on the pinched side and — far worse — is one algebra slip away from
 * clipping the other. The extent states the answer directly.
 *
 * The projection is **uniform**: one scale for both axes, so a metre across is
 * a metre down. A map that stretched to fill the canvas would put every
 * attraction at a plausible-looking but wrong bearing from every other, which
 * is precisely the navigability the fidelity check exists to defend.
 */
export interface MapProjection {
  /** Pixels per metre. Uniform across both axes — see the note above. */
  readonly scale: number;
  /** Canvas CSS pixel the world origin lands on. */
  readonly originPxX: number;
  readonly originPxY: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** World (or interior-local) metres -> canvas CSS pixels. */
  toCanvas(x: number, z: number): readonly [number, number];
  /** Canvas CSS pixels -> world (or interior-local) metres. */
  toPlane(px: number, py: number): readonly [number, number];
}

/**
 * Lawn left around the park's own edge, in metres.
 *
 * The reference illustration's composition rule — a lobed island of lawn
 * floating on a plain background — needs the edge to sit *inside* the frame
 * with air around it, not tight against the crop. It is also functional
 * headroom: an attraction standing near the boundary has an icon and a label
 * that extend past its own point, and both want somewhere to go.
 *
 * Deliberately metres rather than a fraction of the park, so the band is the
 * same real width on a pinched seed and a bulging one.
 */
export const MAP_EDGE_MARGIN_M = 6;

/**
 * Frames `extent` (plus {@link MAP_EDGE_MARGIN_M} of lawn) inside a canvas.
 *
 * The whole extent always fits: the scale is the *smaller* of the two axes'
 * fits, so the constrained axis fills the canvas and the other gains slack.
 * Nothing here can crop — which is the property `check-park-map.mts` asserts
 * against the real `PARK_BOUNDARY.outline()` rather than trusting this comment.
 */
export function frameExtent(
  extent: BoundaryExtent,
  canvasWidth: number,
  canvasHeight: number,
  margin = MAP_EDGE_MARGIN_M,
): MapProjection {
  const minX = extent.minX - margin;
  const maxX = extent.maxX + margin;
  const minZ = extent.minZ - margin;
  const maxZ = extent.maxZ + margin;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanZ = Math.max(1e-6, maxZ - minZ);

  const width = Math.max(1, canvasWidth);
  const height = Math.max(1, canvasHeight);
  const scale = Math.min(width / spanX, height / spanZ);

  // Centre the *framed region* in the canvas — not the world origin, which on
  // a lopsided park is not the middle of anything.
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  const originPxX = width / 2 - centreX * scale;
  const originPxY = height / 2 - centreZ * scale;

  return {
    scale,
    originPxX,
    originPxY,
    canvasWidth: width,
    canvasHeight: height,
    toCanvas: (x, z) => [originPxX + x * scale, originPxY + z * scale],
    toPlane: (px, py) => [(px - originPxX) / scale, (py - originPxY) / scale],
  };
}

/**
 * **How far in the child has zoomed, and what she is looking at.** Issue #359.
 *
 * `zoom: 1` is exactly the map #334 shipped — the whole park framed, nothing
 * clipped. Above 1 it magnifies about {@link MapView.centreX}/`centreZ`.
 *
 * **This is the only shape zoom and pan take.** They are not a second
 * transform composed on top of the projection; they are two more inputs *to*
 * it, and they reach the world-to-pixel maths solely by changing `scale` and
 * the origin inside {@link frameExtent}. That is deliberate and it is the
 * whole design: #234 was one viewport constant drifting out of step with the
 * shape it described, and three rounds of review on #353 went into making this
 * module the single owner of that arithmetic. A `ctx.translate`/`ctx.scale`
 * wrapped round the renderer would re-create the second definition — the map
 * would draw at one transform while `toPlane`, and therefore every tap, used
 * another, and the fidelity check would keep passing while taps landed in the
 * wrong place.
 */
export interface MapView {
  /** 1 = whole park. Clamped to [{@link MAP_MIN_ZOOM}, {@link MAP_MAX_ZOOM}]. */
  readonly zoom: number;
  /** The world point held at the centre of the canvas. */
  readonly centreX: number;
  readonly centreZ: number;
}

/**
 * Zoom 1 is "the whole park" and there is deliberately nothing below it: the
 * park is the world, and pulling back further would frame empty space and
 * shrink the names, which is the problem this issue exists to solve.
 */
export const MAP_MIN_ZOOM = 1;

/**
 * The far end, chosen from the constraint rather than by taste: at 4x, a 380 px
 * phone canvas covers about a quarter of the park's width, which is the point
 * at which every name in view has room at the TEXT rule's minimum size. Going
 * further would mean panning a long way to find anything.
 */
export const MAP_MAX_ZOOM = 4;

/** The default view: the whole park, centred as #334 framed it. */
export function defaultMapView(canvasWidth: number, canvasHeight: number): MapView {
  const base = frameExtent(PARK_BOUNDARY.extent, canvasWidth, canvasHeight);
  const [centreX, centreZ] = base.toPlane(base.canvasWidth / 2, base.canvasHeight / 2);
  return { zoom: MAP_MIN_ZOOM, centreX, centreZ };
}

/**
 * Pulls a view back inside what the map is allowed to show.
 *
 * **The child can never pan off the park into blank paper.** The region she may
 * explore is exactly the region zoom 1 frames — the park plus its lawn margin,
 * letterboxing included — so at any zoom the visible rectangle is clamped to
 * sit inside it. At `zoom === 1` the permitted interval collapses to a single
 * point, so the default view is pinned to the framed centre and this reduces
 * to precisely the projection #334 shipped. That equivalence is asserted by
 * `check:park-map`, not merely claimed here.
 */
export function clampMapView(
  view: MapView,
  canvasWidth: number,
  canvasHeight: number,
): MapView {
  const base = frameExtent(PARK_BOUNDARY.extent, canvasWidth, canvasHeight);
  const zoom = Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, view.zoom));

  // **The park, not the framing.** This used to clamp against the world
  // rectangle zoom 1 *frames*, which was wrong in a way that only appeared
  // once you zoomed: `frameExtent` fits the smaller axis, so on any canvas
  // whose aspect differs from the park's, that rectangle is mostly empty
  // letterbox. At zoom 4 on an 844x390 landscape phone the visible window fits
  // entirely inside the empty band, so three ordinary drags produced a
  // completely blank map — no park at all. Found in review of PR #372.
  //
  // The region the child may explore is the **park's own extent** plus the
  // lawn margin the map draws, which is the same rectangle `frameExtent` is
  // given and contains no letterbox by construction.
  const contentMinX = PARK_BOUNDARY.extent.minX - MAP_EDGE_MARGIN_M;
  const contentMaxX = PARK_BOUNDARY.extent.maxX + MAP_EDGE_MARGIN_M;
  const contentMinZ = PARK_BOUNDARY.extent.minZ - MAP_EDGE_MARGIN_M;
  const contentMaxZ = PARK_BOUNDARY.extent.maxZ + MAP_EDGE_MARGIN_M;

  // Half the world span still visible once magnified.
  const halfX = base.canvasWidth / 2 / (base.scale * zoom);
  const halfZ = base.canvasHeight / 2 / (base.scale * zoom);

  /**
   * Keeps the visible span inside the content span — and **centres instead of
   * clamping when the content is smaller than the view**, which is what makes
   * zoom 1 come out exactly as #353 shipped it. At zoom 1 the constrained axis
   * fits exactly (`half === content half`) and the slack axis is larger than
   * the content, so both axes centre and the framing is the default one.
   */
  const fit = (value: number, lo: number, hi: number, half: number): number => {
    if (half * 2 >= hi - lo) return (lo + hi) / 2;
    return Math.min(hi - half, Math.max(lo + half, value));
  };

  return {
    zoom,
    centreX: fit(view.centreX, contentMinX, contentMaxX, halfX),
    centreZ: fit(view.centreZ, contentMinZ, contentMaxZ, halfZ),
  };
}

/**
 * Slides the view by a drag, in canvas pixels.
 *
 * The world moves *with* the finger, so dragging right reveals what is to the
 * left — which means the centre moves the opposite way. Expressed in world
 * metres by dividing by the live scale, so a drag covers the same amount of
 * park per pixel however far in the child has zoomed.
 */
export function pannedBy(
  view: MapView,
  dxPx: number,
  dyPx: number,
  canvasWidth: number,
  canvasHeight: number,
): MapView {
  const projection = outdoorParkMapProjection(canvasWidth, canvasHeight, view);
  return clampMapView(
    {
      zoom: view.zoom,
      centreX: view.centreX - dxPx / projection.scale,
      centreZ: view.centreZ - dyPx / projection.scale,
    },
    canvasWidth,
    canvasHeight,
  );
}

/**
 * Zooms to `nextZoom` while pinning the world point under a focal pixel.
 *
 * This is what makes pinch and wheel feel like the map rather than a slider:
 * the castle stays under the finger that is pinching on it. Without it the
 * view zooms about the canvas centre and whatever the child was looking at
 * slides away, which reads as the map fighting her.
 *
 * Derived rather than tuned: solve `toCanvas(world) === focal` for the new
 * centre at the new scale. Because it goes through the same one projection,
 * the pinned point is pinned exactly, not approximately.
 */
export function zoomedAboutPoint(
  view: MapView,
  nextZoom: number,
  focalPxX: number,
  focalPxY: number,
  canvasWidth: number,
  canvasHeight: number,
): MapView {
  const before = outdoorParkMapProjection(canvasWidth, canvasHeight, view);
  const [worldX, worldZ] = before.toPlane(focalPxX, focalPxY);

  const base = frameExtent(PARK_BOUNDARY.extent, canvasWidth, canvasHeight);
  const zoom = Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, nextZoom));
  const scale = base.scale * zoom;

  return clampMapView(
    {
      zoom,
      centreX: worldX + (base.canvasWidth / 2 - focalPxX) / scale,
      centreZ: worldZ + (base.canvasHeight / 2 - focalPxY) / scale,
    },
    canvasWidth,
    canvasHeight,
  );
}

/**
 * **The outdoor map's viewport.** The only way `ParkMap` is allowed to get one.
 *
 * This exists so that `ParkMap` has no *choice* to make about what to frame,
 * and therefore no opportunity to make the choice #234 was: a constant that
 * used to mean "the edge of the park" and silently stopped. The renderer asks
 * for a canvas-sized viewport; which region of the world that covers is
 * settled here, from `PARK_BOUNDARY` and nothing else.
 *
 * It is also what makes `scripts/check-park-map.mts`'s coverage assertion
 * worth anything. A check that framed the extent itself and then confirmed the
 * extent fits would be arithmetic marking its own homework; calling *this*
 * asks the real question — does the viewport the map actually uses contain the
 * whole park? — so re-introducing a hard-coded radius here turns the check red.
 */
export function outdoorParkMapProjection(
  canvasWidth: number,
  canvasHeight: number,
  view?: MapView,
): MapProjection {
  const base = frameExtent(PARK_BOUNDARY.extent, canvasWidth, canvasHeight);
  if (!view) return base;

  // Zoom and pan reach the transform *only* here, and only by multiplying the
  // scale and re-centring the origin. Same one-line affine map as before, same
  // `toCanvas`/`toPlane` pair derived from it — so a tap still inverts exactly
  // what was drawn, at any zoom. See the note on `MapView`.
  const { zoom, centreX, centreZ } = clampMapView(view, canvasWidth, canvasHeight);
  const scale = base.scale * zoom;
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

/**
 * Frames a plain half-extent box about the origin — the indoor floor plan,
 * which really is a centred rectangle and has no boundary spline to ask.
 */
export function frameHalfExtent(
  halfX: number,
  halfZ: number,
  canvasWidth: number,
  canvasHeight: number,
): MapProjection {
  return frameExtent({ minX: -halfX, maxX: halfX, minZ: -halfZ, maxZ: halfZ }, canvasWidth, canvasHeight, 0);
}
