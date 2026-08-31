/**
 * **Framing a shot from what is in it**, rather than from a distance somebody
 * liked once.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * Jim, on an iPhone in portrait, 31 August 2026 (#418): *"the keyring stand
 * when zoomed in doesn't show all the keyrings. Adjust the camera to be at a
 * distance where all fit in."*
 *
 * The keyring rack held `KEYCHAIN_VIEW_ZOOM = 4.25`, and its own doc comment
 * said plainly where it came from: *"tuned by eye against a real screenshot of
 * the built view, not computed from the frustum maths."* The screenshot was of
 * a desktop window. On a 390 × 844 phone the frame is 1.294 m of half-width
 * instead of 3.137 m, and two of the six keyrings sat outside it — a
 * six-year-old asked to choose between things she cannot see.
 *
 * A number tuned on one viewport is wrong on every other one, and nothing goes
 * red when it is: the shot still renders, still looks composed, and is simply
 * missing a third of its subject on hardware nobody checked. So the fix is not
 * a better number. It is asking the content how much room it needs, and asking
 * the camera how much room there is.
 *
 * ---------------------------------------------------------------------------
 * How to use it
 * ---------------------------------------------------------------------------
 * 1. Describe what must be in shot as {@link FramedSubject}s — a name and the
 *    world points that must land inside the frame. Bounding-box corners of the
 *    real built meshes are the honest answer; a hand-guessed radius is how the
 *    original constant went wrong one level down.
 * 2. {@link contentFrame} projects them onto the screen axes and returns the
 *    box they occupy.
 * 3. {@link focusForFrame} gives the world point to aim at so that box is
 *    **centred** — which is what makes the margins even, and is worth more
 *    zoom than any amount of retuning. On the keyring rack the focus had been
 *    pulled 43% of the way towards the child by a hand-tuned weight, so the
 *    keyrings sat off to one side and the frame had to be **1.92 m** wide to
 *    hold content only 1.23 m wide. Centring the box was the larger half of
 *    the fix; pulling the camera back was the smaller half.
 * 4. `IsoCamera.zoomToFit(frame.halfWidth, frame.halfHeight, margin)` for the
 *    zoom, every frame, so a rotated phone reframes for free.
 *
 * Everything here is pure and allocation-light on purpose: it runs per frame
 * while a view is open, and it has to be callable from a headless check that
 * has no renderer.
 */
import type { Vector3 } from 'three';
import { screenRightOf, screenUpOf, type ScreenBasis3D } from './screenBasis';

/** A point in world space — `Vector3`, or anything else with the three fields. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * One thing that must be fully inside the shot.
 *
 * `points` are world-space points that must all land inside the frame — for a
 * mesh, the eight corners of its world bounding box; for a character, the
 * corners of the box her worst-case height and radius sweep. Named so a check
 * that finds one outside the frame can say *which* thing is off-screen, which
 * is the difference between a failure someone can fix and a number.
 */
export interface FramedSubject {
  readonly what: string;
  readonly points: readonly WorldPoint[];
}

/** The screen-space box a set of subjects occupies, in world metres. */
export interface ContentFrame {
  readonly rightMin: number;
  readonly rightMax: number;
  readonly upMin: number;
  readonly upMax: number;
  /** Half the box's width — what a camera must be able to show either side of centre. */
  readonly halfWidth: number;
  /** Half the box's height. */
  readonly halfHeight: number;
  /** Screen coordinates of the box's own centre. */
  readonly centreRight: number;
  readonly centreUp: number;
}

/** Projects every subject onto the screen axes and returns the box they fill. */
export function contentFrame(
  basis: ScreenBasis3D,
  subjects: readonly FramedSubject[],
): ContentFrame {
  let rightMin = Infinity;
  let rightMax = -Infinity;
  let upMin = Infinity;
  let upMax = -Infinity;
  for (const subject of subjects) {
    for (const point of subject.points) {
      const right = screenRightOf(basis, point.x, point.y, point.z);
      const up = screenUpOf(basis, point.x, point.y, point.z);
      if (right < rightMin) rightMin = right;
      if (right > rightMax) rightMax = right;
      if (up < upMin) upMin = up;
      if (up > upMax) upMax = up;
    }
  }
  // An empty subject list would otherwise hand back Infinity half-extents, and
  // a zoom derived from those is 0 — a camera pulled back to the horizon, with
  // nothing anywhere saying why. Collapse to a point instead: `zoomToFit` then
  // returns its maximum and the caller's own clamp catches it.
  if (!Number.isFinite(rightMin)) {
    return {
      rightMin: 0,
      rightMax: 0,
      upMin: 0,
      upMax: 0,
      halfWidth: 0,
      halfHeight: 0,
      centreRight: 0,
      centreUp: 0,
    };
  }
  return {
    rightMin,
    rightMax,
    upMin,
    upMax,
    halfWidth: (rightMax - rightMin) / 2,
    halfHeight: (upMax - upMin) / 2,
    centreRight: (rightMin + rightMax) / 2,
    centreUp: (upMin + upMax) / 2,
  };
}

