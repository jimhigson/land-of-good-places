import { Box3, InstancedMesh, Line3, Matrix4, Mesh, PerspectiveCamera, Raycaster, Sphere, Vector3, type BufferAttribute, type InterleavedBufferAttribute, type Material, type Object3D } from 'three';
import { CAMERA_DISTANCE, CAMERA_PITCH_DEGREES, CAMERA_YAW_DEGREES, CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN, PLAYER_RADIUS, cameraViewHalfHeight } from '../../core/constants';
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
 *
 * ## The one over-the-shoulder shot in the game
 *
 * The Library's story time takes its shot here too (Jim, 24 October 2026:
 * *"the camera … comes down to player-level and goes to over the shoulder
 * camera, with the other children listening and the reader visible"* —
 * `library/storyCamera.ts`): the same solver, the same director, in its own
 * room. What was the hall's alone is a {@link ShotRoom} now, and story time
 * asks of the solver what an exhibit does not ({@link ShotRules}): that its
 * subjects hide one another — a child's head in front of the owl is what that
 * shot is solved to see past — that each is seen as a whole, not only its
 * middle, and that nothing but another subject ever covers any of it (never
 * the room, never her own body); that the frame holds every one of them, on a
 * phone held upright too; and that the fan of eyes stands round her by her own
 * facing. Asked for nothing, the solver is the exhibits' exactly.
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
const EYE_HEIGHTS = [2.3, 2.8, 3.3, 3.8, 4.3, 4.8, 5.3] as const;
/** How far behind her the eye stands, along the line from the animal through her. */
const EYE_BACKS = [1.6, 2.4, 3.2, 4.0, 4.8, 5.6] as const;
/**
 * Bearings either side of "straight behind her", in degrees — the shoulder.
 * Ordered by preference only for readability: {@link shotCost} decides.
 */
const EYE_SWINGS = [20, -20, 32, -32, 10, -10, 45, -45, 0, 60, -60, 75, -75, 90, -90, 120, -120, 150, -150, 180] as const;
/** The bearing off "straight behind" a shot is happiest at: past her shoulder, not through her head. */
const IDEAL_SWING = 28;
/**
 * The stand-back and height a shot is happiest at. Far enough behind her and
 * high enough over her hat that she is a shoulder in the corner of the frame
 * rather than half of it — the first cut stood 2.4 m back at 2.8 m and her
 * hat filled 40% of the picture (measured in a real page, 6 October 2026).
 */
const IDEAL_BACK = 3.2;
const IDEAL_HEIGHT = 3.3;
/** Kept clear of the hall's walls, metres. */
const WALL_MARGIN = 0.8;
/** No drawn surface nearer the eye than this — the lens's near plane is 0.1 m. */
export const EYE_CLEARANCE = 0.3;
/** The eye stands over open floor this wide, so it is never inside a case, a bed or a planter. */
const EYE_FLOOR_CLEAR = 0.35;

/**
 * **The room a shot is taken in** — four walls round an open top, which is
 * the space the eye may move through: inside the walls, or over their tops.
 * Each such room is its own flat space off the sphere, so `y` is up in it.
 */
export interface ShotRoom {
  /** The middle of its floor plan, world metres. */
  readonly originX: number;
  readonly originZ: number;
  /** From the middle to the inner face of its walls, along x and along z. */
  readonly innerX: number;
  readonly innerZ: number;
  /** Its floor, world y. */
  readonly floorY: number;
  /** How tall its walls stand over its floor: over them, the room is open to the camera. */
  readonly wallHeight: number;
}

/** The Reptile House's hall, as its layout and its shell build it. */
export const REPTILE_HALL: ShotRoom = {
  originX: REPTILE_HOUSE_ORIGIN_X,
  originZ: REPTILE_HOUSE_ORIGIN_Z,
  innerX: REPTILE_INNER_X,
  innerZ: REPTILE_INNER_Z,
  floorY: REPTILE_HOUSE_FLOOR_Y,
  wallHeight: REPTILE_WALL_HEIGHT,
};

/**
 * **What a shot asks of the solver beyond an exhibit's** — story time's
 * (`library/storyCamera.ts`). All off, the solver is the exhibits' exactly.
 */
export interface ShotRules {
  /**
   * **The subjects hide one another** — each from the others, never from
   * itself. An exhibit's animals never block each other's shot (twelve babies
   * tumbling round their mum are what a crowd *is*); story time's are
   * children sat in rows in front of the owl, and a child's head between the
   * eye and the owl is exactly what that shot must see past. A subject listed
   * inside another (the owl's head, inside the owl) belongs to the outer one.
   */
  readonly mutual?: boolean;
  /**
   * **Seen as a whole, not only its middle**: besides its middle, this many of
   * the own drawn points of each subject marked {@link asWhole}, spread over it
   * (farthest-point sampling from its middle), are sightline targets, owned by
   * its outer subject — and at least the share it was marked with must be seen
   * (all of them, for a share of 1). An exhibit sees each animal's middle and
   * the tube round it; story time's children have heads half their height, and
   * the owl behind them can show her middle past one while a child's hair
   * covers the rest of her (measured: 40% of her drawn points, from cushion 1).
   */
  readonly spread?: number;
  /**
   * **The frame holds every subject whole** — every drawn extremity of every
   * subject (its spread, or its box's corners when it has none), and each of
   * `points` (the owl's bubble's anchor: a bubble
   * is drawn only while its anchor is in shot, #415), at least `margin` (a
   * share of the half-frame) in from the screen's edges, rather than only
   * their middle somewhere near the middle. A candidate eye from which that
   * takes a zoom further out than `CAMERA_ZOOM_MIN` is turned down; otherwise
   * the shot frames exactly that — everything held, the margin round it, and
   * no wider. (An exhibit's own framing is sized from its animals' box seen
   * from above; for an audience five metres off, on a phone held upright, it
   * came out at a lens a hundred and thirty-five degrees tall, the owl a few
   * pixels across — seen on the PR preview, 25 Oct 2026.)
   */
  readonly contain?: { readonly points: readonly Vector3[]; readonly margin: number };
  /**
   * **The fan stands round her, from her back** — the eyes tried are behind
   * her and over her shoulders by her own facing, not round the subjects'
   * middle along the line through her. At an exhibit she faces the animal, so
   * the two are the same; at story time she faces the storyteller's chair, and
   * the audience's middle is off to one side of it, so "behind her" from the
   * middle is beside her.
   */
  readonly overHerShoulder?: boolean;
  /**
   * **The shot we would draw by hand**, where it is not an exhibit's
   * (`IDEAL_SWING`, `IDEAL_BACK`, `IDEAL_HEIGHT`): the order the fan is tried
   * in, nearest first. It decides nothing about what a shot must see.
   */
  readonly ideal?: { readonly swing?: number; readonly back?: number; readonly height?: number };
}

