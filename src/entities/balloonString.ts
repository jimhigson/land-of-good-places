import { CapsuleGeometry, Group, Mesh, Vector3, type Material } from 'three';
import { ART } from '../art/style/artPalette';
import { decal, toonMaterial } from '../art/style/materials';

/**
 * A short verlet chain strung between two moving world-space points — the
 * player's hand and a held balloon's knot — drawn as a fixed set of thin
 * capsules. See `entities/HeldBalloon.ts` for the system that owns one of
 * these per balloon.
 *
 * Deliberately **not** part of the balloon model (`art/models/balloons.ts`'s
 * own `makeString` draws a rigid cylinder, still used on the shop shelf): a
 * held balloon's string has to sag and catch up as the child walks, stops and
 * turns, which a fixed-length mesh parented rigidly to the hand cannot do. A
 * handful of point masses connected by distance constraints, with a light
 * gravity and drag, is the cheapest thing that visibly lags rather than
 * teleporting when either end moves — and it costs nothing when both ends
 * are still, since the chain settles and stops changing shape.
 *
 * ## Why it is capsules and not a tube
 *
 * It used to build a fresh `CatmullRomCurve3` **and** a fresh `TubeGeometry`
 * every frame and throw the previous one away: two geometry objects plus their
 * buffers, per held balloon, per frame — twelve a frame for a bouquet of six —
 * against a game with a standing GC-pause complaint (ARCHITECTURE-REVIEW.md).
 *
 * `art/models/ponytail.ts` had already solved exactly this problem for exactly
 * this kind of object — a springy chain hanging off a moving anchor — by
 * drawing pre-built segment meshes and writing only a `position`, a
 * `quaternion` and a scale onto them each frame. This is now that same
 * solution rather than a second one; read that file's header if this is
 * unfamiliar. **Nothing in `update()` allocates.**
 *
 * The look is meant to be unchanged. It very nearly is by construction: the
 * old tube resampled the same five points onto a Catmull-Rom spline, and this
 * string is in practice pulled taut — `HeldBalloon.ts` floats the knot a good
 * 2.1 m above a hand whose rest length to it is 1.6 m — so the curve it was
 * interpolating was a straight line. The capsules overlap (each one's
 * cylindrical part is shortened by its own radius, the ponytail's trick), so
 * where the chain does bend the joints round off instead of showing a notch.
 */

/** Points along the chain, ends included. Five is enough to read as a curve. */
const POINTS = 5;

/** A gentle sag, not a real rope's — this is a party balloon's string. */
const GRAVITY = 0.55;

/** Per-substep velocity retention. Lower = the string settles faster. */
const DRAG = 0.965;

/** Distance-constraint relaxation passes per frame. More = stiffer string. */
const CONSTRAINT_ITERATIONS = 4;

const RADIUS = 0.012;

/**
 * Faces around the string, matching the old tube's `radialSegments` exactly —
 * this is a 1.2 cm thread and a pentagon reads as round at that size.
 */
const RADIAL_SEGMENTS = 5;

/** Rings across each rounded end. Two, because nobody can see a 12 mm cap. */
const CAP_SEGMENTS = 2;

// --- scratch. Module-level and reused: `update` must allocate nothing. -------

const UP = new Vector3(0, 1, 0);
const scratchDelta = new Vector3();
const scratchDirection = new Vector3();

export class BalloonString {
  /**
   * Add this to the scene. It carries no transform of its own, and neither do
   * the segments' parents — the chain is simulated in world space and written
   * onto the segments in world space, exactly as the old rebuilt tube's
   * vertices were, so whatever this is added to must be untransformed.
   * `HeldBalloons.group` is.
   */
  readonly group = new Group();

  private readonly segments: readonly Mesh[];
  private readonly material: Material;
  private readonly points: Vector3[];
  private readonly previous: Vector3[];
  private readonly segmentLength: number;
  private initialised = false;

