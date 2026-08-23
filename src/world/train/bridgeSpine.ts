import type { LevelCrossing, SpinePoint } from './crossings';

/**
 * The curved local frame a bridge is laid out in (Jim's bridge feedback,
 * 2026-08-23: *"the whole thing can follow a gentle curve along its length,
 * not perfectly straight"*).
 *
 * Everything the bridge machinery used to compute in a straight
 * `(cx, cz) + dir·along + across·t` frame now goes through one of these
 * instead: `pointAt(along)` walks the drawn path's own centreline
 * ({@link LevelCrossing.spine}) and `project(x, z)` inverts it, so the
 * footprint search, the built masonry, the walkable surface, the fence
 * seam and the invariants all agree — one owner — about where "2 m across,
 * 7 m along" actually is on a curved crossing. A crossing with no drawn
 * run through it (the gate walk) degrades to exactly the straight frame
 * the old geometry always used, because its spine is empty.
 *
 * ## The lateral `shift` lever
 *
 * `bridgeFootprint.ts`'s backtracking search slides a candidate deck
 * sideways to dodge an obstacle. In this frame that is a constant offset
 * along the local normal — the spine translates sideways as one piece, so
 * a shifted bridge still follows the path's curve, just beside it.
 *
 * ## Why the spine is deviation-capped
 *
 * The early, conservative reservation pass (`bridgeKeepout.ts`) reserves a
 * *straight* rectangle around each crossing before any path curvature is
 * consultable, padded by `maxLateralShiftFor` (≥ 4 m). A spine that
 * wandered further than that from the crossing's own straight axis would
 * put real bridge masonry on ground the reservation never protected — a
 * tree could legitimately stand there. {@link DEVIATION_CAP} trims the
 * spine where it strays past what the reservation provably covered, and
 * the frame extrapolates straight beyond the trim, so a sharply-curving
 * path gets a bridge that follows it as far as is safe and no further.
 */

/** Uniform resample pitch of the frame's own polyline, metres. */
const STEP = 0.5;

/**
 * How far the spine may stray from the straight line through the crossing
 * before it is trimmed — see the file header. Deliberately under the 4 m
 * floor of `bridgeFootprint.ts`'s `maxLateralShiftFor`, the padding the
 * early reservation always carries.
 */
const DEVIATION_CAP = 3.0;

export interface FramePoint {
  readonly x: number;
  readonly z: number;
  /** Unit tangent (the local "along" direction). */
  readonly dirX: number;
  readonly dirZ: number;
  /** Unit normal (the local "across" direction), `(-dirZ, dirX)` — the same
   * convention every straight-frame consumer already used. */
  readonly acrossX: number;
  readonly acrossZ: number;
}

