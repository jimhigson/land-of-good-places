import { Box3, InstancedMesh, Line3, Matrix4, Mesh, Raycaster, Sphere, Vector3, type Material, type Object3D } from 'three';
import { CAMERA_DISTANCE, CAMERA_PITCH_DEGREES, CAMERA_YAW_DEGREES } from '../../core/constants';
import { CAMERA_FOCUS_LIFT, type IsoCamera } from '../../core/IsoCamera';
import type { CollisionWorld } from '../Collision';
import { REPTILE_HOUSE_FLOOR_Y, REPTILE_HOUSE_ORIGIN_X, REPTILE_HOUSE_ORIGIN_Z, REPTILE_WALL_HEIGHT } from './layout';
import { REPTILE_INNER_X, REPTILE_INNER_Z } from './shell';

/**
 * **The exhibit camera** — Jim, 6 October 2026: *"when using the exhibits in
 * the reptile house, the effects are quite hard to see when zoomed out — in
 * this case the camera needs to come down to an over-shoulder view of the
 * animal or other exhibit being shown."*
 *
 * When one of an exhibit's chips is pressed ("Say hi!", "Wave!", "Tickle
 * tail!" …), the park camera eases down from its fixed pseudo-isometric rig to
 * a shot behind and a little above her, looking past her shoulder at the
 * animals that react. It holds while the reaction (and the first-hello bubble)
 * plays, then eases home. Moving — the stick, a key, a jump, a tap that walks
 * her — hands the camera straight back.
 *
 * ## No new camera mechanism
 *
 * Everything here drives `IsoCamera` through the three calls the cat-bus
 * arrival and the keychain rack already use: a focus override (claimed through
 * `Game`'s one `focusClaim`, so the arbitration there still holds), a shot
 * override (`setShotOverride(yaw, pitch, distance)` — re-asserted every frame
 * with a moving value, which its doc comment invites) and a zoom target. The
 * camera's own damping still runs underneath; this module decides *where*, and
 * eases there on its own clock so the move is a smooth curve rather than the
 * pose damper's exponential lurch.
 *
 * ## The shot is solved, never assumed
 *
 * {@link solveExhibitShot} tries a fan of candidate eyes behind her — a few
 * bearings either side of her shoulder, a few heights, a few stand-backs — and
 * keeps only those that are inside the hall's walls, over open floor (not in a
 * case, a bed or a wall) and not within a hand's breadth of anything drawn.
 * Each survivor is then **raycast from the eye to every animal it is meant to
 * show**, against everything drawn in the hall and against her own body;
 * glass is see-through, anything opaque in the way blocks. The shot that sees
 * the most, then sits nearest an ordinary over-the-shoulder angle, wins. A
 * shot that cannot see its animal is never taken — the camera simply stays
 * where it is.
 *
 * `scripts/check-exhibit-camera.mts` presses every exhibit's chip on the real
 * hall and measures the camera the game actually ends up with: the animals
 * unoccluded from the real eye, a fair share of the frame, the eye inside the
 * hall all the way down, and the moves smooth.
 */

/** Seconds for the camera to come down to the shot. */
export const EXHIBIT_SHOT_EASE_IN = 1.0;
/** Seconds to rise back to the rig once the reaction is over. */
export const EXHIBIT_SHOT_EASE_OUT = 0.9;
/**
 * Seconds to rise back when she moves. Shorter, because while the shot holds
 * its own bearing "up the stick" is the rig's up-screen, not this shot's —
 * the sooner the rig is home the sooner the two agree again (GAME_DESIGN.md's
 * CONTROL rule).
 */
export const EXHIBIT_SHOT_EASE_CANCEL = 0.45;
/** The least time the shot holds once it has landed — every reaction is about two seconds. */
export const EXHIBIT_SHOT_HOLD = 2.6;
/**
 * Milliseconds of solving per frame. A shot that cannot be found inside one
 * slice carries on next frame rather than stalling this one.
 */
const SOLVE_BUDGET_MS = 4;
/** Milliseconds a frame of background warming may take, while no shot is wanted. */
const WARM_BUDGET_MS = 2;
/** A remembered eye is tried first when she presses from within this many metres of where it was solved. */
const REMEMBER_WITHIN = 0.6;
const now = (): number => performance.now();

/** Seconds per halving for the aim to follow animals that move during the shot. */
const LIVE_FOCUS_HALF_LIFE = 0.35;
/** How far she may drift (a nudge, an idle shuffle) before it counts as walking off. Metres. */
const EXHIBIT_SHOT_MOVE_CANCEL = 0.25;

/** Eye heights tried, above the hall floor. Her head is at about 1.4 m; "slightly above". */
const EYE_HEIGHTS = [2.3, 2.8, 3.3, 3.8, 4.3] as const;
/** How far behind her the eye stands, along the line from the animal through her. */
const EYE_BACKS = [1.6, 2.4, 3.2] as const;
/**
 * Bearings either side of "straight behind her", in degrees — the shoulder.
 * Ordered by preference only for readability: {@link shotCost} decides.
 */