/**
 * Moves `focus` — in place, so this can run per frame without allocating — to a
 * world point that projects to the centre of `frame`.
 *
 * An orthographic camera's focus has a free parameter (anywhere along the view
 * direction looks identical), so this **corrects a reference point rather than
 * inventing one**: pass the subjects' own world centroid, or the middle of the
 * thing the shot is about, and it slides sideways and up the screen until it
 * sits on the box centre. That keeps the focus somewhere sensible in depth —
 * which matters for anything else reading it, `IsoCamera.focusPoint`'s own
 * "how far is this from what the camera is looking at" callers included.
 *
 * The two axes are orthonormal and both perpendicular to the view direction, so
 * the correction is exact and needs no iteration.
 */
export function focusForFrame(
  basis: ScreenBasis3D,
  frame: ContentFrame,
  reference: WorldPoint,
  focus: Vector3,
): Vector3 {
  const right = screenRightOf(basis, reference.x, reference.y, reference.z);
  const up = screenUpOf(basis, reference.x, reference.y, reference.z);
  const dRight = frame.centreRight - right;
  const dUp = frame.centreUp - up;
  focus.set(
    reference.x + basis.rightX * dRight + basis.upX * dUp,
    reference.y + basis.rightY * dRight + basis.upY * dUp,
    reference.z + basis.rightZ * dRight + basis.upZ * dUp,
  );
  return focus;
}

/**
 * How much room `frame` needs **about some other centre** — the point the
 * camera is actually aimed at, when that is not this box's own middle.
 *
 * Needed whenever a shot has a *must-fit* subset inside a larger wish-list: the
 * camera is centred on the whole wish-list, so asking "does the subset fit?"
 * with the subset's own half-width silently assumes a frame centred somewhere
 * the camera is not. The keyring rack is exactly that — the six keyrings may
 * never be cropped, the child beside the table may be, and the focus sits at
 * the centre of both together (`KeychainShop.viewZoom`). Measuring the keyrings
 * about their own centre there would have under-stated the room they need by
 * however far the child pulls the focus sideways, which is the same class of
 * mistake as the off-centre focus that caused #418 in the first place.
 */
export function halfExtentsAbout(
  frame: ContentFrame,
  centreRight: number,
  centreUp: number,
): { halfWidth: number; halfHeight: number } {
  return {
    halfWidth: Math.max(frame.rightMax - centreRight, centreRight - frame.rightMin),
    halfHeight: Math.max(frame.upMax - centreUp, centreUp - frame.upMin),
  };
}

/**
 * Screen-space distance between two world points, in metres — how far apart
 * two things *look*, which is not how far apart they are.
 *
 * The distinction is the whole of #418's second fault. Two keyrings 0.75 m
 * apart across a table are 0.75 m apart in the world and `check:tap-spacing`
 * measured them as such; on screen they were **0.462 m** apart, because a
 * pitched camera foreshortens ground depth by `sin(pitch)`. A finger aims at
 * what it can see, so a tap-separation rule has to be asked in the space the
 * finger is working in.
 */
export function screenDistance(basis: ScreenBasis3D, a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(
    screenRightOf(basis, a.x, a.y, a.z) - screenRightOf(basis, b.x, b.y, b.z),
    screenUpOf(basis, a.x, a.y, a.z) - screenUpOf(basis, b.x, b.y, b.z),
  );
}

/** The eight world-space corners of an axis-aligned box, for a {@link FramedSubject}. */
export function boxCorners(min: WorldPoint, max: WorldPoint): WorldPoint[] {
  const corners: WorldPoint[] = [];
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners.push({ x, y, z });
  return corners;
}
