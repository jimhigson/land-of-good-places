import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
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

/**
 * **How far a point sits above the drawn trough surface**, given its place in
 * the chute's own cross-section (`across` along {@link SlideFrame.right}, `up`
 * along {@link SlideFrame.up}). Negative is inside the slide's geometry.
 *
 * Read straight off {@link PROFILE}, the polyline the sweep draws, so the
 * surface a rider is measured against and the surface a child sees are one
 * definition. Between the lips it is the height above the floor under that
 * point; beyond a side wall and below its lip it is how far through the wall the
 * point has gone; above the lip it is clear, whatever the distance.
 *
 * Exported for `check:slide-rider`, which asks it of every vertex of her drawn
 * body; the lift that lays her in the trough (`Player.restingUnderside`, then
 * {@link SlideRide.restLift}) is handed
 * {@link troughFloorAt}, the same floor — so the lift and the check that proves
 * it cannot hold two different ideas of where the floor is.
 */
export function troughClearance(across: number, up: number): number {
  if (Math.abs(across) > CHUTE_ENVELOPE.halfWidth) {
    return up >= CHUTE_ENVELOPE.above ? Infinity : CHUTE_ENVELOPE.halfWidth - Math.abs(across);
  }
  return up - troughFloorAt(across);
}

/**
 * **The height of the drawn trough's floor at `across`**, in the chute's own
 * cross-section — the surface {@link troughClearance} measures against, from
 * the same {@link PROFILE}. Beyond a side wall it is the lip, because the only
 * way over a wall is above it.
 *
 * This is what `Player.restingUnderside` and {@link SlideRide.restLift} lay the
 * child in the slide against.
 */
export function troughFloorAt(across: number): number {
  if (Math.abs(across) > CHUTE_ENVELOPE.halfWidth) return CHUTE_ENVELOPE.above;
  let floor = Infinity;
  for (let k = 0; k < PROFILE.length - 1; k += 1) {
    const [a0, u0] = PROFILE[k]!;
    const [a1, u1] = PROFILE[k + 1]!;
    if (a0 === a1) continue; // a side wall: the floor is the sloped and flat runs
    if (across < Math.min(a0, a1) || across > Math.max(a0, a1)) continue;
    const at = u0 + ((u1 - u0) * (across - a0)) / (a1 - a0);
    if (at < floor) floor = at;
  }
  return floor;
}

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
 * **The curve the chute is actually built on** — the one owner of it.
 *
 * `SlideRide` sweeps its trough along this, and `slide/solve.ts` judges *this*
 * rather than the control points it is threaded through. Those are not the same
 * line: a Catmull-Rom sags between its controls, and on seed 11 that sag put
 * the built chute 5.47 m from the Sky Cruiser where the control polygon had
 * 5.50 m and the solver was satisfied. Three centimetres, and exactly the shape
 * of fault this repo keeps paying for — a check honestly measuring something
 * other than the thing that gets drawn.
 */
export function chuteCurve(points: readonly Vector3[]): CatmullRomCurve3 {
  return new CatmullRomCurve3(points.map((p) => p.clone()), false, 'catmullrom', 0.5);
}

/**
 * The built chute's centre line, sampled the way a measurement wants it:
 * every {@link CHUTE_JUDGE_SPACING} metres along the curve above.
 */
export function chuteCentreLine(points: readonly Vector3[]): Vector3[] {
  if (points.length < 2) return points.map((p) => p.clone());
  const curve = chuteCurve(points);
  const length = curve.getLength();
  const steps = Math.max(points.length, Math.round(length / CHUTE_JUDGE_SPACING));
  const line: Vector3[] = [];
  for (let i = 0; i <= steps; i += 1) {
    line.push(curve.getPointAt(i / steps, new Vector3()));
  }
  return line;
}

/**
 * How finely the built chute is sampled when it is judged.
 *
 * 0.4 m, matching `test/procgen/parkFacts.ts`'s own sampling of the drawn ride,
 * so the line the generator accepts and the line the invariants measure are the
 * same line at the same resolution.
 */