/** Her own body's mark among a shot's occluders ({@link OccluderSet.owners}): not a subject, and not the room. */
const HER = -2;

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
  /** The room the hall stands in: where the eye may be, on its way down and once it is there. */
  readonly room: ShotRoom;
}

const SCRATCH_BOX = new Box3();
const RAYCASTER = new Raycaster();
const DIRECTIONS = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0), // flat-ok: a shot's room is its own flat space off the sphere (the reptile house at x 600, the library at x -600)
  new Vector3(0, -1, 0), // flat-ok: a shot's room is its own flat space off the sphere (the reptile house at x 600, the library at x -600)
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

/**
 * Marks subjects a shot must see **as a whole** ({@link ShotRules.spread}):
 * its sightlines reach a spread of each one's own drawn points as well as its
 * middle, and at least `share` of those points must be seen — 1, the whole of
 * it.
 */
export function asWhole<T extends Object3D>(objects: readonly T[], share = 1): T[] {
  for (const object of objects) object.userData['shotWhole'] = share;
  return [...objects];
}

/** The share of its spread points a subject marked {@link asWhole} must have seen, or null when it is not marked. */
export function wholeShare(subject: Object3D): number | null {
  const share = subject.userData['shotWhole'] as unknown;
  return typeof share === 'number' && share > 0 ? Math.min(1, share) : null;
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
  /**
   * The index, among the subjects, of the outermost subject this one is part
   * of (its own, when it is part of none) — the one subject whose meshes may
   * not hide it when the subjects hide one another ({@link ShotRules.mutual}).
   */
  readonly owner: number;
  /**
   * For one of a whole subject's spread points ({@link ShotRules.spread}): the
   * index of that subject, whose points are counted together, and the share of
   * them that must be seen. Absent on a middle.
   */
  readonly whole?: {
    readonly subject: number;
    readonly share: number;
    /** The point a hand's breadth further out from the subject's middle, across the floor: nothing of the room or of hers may stand in front of that either (see {@link edgeOf}). */
    readonly edge: Vector3;
  };
}

/**
 * For each subject, the outermost subject it is part of: the last subject met
 * walking up from it through its parents (itself, when none is above it).
 */
export function subjectOwners(subjects: readonly Object3D[]): number[] {
  const index = new Map(subjects.map((subject, i) => [subject, i] as const));
  return subjects.map((subject, i) => {
    let owner = i;
    for (let at: Object3D | null = subject; at; at = at.parent) {
      const found = index.get(at);
      if (found !== undefined) owner = found;
    }
    return owner;
  });
}

/**
 * The animals' world box and one sightline target per animal (its middle) —
 * and, with `spread`, that many more over each outer subject's own drawn
 * points ({@link ShotRules.spread}).
 */
export function subjectOf(subjects: readonly Object3D[], spread = 0, floorY = -Infinity): { box: Box3; targets: ShotTarget[] } {
  const box = new Box3();
  const targets: ShotTarget[] = [];
  const owners = subjectOwners(subjects);
  subjects.forEach((subject, i) => {
    boxOf(subject, SCRATCH_BOX);
    box.union(SCRATCH_BOX);
    targets.push({ point: SCRATCH_BOX.getCenter(new Vector3()), crowd: subject.userData['exhibitCrowd'] === true, owner: owners[i] ?? i });
  });
  if (spread > 0) {
    const steps = spreadTargets(subjects, spread, floorY, subjects.map(freeze), targets.map((target) => target.point));
    for (;;) {
      const step = steps.next();
      if (step.done) {
        targets.push(...step.value);
        break;
      }
    }
  }
  return { box, targets };
}

/**
 * The spread targets of every subject marked {@link asWhole}
 * ({@link ShotRules.spread}): `count` of its own drawn points each, owned by
 * its outer subject and carrying its share — a subject at a time, yielding
 * between them (a child is ten thousand vertices), from its drawn meshes as
 * they were {@link freeze frozen} and its middle as it was then.
 */
function* spreadTargets(
  subjects: readonly Object3D[],
  count: number,
  floorY: number,
  frozen: readonly FrozenMeshes[],
  middles: readonly Vector3[],
): Generator<void, ShotTarget[]> {
  const owners = subjectOwners(subjects);
  const out: ShotTarget[] = [];
  for (const [i, subject] of subjects.entries()) {
    const share = wholeShare(subject);
    const meshes = frozen[i];
    const middle = middles[i];
    if (share === null || !meshes || !middle) continue;
    yield;
    for (const point of spreadPoints(meshes, middle, count, floorY + SHOT_FLOOR_GRAZE)) {
      out.push({ point, crowd: false, owner: owners[i] ?? i, whole: { subject: i, share, edge: edgeOf(point, middle) } });
    }
  }
  return out;
}

/** A subject's drawn meshes as they stood at one moment: each one's vertices, and its world matrix then. */
type FrozenMeshes = readonly { readonly position: BufferAttribute | InterleavedBufferAttribute; readonly matrix: Matrix4 }[];

/**
 * **`subject`'s drawn meshes, held as they stand now** — every visible mesh's
 * vertices with a copy of its world matrix (an instanced one's per instance),
 * the rules `visiblePoints` keeps. A solve spreads over frames while a child
 * sways; sampled from these, its points are this frame's, whichever frame
 * each is sampled in.
 */