const EYE_SWINGS = [20, -20, 32, -32, 10, -10, 45, -45, 0, 60, -60, 75, -75, 90, -90] as const;
/** The bearing off "straight behind" a shot is happiest at: past her shoulder, not through her head. */
const IDEAL_SWING = 20;
/** Kept clear of the hall's walls, metres. */
const WALL_MARGIN = 0.8;
/** No drawn surface nearer the eye than this — the lens's near plane is 0.1 m. */
export const EYE_CLEARANCE = 0.3;
/** The eye stands over open floor this wide, so it is never inside a case, a bed or a planter. */
const EYE_FLOOR_CLEAR = 0.35;

/** One sightline target and whether it was seen. */
export interface ShotSample {
  readonly point: Vector3;
  readonly seen: boolean;
}

/** A solved shot: where the eye stands, what it looks at, and how it frames it. */
export interface ExhibitShot {
  readonly exhibitId: string;
  /** World point the camera orbits — the middle of the animals. */
  readonly focus: Vector3;
  /** World point the eye stands at. */
  readonly eye: Vector3;
  readonly yawDegrees: number;
  readonly pitchDegrees: number;
  readonly distance: number;
  readonly zoom: number;
  /** The animals' world box, as framed. */
  readonly subject: Box3;
  /** Every sightline target, seen or not, for the chosen eye. */
  readonly samples: readonly ShotSample[];
  /** Every animal in the exhibit — never an occluder of the others. */
  readonly cast: readonly Object3D[];
  /** How many candidate eyes were tried and how many could see everything. */
  readonly tried: number;
  readonly clear: number;
}

/** Everything the solver needs from the hall — passed in so a check can hand it the real thing. */
export interface ShotWorld {
  /** Everything drawn in the hall: the occluders. */
  readonly hall: Object3D;
  readonly collision: CollisionWorld;
  readonly camera: IsoCamera;
  /** Things that never block a sightline (the snake pools: an animal is not an obstacle). */
  readonly seeThrough: readonly Object3D[];
}

const SCRATCH_BOX = new Box3();
const RAYCASTER = new Raycaster();
const DIRECTIONS = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0), // flat-ok: the reptile house is its own flat space at x 600, floor y 0, off the sphere
  new Vector3(0, -1, 0), // flat-ok: the reptile house is its own flat space at x 600, floor y 0, off the sphere
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

/** A marker's footprint: an object nothing is drawn under is this big a box round its origin. */
const MARKER_HALF = 0.15;

/** An object nothing is drawn under is a small box round its own origin. */
function boxOf(object: Object3D, out: Box3): Box3 {
  object.updateWorldMatrix(true, true);
  out.setFromObject(object);
  if (out.isEmpty()) {
    const at = object.getWorldPosition(new Vector3());
    out.set(at, at).expandByScalar(MARKER_HALF);
  }
  return out;
}

/**
 * Marks subjects as part of a **crowd**: twelve babies, five geckos, the
 * points along a snake's body. A shot must see most of a crowd
 * ({@link CROWD_SEEN}) — a baby behind a rail post, a coil round its branch
 * are what a crowd *is* — but every subject not so marked, every **star**,
 * it must see outright.
 */
export function asCrowd<T extends Object3D>(objects: readonly T[]): T[] {
  for (const object of objects) object.userData['exhibitCrowd'] = true;
  return [...objects];
}

/** The share of a crowd a shot must see — what `check:exhibit-camera` holds the real eye to. */
export const CROWD_SEEN = 2 / 3;
/**
 * What the solver asks for, a margin over {@link CROWD_SEEN}: twelve babies
 * tumbling round their mum for the length of the shot will not all stay
 * where they were when it was solved.
 */
const CROWD_SEEN_TO_SOLVE = 0.75;

/** One sightline target: an animal's middle, and whether it is a star or one of a crowd. */
export interface ShotTarget {
  readonly point: Vector3;
  readonly crowd: boolean;
}

/** The animals' world box and one sightline target per animal (its middle). */
export function subjectOf(subjects: readonly Object3D[]): { box: Box3; targets: ShotTarget[] } {
  const box = new Box3();
  const targets: ShotTarget[] = [];
  for (const subject of subjects) {
    boxOf(subject, SCRATCH_BOX);
    box.union(SCRATCH_BOX);
    targets.push({ point: SCRATCH_BOX.getCenter(new Vector3()), crowd: subject.userData['exhibitCrowd'] === true });
  }
  return { box, targets };
}

/**
 * How fat a star's sightline is: it is tested as a tube of this radius — its
 * own line and four more beside it, above, below and either side — rather
 * than one hairline. An animal breathes, does push-ups, potters about; a line
 * that only just grazes a wall top or a branch is a line the next frame loses.
 */
const SIGHTLINE_TUBE = 0.07;

/** Seen from `eye` down a whole {@link SIGHTLINE_TUBE}. */
function robustlySeen(eye: Vector3, target: Vector3, occluders: OccluderSet, report?: SolveReport): boolean {
  const along = target.clone().sub(eye).normalize();
  const side = new Vector3(0, 1, 0).cross(along); // flat-ok: the reptile house is its own flat space at x 600, floor y 0, off the sphere
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up = along.clone().cross(side).normalize();
  const from = new Vector3();
  const to = new Vector3();
  for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    from.copy(eye).addScaledVector(side, a * SIGHTLINE_TUBE).addScaledVector(up, b * SIGHTLINE_TUBE);
    to.copy(target).addScaledVector(side, a * SIGHTLINE_TUBE).addScaledVector(up, b * SIGHTLINE_TUBE);
    const hit = firstHit(from, to, occluders);
    if (hit) {
      if (report) report.blockers[hit] = (report.blockers[hit] ?? 0) + 1;
      return false;
    }
  }
  return true;
}