export class SpineFrame {
  /** Resampled points, index 0 at `along = alongMin`. */
  private readonly points: FramePoint[] = [];
  /** `along` of `points[0]` — negative (behind the crossing). */
  private alongMin: number;
  constructor(crossing: Pick<LevelCrossing, 'x' | 'z' | 'pathDirX' | 'pathDirZ' | 'spine'>) {
    const dirX = crossing.pathDirX;
    const dirZ = crossing.pathDirZ;

    // Resample the spine at uniform arc pitch, splitting it at the point
    // nearest the crossing so `along = 0` is exactly the crossing.
    const raw: SpinePoint[] = [...crossing.spine];
    const usable = raw.length >= 2 ? raw : null;

    if (!usable) {
      // Straight fallback: a generous fixed reach either way; `pointAt`
      // clamps `along` into it and extrapolates linearly regardless, so the
      // exact figure only bounds the resample, not the frame's reach.
      const reach = 36;
      this.alongMin = -reach;
      for (let a = -reach; a <= reach + 1e-6; a += STEP) {
        this.points.push({
          x: crossing.x + dirX * a,
          z: crossing.z + dirZ * a,
          dirX,
          dirZ,
          acrossX: -dirZ,
          acrossZ: dirX,
        });
      }
      return;
    }

    // Arc-length parametrise the raw polyline and find the crossing's own
    // arc position (nearest point on the polyline).
    const arc: number[] = [0];
    for (let i = 1; i < usable.length; i += 1) {
      const a = usable[i - 1] as SpinePoint;
      const b = usable[i] as SpinePoint;
      arc.push((arc[i - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z));
    }
    let crossingArc = 0;
    let bestDistance = Infinity;
    for (let i = 1; i < usable.length; i += 1) {
      const a = usable[i - 1] as SpinePoint;
      const b = usable[i] as SpinePoint;
      const segX = b.x - a.x;
      const segZ = b.z - a.z;
      const lengthSq = segX * segX + segZ * segZ;
      if (lengthSq === 0) continue;
      let t = ((crossing.x - a.x) * segX + (crossing.z - a.z) * segZ) / lengthSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + segX * t;
      const pz = a.z + segZ * t;
      const d = Math.hypot(px - crossing.x, pz - crossing.z);
      if (d < bestDistance) {
        bestDistance = d;
        crossingArc = (arc[i - 1] as number) + Math.sqrt(lengthSq) * t;
      }
    }

    const pointOnRaw = (s: number): SpinePoint => {
      if (s <= 0) return usable[0] as SpinePoint;
      const total = arc[arc.length - 1] as number;
      if (s >= total) return usable[usable.length - 1] as SpinePoint;
      let i = 1;
      while ((arc[i] as number) < s) i += 1;
      const a = usable[i - 1] as SpinePoint;
      const b = usable[i] as SpinePoint;
      const span = (arc[i] as number) - (arc[i - 1] as number);
      const t = span > 0 ? (s - (arc[i - 1] as number)) / span : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    };

    // Deviation trim: keep only the stretch whose lateral distance from the
    // crossing's straight axis stays under DEVIATION_CAP — measured per
    // resampled point, walking out from the crossing in each direction and
    // stopping at the first breach (never resuming past it, so the kept
    // stretch is contiguous).
    const deviation = (p: SpinePoint): number =>
      Math.abs((p.x - crossing.x) * -dirZ + (p.z - crossing.z) * dirX);
    const total = arc[arc.length - 1] as number;
    let sMin = crossingArc;
    while (sMin - STEP >= 0 && deviation(pointOnRaw(sMin - STEP)) <= DEVIATION_CAP) sMin -= STEP;
    let sMax = crossingArc;
    while (sMax + STEP <= total && deviation(pointOnRaw(sMax + STEP)) <= DEVIATION_CAP) sMax += STEP;

    this.alongMin = sMin - crossingArc;
    for (let s = sMin; s <= sMax + 1e-6; s += STEP) {
      const p = pointOnRaw(s);
      // Central-difference tangent, off the raw polyline so the resample
      // pitch never aliases it.
      const before = pointOnRaw(Math.max(sMin, s - STEP));
      const after = pointOnRaw(Math.min(sMax, s + STEP));
      let tx = after.x - before.x;
      let tz = after.z - before.z;
      const norm = Math.hypot(tx, tz);
      if (norm < 1e-6) {
        tx = dirX;
        tz = dirZ;
      } else {
        tx /= norm;
        tz /= norm;
      }
      this.points.push({ x: p.x, z: p.z, dirX: tx, dirZ: tz, acrossX: -tz, acrossZ: tx });
    }
    if (this.points.length < 2) {
      // Degenerate spine (all trimmed) — rebuild as the straight fallback.
      this.points.length = 0;
      const reach = 36;
      this.alongMin = -reach;
      for (let a = -reach; a <= reach + 1e-6; a += STEP) {
        this.points.push({
          x: crossing.x + dirX * a,
          z: crossing.z + dirZ * a,
          dirX,
          dirZ,
          acrossX: -dirZ,
          acrossZ: dirX,
        });
      }
    }
  }

  /** The frame at `along` metres from the crossing (negative = behind),
   * extrapolating straight past either end of the recorded spine. */
  pointAt(along: number): FramePoint {
    const index = (along - this.alongMin) / STEP;
    const last = this.points.length - 1;
    if (index <= 0) {
      const p = this.points[0] as FramePoint;
      const overshoot = (index - 0) * STEP;
      return { ...p, x: p.x + p.dirX * overshoot, z: p.z + p.dirZ * overshoot };
    }
    if (index >= last) {
      const p = this.points[last] as FramePoint;
      const overshoot = (index - last) * STEP;
      return { ...p, x: p.x + p.dirX * overshoot, z: p.z + p.dirZ * overshoot };
    }
    const i = Math.floor(index);
    const t = index - i;
    const a = this.points[i] as FramePoint;
    const b = this.points[i + 1] as FramePoint;
    // Positions lerp; directions lerp-and-renormalise (adjacent tangents on
    // a gentle curve are near-parallel, so this is safe).
    let dirX = a.dirX + (b.dirX - a.dirX) * t;
    let dirZ = a.dirZ + (b.dirZ - a.dirZ) * t;
    const norm = Math.hypot(dirX, dirZ) || 1;
    dirX /= norm;
    dirZ /= norm;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      dirX,
      dirZ,
      acrossX: -dirZ,
      acrossZ: dirX,
    };
  }

  /** A world point at `(along, across)` in this frame, with the whole frame
   * slid `shift` metres along its local normal (the search's lateral
   * lever — see the file header). */
  worldAt(along: number, across: number, shift = 0): { x: number; z: number } {
    const p = this.pointAt(along);
    const offset = across + shift;
    return { x: p.x + p.acrossX * offset, z: p.z + p.acrossZ * offset };
  }

  /**
   * Inverts {@link worldAt}: the `(along, across)` of a world point against
   * the frame slid by `shift`. Nearest-sample projection refined against
   * the local tangent — exact for the straight fallback, and within the
   * resample pitch of exact on a gentle curve.
   */
  project(x: number, z: number, shift = 0): { along: number; across: number } {
    let bestIndex = 0;
    let bestDistanceSq = Infinity;
    for (let i = 0; i < this.points.length; i += 1) {
      const p = this.points[i] as FramePoint;
      const px = p.x + p.acrossX * shift;
      const pz = p.z + p.acrossZ * shift;
      const dx = x - px;
      const dz = z - pz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistanceSq) {
        bestDistanceSq = dSq;
        bestIndex = i;
      }
    }
    const p = this.points[bestIndex] as FramePoint;
    const px = p.x + p.acrossX * shift;
    const pz = p.z + p.acrossZ * shift;
    const dx = x - px;
    const dz = z - pz;
    const alongOffset = dx * p.dirX + dz * p.dirZ;
    const across = dx * p.acrossX + dz * p.acrossZ;
    return { along: this.alongMin + bestIndex * STEP + alongOffset, across };
  }
}

/** One frame per crossing, cached — the frame is pure geometry derived from
 * the crossing's own recorded spine, so it never changes after boot. */
const frames = new WeakMap<object, SpineFrame>();

export function frameFor(
  crossing: Pick<LevelCrossing, 'x' | 'z' | 'pathDirX' | 'pathDirZ' | 'spine'>,
): SpineFrame {
  let frame = frames.get(crossing);
  if (!frame) {
    frame = new SpineFrame(crossing);
    frames.set(crossing, frame);
  }
  return frame;
}
