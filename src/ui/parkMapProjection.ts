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
): MapProjection {
  return frameExtent(PARK_BOUNDARY.extent, canvasWidth, canvasHeight);
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
