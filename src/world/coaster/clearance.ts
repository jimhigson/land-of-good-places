import { Box3, type InstancedMesh, Matrix4, type Mesh, type Object3D, Raycaster, Vector3 } from 'three';
import { CART_BODY_LENGTH, CART_ENVELOPE } from './cart';
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

/** Ray hop length. Short enough that nothing thin is stepped over. */
const RAY_STEP = 0.2;

/** Only objects whose bounds come within this of the envelope are reported. */
const REPORT_WITHIN = 6;

/**
 * Points around the car's cross-section that the rays follow.
 *
 * Four corners plus the four edge midpoints. Corners alone leave a 1.5 m gap
 * across the car's beam, which a lamp post or a statue's arm can pass clean
 * through without touching a single ray.
 */
function crossSection(): readonly (readonly [number, number])[] {
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

  // The loop, once, with a frame at each sample.
  const path: { p: Vector3; forward: Vector3; side: Vector3 }[] = [];
  for (let d = 0; d < route.length; d += SAMPLE_STEP) {
    const p = route.pointAt(d, new Vector3());
    const t = route.tangentAt(d, new Vector3());
    const flat = Math.hypot(t.x, t.z) || 1;
    path.push({
      p,
      forward: t.clone(),
      side: new Vector3(-t.z / flat, 0, t.x / flat),
    });
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
      if (box.distanceToPoint(frame.p) - halfLength - 6 > best) continue;
      box.clampPoint(frame.p, near);
      offset.subVectors(near, frame.p);
      const alongCar = offset.dot(frame.forward);
      const acrossCar = offset.dot(frame.side);
      const upCar = offset.y;
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
  for (let d = 0; d < route.length; d += SAMPLE_STEP) loop.push(route.pointAt(d, new Vector3()));
  const targets = candidates(top, ignore).filter((object) =>
    worldBoxes(object).some((box) => loop.some((p) => box.distanceToPoint(p) <= reach)),
  );
  const caster = new Raycaster();
  const section = crossSection();
  const point = new Vector3();
  const tangent = new Vector3();
  const previous = new Map<number, Vector3>();
  const direction = new Vector3();
  const struckAlready = new Set<string>();
  const complaints: string[] = [];

  for (let d = 0; d <= route.length; d += RAY_STEP) {
    route.pointAt(d % route.length, point);
    route.tangentAt(d % route.length, tangent);
    const flat = Math.hypot(tangent.x, tangent.z) || 1;
    const sideX = -tangent.z / flat;
    const sideZ = tangent.x / flat;

    for (let i = 0; i < section.length; i += 1) {
      const [lateral, rise] = section[i]!;
      const here = new Vector3(
        point.x + sideX * lateral,
        point.y + rise,
        point.z + sideZ * lateral,
      );
      const before = previous.get(i);
      previous.set(i, here);
      if (!before) continue;
      direction.subVectors(here, before);
      const span = direction.length();
      if (span < 1e-9) continue;
      caster.set(before, direction.normalize());
      caster.near = 0;
      caster.far = span;
      const hit = caster.intersectObjects(targets, false)[0];
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
