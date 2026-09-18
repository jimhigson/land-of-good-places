import { Box3, type InstancedMesh, Matrix4, type Mesh, type Object3D, Raycaster, Vector3 } from 'three';
import { CART_BODY_LENGTH, CART_ENVELOPE, cartEnvelopePoint } from './cart';
import { drawnOnSphere, railFrameAt, type RailFrame } from '../rail/sweptRail';
import type { CoasterRoute } from './route';

/**
 * **What the Sky Cruiser actually flies past, discovered rather than declared.**
 *
 * ### The hole this closes
 *
 * Until now, everything that asked "does the coaster hit anything?" asked it of
 * the same hard-coded two-entry list — `['building', 'ferrisWheel']` — in three
 * separate places: the route solver's `tallObstacles`, the boot assert, and the
 * procgen invariant. The comment beside the list said the cruise floor "clears
 * the trees, the garlands and the train ... those two are therefore the only
 * horizontal obstacles the loop actually has."
 *
 * That claim was true when it was written and is not a thing code can keep true.
 * A 4×-scale RiPika statue added to the plaza tops out at 10.68 m, well above the
 * 6.2 m cruise floor, and **all three checks were blind to it**, because none of
 * them was measuring the park — they were re-reading a sentence somebody typed.
 * Anything tall added in future was invisible the same way.
 *
 * So this measures the built scene and finds what is there. It is the same move
 * already made one level in, where the castle check sweeps the car against every
 * mesh under the castle rather than against a list of the castle's fixtures;
 * this is that, for the whole park.
 *
 * ### Why two different measurements
 *
 * **Rays decide.** Firing the car's envelope along the loop and asking what it
 * strikes is exact: it respects real triangles, so it flies through the castle's
 * window without complaint while a wall one metre to the side would stop it
 * dead. No bounding volume can do that — the castle's own wall band has a hole
 * in it, and its box does not.
 *
 * **Boxes report.** A pass/fail alone tells nobody that the ride skims a statue
 * by two metres. So every object whose bounds come near the loop is measured and
 * ranked, and the tightest are printed whether or not anything failed. That is
 * how the *next* statue gets noticed while it is still a near miss.
 *
 * ### The threshold is the car, and deliberately not the corridor
 *
 * A failure is the car's own envelope intersecting real geometry. It is
 * emphatically **not** the generator's `CORRIDOR_RADIUS` of 3 m: asserting a
 * solver's own target proves only that it can do arithmetic, and would turn
 * every future retune into a red build. Same rule the castle asserts follow, and
 * CLAUDE.md's — thresholds come from the game, never from the generator.
 */

/** One thing the loop goes past, with how close it comes. */
export interface PassedThing {
  readonly name: string;
  /** Metres from the car's envelope to this object's bounds. Negative overlaps. */
  readonly clearance: number;
  /** Metres along the loop where the closest approach happens. */
  readonly along: number;
  /** How high the object reaches, so "tall enough to matter" is visible. */
  readonly topY: number;
}

/** How finely the loop is walked. Half a metre at 15 m/s is ample. */
const SAMPLE_STEP = 0.5;

/**
 * Ray hop length, in metres.
 *
 * **Nothing is "stepped over" at any step size** — the segments tile the path
 * end to end, each starting where the last finished, so there is no gap between
 * them for a thin thing to hide in. What the step actually buys is *fidelity to
 * the curve*: a segment is a chord, and a chord cuts the corner.
 *
 * That error is a sagitta, `L^2 / 8r`. The tightest turn the ride will ever make
 * is `MIN_TURN_RADIUS` = 12 m, so a one-metre hop cuts the corner by **1 cm** at
 * the worst bend in the park and less everywhere else — far inside the
 * clearances being measured, and two orders of magnitude below the car's own
 * 0.75 m half-width.
 *
 * It was 0.2 m, which cost 18 s of the sweep's 19 and put it out of reach of the
 * procgen suite: at 0.2 m this is 7 400 rays, and 17 of the 52 targets sit near
 * *every* step (a terrain mesh's bounding box has the whole loop inside it), so
 * each ray pays a full triangle walk over several large meshes. One metre is
 * 1 480 rays and 3.7 s, and it still catches both original strikes — verified,
 * not assumed, by running it against the pre-fix `Scenery.ts`.
 */
