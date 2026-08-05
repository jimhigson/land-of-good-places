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
  CAMERA_YAW_DEGREES,
} from '../src/core/constants.ts';
import { DEG } from '../src/core/mathUtils.ts';
import { cameraOffset } from '../src/core/cameraRig.ts';
import type { FoliageOccluder } from '../src/world/Scenery.ts';

const verbose = process.argv.includes('--verbose');

/**
 * How much of the top of the arm must be visible for this to count as a wave.
 *
 * QA's reading of the shipped-and-broken pose was **0%** on every tree, against
 * ~96% for the head. At real game zoom she is a ~30 px figure, so a hand that is
 * only marginally visible is not a wave anybody sees. A third of the sampled
 * surface is a hand that is plainly there, without demanding the whole arm clear
 * her silhouette.
 */
const REQUIRED_VISIBLE = 0.35;

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

const results: TreeResult[] = [];

for (const [index, tree] of trees.entries()) {
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
  const foliage = canopyMeshes(occluder);

  let bestHand = 0;
  let bestHead = 0;
  let bestBlockers = new Map<string, number>();

  for (let b = 0; b < BEARINGS; b += 1) {
    const bearing = (b / BEARINGS) * Math.PI * 2;
    const perch = tree.trunkRadius + CLIMB_EDGE_GAP;
    const x = tree.x + Math.sin(bearing) * perch;
    const z = tree.z + Math.cos(bearing) * perch;

    for (let w = 0; w < WAGGLE_PHASES; w += 1) {
      // A full waggle cycle: sin(elapsed * 11) has period 2*PI/11.
      const elapsed = (w / WAGGLE_PHASES) * ((Math.PI * 2) / 11);

      const kid = createKid();
      applyRidePose({ body: kid.body, ...kid.limbs }, 1, elapsed);
      kid.root.position.set(x, tree.canopyTopY - KID_HEAD_HEIGHT + WAVE_RISE, z);
      kid.root.rotation.y = CAMERA_FACING;

      // Exactly what `TreeClimbing.hidePlayerBody` leaves drawn.
      for (const child of kid.body.children) {
        if (child === kid.head) continue;
        if (child === kid.limbs.rightArm) continue;
        child.visible = false;
      }
      kid.root.updateMatrixWorld(true);

      const armSamples = sampleSurface(kid.limbs.rightArm, 1 / 3);
      const headSamples = sampleSurface(kid.head, 1 / 3);
      const notArm = collectMeshes(kid.root, kid.limbs.rightArm);
      const notHead = collectMeshes(kid.root, kid.head);

      const hand = measureVisibility(armSamples, [...notArm, ...foliage]);
      const head = measureVisibility(headSamples, [...notHead, ...foliage]);

      if (hand.visible > bestHand) {
        bestHand = hand.visible;
        bestBlockers = hand.blockedBy;
      }
      if (hand.visible === 0 && bestHand === 0 && bestBlockers.size === 0) {
        bestBlockers = hand.blockedBy;
      }
      bestHead = Math.max(bestHead, head.visible);
    }
  }

  results.push({ index, handVisible: bestHand, headVisible: bestHead, blockedBy: bestBlockers });
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

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

console.log('check:climb-wave OK');
