/**
 * **Can you actually SEE the wave she does from up a tree?**
 *
 * ```
 * npm run check:climb-wave          # or --verbose for the per-tree table
 * ```
 *
 * Issue #120 asks that after climbing a tree the player waves toward the
 * camera. She perches with her head above `canopyTopY` (`world/TreeClimbing.ts`),
 * so the waving hand has to get somewhere the camera can actually see it.
 *
 * Since 6 August this file also answers a second question — **is there a child
 * under that head?** She used to be drawn from the neck up, and the canopy was
 * quietly relied on to cover the gap; widen the climbable-tree rule and raise
 * her out of the leaves and the gap stops being covered. Jim: *"why do they no
 * longer have a body?"* Every measurement here was blind to it, because a
 * floating head occupies exactly the pixels a child in a tree does. See
 * {@link REQUIRED_BODY_PIXELS}.
 *
 * ## What the first version of this check got wrong
 *
 * It measured the hand against the **canopy ellipsoids only** — does the hand
 * clear the leaves — and passed with 0.176 m to spare. That measurement was
 * correct and completely irrelevant. QA then found the hand **0% visible on all
 * every climbable tree**, with *zero* foliage blockers: the hand cleared the
 * leaves and then hid behind **her own skull, hair and ear**, because the raised
 * right hand lands almost exactly behind her head on the camera's bearing. Her
 * head, measured the same way, reads ~96% visible.
 *
 * The lesson generalises: *"clears the obstacle I thought of" is not
 * visibility.* So this no longer models any particular obstacle. It asks the
 * only question that matters — **from the game camera, can you see the hand?**
 * — by casting rays at real surface vertices against every mesh that is
 * actually drawn, the character's own included. Self-occlusion is the failure
 * that shipped, and it is now inside what this measures.
 *
 * ## Method
 *
 * Poses a real kid through the game's own {@link applyRidePose} — not a
 * re-implementation of it, because a check that re-implements a pose is a check
 * that can pass a pose the game never renders — at the real peek position for
 * every real climbable tree, facing the camera as the wave makes her — with
 * **every part drawn**, which is what the game does since Jim asked for the
 * whole body on 6 August. Then, for each
 * camera-facing vertex in the **top third of the arm** (the hand and upper
 * forearm — the part a wave is made of), casts a ray along the camera's view
 * direction and asks whether anything else is in front of it.
 *
 * The camera is orthographic (`CAMERA_IS_ORTHOGRAPHIC`), so every ray is
 * parallel and the view direction is one constant: `-cameraOffset(yaw, pitch)`.
 *
 * A **control** is measured alongside: the head's visibility, by the identical
 * method. A method that reports 0% for everything proves nothing. QA measured
 * the head at 95.8–96.4%, so this check reproducing a high number for the head
 * is what says the rig, the camera and the raycast all agree — and if the
 * control ever fails, this script reports itself broken rather than confidently
 * blaming the pose.
 */
import './headless-canvas.mjs';
import { Group, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { createKid, KID_HEAD_HEIGHT, KID_REST_GAZE_PITCH } from '../src/art/models/kid.ts';
import { applyRidePose, CLIMB_WAVE_ARM_X, CLIMB_WAVE_LEAN_RATE } from '../src/entities/Player.ts';
import { CLIMB_EDGE_GAP, CLIMB_PEEK_LIFT, WAVE_RISE } from '../src/world/TreeClimbing.ts';
import {
  CAMERA_DISTANCE,
  CAMERA_PITCH_DEGREES,
  CAMERA_VIEW_HEIGHT,
  CAMERA_YAW_DEGREES,
} from '../src/core/constants.ts';
import { DEG } from '../src/core/mathUtils.ts';
import { cameraOffset } from '../src/core/cameraRig.ts';
import type { FoliageOccluder } from '../src/world/Scenery.ts';

const verbose = process.argv.includes('--verbose');

/**
 * `--hide-body` re-creates the retired head-and-arm-only climb.
 *
 * The mutation that proves the body guard below can fail, kept as a flag so the
 * next person can re-prove it in one command rather than editing
 * `TreeClimbing.ts` and hoping they put it back.
 */
const hideBodyMutation = process.argv.includes('--hide-body');

/**
 * How much of the top of the arm must be un-occluded.
 *
 * Chosen from the sweep (`--sweep`), not guessed. The two populations are
 * cleanly separated: any pose that tucks the hand **inward** — which is what
 * the crowd's own wave does, and what shipped — scores ~0%, while every pose
 * that swings it **out** scores 51–80%. The shipped pose measures 76%.
 *
 * 50% sits in the empty gap between those two populations. It cannot be reached
 * by an inward wave at any lift angle, and it is cleared by every outward one in
 * the swept good region, so ordinary re-tuning will not trip it but a regression
 * back behind her head fails immediately.
 *
 * This is only half the bar. Un-occluded is not the same as legible — see
 * {@link REQUIRED_HAND_PIXELS}.
 */
const REQUIRED_VISIBLE = 0.5;

/** Approach bearings per tree — she climbs whichever side she walked up to. */
const BEARINGS = 12;

/** Waggle phases sampled. The wave is judged at its BEST moment, not its worst. */
const WAGGLE_PHASES = 8;

/** The camera looks along this. Orthographic, so it is the same for every ray. */
const offset = cameraOffset(CAMERA_YAW_DEGREES * DEG, CAMERA_PITCH_DEGREES * DEG, CAMERA_DISTANCE);
const VIEW_DIR = new Vector3(-offset.x, -offset.y, -offset.z).normalize();

/** Facing the camera is the camera's own yaw — see `TreeClimbing`'s CAMERA_FACING. */
const CAMERA_FACING = CAMERA_YAW_DEGREES * DEG;

/** How far back a ray starts. Comfortably outside the whole park. */
const RAY_BACKOFF = 400;

interface Sample {
  readonly point: Vector3;
}

/** Camera-facing world-space surface vertices of `root`, in its top `fraction`. */
function sampleSurface(root: Group, fraction: number): Sample[] {
  const all: Sample[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    // Outline shells are inverted hulls drawn back-face-only. Nobody sees the
    // front of one, and sampling them would measure the wrong geometry.
    if (mesh.renderOrder === -1) return;
    const position = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    if (!position || !normal) return;
    for (let i = 0; i < position.count; i += 1) {
      const n = new Vector3(normal.getX(i), normal.getY(i), normal.getZ(i));
      n.transformDirection(mesh.matrixWorld);
      // Only surface that faces the camera can be seen at all.
      if (n.dot(VIEW_DIR) >= 0) continue;
      const point = new Vector3(position.getX(i), position.getY(i), position.getZ(i));
      point.applyMatrix4(mesh.matrixWorld);
      all.push({ point });
    }
  });
  if (all.length === 0) return all;
  let low = Infinity;
  let high = -Infinity;
  for (const sample of all) {
    low = Math.min(low, sample.point.y);
    high = Math.max(high, sample.point.y);
  }
  const cut = high - (high - low) * fraction;
  return all.filter((sample) => sample.point.y >= cut);
}

