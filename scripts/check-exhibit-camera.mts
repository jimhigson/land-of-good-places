/**
 * **`check:exhibit-camera` — pressing an exhibit's chip brings the camera down
 * behind her shoulder to an animal it can actually see, smoothly, inside the
 * hall, and hands it back.**
 *
 * ```
 * pnpm run check:exhibit-camera
 * EXHIBIT_CAMERA_BREAK=block pnpm run check:exhibit-camera   # prove it red
 * ```
 *
 * Jim, 6 October 2026: *"when using the exhibits in the reptile house, the
 * effects are quite hard to see when zoomed out — in this case the camera
 * needs to come down to an over-shoulder view of the animal or other exhibit
 * being shown."* The shot is `src/world/reptileHouse/exhibitCamera.ts`.
 *
 * Built on the real `ReptileHouse` (constructed as `World` constructs it) with
 * a real `Player` and the real `IsoCamera`, driven exactly as `Game.tick` drives them —
 * `exhibitCamera.apply(camera)` claims the focus, `camera.update` runs its own
 * damping — so every number is read off the camera the game would render
 * through, never off the shot the solver *asked* for. For each of the hall's
 * exhibits, on a landscape and a portrait screen, she is stood on the
 * exhibit's stand spot and its primary chip is pressed through the zone's own
 * action, then:
 *
 *  1. a shot was solved (no exhibit is left on the zoomed-out view);
 *  2. **unoccluded**: from the camera's real eye, a ray to every star
 *     animal reaches it without crossing anything opaque
 *     drawn in the hall or her own body (glass is see-through), and so do
 *     rays to most (`CROWD_SEEN`) of a crowd — twelve babies, five geckos,
 *     points along a coiled body;
 *  3. **framed**: the animals' box spans at least {@link MIN_SPAN} of the
 *     frame, and its middle is in the middle part of the screen;
 *  4. **inside the hall**: the settled eye is inside the walls; and on every
 *     frame of the way down and back up, the eye is either over the hall's
 *     open top or inside its walls — never through one — and no drawn surface
 *     is within the lens's reach of it;
 *  5. **smooth**: the view direction never turns more than
 *     {@link MAX_TURN_PER_FRAME} degrees in a frame, and the frame's height
 *     at the focus never jumps by more than {@link MAX_FRAME_JUMP} of itself;
 *  6. **home again**: once the reaction is over the camera is back on the rig
 *     exactly (`poseDistance` 0) at the zoom it had before.
 *
 * Then, once: moving (the stick) mid-shot hands the camera back within
 * `EXHIBIT_SHOT_EASE_CANCEL` and a beat; the solver **backtracks** — with an
 * opaque panel stood across the line it would have chosen, it picks another
 * eye that sees past it; and a **control** — the same panel stood across the
 * real settled shot — the occlusion instrument reports blocked.
 *
 * **Proven red before trusted green**, 6 October 2026, on the hall as built
 * by `layout.ts`'s `EXHIBIT_PLACEMENTS` at origin (600, −600) and the
 * solver's fan in `exhibitCamera.ts` (`EYE_SWINGS` ±0–90°, `EYE_BACKS`
 * 1.6/2.4/3.2 m, `EYE_HEIGHTS` 2.3–4.3 m, `SIGHTLINE_TUBE` 0.07 m), two ways:
 *
 * - `EXHIBIT_CAMERA_BREAK=block` stands an opaque 1.6 m panel across each
 *   settled shot — the deliberately blocked shot. **30 clauses red**, every
 *   exhibit on both screens, e.g.
 *   `✗ unoccluded from the real eye: 0 of 1 star(s) … — blocked by deliberate-blocker at 2.45 m`.
 * - With the solver's occlusion test switched off (`if (false && !sightlinesPass(…))`
 *   in `solveExhibitShot`, so it takes its favourite eye blind), **14 clauses
 *   red**, all real geometry:
 *
 * ```
 *   ✗   unoccluded from the real eye: 0 of 1 star(s) … — blocked by rc-tortoise-wall at 4.94 m
 *   ✗   unoccluded from the real eye: 0 of 1 star(s) … — blocked by rc-lagoon-wall at 4.38 m
 *   ✗   unoccluded from the real eye: 1 of 2 star(s) … — blocked by rc-round-wall at 4.10 m
 *   ✗   unoccluded from the real eye: 0 of 0 star(s), 10 of 17 in the crowd … — blocked by rn-tail-mound at 8.40 m; …
 *   ✗   the eye stayed in the hall on every frame down and back — 2 faults, first: eye within 0.15 m of rp-vine-strand at (-12.19, 4.65, -10.02)
 *   ✗ chameleon: with a panel across (4.18, 2.80, -11.64) → focus, it chose an eye 0.00 m away
 *   14 clause(s) FAILED.
 * ```
 *
 * `EXHIBIT_CAMERA_ONLY=<id>` measures one exhibit, for iterating. The hall is
 * built on its own, so locally `LGP_PARK_RESTART=0` skips waiting on the
 * park acceptance loop that importing the game's modules otherwise triggers.
 */