/**
 * The sightlines from `eye`, stars first and failing fast: `null` as soon as
 * a star is hidden or too much of the crowd is for {@link CROWD_SEEN} to be
 * reachable, else every target's result. Equivalent to {@link sightlinesPass}
 * over all of them, without casting the rays that cannot change the answer.
 */
function shotSees(eye: Vector3, targets: readonly ShotTarget[], occluders: OccluderSet, report?: SolveReport): boolean[] | null {
  const seen: boolean[] = targets.map(() => false);
  for (const [index, target] of targets.entries()) {
    if (target.crowd) continue;
    if (!robustlySeen(eye, target.point, occluders, report)) return null;
    seen[index] = true;
  }
  const crowd = targets.filter((target) => target.crowd).length;
  const mayMiss = crowd - Math.ceil(CROWD_SEEN_TO_SOLVE * crowd);
  let missed = 0;
  for (const [index, target] of targets.entries()) {
    if (!target.crowd) continue;
    seen[index] = !sightlineBlocked(eye, target.point, occluders);
    if (!seen[index]) {
      missed += 1;
      if (missed > mayMiss) return null;
    }
  }
  return seen;
}

/**
 * Whether a set of sightline results is a shot: every star, and most of the
 * crowd. The box's middle is only where the camera aims — on the tree snake
 * it is inside her branch, with her head in clear air beside it — so it is
 * not itself something that has to be seen.
 */
export function sightlinesPass(targets: readonly ShotTarget[], seen: readonly boolean[]): boolean {
  let crowd = 0;
  let crowdSeen = 0;
  for (const [index, target] of targets.entries()) {
    const ok = seen[index] ?? false;
    if (!target.crowd && !ok) return false;
    if (target.crowd) {
      crowd += 1;
      if (ok) crowdSeen += 1;
    }
  }
  return crowd === 0 || crowdSeen >= CROWD_SEEN * crowd;
}

function isSeeThrough(material: Material | Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.every((m) => !m.visible || (m.transparent && m.opacity < 0.5) || m.colorWrite === false);
}

function shownInScene(object: Object3D): boolean {
  for (let at: Object3D | null = object; at; at = at.parent) if (!at.visible) return false;
  return true;
}

/**
 * Every opaque mesh that can stand between an eye and an animal: drawn,
 * visible, not glass, not one of the animals themselves and not under
 * anything in `ignore`.
 */
export function collectOccluders(roots: readonly Object3D[], ignore: readonly Object3D[]): OccluderSet {
  const skip = new Set<Object3D>();
  for (const root of ignore) root.traverse((child) => skip.add(child));
  const meshes: Mesh[] = [];
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((child) => {
      if (skip.has(child)) return;
      if (!(child instanceof Mesh) && !(child instanceof InstancedMesh)) return;
      if (!shownInScene(child)) return;
      if (isSeeThrough(child.material)) return;
      meshes.push(child);
    });
  }
  // An instanced mesh is one bounding sphere round every instance in the
  // hall — every fern, every tuft — so it passes any sphere test and three
  // then walks all of its instances per ray. Each instance stands in as its
  // own proxy instead, so the cull sees the one fern actually in the way.
  const expanded: Mesh[] = [];
  const spheres: Sphere[] = [];
  for (const mesh of meshes) {
    if (mesh instanceof InstancedMesh) {
      for (const proxy of instanceProxies(mesh)) {
        expanded.push(proxy);
        spheres.push(worldSphere(proxy));
      }
    } else {
      expanded.push(mesh);
      spheres.push(worldSphere(mesh));
    }
  }
  return { meshes: expanded, spheres };
}

function worldSphere(mesh: Mesh): Sphere {
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const sphere = mesh.geometry.boundingSphere;
  return sphere ? sphere.clone().applyMatrix4(mesh.matrixWorld) : new Sphere(new Vector3(), Infinity);
}

/** Per-instance stand-ins, kept while the instances have not moved (the hall's plants never do). */
const PROXIES = new WeakMap<InstancedMesh, { version: number; count: number; world: Matrix4; proxies: Mesh[] }>();

function instanceProxies(mesh: InstancedMesh): Mesh[] {
  const cached = PROXIES.get(mesh);
  if (cached && cached.version === mesh.instanceMatrix.version && cached.count === mesh.count && cached.world.equals(mesh.matrixWorld)) {
    return cached.proxies;
  }
  const proxies: Mesh[] = [];
  const local = new Matrix4();
  for (let i = 0; i < mesh.count; i += 1) {
    const proxy = new Mesh(mesh.geometry, mesh.material);
    proxy.name = mesh.name;
    proxy.matrixAutoUpdate = false;
    proxy.matrixWorldAutoUpdate = false;
    mesh.getMatrixAt(i, local);
    proxy.matrixWorld.multiplyMatrices(mesh.matrixWorld, local);
    proxies.push(proxy);
  }
  PROXIES.set(mesh, { version: mesh.instanceMatrix.version, count: mesh.count, world: mesh.matrixWorld.clone(), proxies });
  return proxies;
}