/** What fraction of `samples` the camera can see, and what blocked the rest. */
function measureVisibility(
  samples: readonly Sample[],
  blockers: readonly Mesh[],
): { visible: number; blockedBy: Map<string, number> } {
  const raycaster = new Raycaster();
  raycaster.far = RAY_BACKOFF * 2;
  const blockedBy = new Map<string, number>();
  let seen = 0;

  for (const sample of samples) {
    const origin = sample.point.clone().addScaledVector(VIEW_DIR, -RAY_BACKOFF);
    raycaster.set(origin, VIEW_DIR);
    const hits = raycaster.intersectObjects(blockers as Mesh[], false);
    // Anything struck measurably nearer than the sample is in front of it.
    const blocker = hits.find((hit) => hit.distance < RAY_BACKOFF - 1e-3);
    if (!blocker) {
      seen += 1;
      continue;
    }
    const name = blocker.object.name || blocker.object.type;
    blockedBy.set(name, (blockedBy.get(name) ?? 0) + 1);
  }

  return { visible: samples.length === 0 ? 0 : seen / samples.length, blockedBy };
}

/**
 * True if `node` or any ancestor up to `root` is hidden.
 *
 * Kept after the body stopped being hidden, because `--thin-canopy` still
 * hides parts to prove the body guard can fail — and because the trap it
 * records is worth keeping written down: hiding acts on the **pivot groups**,
 * not the meshes inside them, and three.js visibility cascades down through
 * ancestors at draw time. A mesh's own `.visible` is therefore still `true` on
 * a body that is not drawn, so checking only the mesh drew a hidden torso into
 * these pictures and very nearly had me judging a picture the game never
 * renders.
 */
function hiddenByAncestor(node: Mesh, root: Group): boolean {
  let current: Mesh['parent'] = node;
  while (current) {
    if (!current.visible) return true;
    if (current === root) return false;
    current = current.parent;
  }
  return false;
}

/** Every drawn mesh under `root`, skipping anything inside `exclude`. */
function collectMeshes(root: Group, exclude: Group): Mesh[] {
  const out: Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || hiddenByAncestor(mesh, root)) return;
    let node: Mesh['parent'] = mesh;
    while (node) {
      if (node === exclude) return;
      node = node.parent;
    }
    out.push(mesh);
  });
  return out;
}

/** Stand-in meshes for one tree's canopy blobs, as the real ellipsoids. */
function canopyMeshes(tree: FoliageOccluder): Mesh[] {
  const out: Mesh[] = [];
  for (const part of tree.parts) {
    if (part.kind === 'trunk') continue;
    const mesh = new Mesh(new SphereGeometry(1, 24, 16), new MeshBasicMaterial());
    mesh.name = `foliage.${part.kind}`;
    mesh.position.copy(part.position);
    mesh.scale.copy(part.scale);
    mesh.updateMatrixWorld(true);
    out.push(mesh);
  }
  return out;
}

const park = buildHeadlessPark();
const trees = park.world.scenery.climbableTrees;
const occluders = park.world.scenery.foliageOccluders;

if (trees.length === 0) {
  console.error('check:climb-wave FAILED — the park generated no climbable trees at all.');
  process.exit(1);
}

interface TreeResult {
  index: number;
  handVisible: number;
  headVisible: number;
  blockedBy: Map<string, number>;
}

/** The foliage stand-ins for the tree at `index`, or exits if there are none. */
function foliageFor(index: number, tree: (typeof trees)[number]): Mesh[] {
  let occluder: FoliageOccluder | null = null;
  let nearest = 0.05;
  for (const candidate of occluders) {
    const distance = Math.hypot(candidate.x - tree.x, candidate.z - tree.z);
    if (distance < nearest) {
      occluder = candidate;
      nearest = distance;
    }
  }
  if (!occluder) {
    console.error(`check:climb-wave FAILED — climbable tree ${index} has no foliage occluder.`);
    process.exit(1);
  }
  return canopyMeshes(occluder);
}

/**
 * A kid posed mid-wave at a tree, with exactly the meshes the climb leaves drawn.
 *
 * `armOverride` exists only for `--sweep`, which is exploring poses the game
 * does not yet hold. The check itself passes `null` and therefore measures the
 * game's own {@link applyRidePose} untouched — the whole point of sharing it.
 */
function poseKidAt(
  tree: (typeof trees)[number],
  bearing: number,
  elapsed: number,
  armOverride: { x: number; z: number } | null,
  /** 0 = resting peek (no hoist, peek facing), 1 = full wave. */
  wave = 1,
  liftOverride: number | null = null,
  /** Re-creates the retired head-and-arm-only climb, for `--thin-canopy`. */
  hideBody = false,
): ReturnType<typeof createKid> {
  const perch = tree.trunkRadius + CLIMB_EDGE_GAP;
  const kid = createKid();
  applyRidePose({ body: kid.body, head: kid.head, ...kid.limbs }, wave, elapsed);
  if (armOverride) {
    kid.limbs.rightArm.rotation.x = armOverride.x;
    kid.limbs.rightArm.rotation.z = armOverride.z;
  }
  kid.root.position.set(
    tree.x + Math.sin(bearing) * perch,
    tree.canopyTopY - KID_HEAD_HEIGHT + (liftOverride ?? CLIMB_PEEK_LIFT) + WAVE_RISE * wave,
    tree.z + Math.cos(bearing) * perch,
  );
  // At rest she holds the facing she arrived with (facing away from the trunk);
  // the wave turns her to camera. Both are part of what the eye sees change.
  const peekFacing = bearing + Math.PI;
  kid.root.rotation.y = wave > 0.5 ? CAMERA_FACING : peekFacing;
  // Nothing is hidden. `TreeClimbing` used to switch off everything but the
  // head and the waving arm, and this loop matched it part for part; the whole
  // child is drawn up a tree now, so hiding anything here would measure a pose
  // the game never renders — the exact failure this file's header warns about.
  // The `hideBody` argument exists only for `--thin-canopy`, which re-creates
  // the old behaviour to prove the new guard can go red.
  if (hideBody) {
    for (const child of kid.body.children) {
      if (child === kid.head) continue;
      if (child === kid.limbs.rightArm) continue;
      child.visible = false;
    }
  }
  kid.root.updateMatrixWorld(true);
  return kid;
}