import './headless-canvas.mjs';
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3, type Object3D } from 'three';
import { quietly } from './park-harness.mts';
import { CollisionWorld } from '../src/world/Collision.ts';
import { WalkSurfaces } from '../src/world/building/surfaces.ts';
import type { InteriorControls } from '../src/world/building/Building.ts';
import { ReptileHouse } from '../src/world/reptileHouse/ReptileHouse.ts';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import { CAMERA_ZOOM_MAX } from '../src/core/constants.ts';
import { Player } from '../src/entities/Player.ts';
import { PRIMARY_ACTION } from '../src/world/interact.ts';
import {
  EXHIBIT_SHOT_EASE_CANCEL,
  EXHIBIT_SHOT_EASE_IN,
  CROWD_SEEN,
  sightlinesPass,
  eyeInHallSpace,
  insideHall,
  subjectOf,
} from '../src/world/reptileHouse/exhibitCamera.ts';
import { EXHIBIT_PLACEMENTS, REPTILE_HOUSE_ORIGIN_X, REPTILE_HOUSE_ORIGIN_Z } from '../src/world/reptileHouse/layout.ts';
import type { FrameContext } from '../src/core/types.ts';

/**
 * The animals must span at least this share of the frame's width or height —
 * a span, not an area, so a long thin snake and a round tortoise are held to
 * the same idea of "big enough to see the reaction".
 */
const MIN_SPAN = 0.2;
/** And its middle within this much of the screen's middle, in NDC (±1 is the edge). */
const MAX_CENTRE_OFF = 0.45;
/** Degrees the view direction may turn in one 60 fps frame. */
const MAX_TURN_PER_FRAME = 4;
/** The frame's height at the focus may change by at most this fraction in one frame. */
const MAX_FRAME_JUMP = 0.25;
/** No drawn surface nearer the eye than this, on the way down — the lens's near plane is 0.1 m. */
const LENS_CLEARANCE = 0.15;

const VIEWPORTS: readonly [string, number, number][] = [
  ['landscape 1280x720', 1280, 720],
  ['portrait 390x844', 390, 844],
];

