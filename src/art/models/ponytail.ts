import {
  CapsuleGeometry,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Vector3,
  type Material,
} from 'three';
import { addOutline, solid } from '../style/materials';

/**
 * The floor-length ponytail — a springy chain that swings and trails as the
 * child walks, runs and jumps.
 *
 * ## Where this came from
 *
 * `entities/balloonString.ts` already solves "a thing hanging off a moving
 * character that must lag rather than teleport", and this is deliberately the
 * *same* solution rather than a second one: a handful of point masses,
 * verlet-integrated with a light gravity and drag, pulled back into shape by a
 * few distance-constraint passes, with the top point pinned to a moving anchor
 * every frame. Read that file first if this one is unfamiliar; the integrator
 * here is its integrator.
 *
 * ## Where it deliberately differs, and why
 *
 * 1. **It is tapered, and chunky.** Hair is *chunky* in this art direction, and
 *    it is thicker at the tie than at the tip, where a balloon string is one
 *    even 0.012 m thread end to end. Both are now drawn the same way: a fixed
 *    set of capsules built once, with each frame writing only a `position` and
 *    a `quaternion` on each. **Nothing in `update()` allocates.**
 *
 *    (`BalloonString` used to rebuild a `CatmullRomCurve3` and a `TubeGeometry`
 *    every frame, and this file was written to avoid copying that. It has since
 *    been brought over to this approach instead — see its own header.)
 *
 * 2. **It has safety rails a balloon does not need.** A balloon string is
 *    0.4 m long and both its ends are already smoothed. This is 1.55 m of hair
 *    pinned to a head that can be sprinting, jumping, riding a ride, or
 *    teleported into a building by an iris wipe — and `Game.timeScale`
 *    fast-forwards the whole world during a stair ride, which arrives here as
 *    a much larger `dt`. See {@link MAX_STEP}, {@link MAX_SUBSTEPS},
 *    {@link TELEPORT_DISTANCE} and the reach clamp in `constrain()`.
 *
 * 3. **It knows about the body.** Floor-length hair pinned to the back of the
 *    head will happily settle *inside* the torso and the backpack. Two cheap
 *    volumes — a vertical cylinder for the body and a sphere for the head —
 *    push it back out. Both are radially symmetric about a vertical axis, so
 *    neither needs the character's rotation, which keeps the test to a handful
 *    of multiplies.
 */

/** Points in the chain, the pinned anchor included. Eight segments. */
const POINTS = 9;

/**
 * Rest length of the whole tail in metres — anchor to tip.
 *
 * The anchor sits about 1.29 m above the feet (the tie, at the back of a head
 * whose pivot is at 1.36 m), so at rest the tip hangs a centimetre off the
 * floor and the ground clamp takes up the rest: floor-length, as asked for,
 * without a coil of hair piled on the grass.
 */
export const PONYTAIL_LENGTH = 1.3;

/** How fat the tail is at the tie, and at the tip. Chunky, per ART_DIRECTION. */
const RADIUS_TOP = 0.115;
const RADIUS_TIP = 0.045;

/**
 * Gravity, in metres per second squared, and nothing like 9.81.
 *
 * Hair is light and this is a cartoon: real gravity makes the tail snap to
 * vertical the instant the child stops, which kills the swing that is the
 * entire reason this exists.
 */
const GRAVITY = 16;

/** Per-substep velocity retention. Lower settles faster; too low reads dead. */
const DRAG = 0.986;

/** Distance-constraint relaxation passes per substep. More = stiffer tail. */
const CONSTRAINT_ITERATIONS = 5;

/**
 * The largest time step the integrator is ever handed, in seconds.
 *
 * Verlet with stiff distance constraints goes unstable well before a step
 * looks slow, so the step is capped rather than trusted — a tab regaining
 * focus, a slow phone, or `Game.timeScale` running the stair ride at several
 * times normal speed all arrive here as one big `dt`.
 */
const MAX_STEP = 1 / 45;

/**
 * How many capped steps one frame may run.
 *
 * Without this, fast-forward would simply simulate the hair in slow motion
 * (visibly lagging the child it is attached to); with an unbounded count, a
 * one-second stall would run forty-five steps and cost more than the frame it
 * is trying to catch up with. Three is enough to keep up with the fastest
 * time scale the game uses and is bounded work either way.
 */
const MAX_SUBSTEPS = 3;

/**
 * Metres the anchor may move in a single frame before the chain is snapped
 * straight instead of simulated.
 *
 * Entering a building, taking the stairs and finishing a ride all move the
 * player instantly. Without this the tail would be catapulted across the park
 * and spend a second whipping back — the reach clamp below would stop it
 * escaping, but it would still look broken.
 */
const TELEPORT_DISTANCE = 2.5;

/**
 * How far past its rest reach a point may ever get from the anchor.
 *
 * This is the hard rail, applied after the soft distance constraints on every
 * pass: whatever else goes wrong — a pathological frame, a NaN upstream, a
 * teleport the detector above somehow missed — a hair segment physically
 * cannot end up more than a couple of percent further from the child's head
 * than the hair is long.
 */
