import { Box3, InstancedMesh, Mesh, Raycaster, Vector3, type Material, type Object3D } from 'three';
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
/** How far she may drift (a nudge, an idle shuffle) before it counts as walking off. Metres. */
const EXHIBIT_SHOT_MOVE_CANCEL = 0.25;

/** Eye heights tried, above the hall floor. Her head is at about 1.4 m; "slightly above". */
const EYE_HEIGHTS = [2.3, 2.8, 3.3] as const;
/** How far behind her the eye stands, along the line from the animal through her. */
const EYE_BACKS = [1.6, 2.4, 3.2] as const;
/**
 * Bearings either side of "straight behind her", in degrees — the shoulder.
 * Ordered by preference only for readability: {@link shotCost} decides.
 */
const EYE_SWINGS = [20, -20, 32, -32, 10, -10, 45, -45, 0, 60, -60] as const;
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
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

/** An object nothing is drawn under is a point at its own origin. */
function boxOf(object: Object3D, out: Box3): Box3 {
  object.updateWorldMatrix(true, true);
  out.setFromObject(object);
  if (out.isEmpty()) {
    const at = object.getWorldPosition(new Vector3());
    out.set(at, at);
  }
  return out;
}

/** The animals' world box and one sightline target per animal (its middle). */
export function subjectOf(subjects: readonly Object3D[]): { box: Box3; targets: Vector3[] } {
  const box = new Box3();
  const targets: Vector3[] = [];
  for (const subject of subjects) {
    boxOf(subject, SCRATCH_BOX);
    box.union(SCRATCH_BOX);
    targets.push(SCRATCH_BOX.getCenter(new Vector3()));
  }
  return { box, targets };
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
export function collectOccluders(roots: readonly Object3D[], ignore: readonly Object3D[]): Mesh[] {
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
  return meshes;
}

/** Whether anything in `occluders` crosses the open segment from `eye` to `target`. */
export function sightlineBlocked(eye: Vector3, target: Vector3, occluders: readonly Mesh[]): boolean {
  const toward = target.clone().sub(eye);
  const length = toward.length();
  if (length < 1e-6) return false;
  RAYCASTER.set(eye, toward.divideScalar(length));
  RAYCASTER.near = 0;
  // A hair short of the target, so the far side of a thin animal is never "in front" of it.
  RAYCASTER.far = Math.max(0, length - 0.05);
  return RAYCASTER.intersectObjects(occluders as Mesh[], false).length > 0;
}

/** Whether any drawn surface is within {@link EYE_CLEARANCE} of the eye, along the six axes. */
export function eyeTooClose(eye: Vector3, occluders: readonly Mesh[], clearance = EYE_CLEARANCE): boolean {
  RAYCASTER.near = 0;
  RAYCASTER.far = clearance;
  for (const direction of DIRECTIONS) {
    RAYCASTER.set(eye, direction);
    if (RAYCASTER.intersectObjects(occluders as Mesh[], false).length > 0) return true;
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
  const dy = eye.y - focus.y;
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
  player: Vector3,
  facing: number,
  body: Object3D | null,
): ExhibitShot | null {
  const { box, targets } = subjectOf(subjects);
  if (box.isEmpty()) return null;
  const focus = box.getCenter(new Vector3());
  const occluders = collectOccluders(body ? [world.hall, body] : [world.hall], [...subjects, ...world.seeThrough]);
  // The eye must not be inside her, either, but she is not something to keep
  // clear of by a hand's breadth — the shot is over her shoulder.
  const near = collectOccluders([world.hall], [...subjects, ...world.seeThrough]);

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

  let best: { eye: Vector3; seen: boolean[]; cost: number } | null = null;
  let tried = 0;
  let clear = 0;
  const eye = new Vector3();
  for (const swing of EYE_SWINGS) {
    const bearing = behind + (swing * Math.PI) / 180;
    for (const back of EYE_BACKS) {
      for (const height of EYE_HEIGHTS) {
        const out = start + back;
        eye.set(focus.x + Math.sin(bearing) * out, REPTILE_HOUSE_FLOOR_Y + height, focus.z + Math.cos(bearing) * out);
        if (!insideHall(eye)) continue;
        if (!world.collision.isClearCircle(eye.x, eye.z, EYE_FLOOR_CLEAR)) continue;
        if (eyeTooClose(eye, near)) continue;
        tried += 1;
        const seen = targets.map((target) => !sightlineBlocked(eye, target, occluders));
        const centreSeen = !sightlineBlocked(eye, focus, occluders);
        if (!centreSeen || seen.some((s) => !s)) continue;
        clear += 1;
        const cost = shotCost(swing, back, height, shotAngles(eye, focus).yawDegrees);
        if (!best || cost < best.cost) best = { eye: eye.clone(), seen, cost };
      }
    }
  }
  if (!best) return null;
  const angles = shotAngles(best.eye, focus);
  return {
    exhibitId,
    focus,
    eye: best.eye,
    ...angles,
    zoom: shotZoom(world.camera, box),
    subject: box,
    samples: targets.map((point, index) => ({ point, seen: best.seen[index] ?? false })),
    tried,
    clear,
  };
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

  constructor(world: ShotWorld) {
    this.world = world;
  }

  /** The most recent solved shot — for the check. */
  get shot(): ExhibitShot | null {
    return this.lastShot;
  }

  /** Exhibits a chip was pressed on and no clear shot could be found — for the check. */
  get unsolved(): readonly string[] {
    return this.failures;
  }

  /** `true` from the chip until the camera is home again. */
  get active(): boolean {
    return this.phase !== 'idle';
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
  start(id: string, subjects: readonly Object3D[], player: ShotPlayer): boolean {
    if (player.riding) return false;
    const shot = solveExhibitShot(this.world, id, subjects, player.position, player.facing, player.group);
    if (!shot) {
      this.failures.push(id);
      return false;
    }
    if (this.phase === 'idle') {
      this.zoomBefore = this.world.camera.targetZoom;
      this.from = rigPose(player.position, this.zoomBefore);
    } else {
      this.from = this.snapshot(player);
    }
    this.lastShot = shot;
    this.lastPlayer = player;
    this.to = { focus: shot.focus, yawDegrees: shot.yawDegrees, pitchDegrees: shot.pitchDegrees, distance: shot.distance, zoom: shot.zoom };
    this.anchor.copy(player.position);
    this.phase = 'in';
    this.t = 0;
    this.duration = EXHIBIT_SHOT_EASE_IN;
    this.held = 0;
    return true;
  }

  /** Hands the camera straight back (leaving the hall, boarding the tortoise). */
  cancel(): void {
    if (this.phase === 'in' || this.phase === 'hold') this.beginOut(EXHIBIT_SHOT_EASE_CANCEL);
  }

  /**
   * One frame. `bubbleLeft` is how much longer the exhibit's speech bubble
   * shows — the shot waits for the first hello's line to finish too.
   */
  update(dt: number, input: ShotInput, player: ShotPlayer, inside: boolean, bubbleLeft: number): void {
    this.lastPlayer = player;
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
    camera.setShotOverride(pose.yawDegrees, pose.pitchDegrees, pose.distance);
    camera.setZoomTarget(pose.zoom);
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

  /** This frame's pose: the ease from `from` to the shot, or to the rig as it stands round her now. */
  private pose(): Pose | null {
    const from = this.from;
    const player = this.lastPlayer;
    if (!from || !player) return null;
    const target = this.phase === 'out' ? rigPose(player.position, this.zoomBefore) : this.to;
    if (!target) return null;
    const t = this.phase === 'hold' ? 1 : smoothstep(this.t / this.duration);
    return blendPose(from, target, t, this.blended);
  }
}
