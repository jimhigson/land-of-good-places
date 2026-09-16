import type { Vector3 } from 'three';
import { TALLEST_CHILD_HEIGHT } from '../../art/models/kid';
import type { CollisionWorld } from '../Collision';
import { altitudeAt } from '../terrain';
import { CHUTE_ENVELOPE, type SlideRide } from '../building/SlideRide';

/**
 * **The ginormous slide's low run-out is solid** (#664).
 *
 * For most of its length the chute is overhead — a child walks underneath it,
 * and that is part of the ride's charm. But it has to come down to its mouth
 * 0.9 m above the ball pit, and on every seed the last 8–14 m of it outside the
 * pit hang lower than the tallest child (the underside bottoming out at
 * 0.75–1.17 m). With only its legs registered, a walking child passed straight
 * through the trough — CLAUDE.md's first rule, broken.
 *
 * ### What is registered
 *
 * A chain of {@link CollisionWorld.addWall} capsules along the **built** curve,
 * one per short chord, covering every stretch whose underside is below
 * {@link TALLEST_CHILD_HEIGHT} above the ground under it. Consecutive chords
 * share an endpoint and every wall is round-ended, so the chain is one
 * continuous solid bar with **no hollow middle** — the trap a
 * `CollisionWorld` rectangle sets does not exist here, and there is no gap
 * between pieces for a child to stand in.
 *
 * Only below a child's head: the chute above that stays air, so walking under
 * the high part of the ride is exactly what it was.
 *
 * ### Heights, on the sphere
 *
 * "Low" is **altitude**, the clearance along the local up (`altitudeAt`, a
 * difference of radii from the planet's centre), never a world-`y`
 * difference — the same frame the slide's own profile is held in since #659.
 *
 * The top is `topIsAbsolute` (the `hotel/place.ts` precedent), stated as a
 * world `y` because that is what the resolver compares against the mover's
 * real feet: the chute's rim, `CHUTE_ENVELOPE.above` over the centre line, the
 * offset the trough itself is swept with. So it is solid to feet on the grass
 * and air to a child whose jump carries her feet over the rim — a low chute is
 * something you can hop, not a wall to the sky.
 */

/** Chord length between capsules along the curve, in metres. */
const CHORD = 0.5;

/** Where a chute centre point's trough underside is, above the ground under it. */
function undersideAltitude(point: Readonly<Vector3>): number {
  return altitudeAt(point.x, point.y, point.z) - CHUTE_ENVELOPE.below;
}

export interface ChuteColliderStretch {
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
  /** World `y` of the rim over this chord — its `topIsAbsolute` top. */
  readonly topY: number;
}

/**
 * The chords of chute a child could walk into, off the built curve. Pure, so a
 * check can ask what was registered without re-deriving it.
 */
export function lowChuteStretches(slide: SlideRide): ChuteColliderStretch[] {
  const steps = Math.max(2, Math.ceil(slide.length / CHORD));
  const stretches: ChuteColliderStretch[] = [];
  let previous = slide.pointAt(0).clone();
  let previousLow = undersideAltitude(previous) < TALLEST_CHILD_HEIGHT;
  for (let i = 1; i <= steps; i += 1) {
    const point = slide.pointAt(i / steps).clone();
    const low = undersideAltitude(point) < TALLEST_CHILD_HEIGHT;
    // Either end low: the chord reaching down to the first low point is itself
    // partly below a child's head.
    if (low || previousLow) {
      stretches.push({
        x1: previous.x,
        z1: previous.z,
        x2: point.x,
        z2: point.z,
        topY: Math.max(previous.y, point.y) + CHUTE_ENVELOPE.above,
      });
    }
    previous = point;
    previousLow = low;
  }
  return stretches;
}

/** Registers the low run-out as solid. Call after the legs are planned. */
export function registerChuteCollider(slide: SlideRide, collision: CollisionWorld): number {
  const stretches = lowChuteStretches(slide);
  for (const s of stretches) {
    collision.addWall(s.x1, s.z1, s.x2, s.z2, CHUTE_ENVELOPE.halfWidth, s.topY, false, true);
  }
  return stretches.length;
}
