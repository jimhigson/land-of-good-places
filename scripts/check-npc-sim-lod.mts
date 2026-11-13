/**
 * **Are children the camera cannot see simulated in fewer steps — and do they
 * still end up where they would have?**
 *
 * ```
 * pnpm run check:npc-sim-lod
 * ```
 *
 * Step 11 of docs/perf/FRAME-DROPS-2026-11.md (`src/entities/npc/simLod.ts`).
 * Builds the real park headless, stands the player at the park's own spawn
 * with the real isometric camera on her, tells NPC simulation which camera
 * drew the frame exactly as `Game.render` does, and asks four things:
 *
 * 1. **The counts.** Over the same frames, `NpcCharacter.update` calls and
 *    kid-crowd `commit`s with the throttle off, then on. On, the steps must be
 *    (every-frame children) + (throttled children)/2 and the poses and commits
 *    (every-frame) + (throttled)/4.
 * 2. **Flat, not spiky.** No frame poses more than a quarter of the park's
 *    children among the throttled ones (plus one for rounding).
 * 3. **Nobody on screen is throttled.** Every frame, every garden child whose
 *    feet or head the camera can see was stepped that frame. Measured with
 *    this file's own frustum, not by asking the code under test.
 * 4. **Banked time is the same time.** Two real `NpcCharacter`s on the park's
 *    real ground walk the same circuit for 20 simulated seconds, one stepped
 *    every frame and one on the throttle's schedule. Along a straight they
 *    must stay together; what the throttle is allowed to cost is one frame's
 *    walk for each decision made a frame late (see {@link driftAllowedAfter}),
 *    and nothing else.
 *
 * Mutations, each of which must turn it red:
 *
 * - `--mutate=no-throttle` — the throttle is left off for the "on" run (1).
 * - `--mutate=blind` — NPC simulation is told nothing is on screen (3).
 * - `--mutate=drop-banked` — the throttled walker is stepped with one frame's
 *   time instead of the banked time (4).
 */