const RAY_STEP = 1;

/** Only objects whose bounds come within this of the envelope are reported. */
const REPORT_WITHIN = 6;

/**
 * Points around the car's cross-section that the rays follow.
 *
 * Four corners plus the four edge midpoints. Corners alone leave a 1.5 m gap
 * across the car's beam, which a lamp post or a statue's arm can pass clean
 * through without touching a single ray.
 */
export function crossSection(): readonly (readonly [number, number])[] {
  const { halfWidth, above, below } = CART_ENVELOPE;
  return [
    [-halfWidth, -below],
    [0, -below],
    [halfWidth, -below],
    [halfWidth, (above - below) / 2],
    [halfWidth, above],
    [0, above],
    [-halfWidth, above],
    [-halfWidth, (above - below) / 2],
  ];
}

/**
 * What to call a mesh in a complaint.
 *
 * Its own name where it has one, otherwise the nearest named ancestor with the
 * type appended. Most of the park's meshes are named, but the wall runs are not
 * — seed 5's cruiser flew through one and the complaint read `passes through
 * 'Mesh'`, which tells whoever has to fix it precisely nothing. Walking up to
 * `wooden-walls / Mesh` costs one loop and names the thing.
 */
function describeObject(object: Object3D): string {
  if (object.name) return object.name;
  for (let node: Object3D | null = object.parent; node; node = node.parent) {
    if (node.name) return `${node.name} / ${object.type}`;
  }
  return object.type;
}

/** Is `object` inside any of `roots`? */
function isUnder(object: Object3D, roots: readonly Object3D[]): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (roots.includes(node)) return true;
  }
  return false;
}

/**
 * Brings every world matrix up to date.
 *
 * **A headless park has never rendered**, and three.js only refreshes
 * `matrixWorld` during `render` — so without this every mesh still sits at the
 * identity, rays fly through a park that is nowhere near the track, and the
 * check reports "all clear" no matter what is wrong. This exact bug shipped in
 * the castle sweep and was caught only by deliberately building a wall solid to
 * watch the assert fail. Anything that raycasts a headless scene needs this
 * line, and nothing about the failure tells you that it is missing.
 */
function refreshMatrices(root: Object3D): Object3D {
  let top: Object3D = root;
  while (top.parent) top = top.parent;
  top.updateMatrixWorld(true);
  return top;
}

/** Every mesh in the park that is not part of the ride itself. */
function candidates(root: Object3D, ignore: readonly Object3D[]): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh && !(mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    if (isUnder(object, ignore)) return;
    found.push(object);
  });
  return found;
}

/**
 * World-space bounds of a mesh — **one box per instance** for an `InstancedMesh`.
 *
 * `Box3.setFromObject` on an `InstancedMesh` returns the union of every
 * instance, and in this park that is worthless: every tree in the garden is one
 * `tree-canopies` mesh, so its union box spans most of the park and reports a
 * clearance of zero against a loop that is nowhere near any actual tree. The
 * first run of this check produced twelve such rows and not one of them meant
 * anything. Per instance, the boxes are the size of a tree.
 */
function worldBoxes(object: Object3D): Box3[] {
  const instanced = object as InstancedMesh;
  if (!instanced.isInstancedMesh) {
    const box = new Box3().setFromObject(object);
    return box.isEmpty() ? [] : [box];
  }
  const geometry = instanced.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const base = geometry.boundingBox;
  if (!base) return [];
  const boxes: Box3[] = [];
  const matrix = new Matrix4();
  for (let i = 0; i < instanced.count; i += 1) {
    instanced.getMatrixAt(i, matrix);
    matrix.premultiply(instanced.matrixWorld);
    boxes.push(base.clone().applyMatrix4(matrix));
  }
  return boxes;
}

/**
 * Everything the loop passes close to, tightest first.
 *
 * Bounding boxes, so it is cheap and covers the whole park; a box is coarser
 * than the mesh inside it, which for *reporting* is the safe direction to be
 * wrong — it over-states closeness rather than hiding it.
 */