let failures = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${line}`);
};
const note = (line: string): void => {
  process.stderr.write(`  · ${line}\n`);
};

const breakMode = process.env['EXHIBIT_CAMERA_BREAK'];

// **The hall on its own**, not the whole park: the hall is a disjoint space
// 600 m out with its own colliders, and nothing in a park reaches it — so this
// builds in a second rather than waiting on a park solve. The constructor is
// the one `World` calls (forecourt mode: no plot), the controls run the iris's
// midpoint at once as the harness's do.
const collision = new CollisionWorld();
const surfaces = new WalkSurfaces();
const camera = new IsoCamera();
const controls: InteriorControls = {
  cancelWalk: () => {},
  iris: (midpoint) => midpoint(),
  flash: () => {},
  snapCamera: () => {},
  openShop: () => {},
};
const house = quietly(() => new ReptileHouse(collision, controls, surfaces, { plot: null, anchorPlots: null, camera, nightFactor: () => 0 }));
const OX = REPTILE_HOUSE_ORIGIN_X;
const OZ = REPTILE_HOUSE_ORIGIN_Z;
const player = quietly(() => new Player(collision, camera, new Vector3(OX, 0, OZ + 10)));
house.attachPlayer(player);

let moving = false;
const input = {
  get manualMoveActive(): boolean {
    return moving;
  },
  moveAmount: 0,
  justPressed: (): boolean => false,
};
let elapsed = 0;
const context = (): FrameContext =>
  ({ dt: 1 / 60, elapsed, playerPosition: player.position, frame: 1, input, cameraForward: camera.forward } as unknown as FrameContext);

/** One frame, wired as `Game.tick` wires it: the shot claims, the camera follows. */
function frame(): void {
  elapsed += 1 / 60;
  const ctx = context();
  const claim = house.exhibitCamera.apply(camera);
  if (claim) camera.setFocusOverride(claim);
  else camera.clearFocusOverride();
  camera.update(ctx, player.position, player.velocity);
  house.update(ctx);
}

// ------------------------------------------------------------ instruments

const SEE_THROUGH_POOLS = /^reptile-(adults|babies):/;

/**
 * The check's own occlusion instrument — deliberately not the solver's: every
 * mesh drawn in the hall plus her body, minus glass (transparent, opacity
 * under a half), minus the snake pools and the animals being looked at.
 */
function occluders(subjects: readonly Object3D[], extra: readonly Object3D[] = []): Mesh[] {
  const skip = new Set<Object3D>();
  for (const subject of subjects) subject.traverse((child) => skip.add(child));
  const out: Mesh[] = [];
  for (const root of [house.hallRoot, player.group, ...extra]) {
    root.updateWorldMatrix(true, true);
    root.traverse((child) => {
      if (!(child instanceof Mesh) || skip.has(child) || SEE_THROUGH_POOLS.test(child.name)) return;
      for (let at: Object3D | null = child; at; at = at.parent) if (!at.visible) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      if (materials.every((m) => !m.visible || (m.transparent && m.opacity < 0.5))) return;
      out.push(child);
    });
  }
  return out;
}

const ray = new Raycaster();
function blockedBy(eye: Vector3, target: Vector3, meshes: Mesh[]): string | null {
  const toward = target.clone().sub(eye);
  const length = toward.length();
  ray.set(eye, toward.normalize());
  ray.near = 0;
  ray.far = Math.max(0, length - 0.05);
  const hit = ray.intersectObjects(meshes, false)[0];
  return hit ? `${hit.object.name || hit.object.parent?.name || '(unnamed)'} at ${hit.distance.toFixed(2)} m` : null;
}

function tooClose(eye: Vector3, meshes: Mesh[]): string | null {
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
    ray.set(eye, new Vector3(...d));
    ray.near = 0;
    ray.far = LENS_CLEARANCE;
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) return hit.object.name || '(unnamed)';
  }
  return null;
}

/** The share of the screen the box's projection covers, and its middle in NDC. */
function frameShare(box: Box3): { span: number; share: number; centre: Vector3 } {
  const lens = camera.camera;
  lens.updateMatrixWorld();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 8; i += 1) {
    const corner = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(lens);
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }
  const clampN = (v: number): number => Math.max(-1, Math.min(1, v));
  const width = (clampN(maxX) - clampN(minX)) / 2;
  const height = (clampN(maxY) - clampN(minY)) / 2;
  const centre = box.getCenter(new Vector3()).project(lens);
  return { span: Math.max(width, height), share: width * height, centre };
}

/** The frame's half-height at the focus, from the live lens. */
function frameHalfHeight(): number {
  const focus = camera.focusPoint;
  const d = camera.camera.position.distanceTo(focus);
  return Math.tan((camera.camera.fov * Math.PI) / 360) * d;
}

function standAt(id: string): void {
  const placement = EXHIBIT_PLACEMENTS.find((row) => row.id === id);
  if (!placement) throw new Error(`no placement for ${id}`);
  house.requestEnter({ x: placement.stand.x, z: placement.stand.z, facing: placement.stand.facing });
  for (let i = 0; i < 70; i += 1) frame();
  camera.snapTo(player.position.clone().setY(player.position.y + 1.25));
  for (let i = 0; i < 30; i += 1) frame();
}

function press(id: string): void {
  const zone = house.interactZones().find((z) => z.id === `reptile:${id}`);
  const action = zone?.actions?.().find((a) => a.id === PRIMARY_ACTION);
  if (!action) throw new Error(`no chip on ${id}`);
  action.run();
}

/** Puts an opaque panel across the segment from `eye` to `target`, into the hall. */
function blocker(eye: Vector3, target: Vector3): Mesh {
  const mid = eye.clone().lerp(target, 0.5);
  const panel = new Mesh(new BoxGeometry(1.6, 1.6, 0.1), new MeshBasicMaterial());
  panel.name = 'deliberate-blocker';
  house.hallRoot.add(panel);
  house.hallRoot.updateWorldMatrix(true, false);
  panel.position.copy(house.hallRoot.worldToLocal(mid.clone()));
  panel.lookAt(eye);
  panel.updateWorldMatrix(true, false);
  return panel;
}

// ---------------------------------------------------------------- the run

const only = process.env['EXHIBIT_CAMERA_ONLY'];
const ids = only ? house.exhibitIds.filter((id) => id === only) : house.exhibitIds;
if (only) note(`EXHIBIT_CAMERA_ONLY=${only} — measuring one exhibit, not a full run`);
say(only !== undefined || (ids.length === EXHIBIT_PLACEMENTS.length && ids.length >= 15), `${ids.length} exhibits in the hall, every one measured below`);
if (breakMode) note(`EXHIBIT_CAMERA_BREAK=${breakMode} — this run must go red`);

for (const [label, width, height] of VIEWPORTS) {
  camera.resize(width, height);
  console.log(`\n${label}:`);
  for (const id of ids) {
    standAt(id);
    const zoomBefore = camera.targetZoom;
    const pathFaults: string[] = [];
    let worstTurn = 0;
    let worstJump = 0;
    const lastDir = new Vector3();
    camera.camera.getWorldDirection(lastDir);
    let lastHalf = frameHalfHeight();
    const watch = (): void => {
      const eye = camera.camera.position;
      if (!eyeInHallSpace(eye)) pathFaults.push(`eye outside the hall below the wall tops at (${(eye.x - OX).toFixed(2)}, ${eye.y.toFixed(2)}, ${(eye.z - OZ).toFixed(2)})`);
      if (eye.y < 6) {
        const near = tooClose(eye, occluders([]));
        if (near) pathFaults.push(`eye within ${LENS_CLEARANCE} m of ${near} at (${(eye.x - OX).toFixed(2)}, ${eye.y.toFixed(2)}, ${(eye.z - OZ).toFixed(2)})`);
      }
      const dir = camera.camera.getWorldDirection(new Vector3());
      worstTurn = Math.max(worstTurn, (dir.angleTo(lastDir) * 180) / Math.PI);
      lastDir.copy(dir);
      const half = frameHalfHeight();
      worstJump = Math.max(worstJump, Math.abs(half - lastHalf) / Math.max(lastHalf, 1e-6));
      lastHalf = half;
    };

    const rigSpan = frameShare(subjectOf(house.exhibitSubjects(id)).box).span;
    press(id);
    const shot = house.exhibitCamera.shot;
    const solved = house.exhibitCamera.active && shot?.exhibitId === id;
    const report = house.exhibitCamera.report;
    const why = report ? `rejected: ${report.outside} outside the hall, ${report.overSolid} over a solid, ${report.tooClose} too close to something, ${report.blocked} blocked, ${report.approach} with a blocked way down; blockers ${JSON.stringify(report.blockers)}` : '';
    say(solved, solved && shot ? `${id}: a shot was solved (${shot.clear} of ${shot.tried} candidate eyes saw every animal)` : `${id}: NO shot was solved — ${why}`);
    if (shot && shot.exhibitId === id && shot.zoom > CAMERA_ZOOM_MAX) note(`${id}: the framing wanted zoom ${shot.zoom.toFixed(2)}, past CAMERA_ZOOM_MAX ${CAMERA_ZOOM_MAX} — the clamp is deciding this shot's size`);
    if (!solved || !shot) {
      for (let i = 0; i < 600 && house.exhibitCamera.active; i += 1) frame();
      continue;
    }
    // Down, and settled: the ease, then the camera's own damping until the
    // eye is on the solved spot (or the hold runs out, which a clause catches).
    for (let t = 0; t < EXHIBIT_SHOT_EASE_IN; t += 1 / 60) {
      frame();
      watch();
    }
    for (let i = 0; i < 120 && camera.camera.position.distanceTo(shot.eye) > 0.05 && house.exhibitCamera.state === 'hold'; i += 1) {
      frame();
      watch();
    }
    say(camera.camera.position.distanceTo(shot.eye) <= 0.05, `  the real eye lands on the solved one (${camera.camera.position.distanceTo(shot.eye).toFixed(3)} m off) while the shot holds`);
    const subjects = house.exhibitSubjects(id);
    const extra: Object3D[] = [];
    if (breakMode === 'block') extra.push(blocker(camera.camera.position.clone(), shot.focus));
    const meshes = occluders([...subjects, ...house.exhibitCast(id)]);
    const eye = camera.camera.position.clone();
    const { box, targets } = subjectOf(subjects);
    const hits = targets.map((target) => blockedBy(eye, target.point, meshes));
    const stars = targets.filter((target) => !target.crowd).length;
    const crowd = targets.length - stars;
    const starsSeen = targets.filter((target, index) => !target.crowd && hits[index] === null).length;
    const crowdSeen = targets.filter((target, index) => target.crowd && hits[index] === null).length;
    const blocked = hits.filter((hit): hit is string => hit !== null);
    say(
      sightlinesPass(targets, hits.map((hit) => hit === null)),
      `  unoccluded from the real eye: ${starsSeen} of ${stars} star(s), ${crowdSeen} of ${crowd} in the crowd (at least ${Math.round(CROWD_SEEN * 100)}%)${blocked.length ? ` — blocked by ${blocked.join('; ')}` : ''}`,
    );
    const { span, share, centre } = frameShare(box);
    say(span >= MIN_SPAN, `  framed: the animals span ${(span * 100).toFixed(1)}% of the frame (at least ${MIN_SPAN * 100}%; ${(share * 100).toFixed(1)}% of its area), against ${(rigSpan * 100).toFixed(1)}% before the chip`);
    say(Math.abs(centre.x) <= MAX_CENTRE_OFF && Math.abs(centre.y) <= MAX_CENTRE_OFF && centre.z < 1, `  centred: their middle at NDC (${centre.x.toFixed(2)}, ${centre.y.toFixed(2)})`);
    say(insideHall(eye, 0.3), `  the settled eye is inside the hall at (${(eye.x - OX).toFixed(2)}, ${eye.y.toFixed(2)}, ${(eye.z - OZ).toFixed(2)}), ${eye.distanceTo(shot.focus).toFixed(2)} m from the animals`);
    for (const panel of extra) house.hallRoot.remove(panel);

    // Hold, then home.
    let frames = 0;
    while (house.exhibitCamera.active && frames < 60 * 12) {
      frame();
      watch();
      frames += 1;
    }
    // The camera's own pose damper finishes the last of the rise.
    let settle = 0;
    while (camera.poseDistance > 0 && settle < 180) {
      frame();
      settle += 1;
    }
    say(!house.exhibitCamera.active, `  the shot ends on its own after ${(frames / 60).toFixed(1)} s`);
    say(camera.poseDistance === 0 && Math.abs(camera.targetZoom - zoomBefore) < 1e-9, `  home exactly ${(settle / 60).toFixed(2)} s after: pose ${camera.poseDistance.toFixed(4)} m off the rig, zoom ${camera.targetZoom.toFixed(3)} (was ${zoomBefore.toFixed(3)})`);
    say(pathFaults.length === 0, `  the eye stayed in the hall on every frame down and back${pathFaults.length ? ` — ${pathFaults.length} faults, first: ${pathFaults[0]}` : ''}`);
    say(worstTurn <= MAX_TURN_PER_FRAME && worstJump <= MAX_FRAME_JUMP, `  smooth: at most ${worstTurn.toFixed(2)}° of turn and ${(worstJump * 100).toFixed(1)}% of framing change in a frame`);
  }
}