import './headless-canvas.mjs';
import { Frustum, Matrix4, Object3D, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { InstancedCrowd, cullCrowdsFor } from '../src/entities/npc/InstancedCrowd.ts';
import { NpcCharacter } from '../src/entities/npc/NpcCharacter.ts';
import {
  NpcSimLod,
  NpcView,
  SIM_LOD_POSE_EVERY,
  SIM_LOD_STEER_EVERY,
  SIM_POSE,
  noteNpcViewCamera,
} from '../src/entities/npc/simLod.ts';
import type { CharacterDriver, CharacterIntent, DriverContext } from '../src/entities/npc/driver.ts';
import type { NpcAvatar } from '../src/entities/npc/npcAvatar.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';
import { SPACE_GARDEN, spaceAt } from '../src/world/spaces.ts';
import type { FrameContext } from '../src/core/types.ts';

const mutation = process.argv.find((a) => a.startsWith('--mutate='))?.slice('--mutate='.length) ?? '';
const failures: string[] = [];

// ------------------------------------------------------------ instruments
/** Who had `update` called this frame — counted at the method, not read off the scheduler. */
const steppedThisFrame = new Set<NpcCharacter>();
let updateCalls = 0;
const realUpdate = NpcCharacter.prototype.update;
NpcCharacter.prototype.update = function (this: NpcCharacter, ...args: Parameters<typeof realUpdate>): void {
  updateCalls += 1;
  steppedThisFrame.add(this);
  realUpdate.apply(this, args);
};

const park = buildHeadlessPark();
const { world, camera: iso, scene } = park;
const npcs = world.npcs;

/** `commit`s on the children's own crowd only — the two blob pets are committed every frame regardless. */
let kidCommits = 0;
const kidMembers = new Set<object>();
for (const kid of npcs.all) if (kid.avatar.member) kidMembers.add(kid.avatar.member);
const realCommit = InstancedCrowd.prototype.commit;
InstancedCrowd.prototype.commit = function (this: InstancedCrowd, member): void {
  if (kidMembers.has(member)) kidCommits += 1;
  realCommit.call(this, member);
};

// ---------------------------------------------------------------- driving
const input = new InputSystem();
const DT = 1 / 60;
const at = new Vector3(ENTRANCE_PLAYER_X, 0, ENTRANCE_PLAYER_Z);
at.y = park.sample(at.x, at.z, 50);
const zero = new Vector3();
const playerPosition = new Vector3();
let frame = 0;

class BlindView extends NpcView {
  override onScreen(): boolean {
    return false;
  }
}
if (mutation === 'blind') npcs.view = new BlindView();

const seen = new Frustum();
const seenMatrix = new Matrix4();
const head = new Vector3();
let onScreenChecks = 0;
let onScreenThrottled = 0;

/** One frame as `Game` runs it: update, move the camera, cull, tell NPC simulation what drew. */
function stepFrame(view: boolean): void {
  playerPosition.copy(at);
  const context: FrameContext = {
    dt: DT,
    elapsed: frame * DT,
    input,
    playerPosition,
    cameraForward: iso.forward as Vector3,
    frame,
  };
  steppedThisFrame.clear();
  quietly(() => world.update(context));
  frame += 1;

  if (view) {
    // Whoever the camera that drew the *previous* frame could see must have
    // been stepped in this one — `seen` is still that camera here.
    for (const kid of npcs.all) {
      if (spaceAt(kid.position.x, kid.position.z) !== SPACE_GARDEN) continue;
      head.copy(kid.position);
      head.y += kid.avatar.height;
      if (!seen.containsPoint(kid.position) && !seen.containsPoint(head)) continue;
      onScreenChecks += 1;
      if (!steppedThisFrame.has(kid)) {
        onScreenThrottled += 1;
        if (onScreenThrottled <= 3) {
          failures.push(
            `frame ${frame}: ${kid.name} is on screen at (${kid.position.x.toFixed(1)}, ${kid.position.z.toFixed(1)}) and was not stepped`,
          );
        }
      }
    }
  }

  iso.update(context, at, zero);
  if (!view) return;
  cullCrowdsFor(scene, iso.camera);
  noteNpcViewCamera(iso.camera);
  seenMatrix.multiplyMatrices(iso.camera.projectionMatrix, iso.camera.matrixWorldInverse);
  seen.setFromProjectionMatrix(seenMatrix, iso.camera.coordinateSystem, iso.camera.reversedDepth);
}

iso.resize(1440, 900);
iso.snapZoomTarget(1);
iso.snapTo(at);
// Let the park settle with nobody telling NPC simulation what is on screen:
// with no view, everybody is stepped every frame.
for (let i = 0; i < 600; i += 1) stepFrame(false);
const unviewed = { ...npcs.simLod.counts };
if (unviewed.eligible === 0) {
  console.error('check:npc-sim-lod: nobody was offered a step in 600 frames — nothing to measure');
  process.exit(1);
}
if (unviewed.steered !== unviewed.eligible) {
  failures.push(
    `with no view noted, ${unviewed.steered} of ${unviewed.eligible} offered steps were taken — a crowd nobody has described the camera to must run at full rate`,
  );
}

const FRAMES = 600;
interface Run {
  updates: number;
  commits: number;
  eligible: number;
  everyFrame: number;
  posed: number;
  peak: number;
}
function run(throttle: boolean): Run {
  npcs.simLod.enabled = throttle;
  // Two frames to seat the view before counting.
  stepFrame(true);
  stepFrame(true);
  npcs.simLod.resetCounts();
  updateCalls = 0;
  kidCommits = 0;
  for (let i = 0; i < FRAMES; i += 1) stepFrame(true);
  // One more `beginFrame` folds the last frame's stagger count into the peak.
  const c = npcs.simLod.counts;
  return {
    updates: updateCalls,
    commits: kidCommits,
    eligible: c.eligible,
    everyFrame: c.everyFrame,
    posed: c.posed,
    peak: c.peakThrottledPoses,
  };
}

const before = run(false);
const after = run(mutation !== 'no-throttle');
npcs.simLod.enabled = true;

const per = (n: number): string => (n / FRAMES).toFixed(2);
const throttled = after.eligible - after.everyFrame;
const expectedUpdates = after.everyFrame + throttled / SIM_LOD_STEER_EVERY;
const expectedPoses = after.everyFrame + throttled / SIM_LOD_POSE_EVERY;

if (before.updates !== before.eligible) {
  failures.push(`throttle off: ${before.updates} updates for ${before.eligible} offered — expected every one taken`);
}
if (throttled < FRAMES) {
  failures.push(
    `only ${per(throttled)} children a frame were off screen and far from her at the spawn — too few to measure a ratio on (wanted at least 1)`,
  );
}
// The schedule is exact per child; the slack is for children changing tier mid-run.
const SLACK = 0.03;
if (Math.abs(after.updates - expectedUpdates) > expectedUpdates * SLACK) {
  failures.push(
    `throttle on: ${per(after.updates)} updates a frame, expected ${per(expectedUpdates)} ` +
      `(${per(after.everyFrame)} every-frame + ${per(throttled)} throttled / ${SIM_LOD_STEER_EVERY}); off it was ${per(before.updates)}`,
  );
}
if (Math.abs(after.posed - expectedPoses) > expectedPoses * SLACK) {
  failures.push(
    `throttle on: ${per(after.posed)} poses a frame, expected ${per(expectedPoses)} ` +
      `(${per(after.everyFrame)} every-frame + ${per(throttled)} throttled / ${SIM_LOD_POSE_EVERY}); off it was ${per(before.posed)}`,
  );
}
if (after.commits >= before.commits) {
  failures.push(`throttle on: ${per(after.commits)} kid commits a frame, no fewer than the ${per(before.commits)} with it off`);
}
const peakAllowed = Math.ceil(npcs.all.length / SIM_LOD_POSE_EVERY) + 1;
if (after.peak > peakAllowed) {
  failures.push(`a single frame posed ${after.peak} throttled children; staggered, no frame should pose more than ${peakAllowed}`);
}
if (onScreenChecks === 0) {
  failures.push('no child was ever on screen at the spawn, so "nobody on screen is throttled" measured nothing');
}
if (onScreenThrottled > 0) {
  failures.push(`${onScreenThrottled} of ${onScreenChecks} on-screen child-frames were not stepped`);
}

// ------------------------------------------------- banked time is the same time
const SECONDS = 20;
/**
 * **How far apart the two walkers may be after `turns` corners**, in metres.
 *
 * Not a tolerance picked to pass — the throttle's own arithmetic. A throttled
 * child decides only on her steer frames, so she can turn a corner up to
 * `SIM_LOD_STEER_EVERY - 1` frames after the every-frame walker did, and a
 * corner turned late is a corner cut less: each one puts her up to one frame's
 * walk (`stride`) further behind along the route. The one extra stride is the
 * start from rest, where one long step and two short ones integrate the
 * acceleration half a stride apart. Banked time that was *dropped* costs a
 * stride every skipped frame instead, corner or no corner, and blows through
 * this within a second (`--mutate=drop-banked`).
 *
 * Measured on seed 5 at the spawn (-1.6, 51.6), 13 Nov 2026: 2.0 cm before
 * the first corner and constant along every straight, then about +4.2 cm (one
 * stride; the longest measured is 4.25 cm) at each late corner — 28.0 cm at
 * worst after 8 corners and 50.1 m, against 38.3 cm allowed by then.
 */
function driftAllowedAfter(turns: number, stride: number): number {
  return (turns * (SIM_LOD_STEER_EVERY - 1) + 1) * stride;
}

/** Walks a fixed circuit, corner to corner. No dice, no clock: where it is depends only on how far it has walked. */
class CircuitDriver implements CharacterDriver {
  readonly name = 'circuit';
  private next = 1;
  /** Corners turned so far — each is one decision a throttled walker may take late. */
  turns = 0;
  private readonly corners: readonly (readonly [number, number])[];
  constructor(corners: readonly (readonly [number, number])[]) {
    this.corners = corners;
  }
  update(context: DriverContext, intent: CharacterIntent): void {
    let [x, z] = this.corners[this.next]!;
    if (Math.hypot(x - context.position.x, z - context.position.z) < 0.5) {
      this.next = (this.next + 1) % this.corners.length;
      this.turns += 1;
      [x, z] = this.corners[this.next]!;
    }
    const dx = x - context.position.x;
    const dz = z - context.position.z;
    const length = Math.hypot(dx, dz) || 1;
    intent.moveX = dx / length;
    intent.moveZ = dz / length;
  }
}

function stubAvatar(): NpcAvatar {
  const part = (): Object3D => new Object3D();
  return {
    rig: { root: part(), body: part(), head: part(), leftArm: part(), rightArm: part(), leftLeg: part(), rightLeg: part() },
    headBaseY: 1,
    height: 1.3,
    setExpression: () => {},
  };
}

// A circuit on the open ground the player spawns on, so it is walkable on any park.
const R = 3;
const circuit: (readonly [number, number])[] = [
  [at.x - R, at.z - R],
  [at.x + R, at.z - R],
  [at.x + R, at.z + R],
  [at.x - R, at.z + R],
];
function walker(driver: CircuitDriver): NpcCharacter {
  const start = circuit[0]!;
  const character = new NpcCharacter(stubAvatar(), driver, world.collision, start[0], start[1], 0, 'walker');
  character.groundSampler = park.sample;
  character.settle(at.y + 1);
  return character;
}
const everyFrameDriver = new CircuitDriver(circuit);
const everyFrame = walker(everyFrameDriver);
const banked = walker(new CircuitDriver(circuit));
const lod = new NpcSimLod();
let walked = 0;
let worstDrift = 0;
/** The longest single frame's walk of the every-frame walker — measured, not copied from her speed. */
let stride = 0;
/** Drift on each frame the banked walker owes no time, with the corners the every-frame walker had turned by then. */
const drifts: { readonly second: number; readonly turns: number; readonly drift: number }[] = [];
const last = new Vector3().copy(everyFrame.position);
const steps = Math.round(SECONDS / DT);
for (let i = 0; i < steps; i += 1) {
  const elapsed = i * DT;
  realUpdate.call(everyFrame, DT, elapsed, zero, false);
  lod.beginFrame();
  const plan = lod.plan(0, DT, false, false);
  if (plan !== 0) {
    realUpdate.call(banked, mutation === 'drop-banked' ? DT : lod.stepDt, elapsed, zero, false, 0, false, (plan & SIM_POSE) !== 0);
  }
  const stepped = Math.hypot(everyFrame.position.x - last.x, everyFrame.position.z - last.z);
  walked += stepped;
  if (stepped > stride) stride = stepped;
  last.copy(everyFrame.position);
  // Compared on the frames the banked walker has no time owing.
  if (plan !== 0) {
    const drift = Math.hypot(everyFrame.position.x - banked.position.x, everyFrame.position.z - banked.position.z);
    if (drift > worstDrift) worstDrift = drift;
    drifts.push({ second: elapsed, turns: everyFrameDriver.turns, drift });
  }
}
const finalDrift = Math.hypot(everyFrame.position.x - banked.position.x, everyFrame.position.z - banked.position.z);
if (walked < SECONDS * 2) {
  failures.push(`the every-frame walker covered only ${walked.toFixed(2)} m in ${SECONDS} s — the circuit is blocked and the drift measured nothing`);
}
const turns = everyFrameDriver.turns;
if (turns < 4) {
  failures.push(`the every-frame walker turned only ${turns} corners in ${SECONDS} s — fewer than one lap, so late decisions were barely measured`);
}
if (drifts.length === 0 || !(stride > 0)) {
  failures.push(`the banked walker was compared on ${drifts.length} frames with a ${stride} m stride — the drift measured nothing`);
}
const over = drifts.find((d) => !(d.drift <= driftAllowedAfter(d.turns, stride)));
if (over) {
  failures.push(
    `at ${over.second.toFixed(2)} s, ${over.turns} corners in, the throttled walker is ${(over.drift * 100).toFixed(1)} cm from the every-frame one; ` +
      `allowed ${(driftAllowedAfter(over.turns, stride) * 100).toFixed(1)} cm (one ${(stride * 100).toFixed(2)} cm stride a late corner, plus one). ` +
      `After ${SECONDS} s and ${walked.toFixed(1)} m it is ${(finalDrift * 100).toFixed(1)} cm off, ${(worstDrift * 100).toFixed(1)} cm at worst`,
  );
}

// ------------------------------------------------------------------ report
process.stderr.write(
  `check:npc-sim-lod — player at the park spawn (${at.x.toFixed(1)}, ${at.z.toFixed(1)}), ${npcs.all.length} characters, ${FRAMES} frames each way, per frame:\n` +
    `  throttle off: ${per(before.updates)} updates, ${per(before.posed)} poses, ${per(before.commits)} kid commits\n` +
    `  throttle on:  ${per(after.updates)} updates, ${per(after.posed)} poses, ${per(after.commits)} kid commits ` +
    `(${per(after.everyFrame)} every-frame children, ${per(throttled)} throttled; peak ${after.peak} throttled poses in one frame)\n` +
    `  on screen: ${onScreenChecks} child-frames checked, ${onScreenThrottled} not stepped\n` +
    `  banked time: ${walked.toFixed(1)} m and ${turns} corners walked in ${SECONDS} s; throttled walker ${(finalDrift * 100).toFixed(1)} cm off at the end, ` +
    `${(worstDrift * 100).toFixed(1)} cm at worst, ${(driftAllowedAfter(turns, stride) * 100).toFixed(1)} cm allowed by then (${(stride * 100).toFixed(2)} cm stride)\n` +
    `  not covered: the wander driver's own decisions (they draw dice per step, so two runs diverge by design), interiors, and ride or debug cameras.\n`,
);

if (failures.length > 0) {
  console.error(`check:npc-sim-lod FAILED${mutation ? ` (--mutate=${mutation})` : ''}:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('check:npc-sim-lod passed');
process.exit(0);
