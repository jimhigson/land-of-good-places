import { CatmullRomCurve3, Mesh, TubeGeometry, Vector3 } from 'three';
import { ART } from '../art/style/artPalette';
import { decal, toonMaterial } from '../art/style/materials';

/**
 * A short verlet chain strung between two moving world-space points — the
 * player's hand and a held balloon's knot — resampled into a thin tube every
 * frame. See `entities/HeldBalloon.ts` for the system that owns one of these
 * per balloon.
 *
 * Deliberately **not** part of the balloon model (`art/models/balloons.ts`'s
 * own `makeString` draws a rigid cylinder, still used on the shop shelf): a
 * held balloon's string has to sag and catch up as the child walks, stops and
 * turns, which a fixed-length mesh parented rigidly to the hand cannot do. A
 * handful of point masses connected by distance constraints, with a light
 * gravity and drag, is the cheapest thing that visibly lags rather than
 * teleporting when either end moves — and it costs nothing when both ends
 * are still, since the chain settles and stops changing shape.
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
const TUBULAR_SEGMENTS = 8;
const RADIAL_SEGMENTS = 5;

const scratchDelta = new Vector3();

export class BalloonString {
  readonly mesh: Mesh;

  private readonly points: Vector3[];
  private readonly previous: Vector3[];
  private readonly segmentLength: number;
  private initialised = false;

  /** `length` is the string's rest length, hand to knot, in metres. */
  constructor(length: number) {
    this.segmentLength = length / (POINTS - 1);
    this.points = Array.from({ length: POINTS }, () => new Vector3());
    this.previous = Array.from({ length: POINTS }, () => new Vector3());

    const straight = new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(0, -length, 0)]);
    this.mesh = decal(new Mesh(new TubeGeometry(straight, TUBULAR_SEGMENTS, RADIUS, RADIAL_SEGMENTS, false), toonMaterial(ART.balloonString)));
    // Both endpoints move every frame and the geometry is rebuilt in place, so
    // a once-computed bounding sphere would be stale immediately — cheaper to
    // just never cull a string this small.
    this.mesh.frustumCulled = false;
  }

  /** Snaps the whole chain straight between the two points — no catch-up. */
  reset(from: Vector3, to: Vector3): void {
    for (let i = 0; i < POINTS; i += 1) {
      const t = i / (POINTS - 1);
      this.points[i]!.lerpVectors(from, to, t);
      this.previous[i]!.copy(this.points[i]!);
    }
    this.initialised = true;
    this.rebuildGeometry();
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

    this.rebuildGeometry();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material.dispose();
  }

  // -------------------------------------------------------------- internals

  private rebuildGeometry(): void {
    const curve = new CatmullRomCurve3(this.points, false, 'catmullrom', 0.5);
    const next = new TubeGeometry(curve, TUBULAR_SEGMENTS, RADIUS, RADIAL_SEGMENTS, false);
    this.mesh.geometry.dispose();
    this.mesh.geometry = next;
  }
}