console.log('\nMOVING CANCELS — the stick mid-shot hands the camera straight back:');
{
  camera.resize(1280, 720);
  const id = 'chameleon';
  standAt(id);
  const zoomBefore = camera.targetZoom;
  press(id);
  for (let i = 0; i < 90; i += 1) frame();
  say(house.exhibitCamera.state === 'hold', `${id}: the shot is holding (${house.exhibitCamera.state})`);
  moving = true;
  frame();
  say(house.exhibitCamera.state === 'out', `one frame of the stick and it is on its way home (${house.exhibitCamera.state})`);
  moving = false;
  let frames = 0;
  while (house.exhibitCamera.active && frames < 120) {
    frame();
    frames += 1;
  }
  for (let i = 0; i < 180 && camera.poseDistance > 0; i += 1) frame();
  say(!house.exhibitCamera.active && frames / 60 <= EXHIBIT_SHOT_EASE_CANCEL + 0.05, `and hands back in ${(frames / 60).toFixed(2)} s (ease ${EXHIBIT_SHOT_EASE_CANCEL} s)`);
  say(camera.poseDistance === 0 && Math.abs(camera.targetZoom - zoomBefore) < 1e-9, `on the rig at zoom ${camera.targetZoom.toFixed(3)}`);
  // And a tap that walks her: she moves without the stick.
  press(id);
  for (let i = 0; i < 30; i += 1) frame();
  player.position.x += 0.6;
  frame();
  say(house.exhibitCamera.state === 'out', `a tap-to-walk step (0.6 m, no stick) cancels it too (${house.exhibitCamera.state})`);
  for (let i = 0; i < 120; i += 1) frame();
}