function freeze(subject: Object3D): FrozenMeshes {
  subject.updateWorldMatrix(true, true);
  const out: { position: BufferAttribute | InterleavedBufferAttribute; matrix: Matrix4 }[] = [];
  const instance = new Matrix4();
  subject.traverse((object) => {
    if (!(object instanceof Mesh) || !object.visible) return;
    for (let node = object.parent; node; node = node.parent) if (!node.visible) return;
    const position = object.geometry.getAttribute('position') as BufferAttribute | InterleavedBufferAttribute | undefined;
    if (!position) return;
    if (object instanceof InstancedMesh) {
      for (let n = 0; n < object.count; n += 1) {
        object.getMatrixAt(n, instance);
        out.push({ position, matrix: new Matrix4().multiplyMatrices(object.matrixWorld, instance) });
      }
    } else {
      out.push({ position, matrix: object.matrixWorld.clone() });
    }
  });
  return out;
}

/**
 * **How near the room's floor a drawn point is the floor's own**, metres: a
 * sole, and the ink round it, which reaches a centimetre or two under the
 * boards. Nothing is missed there that a child could miss; a sightline to
 * such a point only grazes the floor it stands on. `check:library`'s STORY
 * CAMERA measures what it measures above it too.
 */
export const SHOT_FLOOR_GRAZE = 0.03;

/**
 * `count` of a subject's drawn points ({@link freeze}: its visible meshes'
 * vertices, world) above `above`, each the one furthest from every point
 * picked before it, starting from `from` — spread over the whole of it, edges
 * first.
 */
function spreadPoints(meshes: FrozenMeshes, from: Vector3, count: number, above: number): Vector3[] {
  const all: number[] = [];
  const point = new Vector3();
  for (const { position, matrix } of meshes) {
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(matrix);
      if (point.y >= above) all.push(point.x, point.y, point.z); // flat-ok: a shot's room is its own flat space off the sphere
    }
  }
  // Sampled from at most SPREAD_FROM of them, every k-th: a child is ten thousand vertices, and
  // farthest-point sampling costs every one of them for every point picked.
  const stride = Math.max(1, Math.ceil(all.length / 3 / SPREAD_FROM));
  if (stride > 1) {
    let kept = 0;
    for (let i = 0; i < all.length / 3; i += stride, kept += 1) {
      all[kept * 3] = all[i * 3]!;
      all[kept * 3 + 1] = all[i * 3 + 1]!;
      all[kept * 3 + 2] = all[i * 3 + 2]!;
    }
    all.length = kept * 3;
  }
  const n = all.length / 3;
  if (n === 0) return [];
  // Each vertex's distance (squared) to the nearest point picked so far.
  const nearest = new Float64Array(n);
  for (let i = 0; i < n; i += 1) nearest[i] = (all[i * 3]! - from.x) ** 2 + (all[i * 3 + 1]! - from.y) ** 2 + (all[i * 3 + 2]! - from.z) ** 2;
  const picked: Vector3[] = [];
  while (picked.length < Math.min(count, n)) {
    let far = 0;
    for (let i = 1; i < n; i += 1) if (nearest[i]! > nearest[far]!) far = i;
    const point = new Vector3(all[far * 3]!, all[far * 3 + 1]!, all[far * 3 + 2]!);
    picked.push(point);
    for (let i = 0; i < n; i += 1) {
      const d = (all[i * 3]! - point.x) ** 2 + (all[i * 3 + 1]! - point.y) ** 2 + (all[i * 3 + 2]! - point.z) ** 2;
      if (d < nearest[i]!) nearest[i] = d;
    }
  }
  return picked;
}

/**
 * `point` a hand's breadth ({@link SIGHTLINE_TUBE}) further out from `from`,
 * across the floor: a sightline that only just grazes the edge of what is in
 * front of a subject is one this catches, rather than one that slips between
 * two of its points.
 */
function edgeOf(point: Vector3, from: Vector3): Vector3 {
  const dx = point.x - from.x;
  const dz = point.z - from.z;
  const across = Math.hypot(dx, dz);
  const out = point.clone();
  if (across > 1e-6) {
    out.x += (dx / across) * SIGHTLINE_TUBE;
    out.z += (dz / across) * SIGHTLINE_TUBE;
  }
  return out;
}

/**
 * How fat a star's sightline is: it is tested as a tube of this radius — its
 * own line and four more beside it, above, below and either side — rather
 * than one hairline. An animal breathes, does push-ups, potters about; a line
 * that only just grazes a wall top or a branch is a line the next frame loses.
 */
const SIGHTLINE_TUBE = 0.07;

/** Seen from `eye` down a whole {@link SIGHTLINE_TUBE}, nothing of subject `owner`'s own counting. */
function robustlySeen(eye: Vector3, target: Vector3, occluders: OccluderSet, report?: SolveReport, owner = -1): boolean {
  const along = target.clone().sub(eye).normalize();
  const side = new Vector3(0, 1, 0).cross(along); // flat-ok: a shot's room is its own flat space off the sphere (the reptile house at x 600, the library at x -600)
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up = along.clone().cross(side).normalize();
  const from = new Vector3();
  const to = new Vector3();
  for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    from.copy(eye).addScaledVector(side, a * SIGHTLINE_TUBE).addScaledVector(up, b * SIGHTLINE_TUBE);
    to.copy(target).addScaledVector(side, a * SIGHTLINE_TUBE).addScaledVector(up, b * SIGHTLINE_TUBE);
    const hit = firstHit(from, to, occluders, owner);
    if (hit) {
      if (report) report.blockers[hit] = (report.blockers[hit] ?? 0) + 1;
      return false;
    }
  }
  return true;
}

/**
 * How many sightlines a solve casts before it yields: a candidate that asks
 * for a whole audience's spread points still leaves each frame's slice of
 * solving ({@link SOLVE_BUDGET_MS}) a slice.
 */
const SIGHTLINES_PER_STEP = 12;

/** How many candidate eyes a solve frames before it yields. */
const CANDIDATES_PER_STEP = 40;

/** How many times finer the spread a passing candidate is confirmed on ({@link ShotRules.spread}). */
const SPREAD_CONFIRM = 6;

/** The most of a subject's drawn points a spread is sampled from (every k-th, see {@link spreadPoints}). */
const SPREAD_FROM = 2000;