/**
 * The meshes that can block a view, with each one's world bounding sphere, so
 * a ray is only ever tested against the handful it could possibly meet. The
 * hall has hundreds of meshes and a solve casts thousands of rays; three's own
 * per-mesh culling still pays a matrix inverse and an instance walk for every
 * one, which on a phone was most of a second's hitch on the chip.
 */
export interface OccluderSet {
  readonly meshes: readonly Mesh[];
  readonly spheres: readonly Sphere[];
}

const SCRATCH_CLOSEST = new Vector3();
const SCRATCH_SEGMENT = new Line3();

/** The meshes whose bounding sphere comes within `pad` of the segment `a`–`b`. */
function alongSegment(set: OccluderSet, a: Vector3, b: Vector3, pad: number): Mesh[] {
  SCRATCH_SEGMENT.set(a, b);
  const out: Mesh[] = [];
  set.spheres.forEach((sphere, index) => {
    SCRATCH_SEGMENT.closestPointToPoint(sphere.center, true, SCRATCH_CLOSEST);
    if (SCRATCH_CLOSEST.distanceTo(sphere.center) <= sphere.radius + pad) out.push(set.meshes[index]!);
  });
  return out;
}

/** Whether anything in `occluders` crosses the open segment from `eye` to `target`. */
export function sightlineBlocked(eye: Vector3, target: Vector3, occluders: OccluderSet): boolean {
  return firstHit(eye, target, occluders) !== null;
}

/** The name of the first thing crossing the segment from `eye` to `target`, or `null`. */
function firstHit(eye: Vector3, target: Vector3, occluders: OccluderSet): string | null {
  const toward = target.clone().sub(eye);
  const length = toward.length();
  if (length < 1e-6) return null;
  const candidates = alongSegment(occluders, eye, target, 0.01);
  if (candidates.length === 0) return null;
  RAYCASTER.set(eye, toward.divideScalar(length));
  RAYCASTER.near = 0;
  // A hair short of the target, so the far side of a thin animal is never "in front" of it.
  RAYCASTER.far = Math.max(0, length - 0.05);
  const hit = RAYCASTER.intersectObjects(candidates, false)[0];
  return hit ? hit.object.name || hit.object.parent?.name || '(unnamed)' : null;
}

/** Whether any drawn surface is within {@link EYE_CLEARANCE} of the eye, along the six axes. */
export function eyeTooClose(eye: Vector3, occluders: OccluderSet, clearance = EYE_CLEARANCE): boolean {
  const nearby = alongSegment(occluders, eye, eye, clearance + 0.01);
  if (nearby.length === 0) return false;
  RAYCASTER.near = 0;
  RAYCASTER.far = clearance;
  for (const direction of DIRECTIONS) {
    RAYCASTER.set(eye, direction);
    if (RAYCASTER.intersectObjects(nearby, false).length > 0) return true;
  }
  return false;
}

/** Whether a world point is inside the hall's walls, clear of them by `margin`. */
export function insideHall(point: Vector3, margin = WALL_MARGIN): boolean {
  return (
    Math.abs(point.x - REPTILE_HOUSE_ORIGIN_X) <= REPTILE_INNER_X - margin &&
    Math.abs(point.z - REPTILE_HOUSE_ORIGIN_Z) <= REPTILE_INNER_Z - margin &&
    point.y > REPTILE_HOUSE_FLOOR_Y + 0.5
  );
}

/**
 * Whether an eye on its way down is somewhere a camera may be: over the
 * hall's open top (above its walls), or inside them. Never below the wall
 * tops outside the hall — that is the camera through a wall.
 */
export function eyeInHallSpace(point: Vector3): boolean {
  if (point.y >= REPTILE_HOUSE_FLOOR_Y + REPTILE_WALL_HEIGHT + 0.3) return true;
  return insideHall(point, 0.2);
}

const wrapDegrees = (degrees: number): number => ((((degrees + 180) % 360) + 360) % 360) - 180;

/** The yaw/pitch/distance `IsoCamera.setShotOverride` takes for an eye looking at a focus. */
export function shotAngles(eye: Vector3, focus: Vector3): { yawDegrees: number; pitchDegrees: number; distance: number } {
  const dx = eye.x - focus.x;
  const dy = eye.y - focus.y; // flat-ok: the reptile house is its own flat space at x 600, floor y 0, off the sphere
  const dz = eye.z - focus.z;
  return {
    yawDegrees: (Math.atan2(dx, dz) * 180) / Math.PI,
    pitchDegrees: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI,
    distance: Math.hypot(dx, dy, dz),
  };
}

/**
 * The zoom that frames the animals: half the frame's height at the focus a
 * little over the subject's own size, never tighter than a metre and a bit
 * (a single gecko still gets its board round it).
 */
export function shotZoom(camera: IsoCamera, subject: Box3): number {
  const size = subject.getSize(new Vector3());
  const half = Math.max(0.55, Math.hypot(size.x, size.z) / 2, size.y / 2);
  return camera.zoomToFit(half * 1.25, half * 1.05, 0.35);
}

/** Lower is better: how far a clear candidate is from the shot we would draw by hand. */
function shotCost(swing: number, back: number, height: number, yawDegrees: number): number {
  const rigTurn = Math.abs(wrapDegrees(yawDegrees - CAMERA_YAW_DEGREES));
  return Math.abs(Math.abs(swing) - IDEAL_SWING) / 10 + Math.abs(back - 2.4) + Math.abs(height - 2.8) + rigTurn / 90;
}