console.log('\nTHE SOLVER BACKTRACKS — a panel across its first choice, and it finds another eye:');
{
  camera.resize(1280, 720);
  const id = 'chameleon';
  standAt(id);
  press(id);
  const solvedFirst = house.exhibitCamera.shot;
  const first = solvedFirst?.exhibitId === id ? solvedFirst : null;
  for (let i = 0; i < 600 && house.exhibitCamera.active; i += 1) {
    moving = i === 5;
    frame();
  }
  moving = false;
  if (!first) {
    say(false, `${id}: no first shot to block`);
  } else {
    const panel = blocker(first.eye, first.focus);
    standAt(id);
    press(id);
    const second = house.exhibitCamera.shot;
    const moved = second && second !== first ? second.eye.distanceTo(first.eye) : 0;
    say(second !== null && second !== first && moved > 0.2, `${id}: with a panel across (${(first.eye.x - OX).toFixed(2)}, ${first.eye.y.toFixed(2)}, ${(first.eye.z - OZ).toFixed(2)}) → focus, it chose an eye ${moved.toFixed(2)} m away`);
    if (second && second !== first) {
      const meshes = occluders([...house.exhibitSubjects(id), ...house.exhibitCast(id)]);
      const hit = blockedBy(second.eye, second.focus, meshes);
      say(hit === null, `  and that eye sees the animal past the panel${hit ? ` — blocked by ${hit}` : ''}`);
      // CONTROL: the instrument sees the panel on the line it was stood across.
      const control = blockedBy(first.eye, first.focus, meshes);
      say(control !== null && control.startsWith('deliberate-blocker'), `  CONTROL: the instrument reports the first line blocked (${control ?? 'clear!'})`);
    }
    house.hallRoot.remove(panel);
    for (let i = 0; i < 600 && house.exhibitCamera.active; i += 1) frame();
  }
}

if (house.exhibitCamera.unsolved.length) note(`exhibits with no clear shot at some point: ${[...new Set(house.exhibitCamera.unsolved)].join(', ')}`);
console.log(failures === 0 ? '\nexhibit camera: all clauses green.' : `\n${failures} clause(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