const CHUTE_JUDGE_SPACING = 0.4;

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
    this.curve = chuteCurve(points);
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

  /**
   * **The trough's own cross-section at `t` — the one owner of "which way is up
   * in the slide".**
   *
   * Everything that rides, sits in, films or is carried by this chute has to
   * agree about the frame it is in, and before this existed nothing did. The
   * chute was swept about one notion of up ({@link sampleFrames}, world `+Y`),
   * the rider was leant onto a second (the sphere normal, via `faceOnGround`
   * inside `Player.setRidePose`), and the chase seat and the trackside cameras
   * each re-derived a third and fourth copy of the sweep's formula. Three
   * notions of up over 95 m of one chute is the bug this repo files most often,
   * and the child paid for it: measured on the canonical seed, her **head rode
   * 0.62 m below the trough floor** — `-0.676 m` in this frame against a floor
   * at `-0.06` — for a stretch of the descent, because she was pitched onto the
   * planet inside a trough that is not.
   *
   * So: ask here, never re-derive. {@link sampleFrames} is itself written in
   * terms of this, so the geometry a child sits in and the frame she is placed
   * in cannot drift apart — they are the same function.
   *
   * `previousRight` carries the sideways direction across a vertical tangent,
   * where `tangent x up` collapses. A caller sampling one `t` on its own has no
   * previous frame to offer and passes nothing, which is right for a slide: the
   * chute never goes vertical, and `theGinormousSlideNeverClimbs` is what keeps
   * that true.
   */
  frameAt(t: number, target = new SlideFrame(), previousRight?: Vector3): SlideFrame {
    this.pointAt(t, target.position);
    this.tangentAt(t, target.tangent);
    buildFrame(target, previousRight);
    return target;
  }

  /**
   * **The frame a rigid body `span` metres long lies in, with its front end at
   * `t`** — its axis the chord from the chute's centre line `span` metres back
   * up the slide to here, rather than the tangent at its front.
   *
   * A child lying in the slide is 1.3 m of rigid rig with her feet at `t`. Laid
   * along the tangent at her feet she overhangs every bend by `κs²/2` at her
   * head — measured on the canonical ride, her hair crown (1.74 m wide, in a
   * trough 1.9 m wide) went 2 cm through the side wall on the bends, where no
   * lift can help. Laid along the chord, like a railway carriage on its two
   * bogies, both ends sit on the centre line and the middle is off it by a
   * quarter of that. The frame is otherwise built exactly as {@link frameAt}
   * builds every frame, so up is the trough's up.
   *
   * Behind the lip the chute has no centre line, so the chord runs back along
   * the entry tangent — the same continuation `slide/petRiders.ts` seats a
   * companion on.
   */
  lyingFrameAt(t: number, span: number, target = new SlideFrame()): SlideFrame {
    this.pointAt(t, target.position);
    const back = clamp01(t) * this.length - span;
    if (back >= 0) {
      this.pointAt(back / this.length, _chordBack);
    } else {
      this.pointAt(0, _chordBack).addScaledVector(this.tangentAt(0, _chordEntry), back);
    }
    target.tangent.subVectors(target.position, _chordBack);
    if (target.tangent.lengthSq() < 1e-8) this.tangentAt(t, target.tangent);
    else target.tangent.normalize();
    buildFrame(target);
    return target;
  }

  /**
   * **How far along `here.up` a rigid body lying in `here` — a frame at `t`,
   * from {@link lyingFrameAt} — has to be raised so that every one of `points`
   * clears the drawn trough by `margin`, measured where each point actually
   * is.**
   *
   * `points` are in `here`: `across` along its `right`, `up` along its
   * `up`, `along` its tangent, from the centre line. A child 1.3 m long does not
   * lie in one cross-section: where the chute runs out flat into the ball pit
   * the floor under her head rises above the tangent at her feet, so a lift
   * solved in the cross-section at her feet alone left her hair 4 cm through
   * the floor there. So each point is carried to its own place on the chute
   * (one step along the tangent), read in *that* cross-section against
   * {@link troughFloorAt}, and the largest lift any of them needs is the answer.
   */
  restLift(
    here: SlideFrame,
    t: number,
    points: readonly { readonly across: number; readonly up: number; readonly along: number }[],
    margin: number,
  ): number {
    let lift = -Infinity;
    for (const point of points) {
      _restPoint
        .copy(here.position)
        .addScaledVector(here.right, point.across)
        .addScaledVector(here.up, point.up)
        .addScaledVector(here.tangent, point.along);
      let s = clamp01(t + point.along / this.length);
      let there = this.frameAt(s, _restThere);
      _restOffset.subVectors(_restPoint, there.position);
      s = clamp01(s + _restOffset.dot(there.tangent) / this.length);
      there = this.frameAt(s, _restThere);
      _restOffset.subVectors(_restPoint, there.position);
      const across = _restOffset.dot(there.right);
      const up = _restOffset.dot(there.up);
      // Raising her along `here.up` raises this point along `there.up` by the
      // cosine between the two — near 1 on any chute a child can ride.
      const gain = Math.max(0.5, here.up.dot(there.up));
      const need = (troughFloorAt(across) + margin - up) / gain;
      if (need > lift) lift = need;
    }
    return Number.isFinite(lift) ? lift : margin;
  }
}