export function thingsTheCruiserPasses(
  route: CoasterRoute,
  sceneRoot: Object3D,
  ignore: readonly Object3D[] = [],
): PassedThing[] {
  const top = refreshMatrices(sceneRoot);
  const { halfWidth, above, below } = CART_ENVELOPE;
  const halfLength = CART_BODY_LENGTH / 2;

  // The loop, once, with a frame at each sample — **in the frame the ride is
  // drawn in**, because the boxes it is about to be compared against are the
  // bounds of drawn meshes.
  //
  // This used to take `along` and `across` from the route's own frame and the
  // third axis from world `+Y` (`const upCar = offset.y`), which is two axes of
  // one frame and one of another. On a flat park those agreed; on a leaning one
  // the reported clearance is neither the real gap nor a consistent
  // over-estimate of it, which is worse than a wrong number — it is a wrong
  // number that changes character round the loop.
  const drawnForBoxes = drawnOnSphere(route);
  const path: RailFrame[] = [];
  for (let d = 0; d < route.length; d += SAMPLE_STEP) {
    path.push(
      railFrameAt(drawnForBoxes, d, {
        position: new Vector3(),
        forward: new Vector3(),
        side: new Vector3(),
        up: new Vector3(),
      }),
    );
  }

  const box = new Box3();
  const near = new Vector3();
  const offset = new Vector3();
  const results: PassedThing[] = [];

  for (const object of candidates(top, ignore)) {
   for (const objectBox of worldBoxes(object)) {
    box.copy(objectBox);
    let best = Infinity;
    let bestAlong = 0;
    for (let i = 0; i < path.length; i += 1) {
      const frame = path[i]!;
      // Cheap reject before the real work.
      if (box.distanceToPoint(frame.position) - halfLength - 6 > best) continue;
      box.clampPoint(frame.position, near);
      offset.subVectors(near, frame.position);
      const alongCar = offset.dot(frame.forward);
      const acrossCar = offset.dot(frame.side);
      const upCar = offset.dot(frame.up);
      const dx = Math.max(0, Math.abs(alongCar) - halfLength);
      const dz = Math.max(0, Math.abs(acrossCar) - halfWidth);
      const dy = upCar > 0 ? Math.max(0, upCar - above) : Math.max(0, -upCar - below);
      const gap = Math.hypot(dx, dy, dz);
      if (gap < best) {
        best = gap;
        bestAlong = i * SAMPLE_STEP;
      }
    }
    if (best <= REPORT_WITHIN) {
      results.push({
        name: describeObject(object),
        clearance: best,
        along: bestAlong,
        topY: box.max.y,
      });
    }
   }
  }

  results.sort((a, b) => a.clearance - b.clearance);
  return results;
}

/**
 * What the car's envelope actually strikes, swept along the whole loop.
 *
 * The decider. Exact against real triangles, so the castle's window is a window
 * and not a wall.
 */
