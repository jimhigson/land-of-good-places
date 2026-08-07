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

/**
 * How long one opaque-then-see-through cycle of the chute is, in metres.
 *
 * Issue #228, Jim's words: *"the slide should have a mix of transparent and
 * opaque sections to see the part through it"* — about half and half, so the
 * park floor shows through at intervals from the seat **and** from outside.
 *
 * The period is in **metres of chute** rather than a count of sections, so a
 * ride that comes out longer on another seed gets more bands rather than longer
 * ones, and the rhythm a rider feels is the same on every seed. At
 * {@link GIANT_SLIDE_SPEED} (6.5 m/s) 12 m is about 0.9 s of each — fast enough
 * to read as a pattern, slow enough not to strobe. Six metres was tried and
 * flickers; twenty-four reads as two different slides bolted together.
 */
const BAND_PERIOD = 12;

/**
 * The fraction of each cycle that is see-through. Jim asked for "about 50/50".
 *
 * The cycle **starts opaque**, so boarding reads as getting into a solid tube
 * and the first window arrives a beat later — which is also what QA asked for
 * when they noted the chute "reads as an enclosed tube for the first 2.5 s".
 */
const BAND_CLEAR_FRACTION = 0.5;

/**
 * How much of the park you can see through a see-through section.
 *
 * Tinted the chute's **own colour** rather than a neutral glass, so it reads as
 * a length of amber perspex in the same painted-toy family as the rest of the
 * ride (ART_DIRECTION.md §1) rather than as a hole where the chute should be.
 * Low enough that the grass and the ball pit read clearly through it, high
 * enough that the section is still obviously *there* — a chute you cannot see
 * at all is a chute a six-year-old thinks has a gap in it.
 *
 * **0.36 failed that second half.** QA of #227 found that 0.36 amber over green
 * grass is faint enough that the rider reads as floating, with no chute under
 * her — the exact failure the paragraph above warns about. Not a culling bug:
 * the material is `DoubleSide` with `depthWrite: false`, all correct. Jim's
 * ruling, 7 August 2026, was to raise it to 0.6.
 */
const CLEAR_OPACITY = 0.6;

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
  /**
   * The see-through half of the chute (#228), kept so
   * {@link SlideRide.setCastsShadow} can go on refusing to let it cast one.
   */
  private readonly clear: Mesh;

  private readonly sampleTarget = new Vector3();

  constructor(points: readonly Vector3[], options: SlideOptions) {
    this.group.name = options.name;
    this.curve = new CatmullRomCurve3(points.map((p) => p.clone()), false, 'catmullrom', 0.5);
    this.length = this.curve.getLength();

    const steps = Math.max(24, Math.round(this.length * SEGMENTS_PER_METRE));
    const frames = sampleFrames(this.curve, steps);

    // **Two meshes, one sweep**: the same profile swept along the same frames,
    // split into alternating bands so about half the chute is see-through
    // (#228). Splitting the geometry rather than making one mesh transparent
    // and fading it per-vertex is what keeps the opaque half genuinely opaque —
    // a single `transparent: true` mesh writes no depth anywhere, so the solid
    // sections would stop occluding what is behind them too.
    //
    // Every quad belongs to exactly one of the two, so together they are the
    // chute that was always built here: no gaps at the joins, and nothing
    // drawn twice.
    const colour = options.colour ?? PALETTE.slideChute;
    const chute = new Mesh(
      buildChute(frames, (arc) => !isClearBand(arc, this.length)),
      // A ride part, so it is toon-shaded like the rest of the park's toys.
      // DoubleSide because you see the inside of the chute all the way down.
      toonMaterial(colour, { side: DoubleSide }),
    );
    chute.name = `${options.name}-chute`;
    chute.castShadow = true;
    chute.receiveShadow = true;
    this.group.add(chute);

    // **`DoubleSide`, so the trap CLAUDE.md records cannot apply here.** The
    // hood faces went invisible because a `FrontSide` material was handed a
    // mesh wound the other way round and every face was culled. This mesh is
    // the same sweep, with the same winding, as the opaque one beside it, and
    // both are drawn from both sides — if one is visible the other is.
    this.clear = new Mesh(
      buildChute(frames, (arc) => isClearBand(arc, this.length)),
      toonMaterial(colour, {
        side: DoubleSide,
        transparent: true,
        opacity: CLEAR_OPACITY,
        // Off, so the tube's own far wall shows through its near wall the way
        // a length of coloured perspex does, instead of the two fighting over
        // which was drawn first.
        depthWrite: false,
      }),
    );
    this.clear.name = `${options.name}-chute-clear`;
    // **Deliberately casts no shadow**, which is the point rather than a
    // saving: the shadow the ride lays on the grass comes out dashed, one bar
    // per solid section, so the pattern is legible from the ground as well as
    // from the seat. A see-through section that threw a solid shadow would
    // read as a rendering mistake.
    this.clear.castShadow = false;
    this.clear.receiveShadow = true;
    this.group.add(this.clear);

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
    // …except the see-through sections, which never cast one. Re-asserted after
    // the traverse rather than trusted to callers: this method exists to be
    // called with `true`, and a blanket traverse would otherwise quietly undo
    // the dashed shadow the bands are for.
    this.clear.castShadow = false;
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

/**
 * Is the chute see-through `arc` of the way along itself (0…1)?
 *
 * Alternating rather than random: #228 guessed alternating would read better and
 * it does — a regular rhythm reads as a made thing, which is what everything in
 * this park is (ART_DIRECTION.md §1), where a random split reads as damage.
 *
 * Takes the fraction along rather than a ring index so the band length is in
 * **metres of chute**, not in samples: `SEGMENTS_PER_METRE` is a rendering
 * detail and the pattern a child sees must not change when it does.
 */
function isClearBand(arc: number, length: number): boolean {
  const cycle = ((arc * length) % BAND_PERIOD) / BAND_PERIOD;
  // The cycle starts opaque, so the run-in out of the castle is solid.
  return cycle >= 1 - BAND_CLEAR_FRACTION;
}

/**
 * One non-indexed strip surface joining every profile point along the sweep,
 * for the quads `wanted` accepts.
 *
 * `wanted` is asked about the fraction along the chute at which each quad
 * *starts*, so a quad belongs to exactly one band and the two meshes tile the
 * whole sweep between them with no gap and no overlap.
 */
function buildChute(
  frames: readonly Frame[],
  wanted: (arc: number) => boolean,
): BufferGeometry {
  const rings = frames.length;
  const across = PROFILE.length;
  const bands: number[] = [];
  for (let i = 0; i < rings - 1; i += 1) {
    if (wanted(i / (rings - 1))) bands.push(i);
  }
  const quads = bands.length * (across - 1);
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

  for (const i of bands) {
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