/**
 * The sightlines from `eye`, stars first and failing fast: `null` as soon as
 * a star is hidden, a whole subject's share ({@link ShotRules.spread}) or too
 * much of the crowd is for {@link CROWD_SEEN} to be reachable, else every
 * target's result. Equivalent to {@link sightlinesPass} over all of them,
 * without casting the rays that cannot change the answer — and a step at a
 * time, yielding every {@link SIGHTLINES_PER_STEP} sightlines.
 */
function* shotSeesSteps(eye: Vector3, targets: readonly ShotTarget[], occluders: OccluderSet, report?: SolveReport): Generator<void, boolean[] | null> {
  const seen: boolean[] = targets.map(() => false);
  let cast = 0;
  for (const [index, target] of targets.entries()) {
    if (target.crowd || target.whole) continue;
    if (!robustlySeen(eye, target.point, occluders, report, target.owner)) return null;
    seen[index] = true;
    cast += 5;
    if (cast >= SIGHTLINES_PER_STEP) {
      cast = 0;
      yield;
    }
  }
  // Each whole subject's spread points, counted against the share it must have seen — and only
  // another subject may cover any of them: the room, or her own body, never.
  const points = new Map<number, number>();
  for (const { whole } of targets) if (whole) points.set(whole.subject, (points.get(whole.subject) ?? 0) + 1);
  const misses = new Map<number, number>();
  for (const [index, target] of targets.entries()) {
    const whole = target.whole;
    if (!whole) continue;
    const blocker = firstBlocker(eye, target.point, occluders, target.owner);
    const edge = firstBlocker(eye, whole.edge, occluders, target.owner);
    cast += 2;
    if (cast >= SIGHTLINES_PER_STEP) {
      cast = 0;
      yield;
    }
    for (const hit of [blocker, edge]) if (hit && report) report.blockers[hit.name] = (report.blockers[hit.name] ?? 0) + 1;
    // The room or her own body on the point itself, or a hand's breadth beside it (the corner of a
    // case grazing a child's back, her shoulder brushing a listener's outline as they sway): never.
    if ((blocker && blocker.owner < 0) || (edge && edge.owner < 0)) return null;
    if (blocker === null) {
      seen[index] = true;
      continue;
    }
    const missed = (misses.get(whole.subject) ?? 0) + 1;
    misses.set(whole.subject, missed);
    if (missed > mayMissOf(points.get(whole.subject) ?? 0, whole.share)) return null;
  }
  const crowd = targets.filter((target) => target.crowd).length;
  const mayMiss = crowd - Math.ceil(CROWD_SEEN_TO_SOLVE * crowd);
  let missed = 0;
  for (const [index, target] of targets.entries()) {
    if (!target.crowd) continue;
    seen[index] = !sightlineBlocked(eye, target.point, occluders, target.owner);
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
  const points = new Map<number, number>();
  const misses = new Map<number, number>();
  for (const [index, target] of targets.entries()) {
    const ok = seen[index] ?? false;
    if (target.whole) {
      points.set(target.whole.subject, (points.get(target.whole.subject) ?? 0) + 1);
      if (!ok) misses.set(target.whole.subject, (misses.get(target.whole.subject) ?? 0) + 1);
      continue;
    }
    if (!target.crowd && !ok) return false;
    if (target.crowd) {
      crowd += 1;
      if (ok) crowdSeen += 1;
    }
  }
  for (const target of targets) {
    if (target.whole && (misses.get(target.whole.subject) ?? 0) > mayMissOf(points.get(target.whole.subject) ?? 0, target.whole.share)) return false;
  }
  return crowd === 0 || crowdSeen >= CROWD_SEEN * crowd;
}

/** How many of `points` a subject marked {@link asWhole} with `share` may have hidden. */
function mayMissOf(points: number, share: number): number {
  return Math.floor(points * (1 - share) + 1e-9);
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
 * anything in `ignore`. Each mesh under `owners[k]` is marked as subject
 * `k`'s ({@link OccluderSet.owners}), so a sightline to that subject can pass
 * through its own body ({@link ShotRules.mutual}); a mesh reached from two
 * roots is collected once.
 */
export function collectOccluders(roots: readonly Object3D[], ignore: readonly Object3D[], owners: ReadonlyMap<Object3D, number> = new Map()): OccluderSet {
  const skip = new Set<Object3D>();
  for (const root of ignore) root.traverse((child) => skip.add(child));
  const ownerOf = new Map<Object3D, number>();
  for (const [root, owner] of owners) root.traverse((child) => ownerOf.set(child, owner));
  const meshes: Mesh[] = [];
  const seen = new Set<Object3D>();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((child) => {
      if (skip.has(child) || seen.has(child)) return;
      if (!(child instanceof Mesh) && !(child instanceof InstancedMesh)) return;
      if (!shownInScene(child)) return;
      if (isSeeThrough(child.material)) return;
      seen.add(child);
      meshes.push(child);
    });
  }
  // An instanced mesh is one bounding sphere round every instance in the
  // hall — every fern, every tuft — so it passes any sphere test and three
  // then walks all of its instances per ray. Each instance stands in as its
  // own proxy instead, so the cull sees the one fern actually in the way.
  const expanded: Mesh[] = [];
  const spheres: Sphere[] = [];
  const meshOwners: number[] = [];
  for (const mesh of meshes) {
    const owner = ownerOf.get(mesh) ?? -1;
    if (mesh instanceof InstancedMesh) {
      for (const proxy of instanceProxies(mesh)) {
        expanded.push(proxy);
        spheres.push(worldSphere(proxy));
        meshOwners.push(owner);
      }
    } else {
      // Where it is now, held: a solve spreads over frames while a child sways or an animal
      // breathes, and its answer must be the scene's as it stood when it began, not a race
      // between the solve and the clock (two runs of one scene chose two eyes).
      const still = new Mesh(mesh.geometry, mesh.material);
      still.name = mesh.name;
      still.matrixAutoUpdate = false;
      still.matrixWorldAutoUpdate = false;
      still.matrixWorld.copy(mesh.matrixWorld);
      if (!mesh.name && mesh.parent) still.name = mesh.parent.name;
      expanded.push(still);
      spheres.push(worldSphere(still));
      meshOwners.push(owner);
    }
  }
  return { meshes: expanded, spheres, owners: meshOwners };
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
  /** Per mesh, the subject it is part of (an index into the shot's subjects), {@link HER} for her own body, or −1 for the room — see {@link collectOccluders}. */
  readonly owners: readonly number[];
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

/**
 * **The part of `set` that can stand between `eye` and anything within
 * `reach` of `at`**: every mesh whose bounding sphere comes within `reach` of
 * the segment from the eye to `at`. A sightline from the eye to a point within
 * `reach` of `at` never strays further than `reach` from that segment, so
 * asking only these gives the same answer — and the reading room's nine
 * thousand instanced shelf books, each its own proxy, are a handful of them.
 */
export function occludersToward(set: OccluderSet, eye: Vector3, at: Vector3, reach: number): OccluderSet {
  SCRATCH_SEGMENT.set(eye, at);
  const meshes: Mesh[] = [];
  const spheres: Sphere[] = [];
  const owners: number[] = [];
  set.spheres.forEach((sphere, index) => {
    SCRATCH_SEGMENT.closestPointToPoint(sphere.center, true, SCRATCH_CLOSEST);
    if (SCRATCH_CLOSEST.distanceTo(sphere.center) > sphere.radius + reach) return;
    meshes.push(set.meshes[index]!);
    spheres.push(sphere);
    owners.push(set.owners[index] ?? -1);
  });
  return { meshes, spheres, owners };
}

/** Whether anything in `occluders` — nothing of subject `owner`'s own — crosses the open segment from `eye` to `target`. */
export function sightlineBlocked(eye: Vector3, target: Vector3, occluders: OccluderSet, owner = -1): boolean {
  return firstHit(eye, target, occluders, owner) !== null;
}

/** The name of the first thing crossing the segment from `eye` to `target`, nothing of subject `owner`'s own, or `null`. */
function firstHit(eye: Vector3, target: Vector3, occluders: OccluderSet, owner = -1): string | null {
  return firstBlocker(eye, target, occluders, owner)?.name ?? null;
}

/**
 * The first thing crossing the segment from `eye` to `target`, nothing of
 * subject `owner`'s own: its name, and whose it is — a subject's index,
 * {@link HER} for her own body, or −1 for the room — or `null`.
 */
export function firstBlocker(eye: Vector3, target: Vector3, occluders: OccluderSet, owner = -1): { readonly name: string; readonly owner: number } | null {
  const toward = target.clone().sub(eye);
  const length = toward.length();
  if (length < 1e-6) return null;
  SCRATCH_SEGMENT.set(eye, target);
  const candidates: Mesh[] = [];
  const whose = new Map<Object3D, number>();
  occluders.spheres.forEach((sphere, index) => {
    const own = occluders.owners[index] ?? -1;
    if (owner >= 0 && own === owner) return;
    SCRATCH_SEGMENT.closestPointToPoint(sphere.center, true, SCRATCH_CLOSEST);
    if (SCRATCH_CLOSEST.distanceTo(sphere.center) > sphere.radius + 0.01) return;
    const mesh = occluders.meshes[index]!;
    candidates.push(mesh);
    whose.set(mesh, own);
  });
  if (candidates.length === 0) return null;
  RAYCASTER.set(eye, toward.divideScalar(length));
  RAYCASTER.near = 0;
  // A hair short of the target, so the far side of a thin animal is never "in front" of it.
  RAYCASTER.far = Math.max(0, length - 0.05);
  const hit = RAYCASTER.intersectObjects(candidates, false)[0];
  return hit ? { name: hit.object.name || hit.object.parent?.name || '(unnamed)', owner: whose.get(hit.object) ?? -1 } : null;
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

/** Whether a world point is inside the room's walls, clear of them by `margin`. */
export function insideHall(point: Vector3, room: ShotRoom, margin = WALL_MARGIN): boolean {
  return (
    Math.abs(point.x - room.originX) <= room.innerX - margin &&
    Math.abs(point.z - room.originZ) <= room.innerZ - margin &&
    point.y > room.floorY + 0.5
  );
}

/**
 * Whether an eye on its way down is somewhere a camera may be: over the
 * room's open top (above its walls), or inside them. Never below the wall
 * tops outside the room — that is the camera through a wall.
 */
export function eyeInHallSpace(point: Vector3, room: ShotRoom): boolean {
  if (point.y >= room.floorY + room.wallHeight + 0.3) return true;
  return insideHall(point, room, 0.2);
}

const wrapDegrees = (degrees: number): number => ((((degrees + 180) % 360) + 360) % 360) - 180;

/** The yaw/pitch/distance `IsoCamera.setShotOverride` takes for an eye looking at a focus. */
export function shotAngles(eye: Vector3, focus: Vector3): { yawDegrees: number; pitchDegrees: number; distance: number } {
  const dx = eye.x - focus.x;
  const dy = eye.y - focus.y; // flat-ok: a shot's room is its own flat space off the sphere (the reptile house at x 600, the library at x -600)
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
/**
 * Her body as a box: the player's own collision radius round her feet, up to
 * the top of her hat. Not her group's bounding box — that carries her name
 * label, her shadow and whatever she is holding, and came out 2.1 m wide,
 * overlapping the snake she was looking at.
 */
export function herBodyBox(feet: Vector3, topHeight: number): Box3 {
  return new Box3(new Vector3(feet.x - PLAYER_RADIUS, feet.y, feet.z - PLAYER_RADIUS), new Vector3(feet.x + PLAYER_RADIUS, feet.y + topHeight, feet.z + PLAYER_RADIUS));
}

/** {@link herBodyBox} for an object that carries a `topHeight` (a `Player`'s group does not; see {@link ShotPlayer}). */
function bodyBoxOf(body: Object3D): Box3 {
  const top = (body.userData['topHeight'] as number | undefined) ?? 2.2;
  return herBodyBox(body.getWorldPosition(new Vector3()), top);
}

/** The least span of the frame the animals must reach — `check:exhibit-camera` holds the real frame to {@link SUBJECT_SPAN_MIN}. */
const SUBJECT_SPAN_TO_SOLVE = 0.24;
export const SUBJECT_SPAN_MIN = 0.2;

/** Her largest share of the frame's area the solver will take — `check:exhibit-camera` allows {@link HER_SHARE_MAX}. */
const HER_SHARE_TO_SOLVE = 0.22;
/** Her largest share of the frame's area a shot may show: she is the shoulder, the animal is the subject. */
export const HER_SHARE_MAX = 0.27;

const SCRATCH_LENS = new PerspectiveCamera();

/**
 * The share of the frame's area `box` would cover from `eye` looking at
 * `focus` — the lens solved exactly as `IsoCamera.applyFrustum` solves it
 * for this distance and (clamped) zoom.
 */
export function screenShare(camera: IsoCamera, eye: Vector3, focus: Vector3, zoom: number, box: Box3): number {
  return screenExtent(camera, eye, focus, zoom, box).share;
}

/**
 * {@link screenShare}, and the box's **span** — the larger of the share of
 * the frame's width and of its height it reaches across.
 */
export function screenExtent(camera: IsoCamera, eye: Vector3, focus: Vector3, zoom: number, box: Box3): { share: number; span: number } {
  const aspect = camera.camera.aspect;
  const halfHeight = cameraViewHalfHeight(aspect) / Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, zoom));
  const lens = SCRATCH_LENS;
  lens.fov = (2 * Math.atan(halfHeight / eye.distanceTo(focus)) * 180) / Math.PI;
  lens.aspect = aspect;
  lens.near = 0.1;
  lens.far = 100;
  lens.position.copy(eye);
  lens.up.set(0, 1, 0); // flat-ok: a shot's room is its own flat space off the sphere (the reptile house at x 600, the library at x -600)
  lens.lookAt(focus);
  lens.updateMatrixWorld();
  lens.updateProjectionMatrix();
  let minX = 1;
  let minY = 1;
  let maxX = -1;
  let maxY = -1;
  const corner = new Vector3();
  for (let i = 0; i < 8; i += 1) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(lens); // flat-ok: a shot's room is its own flat space off the sphere (the reptile house at x 600, the library at x -600)
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }
  const clampN = (v: number): number => Math.max(-1, Math.min(1, v));
  const width = Math.max(0, clampN(maxX) - clampN(minX)) / 2;
  const height = Math.max(0, clampN(maxY) - clampN(minY)) / 2;
  return { share: width * height, span: Math.max(width, height) };
}

const SCRATCH_FORWARD = new Vector3();
const SCRATCH_RIGHT = new Vector3();
const SCRATCH_UP = new Vector3();
const SCRATCH_CORNER = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0); // flat-ok: a shot's room is its own flat space off the sphere (the reptile house at x 600, the library at x -600)

