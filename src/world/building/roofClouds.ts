import {
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { clamp, Rng, TAU } from '../../core/mathUtils';
import { disposeTree, toonMaterial } from '../../art/style/materials';

/**
 * **The clouds that drift past the roof garden** (issue #455).
 *
 * Jim, riding the lift up: *"There is a green floor for some reason below the
 * roof garden — it is supposed to be high in the air. Instead, add some
 * transparent clouds floating past to give a sense of height."*
 *
 * The green floor was `Shell.ts`'s `buildInteriorPlaza` disc, a metre and a bit
 * under the terrace; that file's doc records why it was there and why the roof
 * no longer gets one. This is the second half of the answer. With the disc gone
 * the roof stands in open sky, and open sky on its own has **no scale** — a
 * gradient looks the same from a garden wall as from fifty metres up. Weather
 * moving past at your own eye height is what says how high you are, which is
 * why the brief asks for clouds rather than for a longer drop.
 *
 * ## Why they are beside you, not below you
 *
 * The obvious build is a carpet of cloud far underneath, seen from above. That
 * reads from a bird's view and reads as *nothing at all* from where a child
 * actually stands: the iso camera sits behind and above her shoulder, the
 * parapet is 1.05 m tall, and anything more than a few metres down is hidden
 * behind it until she walks right to the rim.
 *
 * So the field is a **band hugging the parapet**, in two tiers: a near one that
 * passes within a few metres of the rim between her knees and above her head,
 * and a deeper, bigger one further down, so that leaning over the edge shows
 * cloud falling away rather than one layer over a void. The near tier is the
 * one that does the work; the deep tier is what stops it looking like a shelf.
 *
 * ## They travel along the building's own outline
 *
 * A cloud's plan position is a point on the roof plate's outline pushed
 * **outwards**, and drifting means walking that outline. Two things fall out of
 * it for free: a cloud can never cross the terrace it is supposed to float past
 * (its offset is outward by construction, so it has nowhere to go but around),
 * and the drift genuinely wraps — no cloud is ever spawned, faded in, or
 * teleported back to the start where a child might see it happen. The outline is
 * a rounded rectangle so the corners get their share; an axis-aligned rectangle
 * leaves four diagonal gaps, which is exactly where the iso camera looks.
 *
 * The plate's half-extents are **asked for, never restated** — `Building` passes
 * `CASTLE_ROOF`'s own, from `building/floors.ts`, which is the one owner of how
 * big a castle floor is. Shrink the roof and the clouds come in with it.
 *
 * ## Why this is not `ferrisWheel/clouds.ts`
 *
 * That module looks similar and is deliberately left alone. It is not scenery:
 * it is a **stage curtain** with a contract — `enveloped()` is the single number
 * the ferris wheel's whole park-away/Earth-out swap runs off — and its numbers
 * (156 clouds, 6–13 m puffs, a 68 m band spread over 300 m) are tuned to be
 * *opaque overhead* for a child flying through it at 96 m. Everything this file
 * wants is the opposite: transparent, small, close, and beside you. The only
 * thing genuinely shared is what a cloud in this park is made of — flattened
 * spheres of {@link PALETTE.blossomWhite} in one instanced mesh — which is
 * ART_DIRECTION's house style rather than a fact either file owns.
 *
 * ## Cost
 *
 * One draw call. Thirty-odd clouds of three to five puffs each, all instances of
 * one sphere, re-posed each frame like the ferris band's are — and only on the
 * frames the roof garden is the space being drawn. Nothing casts or catches a
 * shadow.
 */

/**
 * **How much of the world is actually in shot, and why every number below is
 * smaller than it first looks.**
 *
 * The park's camera is orthographic and tight: measured on the running game by
 * projecting the roof plate's own corners, one screen half-width is about
 * **twelve metres**, and the 42 x 31 m plate does not remotely fit in frame. So
 * a cloud is only ever seen at all when it is within a dozen metres of the
 * child — which happens when she walks to the parapet and looks over, which is
 * exactly the moment the brief is about.
 *
 * The first build of this file used a 6–40 m band forty metres deep, on the
 * reasonable-sounding grounds that a weather system should be big. It rendered
 * a hundred and sixteen puffs, of which — measured, not guessed — **zero were
 * on screen**. Any change to the two tiers below should be re-measured the same
 * way rather than reasoned about: an orthographic frame is much smaller than it
 * feels while reading metres in a source file.
 */

/**
 * The near tier: the clouds that **drift past her**, just outside the parapet
 * and around head height. These are the ones that do the job.
 */
const NEAR_COUNT = 22;
const NEAR_OUT_MIN = 3.5;
const NEAR_OUT_MAX = 10;
const NEAR_TOP = 2.6;
const NEAR_BOTTOM = -7;
/** Small: at four metres away a big puff is a white wall across the frame. */
const NEAR_PUFF_MIN = 1.3;
const NEAR_PUFF_MAX = 2.6;

/**
 * The deep tier: cloud **going down**, so that leaning over the rim shows layers
 * falling away rather than one lonely layer with a void beneath it. Bigger, and
 * further out, because they are read as distant.
 */
const DEEP_COUNT = 16;
const DEEP_OUT_MIN = 5;
const DEEP_OUT_MAX = 22;
const DEEP_TOP = -9;
const DEEP_BOTTOM = -26;
const DEEP_PUFF_MIN = 2.2;
const DEEP_PUFF_MAX = 4.4;

/** Puffs per cloud — the park's chunky three-to-five-lobed painted cloud. */
const PUFFS_MIN = 3;
const PUFFS_MAX = 5;

/**
 * How far a puff sits from its cloud's own centre, as a multiple of its radius.
 *
 * Written as a ratio rather than in metres so the two tiers keep the same
 * *shape* at different sizes: a deep cloud is a big version of a near one, not
 * a differently-proportioned one.
 *
 * **A cloud is laid out in the outline's own frame**, not in a random one: local
 * X runs along the direction it is travelling and local Z points outwards, away
 * from the building. That is worth the few lines it costs for two reasons.
 * A cloud then streaks along the way it is going, which is what a cloud does;
 * and — the load-bearing one — its inward reach is `PUFF_SPREAD_Z × radius`,
 * which is **less than {@link NEAR_OUT_MIN} and {@link DEEP_OUT_MIN}**, so no
 * puff can ever poke back over the parapet and hang above the garden. With a
 * random yaw the long X spread pointed inwards about a quarter of the time and
 * dropped grey blobs on the meadow; that is what this arrangement rules out
 * rather than merely making unlikely.
 */
const PUFF_SPREAD_X = 1.9;
const PUFF_SPREAD_Y = 0.42;
const PUFF_SPREAD_Z = 0.85;

/** How far off the outline's bearing a cloud may be twisted, in radians. */
const YAW_JITTER = 0.3;

/** How fast a cloud travels around the building, in metres per second. */
const DRIFT_MIN = 0.55;
const DRIFT_MAX = 1.35;

/**
 * How see-through a cloud is.
 *
 * *"Transparent clouds"*, verbatim from the brief, and the number does real
 * work: at full opacity the band reads as a white wall round the terrace and
 * takes the sky's colour away from it again — which is the complaint the green
 * disc caused. At 0.6 the sunset comes through them.
 */
const CLOUD_OPACITY = 0.6;

/** How far a cloud bobs up and down as it goes, and how fast. */
const BOB_AMPLITUDE = 0.8;
const BOB_RATE = 0.11;

/** The clouds around the roof garden. Parent {@link root} to the roof's floor group. */
export interface RoofClouds {
  readonly root: Group;
  /**
   * Advances the drift. `elapsed` drives the bob; `dt` drives the travel.
   *
   * Call it only while the roof garden is the space being drawn — `Building`
   * does. Per-space visibility lives on the *floor group*, so this object's own
   * `visible` flag stays true whichever floor she is on and cannot be used to
   * decide; and a band nobody can see has no business re-posing a hundred and
   * thirty matrices while she is shopping in the mall.
   */
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

interface Cloud {
  /** How far outside the plate's outline it flies. Fixed for its lifetime. */
  readonly out: number;
  /** Perimeter of the outline at that offset — its own lap length, in metres. */
  readonly lap: number;
  /** Height of its centre over the deck, before the bob. */
  readonly y: number;
  /** Metres per second around the outline. */
  readonly speed: number;
  /**
   * A small twist off the outline's own bearing, so no two clouds lie exactly
   * parallel to the parapet they are passing. Kept small on purpose — see
   * {@link PUFF_SPREAD_Z} for what a big one would let through.
   */
  readonly yaw: number;
  /** Its own phase, so thirty clouds do not bob in unison. */
  readonly phase: number;
  /** How far round its lap it has travelled, in metres. */
  travelled: number;
}

interface Puff {
  readonly cloud: number;
  readonly offset: Vector3;
  readonly radius: number;
  /** How squashed. Clouds are wider than they are tall. */
  readonly flatten: number;
}

/**
 * A point on the roof plate's outline, pushed `out` metres outwards.
 *
 * The outline is the plate's rectangle offset outwards by `out` — four straight
 * edges of the plate's own length joined by four quarter-circle corners of
 * radius `out`, which is the exact set of points that distance from the
 * rectangle. `distance` is measured along it from the middle of the north edge,
 * and wraps.
 */
function outlinePoint(
  halfX: number,
  halfZ: number,
  out: number,
  distance: number,
  target: Vector3,
): void {
  const straightX = 2 * halfX;
  const straightZ = 2 * halfZ;
  const arc = (Math.PI / 2) * out;
  const lap = 2 * straightX + 2 * straightZ + 4 * arc;
  let d = distance % lap;
  if (d < 0) d += lap;

  // North edge, running east from the middle: (0, -halfZ - out) -> (halfX, …).
  if (d < halfX) {
    target.set(d, 0, -halfZ - out);
    return;
  }
  d -= halfX;
  // North-east corner arc, centred on the plate's own corner.
  if (d < arc) {
    const a = -Math.PI / 2 + d / out;
    target.set(halfX + Math.cos(a) * out, 0, -halfZ + Math.sin(a) * out);
    return;
  }
  d -= arc;
  if (d < straightZ) {
    target.set(halfX + out, 0, -halfZ + d);
    return;
  }
  d -= straightZ;
  if (d < arc) {
    const a = d / out;
    target.set(halfX + Math.cos(a) * out, 0, halfZ + Math.sin(a) * out);
    return;
  }
  d -= arc;
  if (d < straightX) {
    target.set(halfX - d, 0, halfZ + out);
    return;
  }
  d -= straightX;
  if (d < arc) {
    const a = Math.PI / 2 + d / out;
    target.set(-halfX + Math.cos(a) * out, 0, halfZ + Math.sin(a) * out);
    return;
  }
  d -= arc;
  if (d < straightZ) {
    target.set(-halfX - out, 0, halfZ - d);
    return;
  }
  d -= straightZ;
  if (d < arc) {
    const a = Math.PI + d / out;
    target.set(-halfX + Math.cos(a) * out, 0, -halfZ + Math.sin(a) * out);
    return;
  }
  d -= arc;
  target.set(-halfX + d, 0, -halfZ - out);
}

/** The length of one lap of the outline `out` metres outside the plate. */
function lapLength(halfX: number, halfZ: number, out: number): number {
  return 4 * halfX + 4 * halfZ + TAU * out;
}

/**
 * Builds the roof garden's clouds.
 *
 * @param halfX  the roof plate's own half-extent — pass `CASTLE_ROOF.halfX`
 * @param halfZ  ditto
 */
export function createRoofClouds(halfX: number, halfZ: number): RoofClouds {
  const root = new Group();
  root.name = 'roof-clouds';

  // Its own seed, so adding or removing a cloud here cannot move anything else
  // that draws from a shared stream.
  const rng = new Rng(0x5c10d5);
  const material = toonMaterial(PALETTE.blossomWhite, {
    transparent: true,
    opacity: CLOUD_OPACITY,
    // **Depth write on, which is unusual for a transparent material and is the
    // difference between a cloud and a bag of bubbles.** Left off, every pair of
    // overlapping puffs blends twice and the overlap draws as a darker lens, so
    // a five-lobed cloud reads as five discs. Writing depth lets the nearest
    // puff win, and since every puff is the same colour at the same opacity the
    // whole cloud comes out as one soft silhouette with the sky showing through
    // it evenly.
    depthWrite: true,
  });

  const clouds: Cloud[] = [];
  const puffs: Puff[] = [];

  /** Adds one tier's worth of clouds. Both tiers are the same thing at
   *  different scales — see {@link NEAR_COUNT} and {@link DEEP_COUNT}. */
  function addTier(
    count: number,
    outMin: number,
    outMax: number,
    top: number,
    bottom: number,
    puffMin: number,
    puffMax: number,
  ): void {
    for (let i = 0; i < count; i += 1) {
      const out = rng.range(outMin, outMax);
      const lap = lapLength(halfX, halfZ, out);
      const index = clouds.length;
      clouds.push({
        out,
        lap,
        y: rng.range(bottom, top),
        speed: rng.range(DRIFT_MIN, DRIFT_MAX),
        yaw: rng.range(-YAW_JITTER, YAW_JITTER),
        phase: rng.range(0, TAU),
        travelled: rng.range(0, lap),
      });
      const lobes = PUFFS_MIN + Math.floor(rng.range(0, PUFFS_MAX - PUFFS_MIN + 1));
      for (let p = 0; p < lobes; p += 1) {
        const radius = rng.range(puffMin, puffMax);
        puffs.push({
          cloud: index,
          offset: new Vector3(
            rng.range(-PUFF_SPREAD_X, PUFF_SPREAD_X) * radius,
            rng.range(-PUFF_SPREAD_Y * 0.7, PUFF_SPREAD_Y) * radius,
            rng.range(-PUFF_SPREAD_Z, PUFF_SPREAD_Z) * radius,
          ),
          radius,
          flatten: rng.range(0.46, 0.72),
        });
      }
    }
  }

  addTier(NEAR_COUNT, NEAR_OUT_MIN, NEAR_OUT_MAX, NEAR_TOP, NEAR_BOTTOM, NEAR_PUFF_MIN, NEAR_PUFF_MAX);
  addTier(DEEP_COUNT, DEEP_OUT_MIN, DEEP_OUT_MAX, DEEP_TOP, DEEP_BOTTOM, DEEP_PUFF_MIN, DEEP_PUFF_MAX);

  // One unit sphere for all of them; each puff's size lives in its instance
  // matrix. Modest segment counts — these are painted toys.
  const mesh = new InstancedMesh(new SphereGeometry(1, 12, 9), material, puffs.length);
  mesh.name = 'roof-cloud-puffs';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // The field surrounds the camera, so culling it as one object would pop the
  // whole band out the moment its centre left the frustum.
  mesh.frustumCulled = false;
  root.add(mesh);

  const matrix = new Matrix4();
  const centre = new Vector3();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);

  /** Re-poses every puff from where its cloud has drifted to. */
  function pose(elapsed: number): void {
    let posed = -1;
    let bearing = 0;
    for (let i = 0; i < puffs.length; i += 1) {
      const puff = puffs[i] as Puff;
      const cloud = clouds[puff.cloud] as Cloud;
      if (puff.cloud !== posed) {
        posed = puff.cloud;
        outlinePoint(halfX, halfZ, cloud.out, cloud.travelled, centre);
        // **Set, never accumulate** — the ferris band learnt this the hard way:
        // integrating a sine instead of offsetting by one pulls the field apart
        // over a long session, and this one is never rebuilt.
        centre.y = cloud.y + Math.sin(elapsed * BOB_RATE + cloud.phase) * BOB_AMPLITUDE;
        // The outward normal, read off the geometry rather than from which
        // branch of `outlinePoint` happened to fire: every point on the outline
        // is exactly `out` from the plate, so the way out is the way away from
        // the nearest point of the plate. Turning local +Z onto it is what puts
        // the cloud's long axis along its travel and its short one across the
        // parapet — see {@link PUFF_SPREAD_Z}.
        const nx = centre.x - clamp(centre.x, -halfX, halfX);
        const nz = centre.z - clamp(centre.z, -halfZ, halfZ);
        bearing = Math.atan2(nx, nz) + cloud.yaw;
      }
      rotation.setFromAxisAngle(up, bearing);
      position.copy(puff.offset).applyQuaternion(rotation);
      position.add(centre);
      scale.set(puff.radius, puff.radius * puff.flatten, puff.radius);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  pose(0);

  return {
    root,

    update(dt: number, elapsed: number): void {
      for (const cloud of clouds) {
        cloud.travelled += cloud.speed * dt;
        if (cloud.travelled > cloud.lap) cloud.travelled -= cloud.lap;
      }
      pose(elapsed);
    },

    dispose(): void {
      disposeTree(root);
      mesh.dispose();
    },
  };
}