const MAX_REACH = 1.02;

// --- the body, as two volumes the hair is pushed out of ---------------------

/** Radius of the vertical cylinder standing in for the torso and backpack. */
const BODY_RADIUS = 0.46;

/** The cylinder's extent above the feet, in metres. */
const BODY_MIN_Y = 0.18;
const BODY_MAX_Y = 1.05;

/** Radius of the sphere standing in for the skull. Slightly inside the real one. */
const HEAD_RADIUS = 0.58;

/** How close to the ground the tip may get. It drags; it does not sink. */
const GROUND_CLEARANCE = 0.035;

/** How much horizontal speed a point keeps once it is dragging on the floor. */
const GROUND_FRICTION = 0.86;

// --- scratch. Module-level and reused: `update` must allocate nothing. -------

const UP = new Vector3(0, 1, 0);
const scratchAnchor = new Vector3();
const scratchOrigin = new Vector3();
const scratchHead = new Vector3();
const scratchDelta = new Vector3();
const scratchDirection = new Vector3();
const scratchInverse = new Matrix4();

/**
 * A tapered chain of hair segments, simulated in world space and drawn in a
 * host object's local space.
 *
 * The two spaces are the whole trick. The simulation has to be in **world**
 * space — in the character's own space the character never moves, so there is
 * no lag and therefore no swing. The meshes have to be in the character's
 * **local** space, so that the tail is part of the model rather than a second
 * thing in the scene that has to be added, removed and disposed alongside it.
 * One matrix inverse per frame converts between them.
 */
export class PonytailChain {
  /** Parent this to the character root. Its own transform stays identity. */
  readonly group = new Group();

  /** The segment meshes, tie end first. Exposed so the crowd/host can tag them. */
  readonly segments: readonly Mesh[];

  private readonly anchor: Object3D;
  private readonly host: Object3D;
  private readonly segmentLength: number;

  private readonly points: Vector3[] = [];
  private readonly previous: Vector3[] = [];
  private readonly local: Vector3[] = [];
  private readonly lastAnchor = new Vector3();
  private started = false;

  /**
   * `anchor` is the object the tail hangs from — the tie at the back of the
   * head. `host` is the object the segments are parented under, and whose
   * origin is at the character's feet: the body cylinder and the ground plane
   * are both measured from it, so it must be the model root, not the head.
   */
  constructor(anchor: Object3D, host: Object3D, material: Material, outlineThickness = 0.016) {
    this.anchor = anchor;
    this.host = host;
    this.segmentLength = PONYTAIL_LENGTH / (POINTS - 1);
    this.group.name = 'hair.ponytail';

    for (let i = 0; i < POINTS; i += 1) {
      this.points.push(new Vector3());
      this.previous.push(new Vector3());
      this.local.push(new Vector3());
    }

    const segments: Mesh[] = [];
    for (let i = 0; i < POINTS - 1; i += 1) {
      const t = i / (POINTS - 2);
      const radius = RADIUS_TOP + (RADIUS_TIP - RADIUS_TOP) * t * t;
      // The capsule's cylindrical part is shortened by its own rounded caps so
      // consecutive segments overlap into one continuous rope rather than a
      // string of visible sausages.
      const mesh = solid(
        new Mesh(new CapsuleGeometry(radius, Math.max(0.01, this.segmentLength - radius), 5, 12), material),
      );
      // Both ends move every frame, so a cached bounding sphere is stale the
      // moment it is computed — same reasoning as `BalloonString`'s.
      mesh.frustumCulled = false;
      addOutline(mesh, outlineThickness);
      this.group.add(mesh);
      segments.push(mesh);
    }
    this.segments = segments;
  }

  /** Snaps the tail straight down from the anchor. No catch-up, no swing. */
  reset(): void {
    this.anchor.updateWorldMatrix(true, false);
    this.anchor.getWorldPosition(scratchAnchor);
    for (let i = 0; i < POINTS; i += 1) {
      this.points[i]!.set(scratchAnchor.x, scratchAnchor.y - this.segmentLength * i, scratchAnchor.z);
      this.previous[i]!.copy(this.points[i]!);
    }
    this.lastAnchor.copy(scratchAnchor);
    this.started = true;
    this.place();
  }