export function cruiserStrikes(
  route: CoasterRoute,
  sceneRoot: Object3D,
  ignore: readonly Object3D[] = [],
): string[] {
  const top = refreshMatrices(sceneRoot);
  // Only the meshes whose bounds come anywhere near the loop. Raycasting the
  // whole park took 26 seconds; nearly all of it was spent proving that flower
  // beds on the far side are not in the way.
  const reach = Math.max(CART_ENVELOPE.above, CART_ENVELOPE.below) + CART_ENVELOPE.halfWidth + 1;
  const loop: Vector3[] = [];
  // The pre-filters ask about the **drawn** loop, as the rays below do. Asked of
  // the flat route they sit up to 3.04 m from the car being swept (scale 1,
  // canonical seed), against a reach of a few metres — a target dropped here is
  // a strike never tested, and nothing would say so.
  const drawnLoop = drawnOnSphere(route);
  for (let d = 0; d < route.length; d += SAMPLE_STEP) loop.push(drawnLoop.pointAt(d, new Vector3()));
  const targets = candidates(top, ignore).filter((object) =>
    worldBoxes(object).some((box) => loop.some((p) => box.distanceToPoint(p) <= reach)),
  );

  /**
   * Which targets are near enough to matter, per ray step.
   *
   * Filtering once against the *whole* loop is not enough: a bush beside the
   * station stayed a target for all 926 steps of a 185 m loop, and every one of
   * the 7 400 rays then paid to test it — and paid per *instance*, because
   * three.js raycasts every instance of an `InstancedMesh`. That is what made
   * this 24.6 s, against 84 ms for the box report beside it, which is far too
   * slow to run on five seeds in the procgen suite.
   *
   * Indexed per step it is a handful of objects per ray. Deliberately generous:
   * the reach covers the envelope's own corner-to-centre distance plus a whole
   * ray step either way, because a ray spans from the previous step to this one
   * and missing a target here would be a silent false pass — the expensive
   * direction to be wrong.
   */
  const stepCount = Math.ceil(route.length / RAY_STEP) + 1;
  const stepReach = Math.hypot(CART_ENVELOPE.halfWidth, Math.max(CART_ENVELOPE.above, CART_ENVELOPE.below)) + RAY_STEP * 2 + 1;
  const stepPoints: Vector3[] = [];
  for (let i = 0; i < stepCount; i += 1) {
    stepPoints.push(drawnLoop.pointAt((i * RAY_STEP) % route.length, new Vector3()));
  }
  const nearbyTargets: Object3D[][] = stepPoints.map(() => []);
  for (const object of targets) {
    for (const box of worldBoxes(object)) {
      for (let i = 0; i < stepCount; i += 1) {
        if (box.distanceToPoint(stepPoints[i]!) > stepReach) continue;
        const cell = nearbyTargets[i]!;
        if (cell[cell.length - 1] !== object) cell.push(object);
      }
    }
  }

  const caster = new Raycaster();
  const section = crossSection();
  const previous = new Map<number, Vector3>();
  const direction = new Vector3();
  const struckAlready = new Set<string>();
  const complaints: string[] = [];

  // **Sweep the car that gets drawn, at the meshes that get drawn.** The route
  // is solved flat and the whole park — this ride's rails included — is leaned
  // onto the sphere when it is drawn. Building the envelope in the flat frame
  // and casting it at leaned geometry compares two different worlds, and on
  // seed 428 that reported the cruiser passing through `castle-wall-lower`,
  // `castle-courtyard-floor`, `castle-roof-deck` and bare `terrain`.
  const drawn = drawnOnSphere(route);
  const frame: RailFrame = {
    position: new Vector3(),
    forward: new Vector3(),
    side: new Vector3(),
    up: new Vector3(),
  };

  for (let step = 0; step < stepCount; step += 1) {
    const d = step * RAY_STEP;
    railFrameAt(drawn, d % route.length, frame);

    for (let i = 0; i < section.length; i += 1) {
      const [lateral, rise] = section[i]!;
      const here = cartEnvelopePoint(frame, lateral, rise, new Vector3());
      const before = previous.get(i);
      previous.set(i, here);
      if (!before) continue;
      direction.subVectors(here, before);
      const span = direction.length();
      if (span < 1e-9) continue;
      caster.set(before, direction.normalize());
      caster.near = 0;
      caster.far = span;
      const nearby = nearbyTargets[step]!;
      if (nearby.length === 0) continue;
      const hit = caster.intersectObjects(nearby, false)[0];
      if (!hit) continue;
      const name = describeObject(hit.object);
      // One complaint per thing struck, not one per centimetre of striking it.
      if (struckAlready.has(name)) continue;
      struckAlready.add(name);
      complaints.push(
        `the Sky Cruiser's car passes through '${name}' at ${d.toFixed(1)} m along the loop, ` +
          `world (${hit.point.x.toFixed(2)}, ${hit.point.y.toFixed(2)}, ${hit.point.z.toFixed(2)})`,
      );
    }
  }
  return complaints;
}

/**
 * **How much room the Sky Cruiser leaves for a post standing at (x, z).**
 *
 * Returns the smallest gap, in metres, between the car's swept envelope and an
 * upright post of `radius` rising `height` from `baseY`. Zero or less means the
 * ride passes through it.
 *
 * ### Why this exists
 *
 * Fairy-light poles are 4.4 m tall and are placed by a builder that knew only
 * about paving and about *ground* claims. The claims registry answers "who else
 * wants this square metre"; it says nothing about what sweeps through the air
 * above it. Ten poles in the plaza verge never met the loop. Ninety-odd strung
 * along two thirds of the path network did, and seed 24 built a park where
 * **the car passed through `fairy-pole-84`** at 17.0 m along the loop.
 *
 * That is the standing rule in this codebase — a generator that checks itself
 * against the obstacle classes it happens to know by name will silently miss
 * whatever a sibling system put there — so a pole now asks the ride directly,
 * before it is placed, instead of the ride discovering the pole afterwards.
 *
 * ### It asks the ride for its own envelope
 *
 * Not a bounding box round the route. The gap is measured in **the frame the
 * ride is drawn in** (`drawnOnSphere` + `railFrameAt`) against
 * {@link CART_ENVELOPE}, exactly as {@link thingsTheCruiserPasses} does — a box
 * round a leaning ride is neither the real gap nor a consistent over-estimate
 * of it, and this park leans everywhere.
 *
 * The post is sampled along its axis rather than treated as a point, because a
 * pole is tall and the loop dives: the tip can foul where the foot is clear.
 */
