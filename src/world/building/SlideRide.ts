import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Group,
  Mesh,
  TubeGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { toonMaterial } from '../../art/style/materials';

/** Cross-section of a chute, as (across, up) pairs in metres. */
const PROFILE: readonly (readonly [number, number])[] = [
  [-0.95, 0.86],
  [-0.95, 0.3],
  [-0.66, 0.03],
  [0, -0.06],
  [0.66, 0.03],
  [0.95, 0.3],
  [0.95, 0.86],
];

/**
 * The space the chute itself occupies around its centre line.
 *
 * **Derived from {@link PROFILE}, never restated.** This is what a rider is
 * actually inside, so it is the threshold a clearance check should use — as
 * opposed to `slide/plan.ts`'s `CORRIDOR_RADIUS` (1.45 m), which is the wider
 * margin the *generator* steers by and includes room it does not physically
 * fill. Measuring a collision against the generator's target rather than the
 * built trough would report a clip half a metre before there is one, and the
 * temptation would then be to loosen the wrong number.
 */
export const CHUTE_ENVELOPE = {
  halfWidth: Math.max(...PROFILE.map(([across]) => Math.abs(across))),
  above: Math.max(...PROFILE.map(([, up]) => up)),
  below: -Math.min(...PROFILE.map(([, up]) => up)),
} as const;

const SEGMENTS_PER_METRE = 2.2;
const UP = new Vector3(0, 1, 0);

export interface SlideOptions {
  readonly name: string;
  readonly colour?: number;
  readonly railColour?: number;
}

/**
 * A slide you ride down.
 *
 * The chute is swept by hand rather than with `ExtrudeGeometry`'s `extrudePath`,
 * because Frenet frames roll through a corkscrew and would tip the open side of
 * the slide over. Here "up" is always world up, so however the slide loops, the
 * bit you sit in faces the sky.
 *
 * The ride itself is a scripted trip along the same curve — see `Building` — so
 * the geometry and the path a child travels can never disagree.
 */
export class SlideRide {
  readonly group = new Group();
  readonly curve: CatmullRomCurve3;
  readonly length: number;

  private readonly sampleTarget = new Vector3();

  constructor(points: readonly Vector3[], options: SlideOptions) {
    this.group.name = options.name;
    this.curve = new CatmullRomCurve3(points.map((p) => p.clone()), false, 'catmullrom', 0.5);
    this.length = this.curve.getLength();

    const steps = Math.max(24, Math.round(this.length * SEGMENTS_PER_METRE));
    const frames = sampleFrames(this.curve, steps);

    const chute = new Mesh(
      buildChute(frames),
      // A ride part, so it is toon-shaded like the rest of the park's toys.
      // DoubleSide because you see the inside of the chute all the way down.
      toonMaterial(options.colour ?? PALETTE.slideChute, { side: DoubleSide }),
    );
    chute.name = `${options.name}-chute`;
    chute.castShadow = true;
    chute.receiveShadow = true;
    this.group.add(chute);

    const railMaterial = toonMaterial(options.railColour ?? PALETTE.slideRail);
    for (const side of [-1, 1] as const) {
      const rail = new Mesh(
        new TubeGeometry(railCurve(frames, side), steps, 0.11, 7, false),
        railMaterial,
      );
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.group.add(rail);
    }
  }

  /** Turns the whole chute into a shadow caster, or not. */
  setCastsShadow(casts: boolean): void {
    this.group.traverse((object) => {
      object.castShadow = casts;
    });
  }

  /** World position on the slide floor at `t` in [0, 1]. */
  pointAt(t: number, target = this.sampleTarget): Vector3 {
    return this.curve.getPointAt(clamp01(t), target);
  }

  /** Unit tangent at `t`, pointing the way you are travelling. */
  tangentAt(t: number, target = new Vector3()): Vector3 {
    return this.curve.getTangentAt(clamp01(t), target).normalize();
  }
}

// ------------------------------------------------------------------ sweeping

interface Frame {
  readonly position: Vector3;
  readonly right: Vector3;
  readonly up: Vector3;
}

function sampleFrames(curve: CatmullRomCurve3, steps: number): Frame[] {
  const frames: Frame[] = [];
  const previousRight = new Vector3(1, 0, 0);

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const position = curve.getPointAt(t, new Vector3());
    const tangent = curve.getTangentAt(t, new Vector3()).normalize();

    const right = new Vector3().crossVectors(tangent, UP);
    // Straight up or straight down: keep whatever sideways we had last time.
    if (right.lengthSq() < 1e-6) right.copy(previousRight);
    right.normalize();
    previousRight.copy(right);

    const up = new Vector3().crossVectors(right, tangent).normalize();
    frames.push({ position, right, up });
  }
  return frames;
}

/** One non-indexed strip surface joining every profile point along the sweep. */
function buildChute(frames: readonly Frame[]): BufferGeometry {
  const rings = frames.length;
  const across = PROFILE.length;
  const quads = (rings - 1) * (across - 1);
  const positions = new Float32Array(quads * 6 * 3);
  const normals = new Float32Array(quads * 6 * 3);

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const d = new Vector3();
  const edgeA = new Vector3();
  const edgeB = new Vector3();
  const normal = new Vector3();
  let cursor = 0;

  const at = (frameIndex: number, profileIndex: number, target: Vector3): Vector3 => {
    const frame = frames[frameIndex];
    const entry = PROFILE[profileIndex];
    if (!frame || !entry) return target.set(0, 0, 0);
    return target
      .copy(frame.position)
      .addScaledVector(frame.right, entry[0])
      .addScaledVector(frame.up, entry[1]);
  };

  for (let i = 0; i < rings - 1; i += 1) {
    for (let j = 0; j < across - 1; j += 1) {
      at(i, j, a);
      at(i, j + 1, b);
      at(i + 1, j + 1, c);
      at(i + 1, j, d);

      // The triangles are wound a-b-c / a-c-d, so the front-face normal is
      // cross(b - a, d - a). Get this the wrong way round and every face is lit
      // from behind: three only flips normals for faces the winding calls back
      // faces, not for ones whose supplied normal happens to point away.
      edgeA.subVectors(b, a);
      edgeB.subVectors(d, a);
      normal.crossVectors(edgeA, edgeB).normalize();

      for (const corner of [a, b, c, a, c, d]) {
        positions[cursor] = corner.x;
        positions[cursor + 1] = corner.y;
        positions[cursor + 2] = corner.z;
        normals[cursor] = normal.x;
        normals[cursor + 1] = normal.y;
        normals[cursor + 2] = normal.z;
        cursor += 3;
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** The curve one of the two hand-rails follows, along the top of the chute. */
function railCurve(frames: readonly Frame[], side: -1 | 1): CatmullRomCurve3 {
  const points = frames.map((frame) =>
    frame.position
      .clone()
      .addScaledVector(frame.right, side * 1.0)
      .addScaledVector(frame.up, 0.9),
  );
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