/** Measures every tree, over the whole bearing x waggle envelope. */
function measurePose(
  armOverride: { x: number; z: number } | null,
  bearings = BEARINGS,
  phases = WAGGLE_PHASES,
): TreeResult[] {
  const out: TreeResult[] = [];
  for (const [index, tree] of trees.entries()) {
    const foliage = foliageFor(index, tree);
    let bestHand = 0;
    let bestHead = 0;
    let bestBlockers = new Map<string, number>();
    let haveBlame = false;

    for (let b = 0; b < bearings; b += 1) {
      const bearing = (b / bearings) * Math.PI * 2;
      for (let w = 0; w < phases; w += 1) {
        // A full waggle cycle: sin(elapsed * 11) has period 2*PI/11.
        const elapsed = (w / phases) * ((Math.PI * 2) / 11);
        const kid = poseKidAt(tree, bearing, elapsed, armOverride);

        const armSamples = sampleSurface(kid.limbs.rightArm, 1 / 3);
        const headSamples = sampleSurface(kid.head, 1 / 3);
        const notArm = collectMeshes(kid.root, kid.limbs.rightArm);
        const notHead = collectMeshes(kid.root, kid.head);

        const hand = measureVisibility(armSamples, [...notArm, ...foliage]);
        const head = measureVisibility(headSamples, [...notHead, ...foliage]);

        if (hand.visible > bestHand || !haveBlame) {
          bestHand = Math.max(bestHand, hand.visible);
          bestBlockers = hand.blockedBy;
          haveBlame = true;
        }
        bestHead = Math.max(bestHead, head.visible);
      }
    }
    out.push({ index, handVisible: bestHand, headVisible: bestHead, blockedBy: bestBlockers });
  }
  return out;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

// --------------------------------------------------------------------- sweep
//
// `--sweep` explores arm angles and prints what each would score. It is how
// the shipped angle was chosen rather than guessed; it changes nothing.
if (process.argv.includes('--sweep')) {
  console.log('sweeping right-arm rotation (x = lift, z = lateral swing)');
  console.log('  arm.x   arm.z   worst hand   best hand   worst head');
  const rows: { x: number; z: number; worst: number; best: number; head: number }[] = [];
  for (let x = -2.7; x <= -0.9; x += 0.3) {
    for (let z = -1.5; z <= 1.5; z += 0.25) {
      const results = measurePose({ x, z }, 4, 2);
      const worst = Math.min(...results.map((r) => r.handVisible));
      const bestOf = Math.max(...results.map((r) => r.handVisible));
      const head = Math.min(...results.map((r) => r.headVisible));
      rows.push({ x, z, worst, best: bestOf, head });
    }
  }
  rows.sort((a, b) => b.worst - a.worst);
  for (const row of rows.slice(0, 25)) {
    console.log(
      `  ${row.x.toFixed(2).padStart(5)}   ${row.z.toFixed(2).padStart(5)}   ` +
        `${pct(row.worst).padStart(10)}   ${pct(row.best).padStart(9)}   ${pct(row.head).padStart(10)}`,
    );
  }
  process.exit(0);
}

// ------------------------------------------------------------------- picture
//
// Rasterises her at play scale, because a visibility percentage says nothing
// about whether a ~35 px figure reads as waving. 76% of a hand that covers four
// pixels is still not a wave. This is the "look at it" step, done without a
// browser — and the pixel count it returns is what the check actually enforces.

/** She is a ~35 px figure at play distance; the kid is 2.12 m (ART_DIRECTION §4). */
const FIGURE_PX = 35;
const UNITS_PER_PIXEL = 2.12 / FIGURE_PX;

interface Picture {
  rows: string[];
  handPixels: number;
  headPixels: number;
  /**
   * Pixels of her that are neither head nor waving arm — torso, legs, far arm.
   * **Zero on the pose that shipped before 6 August**, which is the point.
   */
  bodyPixels: number;
  /** Screen-space bounds of her body (head + arm), in raster pixels. */
  bodyTop: number;
  bodyBottom: number;
  bodyCentroidY: number;
  bodyCentroidX: number;
}

/**
 * Ray-traced ASCII of one tree's climber at play scale.
 *
 * `anchor` fixes the raster window in the WORLD. Centring on her own head
 * (the default) is right for judging the pose; centring on the tree is what
 * measures whether she visibly moves **against the scenery**, which is the
 * only motion the eye can see — see `--motion`.
 */
function rasterise(
  tree: (typeof trees)[number],
  index: number,
  override: { x: number; z: number } | null,
  wave = 1,
  anchor: 'head' | 'tree' = 'head',
  bearing = Math.PI * 0.25,
  elapsed = 0,
  liftOverride: number | null = null,
  hideBody = false,
): Picture {
  const right = new Vector3().crossVectors(VIEW_DIR, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, VIEW_DIR).normalize();
  const foliage = foliageFor(index, tree);
  const kid = poseKidAt(tree, bearing, elapsed, override, wave, liftOverride, hideBody);
  const arm = new Set(collectMeshes(kid.limbs.rightArm, new Group()));
  const head = new Set(collectMeshes(kid.head, new Group()));
  const all = [...collectMeshes(kid.root, new Group()), ...foliage];

  const centre = new Vector3();
  if (anchor === 'head') {
    kid.head.getWorldPosition(centre);
  } else {
    // World-anchored on the tree top: the window does not move with her, so
    // any shift of her silhouette here is real motion against the scenery.
    centre.set(tree.x, tree.canopyTopY, tree.z);
  }

  const halfW = 30;
  const halfH = 22;
  const raycaster = new Raycaster();
  raycaster.far = RAY_BACKOFF * 2;
  let handPixels = 0;
  let headPixels = 0;
  let bodyPixels = 0;
  let bodyTop = Number.NaN;
  let bodyBottom = Number.NaN;
  let sumY = 0;
  let sumX = 0;
  let bodyCount = 0;
  const rows: string[] = [];
  for (let py = halfH; py >= -halfH; py -= 1) {
    let row = '';
    for (let px = -halfW; px <= halfW; px += 1) {
      const point = centre
        .clone()
        .addScaledVector(right, px * UNITS_PER_PIXEL)
        .addScaledVector(up, py * UNITS_PER_PIXEL);
      raycaster.set(point.clone().addScaledVector(VIEW_DIR, -RAY_BACKOFF), VIEW_DIR);
      const hit = raycaster.intersectObjects(all, false)[0];
      if (!hit) {
        row += ' ';
        continue;
      }
      const isArm = arm.has(hit.object as Mesh);
      const isHead = head.has(hit.object as Mesh);
      if (isArm || isHead) {
        // Her silhouette, for the screen-space motion measurement.
        if (Number.isNaN(bodyTop)) bodyTop = py;
        bodyBottom = py;
        sumY += py;
        sumX += px;
        bodyCount += 1;
      }
      if (isArm) {
        row += 'H';
        handPixels += 1;
      } else if (isHead) {
        row += '#';
        headPixels += 1;
      } else if ((hit.object.name || '').startsWith('foliage')) {
        row += '.';
      } else {
        row += '+';
        bodyPixels += 1;
      }
    }
    rows.push(row);
  }
  return {
    rows,
    handPixels,
    headPixels,
    bodyPixels,
    bodyTop,
    bodyBottom,
    bodyCentroidY: bodyCount === 0 ? Number.NaN : sumY / bodyCount,
    bodyCentroidX: bodyCount === 0 ? Number.NaN : sumX / bodyCount,
  };
}

/**
 * The legibility floor, in pixels of visible hand at play scale.
 *
 * This is the bar that matters, and the reason the percentage alone is not
 * enough: a hand can be 76% unoccluded and still be four pixels nobody notices.
 *
 * Measured ceiling for this rig is ~19 px. That is not a tuning choice, it is
 * anatomy: her lateral reach is 0.38 (shoulder) + 0.455 (arm + hand) = 0.835 m
 * from her centreline, against a skull of roughly 0.6 m radius — this kid is
 * 59% head (ART_DIRECTION.md §4) — so only ~0.23 m of hand can ever clear her
 * own silhouette, about four pixels wide at 61 mm/px. Swinging the arm further
 * out does not help; past z = 1.5 the count *falls* (10 px at 2.0, 1 px at 2.3)
 * as the hand rotates back behind her.
 *
 * 12 is comfortably under the 18 the shipped pose measures, so ordinary tuning
 * does not trip it, and far above the **zero** the broken pose scored.
 */
const REQUIRED_HAND_PIXELS = 12;

/**
 * How far her silhouette must travel side to side, in pixels at play scale,
 * at the WORST approach bearing.
 *
 * Measured, not chosen from geometry: `CLIMB_WAVE_LEAN` produces 6.7-7.3 px at
 * every bearing. 5 keeps a margin for tuning while failing loudly if the rock
 * is removed or replaced with a translation the camera can eat.
 *
 * This is the *worst* bearing, deliberately. The hand is measured at its best
 * one, and that is a weakness: hand visibility ranges 0-19 px across the four
 * approaches, so on one side of some trees the arm cannot be seen at all. The
 * rock is what makes the wave legible regardless.
 */
const REQUIRED_ROCK_PIXELS = 5;

// ---------------------------------------------------------------------- arm8
//
// **QA's method, not mine.** Twice now a measurement written here has flattered
// the outcome it was checking — the canopy-only clearance in round 1, and a
// four-bearing crop in round 3 that printed 7/19/15/0 when the honest figure
// was zero arm across three contiguous bearings on every tree. So this adopts
// QA's technique wholesale:
//
//  - **eight bearings**, not four;
//  - **whole visible scene**, not a crop framed on her head;
//  - **the delta method** — render twice, differing by exactly one thing (the
//    arm present or deleted), and count the pixels that change. That measures
//    what the arm actually contributes to the picture, rather than trusting
//    this script's own idea of which mesh owns a pixel.
//
// The pose clock is frozen and set explicitly, so the two frames of a pair can
// differ by nothing else.

/** Pixels the arm contributes to the whole scene, by QA's delta method. */
function armDeltaPixels(
  tree: (typeof trees)[number],
  index: number,
  bearing: number,
  elapsed: number,
): number {
  const right = new Vector3().crossVectors(VIEW_DIR, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, VIEW_DIR).normalize();
  const foliage = foliageFor(index, tree);
  const kid = poseKidAt(tree, bearing, elapsed, null, 1);
  const armMeshes = new Set(collectMeshes(kid.limbs.rightArm, new Group()));
  const withArm = [...collectMeshes(kid.root, new Group()), ...foliage];
  const withoutArm = withArm.filter((mesh) => !armMeshes.has(mesh));

  // Generous, world-anchored, and centred between her head and the canopy top —
  // wide enough that an arm appearing anywhere around her is inside it. This is
  // the "whole screen, not a crop" part.
  const centre = new Vector3(tree.x, tree.canopyTopY + CLIMB_PEEK_LIFT * 0.5, tree.z);
  const half = 44;
  const raycaster = new Raycaster();
  raycaster.far = RAY_BACKOFF * 2;
  let changed = 0;
  for (let py = -half; py <= half; py += 1) {
    for (let px = -half; px <= half; px += 1) {
      const point = centre
        .clone()
        .addScaledVector(right, px * UNITS_PER_PIXEL)
        .addScaledVector(up, py * UNITS_PER_PIXEL);
      const origin = point.clone().addScaledVector(VIEW_DIR, -RAY_BACKOFF);
      raycaster.set(origin, VIEW_DIR);
      const a = raycaster.intersectObjects(withArm, false)[0];
      raycaster.set(origin, VIEW_DIR);
      const b = raycaster.intersectObjects(withoutArm, false)[0];
      const aKey = a ? `${a.object.id}:${a.distance.toFixed(3)}` : '-';
      const bKey = b ? `${b.object.id}:${b.distance.toFixed(3)}` : '-';
      if (aKey !== bKey) changed += 1;
    }
  }
  return changed;
}

if (process.argv.includes('--arm8')) {
  console.log(
    `arm contribution by QA's delta method (8 bearings, whole scene, ` +
      `${(UNITS_PER_PIXEL * 1000).toFixed(0)} mm/px), lift ${CLIMB_PEEK_LIFT} m:`,
  );
  console.log('  tree    0    45    90   135   180   225   270   315   | zero-bearings');
  let totalZero = 0;
  let totalCombos = 0;
  for (const [index, tree] of trees.entries()) {
    const cells: number[] = [];
    for (let b = 0; b < 8; b += 1) {
      const bearing = (b / 8) * Math.PI * 2;
      // Frozen pose clock, half a rock period in, so the rock is at an extreme
      // rather than at its neutral crossing.
      const elapsed = Math.PI / CLIMB_WAVE_LEAN_RATE;
      cells.push(armDeltaPixels(tree, index, bearing, elapsed));
    }
    const zeros = cells.filter((n) => n === 0).length;
    totalZero += zeros;
    totalCombos += cells.length;
    console.log(
      `  ${String(index).padStart(4)}  ${cells.map((n) => String(n).padStart(4)).join('  ')}   | ${zeros}`,
    );
  }
  console.log(`  ${totalZero} of ${totalCombos} tree x bearing combinations show no arm.`);

  // Turn timing: how much of the wave she actually spends facing the camera.
  console.log('\nturn timing (PEEK_TURN_SPEED 2.6 rad/s, wave held 1.7 s):');
  console.log('  bearing   turn angle   turn time   camera-facing for');
  for (let b = 0; b < 8; b += 1) {
    const bearing = (b / 8) * Math.PI * 2;
    const peekFacing = bearing + Math.PI;
    let delta = Math.abs(((CAMERA_FACING - peekFacing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const turnTime = delta / 2.6;
    const facing = Math.max(0, 1.7 - turnTime);
    console.log(
      `  ${((bearing * 180) / Math.PI).toFixed(0).padStart(7)}   ` +
        `${((delta * 180) / Math.PI).toFixed(0).padStart(10)}°   ${turnTime.toFixed(2).padStart(9)}s   ` +
        `${facing.toFixed(2).padStart(17)}s`,
    );
  }
  process.exit(0);
}

// -------------------------------------------------------------------- motion
//
// `--motion` answers the question QA's third pass raised and nothing here could
// previously see: **does she visibly move against the scenery?**
//
// She really does rise 0.31 m in the world. QA measured her ending each wave
// ~7 px LOWER on screen. Two reasons, and both are invisible from world space:
//
//  1. The camera follows `player.position` (`Game.ts` -> `IsoCamera.update`,
//     `focus.y` damped at CAMERA_FOLLOW_HALF_LIFE * 2), so it climbs with her
//     and eats most of the hoist.
//  2. Turning to camera swings her off-axis mass (her head is tipped back
//     inside `crown`), and under an isometric projection horizontal motion has
//     a screen-Y component.
//
// So this rasterises her WORLD-ANCHORED on the tree, at rest and mid-wave, and
// compares where her silhouette actually lands. A world-space number is not
// evidence of anything the eye can see.
if (process.argv.includes('--motion')) {
  console.log(
    `screen-space motion at play scale (${(UNITS_PER_PIXEL * 1000).toFixed(0)} mm/px), ` +
      'her silhouette measured against a tree-anchored window:',
  );
  console.log('  tree  bearing   top rest->wave   centroid dY   centroid dX   hand px');
  for (const [index, tree] of trees.entries()) {
    for (const b of [0, 1, 2, 3]) {
      const bearing = (b / 4) * Math.PI * 2;
      const rest = rasterise(tree, index, null, 0, 'tree', bearing);
      const wave = rasterise(tree, index, null, 1, 'tree', bearing);
      const dTop = wave.bodyTop - rest.bodyTop;
      const dY = wave.bodyCentroidY - rest.bodyCentroidY;
      const dX = wave.bodyCentroidX - rest.bodyCentroidX;
      // The rock: how far her silhouette actually travels across one rock
      // cycle, in pixels, at full wave. This is the number that matters —
      // world-space motion is what turned out not to reach the screen.
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const ROCK_STEPS = 8;
      for (let r = 0; r < ROCK_STEPS; r += 1) {
        const t = (r / ROCK_STEPS) * ((Math.PI * 2) / 5.5);
        const frame = rasterise(tree, index, null, 1, 'tree', bearing, t);
        minX = Math.min(minX, frame.bodyCentroidX);
        maxX = Math.max(maxX, frame.bodyCentroidX);
        minY = Math.min(minY, frame.bodyCentroidY);
        maxY = Math.max(maxY, frame.bodyCentroidY);
      }
      console.log(
        `  ${String(index).padStart(4)}  ${((bearing * 180) / Math.PI).toFixed(0).padStart(7)}   ` +
          `${rest.bodyTop} -> ${wave.bodyTop} (${dTop >= 0 ? '+' : ''}${dTop})`.padStart(15) +
          `   ${dY >= 0 ? '+' : ''}${dY.toFixed(1)}`.padStart(14) +
          `   ${dX >= 0 ? '+' : ''}${dX.toFixed(1)}`.padStart(14) +
          `   ${wave.handPixels}`.padStart(8) +
          `   rock ${(maxX - minX).toFixed(1)}x${(maxY - minY).toFixed(1)}px`,
      );
    }
  }
  process.exit(0);
}

if (process.argv.includes('--picture')) {
  // `--arm-x`/`--arm-z` draw a pose the game does not hold, for comparing
  // candidates. With neither, this draws the shipped pose.
  const argX = process.argv.indexOf('--arm-x');
  const argZ = process.argv.indexOf('--arm-z');
  const override =
    argX > 0 && argZ > 0
      ? { x: Number(process.argv[argX + 1]), z: Number(process.argv[argZ + 1]) }
      : null;

  const tree = trees[0];
  if (!tree) process.exit(1);
  const liftArg = process.argv.indexOf('--lift');
  const liftOverride = liftArg > 0 ? Number(process.argv[liftArg + 1]) : null;
  const picture = rasterise(tree, 0, override, 1, 'tree', Math.PI * 0.25, 0, liftOverride);
  console.log(
    `\nTree 0 at play scale (kid = ${FIGURE_PX}px tall, ` +
      `${(UNITS_PER_PIXEL * 1000).toFixed(0)} mm/px)` +
      `${override ? `, arm override x=${override.x} z=${override.z}` : ', shipped pose'}.` +
      '\nH = waving arm, # = head, + = other body, . = leaves',
  );
  for (const row of picture.rows) console.log(`  |${row}|`);
  console.log(`  hand pixels: ${picture.handPixels}   head pixels: ${picture.headPixels}`);
  process.exit(0);
}

const results = measurePose(null);

console.log(
  `check:climb-wave: arm angle ${CLIMB_WAVE_ARM_X}, hoist ${WAVE_RISE} m, ${trees.length} ` +
    `climbable trees, best of ${BEARINGS} bearings x ${WAGGLE_PHASES} waggle phases.`,
);
console.log('  tree   hand visible   head (control)   blocked mostly by');
for (const result of results) {
  const top = [...result.blockedBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const blame = top.length > 0 ? top.map(([name, n]) => `${name} x${n}`).join(', ') : '—';
  console.log(
    `  ${String(result.index).padStart(4)}   ${pct(result.handVisible).padStart(12)}   ` +
      `${pct(result.headVisible).padStart(14)}   ${blame}`,
  );
}
if (verbose) {
  for (const result of results) {
    console.log(`\n  tree ${result.index} full blame:`);
    for (const [name, n] of [...result.blockedBy.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${name} x${n}`);
    }
  }
}

const worstHand = Math.min(...results.map((r) => r.handVisible));
const worstHead = Math.min(...results.map((r) => r.headVisible));

// The control. If the head is not clearly visible either, the measurement is
// wrong and its verdict on the hand means nothing — say that, rather than
// reporting a confident failure built on a broken method.
if (worstHead < 0.5) {
  console.error(
    `\ncheck:climb-wave FAILED (control) — the HEAD reads only ${pct(worstHead)} visible, but the ` +
      'head is known to be plainly visible in game (~96%).\n' +
      'The measurement itself is wrong. Fix this script before trusting anything it says about ' +
      'the hand.',
  );
  process.exit(1);
}

if (worstHand < REQUIRED_VISIBLE) {
  console.error(
    `\ncheck:climb-wave FAILED — the waving hand is only ${pct(worstHand)} visible from the game ` +
      `camera (needs ${pct(REQUIRED_VISIBLE)}).\n` +
      `The head control reads ${pct(worstHead)}, so the camera and the rig are fine: the hand is ` +
      'genuinely hidden.\n\n' +
      'Read the blame column above. If it names her own skull, hair or ear, the hand is behind her\n' +
      'own silhouette, and no amount of extra hoist will help — it has to move SIDEWAYS, out past\n' +
      'her head, not further up.',
  );
  process.exit(1);
}

// Not occluded is not the same as legible. A hand can be 76% unoccluded and
// still cover four pixels nobody notices, which is the difference between what
// this check measured before QA and what it measures now.
const firstTree = trees[0];
if (!firstTree) {
  console.error('check:climb-wave FAILED — no tree to rasterise.');
  process.exit(1);
}
const picture = rasterise(firstTree, 0, null);
console.log(
  `  legibility: ${picture.handPixels} px of hand against ${picture.headPixels} px of head, ` +
    `at play scale (kid = ${FIGURE_PX} px tall). Needs ${REQUIRED_HAND_PIXELS}. ` +
    'See --picture.',
);

if (picture.handPixels < REQUIRED_HAND_PIXELS) {
  console.error(
    `\ncheck:climb-wave FAILED (legibility) — the hand is ${pct(worstHand)} unoccluded but covers ` +
      `only ${picture.handPixels} px at play scale (needs ${REQUIRED_HAND_PIXELS}).\n` +
      'Being un-hidden is not the same as being seen. Run --picture to look at it.\n' +
      'Note the ceiling: ~19 px is all this rig can produce, because her arm reaches 0.835 m from\n' +
      'her centreline against a skull of roughly 0.6 m radius. If more is needed, the lever is not\n' +
      'the arm — it is moving the whole body, which is 474 px.',
  );
  process.exit(1);
}

// --------------------------------------------------------------- the rock
//
// The motion that actually reaches the screen, and the only cue that does not
// depend on which side she climbed. Measured in pixels at play scale, against a
// world-anchored window, because QA's third pass proved world-space motion is
// no evidence at all: her 0.31 m hoist nets about −3 px on half the approaches,
// the follow camera having eaten it.
const ROCK_STEPS = 8;
let worstRock = Infinity;
const handByBearing: number[] = [];
for (const bearing of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
  let minX = Infinity;
  let maxX = -Infinity;
  for (let r = 0; r < ROCK_STEPS; r += 1) {
    const t = (r / ROCK_STEPS) * ((Math.PI * 2) / CLIMB_WAVE_LEAN_RATE);
    const frame = rasterise(firstTree, 0, null, 1, 'tree', bearing, t);
    minX = Math.min(minX, frame.bodyCentroidX);
    maxX = Math.max(maxX, frame.bodyCentroidX);
  }
  worstRock = Math.min(worstRock, maxX - minX);
  handByBearing.push(rasterise(firstTree, 0, null, 1, 'tree', bearing).handPixels);
}

console.log(
  `  rock: silhouette travels ${worstRock.toFixed(1)} px side to side at the WORST approach ` +
    `bearing (needs ${REQUIRED_ROCK_PIXELS}).`,
);
console.log(
  `  hand by approach bearing (0/90/180/270): ${handByBearing.join(' / ')} px — ` +
    'the arm is approach-dependent; the rock is not.',
);

if (worstRock < REQUIRED_ROCK_PIXELS) {
  console.error(
    `\ncheck:climb-wave FAILED (motion) — her silhouette only travels ${worstRock.toFixed(1)} px ` +
      `at the worst approach (needs ${REQUIRED_ROCK_PIXELS}).\n` +
      'The rock is the only cue that survives every approach and the follow camera. Do not try to\n' +
      'replace it with a translation: the camera tracks `player.position` and cancels those — that\n' +
      'is exactly what happened to the 0.3 m hoist, which nets about -3 px on half the bearings.',
  );
  process.exit(1);
}

// ------------------------------------------------------------------- the aim
//
// **Is she looking at you?** Jim's 6 August note — "the character should look
// slightly upwards too, straight towards the camera" — describes a bug this
// script could not see. Every measurement above is about the *silhouette*: how
// much hand clears the leaves, how far it travels. A face aimed 40° under the
// viewer's feet moves exactly the same pixels as one aimed at him, so the whole
// of the rest of this file passes either way. That is the same shape of hole as
// issue #224, and it gets the same treatment: measure the thing itself.
//
// The gaze is measured off the built rig — the direction from the skull's centre
// out through the bridge of the nose, which is where `glassesAnchor` sits, at
// the painted eyes' own height — never re-derived from the angles that posed it.

/** Where the camera is, as a direction from her. Orthographic, so it is constant. */
const TO_CAMERA = new Vector3(offset.x, offset.y, offset.z).normalize();

/** The direction the painted eyes actually point, for a kid posed and placed. */
function gazeOf(kid: ReturnType<typeof createKid>): Vector3 {
  const crown = kid.glassesAnchor.parent;
  if (!crown) {
    console.error('check:climb-wave FAILED (aim) — the glasses anchor has no parent to measure the skull centre from.');
    process.exit(1);
  }
  kid.root.updateMatrixWorld(true);
  const bridge = kid.glassesAnchor.getWorldPosition(new Vector3());
  const skull = crown.getWorldPosition(new Vector3());
  return bridge.sub(skull).normalize();
}

/** A kid mid-wave, facing the camera, with the rock frozen at `elapsed`. */
function wavingKid(elapsed: number, headPitchOverride: number | null = null) {
  const kid = createKid();
  applyRidePose({ body: kid.body, head: kid.head, ...kid.limbs }, 1, elapsed);
  if (headPitchOverride !== null) kid.head.rotation.x = headPitchOverride;
  kid.root.rotation.y = CAMERA_FACING;
  return kid;
}

const degreesOff = (gaze: Vector3) => (Math.acos(Math.min(1, gaze.dot(TO_CAMERA))) / DEG);

// First, the claim `Player.ts` solves the head angle from, and `kid.ts`'s
// KID_REST_GAZE_PITCH doc comment states outright: gaze elevation is exactly
// `KID_REST_GAZE_PITCH - body.rotation.x - head.rotation.x`. If that ever stops
// being true — a neck joint added, the crown re-parented, HEAD_TILT moved onto
// a different group — the solved angle silently stops pointing at the camera
// while every number in this file still looks healthy. So check the model, not
// just its answer.
let worstModelError = 0;
for (const [bodyPitch, headPitch] of [
  [0, 0],
  [0.3, 0],
  [0.3, -0.7],
  [0, -0.5],
  [0.5, 0.2],
  [-0.2, -0.9],
] as const) {
  const kid = createKid();
  applyRidePose({ body: kid.body, head: kid.head, ...kid.limbs }, 0, 0);
  kid.body.rotation.x = bodyPitch;
  kid.head.rotation.x = headPitch;
  kid.root.rotation.y = CAMERA_FACING;
  const predicted = KID_REST_GAZE_PITCH - bodyPitch - headPitch;
  const actual = Math.asin(gazeOf(kid).y);
  worstModelError = Math.max(worstModelError, Math.abs(predicted - actual) / DEG);
}

if (worstModelError > 0.01) {
  console.error(
    `\ncheck:climb-wave FAILED (aim model) — gaze is no longer ` +
      `KID_REST_GAZE_PITCH - body.rotation.x - head.rotation.x; it is off by up to ` +
      `${worstModelError.toFixed(3)}°.\n` +
      'Player.ts solves CLIMB_WAVE_HEAD_PITCH by rearranging exactly that expression, so it is now\n' +
      'aiming her somewhere other than where it believes. Re-derive it against whatever the rig does\n' +
      'now — do not simply widen this tolerance.',
  );
  process.exit(1);
}

// Then the aim itself, across the rock. She passes dead through the camera
// twice a cycle and leans off it in between; both are wanted, so both are
// measured — the best says she is genuinely aimed at you, the worst says the
// rock never throws her wildly off.
let bestAim = Infinity;
let worstAim = 0;
for (let r = 0; r < 16; r += 1) {
  const elapsed = (r / 16) * ((Math.PI * 2) / CLIMB_WAVE_LEAN_RATE);
  const off = degreesOff(gazeOf(wavingKid(elapsed)));
  bestAim = Math.min(bestAim, off);
  worstAim = Math.max(worstAim, off);
}

/**
 * How near dead-on she must get at the rock's crossing.
 *
 * She measures 0.00° — the angle is solved, not tuned, so anything but ~0 means
 * the derivation is broken rather than the pose being slightly off. 1.5° is
 * loose enough to survive floating point and a nudge to the rig, and nowhere
 * near loose enough to pass the 40.14° she scored before this existed.
 */
const REQUIRED_AIM_DEGREES = 1.5;

/**
 * And how far the rock may then swing her off it.
 *
 * `CLIMB_WAVE_LEAN` is 0.16 rad, which works out at 7.52° of gaze at the
 * extremes. 12 leaves room to retune the rock by half again before this
 * complains, while still failing if the head is aimed by something that drifts.
 */
const ALLOWED_ROCK_SWING_DEGREES = 12;

const wasOff = degreesOff(gazeOf(wavingKid(0, 0)));
console.log(
  `  aim: her gaze passes ${bestAim.toFixed(2)}° from the camera at the rock's crossing ` +
    `(needs ${REQUIRED_AIM_DEGREES}°), and never more than ${worstAim.toFixed(2)}° off it ` +
    `(allowed ${ALLOWED_ROCK_SWING_DEGREES}°). With no head pitch at all it would be ` +
    `${wasOff.toFixed(2)}°.`,
);

if (bestAim > REQUIRED_AIM_DEGREES) {
  console.error(
    `\ncheck:climb-wave FAILED (aim) — she never looks closer than ${bestAim.toFixed(2)}° to the ` +
      `camera while waving (needs ${REQUIRED_AIM_DEGREES}°).\n` +
      'She is waving past the player rather than at him — the exact thing Jim asked to be fixed on\n' +
      '6 August, when it measured 40.14° low. CLIMB_WAVE_HEAD_PITCH in Player.ts is what aims her;\n' +
      'it is solved from CAMERA_PITCH_DEGREES and KID_REST_GAZE_PITCH, so suspect those before the\n' +
      'pose. Note that the sign matters and is not obvious: NEGATIVE head.rotation.x looks UP.',
  );
  process.exit(1);
}

if (worstAim > ALLOWED_ROCK_SWING_DEGREES) {
  console.error(
    `\ncheck:climb-wave FAILED (aim) — the rock swings her gaze up to ${worstAim.toFixed(2)}° off the ` +
      `camera (allowed ${ALLOWED_ROCK_SWING_DEGREES}°).\n` +
      'She passes through the camera but lurches away from it either side. If CLIMB_WAVE_LEAN grew,\n' +
      'that is the cause, and it is a judgement call whether the bigger rock or the steadier gaze\n' +
      'matters more — but it should be a decision, not a surprise.',
  );
  process.exit(1);
}

// ------------------------------------------------------------------ the body
//
// **Is there a child under that head?**
//
// The mirror of the aim block above, and it exists for the same reason: every
// other measurement in this file is about the head and the hand, and a head
// with nothing under it occupies exactly the pixels a child in a tree does. So
// the whole file passed, twice, through a version of the game where she was a
// floating head and one arm — and Jim found it by looking, as he found the aim.
//
// Measured from the play camera on the real rig, at every climbable tree and
// from four approaches, so a body hidden only on some bearing cannot hide here.

/**
 * How much of her below the neck must reach the screen, in pixels at play scale.
 *
 * Not a fraction and not a ratio: the honest question is whether a child is
 * *there*, and one pixel of shoulder is not a child. The pose that shipped
 * before 6 August measures **exactly 0**, on every tree and every approach,
 * because nothing below the neck was drawn at all — `--hide-body` reproduces it.
 *
 * **This was 40, and it came down to 12 when Jim lowered the seat**, which is a
 * loosening and so needs its reasoning in the open rather than a quiet edit.
 * 40 was set below a worst reading of 60 px taken when she sat 1.2 m above the
 * canopy with her whole body clear of it. He then asked her to sit *into* the
 * tree (`CLIMB_SEAT_DROP`), and burying more of her is the entire point of that
 * change, so the number this guards had to move with it.
 *
 * What it must not stop catching is a **floating head**, and the measured gap
 * is still wide. Per approach, at the new seat:
 *
 * ```
 *     0° / 90°    51-57 px      she is side-on, most of her clears the leaves
 *   180° / 270°   20-23 px      canopy between her body and the camera
 *   any, hidden    0 px         --hide-body
 * ```
 *
 * The split is by **approach, not by tree** — every tree reads within 3 px of
 * every other at the same bearing — so this is a property of the pose and the
 * camera, not of which tree she picked. 12 sits below the worst real reading
 * with 40% to spare and far above the zero it exists to catch; it would also
 * still fail a regression that drew only her legs, or only her shoulders.
 */
const REQUIRED_BODY_PIXELS = 12;

/**
 * How many trees the body check rasterises.
 *
 * Not all of them, and the reason is cost: rasterising is ~2 700 rays a frame
 * and #216 took the park from 8 climbable trees to 43, which would put this one
 * check near two minutes of every build. A spread of {@link BODY_TREES}, evenly
 * spaced through the list so different canopy sizes are covered, is enough —
 * because what this guards is **global**. Nothing hides the body on one tree
 * and not another: `TreeClimbing` either draws her or it does not. The per-tree
 * variation is only how much canopy eats, and four approaches on each of these
 * samples that adequately.
 */
const BODY_TREES = 6;

const bodyByTree: { index: number; bearing: number; pixels: number }[] = [];
for (let t = 0; t < Math.min(BODY_TREES, trees.length); t += 1) {
  const index = Math.floor((t * trees.length) / Math.min(BODY_TREES, trees.length));
  const tree = trees[index];
  if (!tree) continue;
  for (let b = 0; b < 4; b += 1) {
    const bearing = (b / 4) * Math.PI * 2;
    const shot = rasterise(tree, index, null, 1, 'head', bearing, 0, null, hideBodyMutation);
    bodyByTree.push({ index, bearing, pixels: shot.bodyPixels });
  }
}
if (bodyByTree.length === 0) {
  console.error('check:climb-wave FAILED (body) — no tree was sampled, so nothing was measured.');
  process.exit(1);
}
const worstBody = bodyByTree.reduce((a, b) => (b.pixels < a.pixels ? b : a));

if (verbose) {
  console.log('\n  body pixels by tree x approach:');
  for (const row of bodyByTree) {
    console.log(
      `    tree ${String(row.index).padStart(3)}  ` +
        `${((row.bearing * 180) / Math.PI).toFixed(0).padStart(4)}°  ${String(row.pixels).padStart(4)} px`,
    );
  }
}

console.log(
  `  body: ${worstBody.pixels} px of her below the neck at the WORST of ` +
    `${Math.min(BODY_TREES, trees.length)} of ${trees.length} trees x 4 approaches ` +
    `(needs ${REQUIRED_BODY_PIXELS})` +
    `${hideBodyMutation ? ' — MUTATED: body re-hidden' : ''}.`,
);

if (worstBody.pixels < REQUIRED_BODY_PIXELS) {
  console.error(
    `\ncheck:climb-wave FAILED (body) — only ${worstBody.pixels} px of her below the neck is on ` +
      `screen at tree ${worstBody.index}, approach ${((worstBody.bearing * 180) / Math.PI).toFixed(0)}° ` +
      `(needs ${REQUIRED_BODY_PIXELS}).\n` +
      'She is a floating head. That is what Jim saw on 6 August, and the whole reason this check\n' +
      'exists: every other number in this file is happy either way, because a head with nothing\n' +
      'under it covers the same pixels as a child in a tree.\n' +
      'The cause is almost certainly something switching parts off again in `TreeClimbing` — the\n' +
      'player is meant to be drawn WHOLE up a tree. Note the trap: hiding acts on the pivot groups,\n' +
      'so a mesh\'s own `.visible` still reads true on a body that is not drawn.',
  );
  process.exit(1);
}

console.log('check:climb-wave OK');