/**
 * The loop's frames, resolved once per route.
 *
 * **This memo is load-bearing, not a micro-optimisation.** The caller asks per
 * *candidate* position — a hundred-odd poles with up to ten candidates each —
 * and `drawnOnSphere` plus a full walk of the loop per call turned a question
 * that should cost microseconds into millions of frame resolutions. The world
 * phase is sliced a frame at a time in the browser and `check:park-boot`
 * polices the slice ceiling, so the expensive thing has to happen once.
 *
 * Keyed by the route object: a new solve produces a new route, so a stale entry
 * cannot be read for a park it does not describe.
 */
const postFrameMemo = new WeakMap<CoasterRoute, { frames: RailFrame[]; centre: Vector3; reach: number }>();

function framesForPostQueries(route: CoasterRoute): { frames: RailFrame[]; centre: Vector3; reach: number } {
  const cached = postFrameMemo.get(route);
  if (cached) return cached;
  const drawn = drawnOnSphere(route);
  const frames: RailFrame[] = [];
  const centre = new Vector3();
  for (let d = 0; d < route.length; d += SAMPLE_STEP) {
    const frame = railFrameAt(drawn, d, {
      position: new Vector3(),
      forward: new Vector3(),
      side: new Vector3(),
      up: new Vector3(),
    });
    frames.push(frame);
    centre.add(frame.position);
  }
  if (frames.length > 0) centre.multiplyScalar(1 / frames.length);
  // A sphere round the whole loop, so a pole on the far side of the park is
  // rejected in one distance test instead of several hundred.
  let reach = 0;
  for (const frame of frames) reach = Math.max(reach, frame.position.distanceTo(centre));
  const resolved = { frames, centre, reach };
  postFrameMemo.set(route, resolved);
  return resolved;
}

/**
 * The smallest gap between the car's swept envelope and any of `points`.
 *
 * Takes the **drawn world points of the thing itself** rather than a shape
 * description, so whatever the caller draws is what gets tested — see
 * `FairyLights.fairyOccupiedPoints`, which exists because a version of this
 * guarded a post and missed the bulbs hanging beside it.
 */
export function cruiserClearanceForPoints(
  route: CoasterRoute,
  points: readonly Vector3[],
  radius: number,
): number {
  const { halfWidth, above, below } = CART_ENVELOPE;
  const halfLength = CART_BODY_LENGTH / 2;
  const { frames, centre, reach } = framesForPostQueries(route);
  const envelope = halfLength + halfWidth + Math.max(above, below);
  if (points.length === 0) return Infinity;

  // Whole-loop reject: a cluster far outside the loop's bounding sphere cannot
  // reach it, and most of the park's poles are exactly that.
  let nearest = Infinity;
  for (const p of points) nearest = Math.min(nearest, p.distanceTo(centre));
  const far = nearest - reach - envelope - radius;
  if (far > 0) return far;

  const offset = new Vector3();
  let best = Infinity;
  for (const frame of frames) {
    for (const point of points) {
      offset.subVectors(point, frame.position);
      if (offset.length() - envelope > best) continue;
      const alongCar = offset.dot(frame.forward);
      const acrossCar = offset.dot(frame.side);
      const upCar = offset.dot(frame.up);
      const dx = Math.max(0, Math.abs(alongCar) - halfLength);
      const dz = Math.max(0, Math.abs(acrossCar) - halfWidth);
      const dy = upCar > 0 ? Math.max(0, upCar - above) : Math.max(0, -upCar - below);
      const gap = Math.hypot(dx, dy, dz) - radius;
      if (gap < best) best = gap;
    }
  }
  return best;
}