/**
 * Solves the over-the-shoulder shot of `subjects` for a child standing at
 * `player` (feet), whose body is `body`. `null` when no candidate eye can see
 * every animal — the caller keeps the camera where it is.
 */
export function solveExhibitShot(
  world: ShotWorld,
  exhibitId: string,
  subjects: readonly Object3D[],
  cast: readonly Object3D[],
  player: Vector3,
  facing: number,
  body: Object3D | null,
  report?: SolveReport,
): ExhibitShot | null {
  const steps = solveExhibitShotSteps(world, exhibitId, subjects, cast, player, facing, body, report);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * {@link solveExhibitShot}, one candidate eye per step — so the director can
 * spread a hard solve (the nursery's babies behind their rail can take a
 * hundred candidates) over a few frames instead of hitching the one frame
 * the chip is pressed on.
 */
export function* solveExhibitShotSteps(
  world: ShotWorld,
  exhibitId: string,
  subjects: readonly Object3D[],
  cast: readonly Object3D[],
  player: Vector3,
  facing: number,
  body: Object3D | null,
  report?: SolveReport,
  preferred?: Vector3,
): Generator<void, ExhibitShot | null> {
  const { box, targets } = subjectOf(subjects);
  if (box.isEmpty()) return null;
  const focus = box.getCenter(new Vector3());
  const ignore = [...subjects, ...cast, ...world.seeThrough];
  const occluders = collectOccluders(body ? [world.hall, body] : [world.hall], ignore);
  // The eye must not be inside her, either, but she is not something to keep
  // clear of by a hand's breadth — the shot is over her shoulder.
  const near = collectOccluders([world.hall], ignore);
  const zoom = shotZoom(world.camera, box);
  const rig = rigPose(player, world.camera.targetZoom);

  // "Behind her": along the line from the animals through her. Stood right
  // on top of the focus, her own back is the answer instead.
  let behindX = player.x - focus.x;
  let behindZ = player.z - focus.z;
  const reach = Math.hypot(behindX, behindZ);
  if (reach < 0.5) {
    behindX = -Math.sin(facing);
    behindZ = -Math.cos(facing);
  } else {
    behindX /= reach;
    behindZ /= reach;
  }
  const behind = Math.atan2(behindX, behindZ);
  const start = Math.max(reach, 0.5);

  // Every candidate, cheapest-to-reject tests first, then in order of how
  // close each is to the shot we would draw by hand: the first that passes
  // everything is the best there is, so nothing after it is ever cast.
  const candidates: { eye: Vector3; cost: number }[] = [];
  for (const swing of EYE_SWINGS) {
    const bearing = behind + (swing * Math.PI) / 180;
    for (const back of EYE_BACKS) {
      for (const height of EYE_HEIGHTS) {
        const out = start + back;
        const eye = new Vector3(focus.x + Math.sin(bearing) * out, REPTILE_HOUSE_FLOOR_Y + height, focus.z + Math.cos(bearing) * out);
        if (!insideHall(eye)) {
          if (report) report.outside += 1;
          continue;
        }
        if (!world.collision.isClearCircle(eye.x, eye.z, EYE_FLOOR_CLEAR)) {
          if (report) report.overSolid += 1;
          continue;
        }
        candidates.push({ eye, cost: shotCost(swing, back, height, shotAngles(eye, focus).yawDegrees) });
      }
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  // The eye that worked last time from here goes first: every test still runs
  // on it, so it is only ever a guess about where to start looking.
  if (preferred) candidates.unshift({ eye: preferred.clone(), cost: -1 });

  let best: { eye: Vector3; seen: boolean[]; cost: number } | null = null;
  let tried = 0;
  for (const { eye, cost } of candidates) {
    if (tried > 0) yield;
    tried += 1;
    if (eyeTooClose(eye, near)) {
      if (report) report.tooClose += 1;
      continue;
    }
    const seen = shotSees(eye, targets, occluders, report);
    if (!seen) {
      if (report) report.blocked += 1;
      continue;
    }
    // And the way there and back: the eye sweeps down from the rig, and a
    // shot whose own approach crosses a wall, the log or a vine is no shot.
    if (!approachClear(rig, { focus, ...shotAngles(eye, focus), zoom }, near)) {
      if (report) report.approach += 1;
      continue;
    }
    best = { eye, seen, cost };
    break;
  }
  const clear = best ? 1 : 0;
  if (!best) return null;
  const angles = shotAngles(best.eye, focus);
  return {
    exhibitId,
    focus,
    eye: best.eye,
    ...angles,
    zoom,
    subject: box,
    samples: targets.map((target, index) => ({ point: target.point, seen: best.seen[index] ?? false })),
    cast,
    tried,
    clear,
  };
}

/** Why candidate eyes were turned down — for the check, so an unsolved shot says why. */
export interface SolveReport {
  outside: number;
  overSolid: number;
  tooClose: number;
  blocked: number;
  approach: number;
  /** What blocked the stars' sightlines, by mesh name, over every candidate. */
  blockers: Record<string, number>;
}

/** Samples along a move, both ways, the eye checked at each — see {@link solveExhibitShot}. */
const APPROACH_SAMPLES = 60;
/**
 * Clearance along the way down and back — wider than at the eye's resting
 * spot because the real eye trails the eased path a little (the camera's own
 * pose damper), so the path it flies is not quite the one sampled here.
 */
const APPROACH_CLEARANCE = 0.6;

/** Where the eye stands for a pose: the focus plus the shot override's offset. */
export function eyeOfPose(pose: Pose, out = new Vector3()): Vector3 {
  const yaw = (pose.yawDegrees * Math.PI) / 180;
  const pitch = (pose.pitchDegrees * Math.PI) / 180;
  const horizontal = Math.cos(pitch) * pose.distance;
  return out.set(pose.focus.x + Math.sin(yaw) * horizontal, pose.focus.y + Math.sin(pitch) * pose.distance, pose.focus.z + Math.cos(yaw) * horizontal);
}

/**
 * Whether the eye's path down from the rig to `shot` and back up again stays
 * in the hall's space and clear of everything drawn — sampled on the same
 * blend {@link ExhibitCamera} drives, so it is the path the camera takes.
 */
function approachClear(rig: Pose, shot: Pose, near: OccluderSet): boolean {
  const scratch = { focus: new Vector3() };
  const eye = new Vector3();
  for (const [from, to] of [[rig, shot], [shot, rig]] as const) {
    for (let i = 1; i < APPROACH_SAMPLES; i += 1) {
      eyeOfPose(blendPose(from, to, smoothstep(i / APPROACH_SAMPLES), scratch), eye);
      if (!eyeInHallSpace(eye)) return false;
      if (eye.y < REPTILE_HOUSE_FLOOR_Y + REPTILE_WALL_HEIGHT + 3 && eyeTooClose(eye, near, APPROACH_CLEARANCE)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- director

/** One camera pose, in the terms `IsoCamera`'s shot override takes. */
interface Pose {
  readonly focus: Vector3;
  readonly yawDegrees: number;
  readonly pitchDegrees: number;
  readonly distance: number;
  readonly zoom: number;
}

/** The pose the camera is in when nothing is overriding it, for a child standing at `feet`. */
function rigPose(feet: Vector3, zoom: number): Pose {
  return {
    focus: new Vector3(feet.x, feet.y + CAMERA_FOCUS_LIFT, feet.z),
    yawDegrees: CAMERA_YAW_DEGREES,
    pitchDegrees: CAMERA_PITCH_DEGREES,
    distance: CAMERA_DISTANCE,
    zoom,
  };
}

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * The blend of two poses at `t` (0..1, already eased). The bearing takes the
 * short way round; the distance and the zoom blend in log space so the dolly
 * reads as even speed from 90 m to 5 m rather than all happening at the end.
 *
 * The pitch is held up while the eye is far out: it flattens only as the
 * eye closes in (and lifts first on the way out), so the path comes down over
 * the open top of the hall rather than through a wall.
 */
function blendPose(from: Pose, to: Pose, t: number, out: { focus: Vector3 }): Pose {
  const focus = out.focus.copy(from.focus).lerp(to.focus, t);
  const turn = wrapDegrees(to.yawDegrees - from.yawDegrees);
  // Coming in, the tilt flattens late; going out, it lifts early — either way
  // the eye is high whenever it is far, which is what keeps it over the walls.
  const pitchT = to.distance < from.distance ? t * t : 1 - (1 - t) * (1 - t);
  return {
    focus,
    yawDegrees: from.yawDegrees + turn * t,
    pitchDegrees: from.pitchDegrees + (to.pitchDegrees - from.pitchDegrees) * pitchT,
    distance: Math.exp(Math.log(from.distance) + (Math.log(to.distance) - Math.log(from.distance)) * t),
    zoom: Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * t),
  };
}

type Phase = 'idle' | 'in' | 'hold' | 'out';

/** One exhibit to solve in the background from its stand spot — see {@link ExhibitCamera.warm}. */
export interface WarmEntry {
  readonly id: string;
  subjects(): readonly Object3D[];
  cast(): readonly Object3D[];
  /** Her feet at the stand spot, world. */
  readonly at: Vector3;
  /** Her facing there, radians. */
  readonly facing: number;
}

/** What the director needs to know about her each frame. */
export interface ShotPlayer {
  readonly position: Vector3;
  readonly facing: number;
  readonly riding: boolean;
  readonly group: Object3D;
}

/** What the director needs from the frame's input. */
export interface ShotInput {
  readonly manualMoveActive: boolean;
  justPressed(action: 'jump'): boolean;
}

/**
 * Owns the shot's life: solve on a chip, ease down, hold for the reaction,
 * ease home — or home at once when she moves. {@link apply} is the single
 * place it touches the camera; `Game.tick` and the check both call it.
 */
export class ExhibitCamera {
  private readonly world: ShotWorld;
  private phase: Phase = 'idle';
  private from: Pose | null = null;
  private to: Pose | null = null;
  /** Seconds into the current ease. */
  private t = 0;
  private duration = 1;
  private held = 0;
  private engaged = false;
  private zoomBefore = 1;
  private readonly anchor = new Vector3();
  private readonly blended = { focus: new Vector3() };
  private current: Pose | null = null;
  private lastShot: ExhibitShot | null = null;
  private lastPlayer: ShotPlayer | null = null;
  private failures: string[] = [];
  private lastReport: SolveReport | null = null;
  private readonly memory = new Map<string, { at: Vector3; eye: Vector3 }>();
  private warmQueue: WarmEntry[] = [];
  private warming: { id: string; at: Vector3; steps: Generator<void, ExhibitShot | null> } | null = null;
  private pending: { id: string; subjects: readonly Object3D[]; steps: Generator<void, ExhibitShot | null> } | null = null;
  private subjects: readonly Object3D[] = [];
  private readonly liveFocus = new Vector3();
  private lastDt = 0;

  constructor(world: ShotWorld) {
    this.world = world;
  }

  /** The most recent solved shot — for the check. */
  get shot(): ExhibitShot | null {
    return this.lastShot;
  }

  /** Why the last solve turned its candidates down — for the check. */
  get report(): SolveReport | null {
    return this.lastReport;
  }

  /** Exhibits a chip was pressed on and no clear shot could be found — for the check. */
  get unsolved(): readonly string[] {
    return this.failures;
  }

  /** `true` from the chip until the camera is home again. */
  get active(): boolean {
    return this.phase !== 'idle' || this.pending !== null;
  }

  /** A chip has been pressed and its shot is still being solved. */
  get solving(): boolean {
    return this.pending !== null;
  }

  /** Where the shot is in its life — for the check. */
  get state(): Phase {
    return this.phase;
  }

  /**
   * A chip was pressed on exhibit `id`, whose reacting animals are
   * `subjects`. Solves the shot from where she stands now and starts the
   * move — from wherever the camera is, so a second chip mid-shot glides on
   * to the next animal rather than jumping home first.
   */
  start(id: string, subjects: readonly Object3D[], cast: readonly Object3D[], player: ShotPlayer): boolean {
    if (player.riding) return false;
    const report: SolveReport = { outside: 0, overSolid: 0, tooClose: 0, blocked: 0, approach: 0, blockers: {} };
    this.lastReport = report;
    const remembered = this.memory.get(id);
    const preferred = remembered && Math.hypot(remembered.at.x - player.position.x, remembered.at.z - player.position.z) < REMEMBER_WITHIN ? remembered.eye : undefined;
    this.pending = { id, subjects, steps: solveExhibitShotSteps(this.world, id, subjects, cast, player.position, player.facing, player.group, report, preferred) };
    this.anchor.copy(player.position);
    this.lastPlayer = player;
    // Most shots solve inside this first slice; a hard one finishes over the
    // next frames, in `update`.
    this.advanceSolve(player);
    return true;
  }

  /**
   * Queues every exhibit's shot to be solved in the background from its own
   * stand spot — on entering the hall — so that pressing a chip where the
   * layout stands her starts from an eye already known to work, and the
   * press only has to re-check it. Called again, it starts over.
   */
  warm(entries: readonly WarmEntry[]): void {
    this.warmQueue = [...entries];
    this.warming = null;
  }

  /** How many exhibits' shots are still to be warmed — for the check. */
  get warmingLeft(): number {
    return this.warmQueue.length + (this.warming ? 1 : 0);
  }

  private advanceWarm(): void {
    const deadline = now() + WARM_BUDGET_MS;
    while (now() < deadline) {
      if (!this.warming) {
        const next = this.warmQueue.shift();
        if (!next) return;
        this.warming = {
          id: next.id,
          at: next.at.clone(),
          steps: solveExhibitShotSteps(this.world, next.id, next.subjects(), next.cast(), next.at, next.facing, null),
        };
      }
      const step = this.warming.steps.next();
      if (step.done) {
        if (step.value && !this.memory.has(this.warming.id)) this.memory.set(this.warming.id, { at: this.warming.at, eye: step.value.eye.clone() });
        this.warming = null;
      }
    }
  }

  /** Runs the pending solve for up to {@link SOLVE_BUDGET_MS}, and starts the move when it lands. */
  private advanceSolve(player: ShotPlayer): void {
    const pending = this.pending;
    if (!pending) return;
    const deadline = now() + SOLVE_BUDGET_MS;
    for (;;) {
      const step = pending.steps.next();
      if (step.done) {
        this.pending = null;
        if (step.value) {
          this.memory.set(pending.id, { at: player.position.clone(), eye: step.value.eye.clone() });
          this.begin(step.value, pending.subjects, player);
        }
        else this.failures.push(pending.id);
        return;
      }
      if (now() >= deadline) return;
    }
  }

  /** The solved shot takes the camera: the move starts from wherever it is now. */
  private begin(shot: ExhibitShot, subjects: readonly Object3D[], player: ShotPlayer): void {
    if (this.phase === 'idle') {
      const camera = this.world.camera;
      this.zoomBefore = camera.targetZoom;
      // From exactly where the camera is: the focus it is really orbiting and
      // the zoom it has really reached, so the first placed frame is a no-op.
      this.from = { ...rigPose(player.position, camera.zoom), focus: camera.focusPoint.clone() };
    } else {
      this.from = this.snapshot(player);
    }
    this.lastShot = shot;
    this.subjects = subjects;
    this.liveFocus.copy(shot.focus);
    this.lastPlayer = player;
    this.to = { focus: shot.focus, yawDegrees: shot.yawDegrees, pitchDegrees: shot.pitchDegrees, distance: shot.distance, zoom: shot.zoom };
    this.anchor.copy(player.position);
    this.phase = 'in';
    this.t = 0;
    this.duration = EXHIBIT_SHOT_EASE_IN;
    this.held = 0;
  }

  /** Hands the camera straight back (leaving the hall, boarding the tortoise). */
  cancel(): void {
    this.pending = null;
    if (this.phase === 'in' || this.phase === 'hold') this.beginOut(EXHIBIT_SHOT_EASE_CANCEL);
  }

  /**
   * One frame. `bubbleLeft` is how much longer the exhibit's speech bubble
   * shows — the shot waits for the first hello's line to finish too.
   */
  update(dt: number, input: ShotInput, player: ShotPlayer, inside: boolean, bubbleLeft: number): void {
    this.lastPlayer = player;
    this.lastDt = dt;
    if (this.pending) {
      const moved = Math.hypot(player.position.x - this.anchor.x, player.position.z - this.anchor.z) > EXHIBIT_SHOT_MOVE_CANCEL;
      if (!inside || player.riding || moved || input.manualMoveActive || input.justPressed('jump')) this.pending = null;
      else this.advanceSolve(player);
    }
    if (!this.pending && this.phase === 'idle') this.advanceWarm();
    if (this.phase === 'idle') return;
    if (this.phase === 'in' || this.phase === 'hold') {
      const moved = Math.hypot(player.position.x - this.anchor.x, player.position.z - this.anchor.z) > EXHIBIT_SHOT_MOVE_CANCEL;
      if (!inside || player.riding || moved || input.manualMoveActive || input.justPressed('jump')) {
        this.beginOut(EXHIBIT_SHOT_EASE_CANCEL);
      }
    }
    this.t += dt;
    if (this.phase === 'in' && this.t >= this.duration) {
      this.phase = 'hold';
      this.held = 0;
    }
    if (this.phase === 'hold') {
      this.held += dt;
      if (this.held >= EXHIBIT_SHOT_HOLD && bubbleLeft <= 0) this.beginOut(EXHIBIT_SHOT_EASE_OUT);
    }
    if (this.phase === 'out' && this.t >= this.duration) this.phase = 'idle';
  }

  /**
   * Writes this frame's pose to the camera and returns the focus it claims,
   * or `null` — `Game` folds that into its one `focusClaim`. On the frame
   * the shot ends it gives the zoom back and clears the pose override,
   * exactly once (writing a constant zoom every frame is #329).
   */
  apply(camera: IsoCamera): Readonly<Vector3> | null {
    if (this.phase === 'idle') {
      if (this.engaged) {
        this.engaged = false;
        this.current = null;
        camera.setZoomTarget(this.zoomBefore);
        camera.clearPoseOverride();
      }
      return null;
    }
    const pose = this.pose();
    if (!pose) return null;
    this.current = pose;
    // **Placed, not chased.** The ease is this module's own smooth curve, so
    // the camera is put exactly on it each frame rather than damped towards
    // it: a damper on top would trail the curve by metres on the way down,
    // and the path the solver proved clear of the walls, the ribs and the
    // vines would not be the path the eye actually flew (measured: 0.15 m
    // off a rib at 6 m up). The curve starts from where the camera really
    // was (`start`), so the first frame does not move it.
    camera.snapShotOverride(pose.yawDegrees, pose.pitchDegrees, pose.distance);
    camera.snapZoomTarget(pose.zoom);
    camera.snapTo(pose.focus);
    this.engaged = true;
    return pose.focus;
  }

  private beginOut(duration: number): void {
    const player = this.lastPlayer;
    if (!player) return;
    this.from = this.snapshot(player);
    this.to = null;
    this.phase = 'out';
    this.t = 0;
    this.duration = duration;
  }

  /** The pose being shown now, frozen — the start of whatever move comes next. */
  private snapshot(player: ShotPlayer): Pose {
    const pose = this.current ?? this.pose() ?? rigPose(player.position, this.zoomBefore);
    return { ...pose, focus: pose.focus.clone() };
  }

  /**
   * The shot as it stands this frame: the eye held on the spot that was
   * proven clear, the aim on the animals as they are *now* — a tortoise
   * plods, a croc drifts, a skink potters — so the reaction stays in the
   * middle of the frame without the eye wandering anywhere unproven.
   */
  private liveShot(): Pose | null {
    const shot = this.lastShot;
    if (!shot || !this.to) return this.to;
    const { box } = subjectOf(this.subjects);
    if (box.isEmpty()) return this.to;
    // Eased towards the animals rather than pinned to them: a wriggling head
    // must not shake the picture.
    const at = box.getCenter(new Vector3());
    const focus = this.liveFocus.lerp(at, 1 - Math.pow(2, -this.lastDt / LIVE_FOCUS_HALF_LIFE));
    return { focus, ...shotAngles(shot.eye, focus), zoom: shot.zoom };
  }

  /** This frame's pose: the ease from `from` to the shot, or to the rig as it stands round her now. */
  private pose(): Pose | null {
    const from = this.from;
    const player = this.lastPlayer;
    if (!from || !player) return null;
    const target = this.phase === 'out' ? rigPose(player.position, this.zoomBefore) : this.liveShot();
    if (!target) return null;
    const t = this.phase === 'hold' ? 1 : smoothstep(this.t / this.duration);
    return blendPose(from, target, t, this.blended);
  }
}