/**
 * **The closest zoom from `eye`, looking at `focus`, at which every one of
 * `drawn` and every one of `points` is in shot**, `margin` (a share of the
 * half-frame) in from the screen's edges. Unclamped; 0 when one of them is not
 * in front of the eye at all.
 *
 * Two tests, because two things decide "in shot". A drawn point — a vertex of
 * something drawn — is in shot when it is inside the lens: the lens as `IsoCamera.applyFrustum`
 * solves it for this eye (`fov = 2·atan(halfHeight / distance)`, `halfHeight =
 * cameraViewHalfHeight(aspect) / zoom`), turned as `lookAt` turns it. A point
 * is a **label's anchor**, and a label is drawn only while the camera's own
 * test says its anchor is in shot (`IsoCamera.isOnScreen`, #415): its offset
 * from the eye along the screen's axes against the frame's half-size *at the
 * focus* — stricter than the lens for an anchor beyond the focus, which is
 * where the owl reads from — so a point is held to that test.
 */
export function containZoom(camera: IsoCamera, eye: Vector3, focus: Vector3, drawn: readonly Vector3[], points: readonly Vector3[], margin: number): number {
  const aspect = camera.camera.aspect;
  const base = cameraViewHalfHeight(aspect);
  const forward = SCRATCH_FORWARD.copy(focus).sub(eye);
  const distance = forward.length();
  if (distance < 1e-6) return 0;
  forward.divideScalar(distance);
  const right = SCRATCH_RIGHT.crossVectors(forward, WORLD_UP);
  if (right.lengthSq() < 1e-9) return 0;
  right.normalize();
  const up = SCRATCH_UP.crossVectors(right, forward);
  /** The tangent of the lens's half-height angle the drawn points need, so far. */
  let need = 0;
  /** The frame's half-height at the focus the label anchors need, so far (metres). */
  let reach = 0;
  for (const point of drawn) {
    const v = SCRATCH_CORNER.copy(point).sub(eye);
    const depth = v.dot(forward);
    if (depth < camera.camera.near) return 0;
    need = Math.max(need, Math.abs(v.dot(right)) / (depth * aspect), Math.abs(v.dot(up)) / depth);
  }
  for (const point of points) {
    const v = SCRATCH_CORNER.copy(point).sub(eye);
    if (v.dot(forward) < camera.camera.near) return 0;
    reach = Math.max(reach, Math.abs(v.dot(right)) / aspect, Math.abs(v.dot(up)));
  }
  const byDrawn = need > 0 ? base / ((need / (1 - margin)) * distance) : Infinity;
  const byLabels = reach > 0 ? (base * (1 - margin)) / reach : Infinity;
  return Math.min(byDrawn, byLabels);
}