  /**
   * One frame. `dt` is the game's already-time-scaled delta; this clamps it
   * itself rather than trusting the caller.
   */
  update(dt: number): void {
    this.anchor.updateWorldMatrix(true, false);
    this.anchor.getWorldPosition(scratchAnchor);

    if (!this.started || scratchAnchor.distanceTo(this.lastAnchor) > TELEPORT_DISTANCE) {
      this.reset();
      return;
    }
    this.lastAnchor.copy(scratchAnchor);

    if (dt > 0) {
      const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_STEP)));
      const step = Math.min(dt / substeps, MAX_STEP);
      // The host's own origin and the head's centre, read once for the whole
      // frame: both collision volumes are measured from them.
      this.host.getWorldPosition(scratchOrigin);
      this.anchor.getWorldPosition(scratchHead);
      for (let s = 0; s < substeps; s += 1) {
        this.integrate(step);
        this.constrain();
      }
    }

    this.place();
  }

  dispose(): void {
    for (const segment of this.segments) segment.geometry.dispose();
  }

  // -------------------------------------------------------------- internals

  private integrate(step: number): void {
    const fall = GRAVITY * step * step;
    for (let i = 1; i < POINTS; i += 1) {
      const point = this.points[i]!;
      const prev = this.previous[i]!;
      const vx = (point.x - prev.x) * DRAG;
      const vy = (point.y - prev.y) * DRAG;
      const vz = (point.z - prev.z) * DRAG;
      prev.copy(point);
      point.x += vx;
      point.y += vy - fall;
      point.z += vz;
    }
  }

  private constrain(): void {
    this.points[0]!.copy(scratchAnchor);

    for (let iteration = 0; iteration < CONSTRAINT_ITERATIONS; iteration += 1) {
      for (let i = 0; i < POINTS - 1; i += 1) {
        const a = this.points[i]!;
        const b = this.points[i + 1]!;
        scratchDelta.subVectors(b, a);
        const distance = scratchDelta.length() || 1e-4;
        const diff = (distance - this.segmentLength) / distance;
        // The anchor end never moves; the whole correction goes into `b`.
        scratchDelta.multiplyScalar(i === 0 ? diff : diff * 0.5);
        if (i > 0) a.add(scratchDelta);
        b.sub(scratchDelta);
      }
      this.points[0]!.copy(scratchAnchor);
    }

    for (let i = 1; i < POINTS; i += 1) {
      const point = this.points[i]!;

      this.pushOutOfSphere(point, scratchHead, HEAD_RADIUS);
      this.pushOutOfBody(point);

      // Ground: drag along it rather than sink through it.
      const floor = scratchOrigin.y + GROUND_CLEARANCE;
      if (point.y < floor) {
        point.y = floor;
        const prev = this.previous[i]!;
        prev.x += (point.x - prev.x) * (1 - GROUND_FRICTION);
        prev.z += (point.z - prev.z) * (1 - GROUND_FRICTION);
      }

      // The hard rail. Whatever the above did, a segment cannot be further
      // from the head than that much hair physically reaches.
      const reach = this.segmentLength * i * MAX_REACH;
      scratchDelta.subVectors(point, scratchAnchor);
      const distance = scratchDelta.length();
      if (distance > reach && distance > 1e-6) {
        point.copy(scratchAnchor).addScaledVector(scratchDelta, reach / distance);
      }
    }
  }

  /** Shoves a point radially out of the torso/backpack cylinder. */
  private pushOutOfBody(point: Vector3): void {
    const relY = point.y - scratchOrigin.y;
    if (relY < BODY_MIN_Y || relY > BODY_MAX_Y) return;
    const dx = point.x - scratchOrigin.x;
    const dz = point.z - scratchOrigin.z;
    const squared = dx * dx + dz * dz;
    if (squared >= BODY_RADIUS * BODY_RADIUS) return;
    if (squared < 1e-8) {
      // Dead on the axis, which has no "out". Push it behind the character,
      // read straight off the host's world matrix (column 2 is local +Z).
      const m = this.host.matrixWorld.elements;
      point.x = scratchOrigin.x - (m[8] ?? 0) * BODY_RADIUS;
      point.z = scratchOrigin.z - (m[10] ?? 1) * BODY_RADIUS;
      return;
    }
    const scale = BODY_RADIUS / Math.sqrt(squared);
    point.x = scratchOrigin.x + dx * scale;
    point.z = scratchOrigin.z + dz * scale;
  }

  private pushOutOfSphere(point: Vector3, centre: Vector3, radius: number): void {
    scratchDelta.subVectors(point, centre);
    const squared = scratchDelta.lengthSq();
    if (squared >= radius * radius || squared < 1e-8) return;
    point.copy(centre).addScaledVector(scratchDelta, radius / Math.sqrt(squared));
  }

  /**
   * Writes the simulated world-space points onto the segment meshes, in the
   * host's local space. One matrix inverse, then eight midpoints and eight
   * `setFromUnitVectors` — no allocation anywhere in here.
   */
  private place(): void {
    this.host.updateWorldMatrix(true, false);
    scratchInverse.copy(this.host.matrixWorld).invert();
    for (let i = 0; i < POINTS; i += 1) {
      this.local[i]!.copy(this.points[i]!).applyMatrix4(scratchInverse);
    }

    for (let i = 0; i < POINTS - 1; i += 1) {
      const segment = this.segments[i];
      if (!segment) continue;
      const a = this.local[i]!;
      const b = this.local[i + 1]!;
      segment.position.addVectors(a, b).multiplyScalar(0.5);
      scratchDirection.subVectors(b, a);
      const length = scratchDirection.length();
      if (length < 1e-6) continue;
      scratchDirection.multiplyScalar(1 / length);
      // The capsule's own axis is +Y; the chain runs downwards, so this is
      // almost always close to a half turn. `setFromUnitVectors` has its own
      // branch for the antiparallel case and allocates nothing.
      segment.quaternion.setFromUnitVectors(UP, scratchDirection);
    }
  }
}
