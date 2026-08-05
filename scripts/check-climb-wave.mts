/**
 * **Can you actually SEE the wave she does from up a tree?**
 *
 * ```
 * npm run check:climb-wave          # or --verbose for the per-tree table
 * ```
 *
 * Issue #120 asks that after climbing a tree the player waves toward the
 * camera. A climber peeks with her head at `canopyTopY` and everything else
 * hidden in the leaves (`world/TreeClimbing.ts`), so the waving hand has to get
 * somewhere the camera can actually see it.
 *
 * ## What the first version of this check got wrong
 *
 * It measured the hand against the **canopy ellipsoids only** — does the hand
 * clear the leaves — and passed with 0.176 m to spare. That measurement was
 * correct and completely irrelevant. QA then found the hand **0% visible on all
 * four climbable trees**, with *zero* foliage blockers: the hand cleared the
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
 * every real climbable tree, facing the camera as the wave makes her. Hides
 * exactly what `TreeClimbing.hidePlayerBody` hides. Then, for each
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
import { createKid, KID_HEAD_HEIGHT } from '../src/art/models/kid.ts';
import { applyRidePose, CLIMB_WAVE_ARM_X } from '../src/entities/Player.ts';
import { CLIMB_EDGE_GAP, WAVE_RISE } from '../src/world/TreeClimbing.ts';
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

/** Every drawn mesh under `root`, skipping anything inside `exclude`. */
function collectMeshes(root: Group, exclude: Group): Mesh[] {
  const out: Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
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
): ReturnType<typeof createKid> {
  const perch = tree.trunkRadius + CLIMB_EDGE_GAP;
  const kid = createKid();
  applyRidePose({ body: kid.body, ...kid.limbs }, 1, elapsed);
  if (armOverride) {
    kid.limbs.rightArm.rotation.x = armOverride.x;
    kid.limbs.rightArm.rotation.z = armOverride.z;
  }
  kid.root.position.set(
    tree.x + Math.sin(bearing) * perch,
    tree.canopyTopY - KID_HEAD_HEIGHT + WAVE_RISE,
    tree.z + Math.cos(bearing) * perch,
  );
  kid.root.rotation.y = CAMERA_FACING;
  // Exactly what `TreeClimbing.hidePlayerBody` leaves drawn.
  for (const child of kid.body.children) {
    if (child === kid.head) continue;
    if (child === kid.limbs.rightArm) continue;
    child.visible = false;
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
}

/** Ray-traced ASCII of one tree's climber at play scale. */
function rasterise(
  tree: (typeof trees)[number],
  index: number,
  override: { x: number; z: number } | null,
): Picture {
  const right = new Vector3().crossVectors(VIEW_DIR, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, VIEW_DIR).normalize();
  const foliage = foliageFor(index, tree);
  const kid = poseKidAt(tree, Math.PI * 0.25, 0, override);
  const arm = new Set(collectMeshes(kid.limbs.rightArm, new Group()));
  const head = new Set(collectMeshes(kid.head, new Group()));
  const all = [...collectMeshes(kid.root, new Group()), ...foliage];

  const centre = new Vector3();
  kid.head.getWorldPosition(centre);

  const halfW = 30;
  const halfH = 22;
  const raycaster = new Raycaster();
  raycaster.far = RAY_BACKOFF * 2;
  let handPixels = 0;
  let headPixels = 0;
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
      if (arm.has(hit.object as Mesh)) {
        row += 'H';
        handPixels += 1;
      } else if (head.has(hit.object as Mesh)) {
        row += '#';
        headPixels += 1;
      } else if ((hit.object.name || '').startsWith('foliage')) {
        row += '.';
      } else {
        row += '+';
      }
    }
    rows.push(row);
  }
  return { rows, handPixels, headPixels };
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
  const picture = rasterise(tree, 0, override);
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

console.log('check:climb-wave OK');