export function shotZoom(camera: IsoCamera, subject: Box3): number {
  const size = subject.getSize(new Vector3());
  const half = Math.max(0.55, Math.hypot(size.x, size.z) / 2, size.y / 2);
  return camera.zoomToFit(half * 1.25, half * 1.05, 0.35);
}

/** Lower is better: how far a clear candidate is from the shot we would draw by hand. */
function shotCost(swing: number, back: number, height: number, yawDegrees: number, ideal: ShotRules['ideal'] = {}): number {
  const rigTurn = Math.abs(wrapDegrees(yawDegrees - CAMERA_YAW_DEGREES));
  return (
    Math.abs(Math.abs(swing) - (ideal.swing ?? IDEAL_SWING)) / 10 +
    Math.abs(back - (ideal.back ?? IDEAL_BACK)) +
    Math.abs(height - (ideal.height ?? IDEAL_HEIGHT)) +
    rigTurn / 90
  );
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
  rules: ShotRules = {},
): ExhibitShot | null {
  const steps = solveExhibitShotSteps(world, exhibitId, subjects, cast, player, facing, body, report, undefined, undefined, rules);
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
  her?: Box3,
  rules: ShotRules = {},
): Generator<void, ExhibitShot | null> {
  const middles = subjectOf(subjects);
  const box = middles.box;
  // A subject seen as a whole is judged on its spread, not on a tube to its middle as well.
  const judged = (list: readonly ShotTarget[]): ShotTarget[] => (rules.spread ? list.filter((_, i) => wholeShare(subjects[i]!) === null) : [...list]);
  const targets = judged(middles.targets);
  if (box.isEmpty()) return null;
  const focus = box.getCenter(new Vector3());
  // Every sightline ends inside the subjects' box: this far round its middle, and the tube's width.
  const sightReach = box.getSize(new Vector3()).length() / 2 + SIGHTLINE_TUBE + 0.02;
  const room = world.room;
  // Subjects that hide one another are occluders like the room, each mesh
  // marked as its own subject's, so a sightline passes through only the body
  // it is looking at (`ShotRules.mutual`); otherwise none of them is one.
  const owners = new Map<Object3D, number>();
  if (rules.mutual) {
    for (const { owner } of middles.targets) {
      const outer = subjects[owner];
      if (outer) owners.set(outer, owner);
    }
  }
  const mutualRoots = [...owners.keys()];
  if (body) owners.set(body, HER);
  const ignore = [...(rules.mutual ? [] : subjects), ...cast, ...world.seeThrough];
  // **Everything the solve reads of the scene, as it stands this frame**: the occluders held where
  // they are (`collectOccluders`) and the whole subjects' drawn meshes frozen — so the eye it
  // chooses is this frame's answer, however many frames the solve then spreads over while the
  // listeners sway (two runs of one scene once chose two eyes).
  const occluders = collectOccluders([world.hall, ...(body ? [body] : []), ...mutualRoots], ignore, owners);
  // The eye must not be inside her, either, but she is not something to keep
  // clear of by a hand's breadth — the shot is over her shoulder.
  const near = collectOccluders([world.hall, ...mutualRoots], ignore);
  const frozen = rules.spread ? subjects.map((subject) => (wholeShare(subject) === null ? [] : freeze(subject))) : [];
  const middlePoints = middles.targets.map((target) => target.point);
  yield;
  if (rules.spread) targets.push(...(yield* spreadTargets(subjects, rules.spread, world.room.floorY, frozen, middlePoints)));
  const framing = shotZoom(world.camera, box);
  const contain = rules.contain;
  /**
   * What the frame must hold of the subjects ({@link ShotRules.contain}): each outer subject seen as a
   * whole by its own spread — its drawn extremities, sampled edges first — and any other by its box's
   * corners. Never a rotated child's box: a box round a turned model is half again as wide as she is,
   * and its near corners held the lens of a phone held upright a hundred and seventeen degrees tall.
   */
  const drawn: Vector3[] = [];
  if (contain) {
    const sampled = new Set<number>();
    for (const target of targets) {
      if (target.whole && target.owner === target.whole.subject) {
        drawn.push(target.point);
        sampled.add(target.owner);
      }
    }
    for (const owner of new Set(middles.targets.map((target) => target.owner))) {
      const subject = subjects[owner];
      if (sampled.has(owner) || !subject) continue;
      const corners = boxOf(subject, new Box3());
      for (let i = 0; i < 8; i += 1) drawn.push(new Vector3(i & 1 ? corners.max.x : corners.min.x, i & 2 ? corners.max.y : corners.min.y, i & 4 ? corners.max.z : corners.min.z)); // flat-ok: a shot's room is its own flat space off the sphere
    }
  }
  /**
   * The zoom this eye frames the shot at — or null, when it cannot hold
   * everything {@link ShotRules.contain} asks for at any zoom the camera has.
   */
  const zoomFrom = (eye: Vector3): number | null => {
    if (!contain) return framing;
    const fit = containZoom(world.camera, eye, focus, drawn, contain.points, contain.margin);
    return fit < CAMERA_ZOOM_MIN ? null : Math.min(CAMERA_ZOOM_MAX, fit);
  };
  const herBox = her ?? (body ? bodyBoxOf(body) : null);
  const rig = rigPose(player, world.camera.targetZoom);

  // "Behind her": along the line from the animals through her. Stood right
  // on top of the focus, her own back is the answer instead — and always,
  // over her shoulder (`ShotRules.overHerShoulder`), with the fan round her.
  let behindX = player.x - focus.x;
  let behindZ = player.z - focus.z;
  const reach = Math.hypot(behindX, behindZ);
  if (reach < 0.5 || rules.overHerShoulder) {
    behindX = -Math.sin(facing);
    behindZ = -Math.cos(facing);
  } else {
    behindX /= reach;
    behindZ /= reach;
  }
  const behind = Math.atan2(behindX, behindZ);
  const origin = rules.overHerShoulder ? player : focus;
  const start = rules.overHerShoulder ? 0 : Math.max(reach, 0.5);

  // Every candidate, cheapest-to-reject tests first, then in order of how
  // close each is to the shot we would draw by hand: the first that passes
  // everything is the best there is, so nothing after it is ever cast.
  const candidates: { eye: Vector3; cost: number; zoom: number }[] = [];
  let built = 0;
  for (const swing of EYE_SWINGS) {
    const bearing = behind + (swing * Math.PI) / 180;
    for (const back of EYE_BACKS) {
      for (const height of EYE_HEIGHTS) {
        // A step at a time: each eye is framed through a lens or three, and there are hundreds.
        built += 1;
        if (built % CANDIDATES_PER_STEP === 0) yield;
        const out = start + back;
        const eye = new Vector3(origin.x + Math.sin(bearing) * out, room.floorY + height, origin.z + Math.cos(bearing) * out);
        if (!insideHall(eye, room)) {
          if (report) report.outside += 1;
          continue;
        }
        if (!world.collision.isClearCircle(eye.x, eye.z, EYE_FLOOR_CLEAR)) {
          if (report) report.overSolid += 1;
          continue;
        }
        const zoom = zoomFrom(eye);
        if (zoom === null) {
          if (report) report.uncontained += 1;
          continue;
        }
        // Over her shoulder, not through her: how much of the frame she
        // would fill, from this eye, at this shot's lens.
        const share = herBox ? screenShare(world.camera, eye, focus, zoom, herBox) : 0;
        if (report) report.herLeast = Math.min(report.herLeast ?? 1, share);
        if (share > HER_SHARE_TO_SOLVE) {
          if (report) report.herTooBig += 1;
          continue;
        }
        // And big enough to see the reaction: the clamped zoom can only
        // frame so tight, so a small animal wants the eye nearer.
        const { span } = screenExtent(world.camera, eye, focus, zoom, box);
        if (span < SUBJECT_SPAN_TO_SOLVE) {
          if (report) report.tooSmall += 1;
          continue;
        }
        candidates.push({ eye, zoom, cost: shotCost(swing, back, height, shotAngles(eye, focus).yawDegrees, rules.ideal) + share * 4 + Math.max(0, 0.35 - span) * 6 });
      }
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  // The eye that worked last time from here goes first: every test still runs
  // on it, so it is only ever a guess about where to start looking.
  const preferredZoom = preferred && insideHall(preferred, room) ? zoomFrom(preferred) : null;
  if (preferred && preferredZoom !== null && (!herBox || screenShare(world.camera, preferred, focus, preferredZoom, herBox) <= HER_SHARE_TO_SOLVE)) {
    candidates.unshift({ eye: preferred.clone(), cost: -1, zoom: preferredZoom });
  }

  let best: { eye: Vector3; seen: boolean[]; cost: number; zoom: number } | null = null;
  /** The finer spread a passing candidate is confirmed on, sampled the first time one passes. */
  let fine: ShotTarget[] | null = null;
  let tried = 0;
  for (const { eye, cost, zoom } of candidates) {
    if (tried > 0) yield;
    tried += 1;
    if (eyeTooClose(eye, near)) {
      if (report) report.tooClose += 1;
      continue;
    }
    const seen = yield* shotSeesSteps(eye, targets, occludersToward(occluders, eye, focus, sightReach), report);
    if (!seen) {
      if (report) report.blocked += 1;
      continue;
    }
    // And the way there and back: the eye sweeps down from the rig, and a
    // shot whose own approach crosses a wall, the log or a vine is no shot.
    if (!(yield* approachClear(rig, { focus, ...shotAngles(eye, focus), zoom }, near, room))) {
      if (report) report.approach += 1;
      continue;
    }
    // Seen whole on the coarse spread, confirmed on a finer one before it is taken: sixteen points
    // can sit either side of the corner of a bookcase that a child's back is behind.
    if (rules.spread) {
      fine ??= [...judged(middles.targets), ...(yield* spreadTargets(subjects, rules.spread * SPREAD_CONFIRM, world.room.floorY, frozen, middlePoints))];
      if (!(yield* shotSeesSteps(eye, fine, occludersToward(occluders, eye, focus, sightReach), report))) {
        if (report) report.unconfirmed += 1;
        continue;
      }
    }
    best = { eye, seen, cost, zoom };
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
    zoom: best.zoom,
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
  herTooBig: number;
  tooSmall: number;
  /** Eyes from which the frame could not hold everything {@link ShotRules.contain} asks for. */
  uncontained: number;
  /** Eyes that saw every whole subject on the coarse spread and not on the finer one ({@link SPREAD_CONFIRM}). */
  unconfirmed: number;
  /** The smallest share of the frame she would have filled from any eye that got that far. */
  herLeast?: number;
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
 * in the room's space and clear of everything drawn — sampled on the same
 * blend {@link ExhibitCamera} drives, so it is the path the camera takes.
 */
function* approachClear(rig: Pose, shot: Pose, near: OccluderSet, room: ShotRoom): Generator<void, boolean> {
  const scratch = { focus: new Vector3() };
  const eye = new Vector3();
  for (const [from, to] of [[rig, shot], [shot, rig]] as const) {
    for (let i = 1; i < APPROACH_SAMPLES; i += 1) {
      eyeOfPose(blendPose(from, to, smoothstep(i / APPROACH_SAMPLES), scratch), eye);
      if (!eyeInHallSpace(eye, room)) return false;
      if (eye.y < room.floorY + room.wallHeight + 3 && eyeTooClose(eye, near, APPROACH_CLEARANCE)) return false;
      // A step at a time: every sample asks every drawn surface in the room.
      if (i % APPROACH_SAMPLES_PER_STEP === 0) yield;
    }
  }
  return true;
}

/** Approach samples between yields — each asks every drawn surface in the room ({@link eyeTooClose}). */
const APPROACH_SAMPLES_PER_STEP = 10;

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
  /** The top of her head, hat and all, above her feet. */
  readonly topHeight: number;
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
   * to the next animal rather than jumping home first. `rules` are what the
   * shot asks of the solver beyond an exhibit's ({@link ShotRules}: story
   * time's).
   */
  start(id: string, subjects: readonly Object3D[], cast: readonly Object3D[], player: ShotPlayer, rules: ShotRules = {}): boolean {
    if (player.riding) return false;
    const report: SolveReport = { outside: 0, overSolid: 0, tooClose: 0, blocked: 0, approach: 0, herTooBig: 0, tooSmall: 0, uncontained: 0, unconfirmed: 0, blockers: {} };
    this.lastReport = report;
    const remembered = this.memory.get(id);
    const preferred = remembered && Math.hypot(remembered.at.x - player.position.x, remembered.at.z - player.position.z) < REMEMBER_WITHIN ? remembered.eye : undefined;
    this.pending = {
      id,
      subjects,
      steps: solveExhibitShotSteps(this.world, id, subjects, cast, player.position, player.facing, player.group, report, preferred, herBodyBox(player.position, player.topHeight), rules),
    };
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

  /** Her box as it would be stood at `feet` — for warming a shot from a stand spot she is not on yet. */
  private herAt(feet: Vector3): Box3 | undefined {
    const player = this.lastPlayer;
    if (!player) return undefined;
    return herBodyBox(feet, player.topHeight);
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
          steps: solveExhibitShotSteps(this.world, next.id, next.subjects(), next.cast(), next.at, next.facing, null, undefined, undefined, this.herAt(next.at)),
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