/**
 * A cross-section of the chute: where it is, and the three axes a body lying in
 * it is turned by. `tangent` is the way she travels, `up` is out of the trough
 * towards the sky, `right` is across it.
 */
export class SlideFrame {
  readonly position = new Vector3();
  readonly tangent = new Vector3();
  readonly right = new Vector3();
  readonly up = new Vector3();

  /**
   * The turn that takes a model's own axes onto this frame's.
   *
   * A model faces `+Z`, so its forward goes to `tangent` and its up to `up`.
   * The `x` axis is then `up x tangent`, which is `-right` — the sweep names
   * its sideways axis `tangent x UP`, and that points the other way. Worth
   * stating because getting it backwards mirrors a rider rather than failing.
   *
   * Taken as a basis rather than as yaw-and-pitch euler angles on purpose:
   * angles need an order, an order needs everyone to agree on it, and that
   * agreement is exactly what broke here (`world/up.ts`'s `faceOnGround` built
   * a `YXZ` intent out of an `XYZ` euler for a year). A basis has no order to
   * get wrong.
   */
  orientation(target = new Quaternion()): Quaternion {
    _basisX.copy(this.right).multiplyScalar(-1);
    _basis.makeBasis(_basisX, this.up, this.tangent);
    return target.setFromRotationMatrix(_basis);
  }
}

const _basis = /* @__PURE__ */ new Matrix4();
const _restThere = /* @__PURE__ */ new SlideFrame();
const _chordBack = /* @__PURE__ */ new Vector3();
const _chordEntry = /* @__PURE__ */ new Vector3();
const _restPoint = /* @__PURE__ */ new Vector3();
const _restOffset = /* @__PURE__ */ new Vector3();
const _basisX = /* @__PURE__ */ new Vector3();

/**
 * Fill in `right` and `up` from a frame that already has its `tangent`.
 *
 * **Here "up" is always world up** — see the class header. However the slide
 * loops, the bit you sit in faces the sky.
 */
function buildFrame(frame: SlideFrame, previousRight?: Vector3): void {
  frame.right.crossVectors(frame.tangent, UP);
  // Straight up or straight down: keep whatever sideways we had last time.
  if (frame.right.lengthSq() < 1e-6) {
    if (previousRight) frame.right.copy(previousRight);
    else frame.right.set(1, 0, 0);
  }
  frame.right.normalize();
  frame.up.crossVectors(frame.right, frame.tangent).normalize();
}

// ------------------------------------------------------------------ sweeping

type Frame = SlideFrame;

/**
 * The frames the trough is swept along.
 *
 * **Built out of {@link SlideFrame} and {@link buildFrame}, which is what a
 * rider is placed by too** — one definition, so the shape a child sits in and
 * the frame she is turned by are the same arithmetic rather than two copies of
 * it kept in step by hand.
 */
function sampleFrames(curve: CatmullRomCurve3, steps: number): Frame[] {
  const frames: Frame[] = [];
  const previousRight = new Vector3(1, 0, 0);

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const frame = new SlideFrame();
    curve.getPointAt(t, frame.position);
    curve.getTangentAt(t, frame.tangent).normalize();
    buildFrame(frame, previousRight);
    previousRight.copy(frame.right);
    frames.push(frame);
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