  /** `length` is the string's rest length, hand to knot, in metres. */
  constructor(length: number) {
    this.segmentLength = length / (POINTS - 1);
    this.points = Array.from({ length: POINTS }, () => new Vector3());
    this.previous = Array.from({ length: POINTS }, () => new Vector3());

    this.group.name = 'balloonString';
    this.material = toonMaterial(ART.balloonString);

    const segments: Mesh[] = [];
    for (let i = 0; i < POINTS - 1; i += 1) {
      const segment = decal(
        new Mesh(
          // Authored at the rest length, so `place()`'s stretch scale is ~1 in
          // the ordinary case and the numbers here mean what they say. The
          // cylindrical part is shortened by the radius so that consecutive
          // segments overlap into one continuous thread rather than a row of
          // beads with notches between them.
          new CapsuleGeometry(
            RADIUS,
            Math.max(0.001, this.segmentLength - RADIUS),
            CAP_SEGMENTS,
            RADIAL_SEGMENTS,
          ),
          this.material,
        ),
      );
      // Both endpoints move every frame, so a once-computed bounding sphere
      // would be stale immediately — cheaper to just never cull a thread this
      // small. (Same reasoning the tube version had.)
      segment.frustumCulled = false;
      this.group.add(segment);
      segments.push(segment);
    }
    this.segments = segments;
  }

  /** Snaps the whole chain straight between the two points — no catch-up. */
  reset(from: Vector3, to: Vector3): void {
    for (let i = 0; i < POINTS; i += 1) {
      const t = i / (POINTS - 1);
      this.points[i]!.lerpVectors(from, to, t);
      this.previous[i]!.copy(this.points[i]!);
    }
    this.initialised = true;
    this.place();
  }

  /** Relaxes the chain towards the two (moved) endpoints for one frame. */
  update(from: Vector3, to: Vector3, dt: number): void {
    if (!this.initialised) {
      this.reset(from, to);
      return;
    }
    // Capped so a stutter (a tab losing focus, a slow phone) cannot fling the
    // free points across the park in one giant verlet step.
    const step = Math.min(dt, 1 / 30);

    for (let i = 1; i < POINTS - 1; i += 1) {
      const point = this.points[i]!;
      const prev = this.previous[i]!;
      const vx = (point.x - prev.x) * DRAG;
      const vy = (point.y - prev.y) * DRAG;
      const vz = (point.z - prev.z) * DRAG;
      prev.copy(point);
      point.x += vx;
      point.y += vy - GRAVITY * step * step;
      point.z += vz;
    }

    this.points[0]!.copy(from);
    this.points[POINTS - 1]!.copy(to);

    for (let iteration = 0; iteration < CONSTRAINT_ITERATIONS; iteration += 1) {
      for (let i = 0; i < POINTS - 1; i += 1) {
        const a = this.points[i]!;
        const b = this.points[i + 1]!;
        scratchDelta.subVectors(b, a);
        const distance = scratchDelta.length() || 0.0001;
        const diff = (distance - this.segmentLength) / distance;
        const pinnedA = i === 0;
        const pinnedB = i + 1 === POINTS - 1;
        if (pinnedA && pinnedB) continue;
        scratchDelta.multiplyScalar(diff * 0.5);
        if (!pinnedA) a.add(scratchDelta);
        if (!pinnedB) b.sub(scratchDelta);
      }
      // Constraints on the free points can nudge a pinned end off its exact
      // target by a hair; re-pin every pass rather than let it drift.
      this.points[0]!.copy(from);
      this.points[POINTS - 1]!.copy(to);
    }

    this.place();
  }

  dispose(): void {
    for (const segment of this.segments) segment.geometry.dispose();
    this.material.dispose();
  }

  // -------------------------------------------------------------- internals

  /**
   * Writes the chain's points onto the segment meshes. Four midpoints, four
   * `setFromUnitVectors` and four scales — no allocation anywhere in here.
   *
   * The scale is not optional decoration. `HeldBalloon.ts` pins the ends to
   * the player's hand and to a knot floating above her head, which are further
   * apart than the string's rest length essentially all of the time, so the
   * links are routinely stretched by a third. Fixed-length segments would
   * leave the string in four visibly separate pieces. Only Y is scaled, along
   * the capsule's own axis, so the thread never gets fatter or thinner.
   */
  private place(): void {
    for (let i = 0; i < POINTS - 1; i += 1) {
      const segment = this.segments[i];
      if (!segment) continue;
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      segment.position.addVectors(a, b).multiplyScalar(0.5);
      scratchDirection.subVectors(b, a);
      const length = scratchDirection.length();
      if (length < 1e-6) continue;
      segment.scale.y = length / this.segmentLength;
      scratchDirection.multiplyScalar(1 / length);
      // The capsule's own axis is +Y and the chain hangs downwards, so this is
      // usually close to a half turn. `setFromUnitVectors` has its own branch
      // for the antiparallel case and allocates nothing.
      segment.quaternion.setFromUnitVectors(UP, scratchDirection);
    }
  }
}
