/**
 * **Can you actually see the wave she does from up a tree?**
 *
 * ```
 * npm run check:climb-wave          # or --verbose for the per-tree table
 * ```
 *
 * Issue #120 asks that after climbing a tree the player waves toward the
 * camera. The catch, and the whole reason this script exists, is that a climber
 * peeks with her **head at `canopyTopY` and everything else buried in the
 * leaves** (`world/TreeClimbing.ts`, "Body hidden, head out"). A wave is
 * therefore only a wave if the waving hand comes out of the canopy — and it
 * very nearly does not:
 *
 *  - her arm cannot reach above her own head. The shoulder sits 0.72 up a body
 *    whose head is at 1.36, and the hand reaches ~0.455 past the shoulder;
 *  - so the raised hand tops out roughly a quarter of a metre *below* the head,
 *    i.e. below `canopyTopY`;
 *  - and the canopy surface where she perches — a trunk-radius or so off the
 *    axis — is only about 0.17 below `canopyTopY`.
 *
 * `WAVE_RISE` lifts the whole child to close that gap. Whether it is *enough*
 * depends on four numbers owned by four different files — the kid's shoulder
 * height and arm length (`art/models/kid.ts`), the wave angle
 * (`entities/Player.ts`), the perch offset and the lift
 * (`world/TreeClimbing.ts`), and the canopy sizes (`world/Scenery.ts`) — none
 * of whose authors have any reason to think about this one. Any of them can
 * move and silently sink the hand back into the leaves, with **no visual
 * symptom except a wave you cannot see**.
 *
 * So nothing here is algebra: it poses a **real** kid at the real wave angle
 * and measures where the hand ends up, then walks the **real** generated park
 * and measures the real canopy ellipsoid above every real climbing spot.
 *
 * It samples every approach bearing, because which side of the trunk she climbs
 * depends on where she walked from, and reports the worst one.
 */
import './headless-canvas.mjs';
import { Box3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { createKid, KID_HEAD_HEIGHT } from '../src/art/models/kid.ts';
import { CLIMB_WAVE_ARM_X, CLIMB_WAVE_ARM_Z, WAVE_WAGGLE } from '../src/entities/Player.ts';
import { CLIMB_EDGE_GAP, WAVE_RISE } from '../src/world/TreeClimbing.ts';
import type { FoliageOccluder } from '../src/world/Scenery.ts';

const verbose = process.argv.includes('--verbose');

/**
 * How far clear of the leaves the hand must get.
 *
 * Not zero: a hand exactly level with the canopy surface is a hand you cannot
 * see. This is about a hand's width, so there is visibly a hand up there.
 */
const REQUIRED_CLEARANCE = 0.1;

/** Approach bearings sampled per tree. She climbs the side she walked up to. */
const BEARINGS = 72;

/**
 * How high the waving hand gets, measured off a real kid.
 *
 * Poses the right arm exactly as `Player`'s riding branch does at full wave and
 * takes the top of the arm subtree's world bounds. The waggle is swung to both
 * extremes and the **lowest** result kept, so a pass means the hand is clear
 * through the whole wag rather than only at the top of it.
 */
function measureHandTop(): { handTop: number; headHeight: number } {
  let lowest = Infinity;
  for (const waggle of [-WAVE_WAGGLE, 0, WAVE_WAGGLE]) {
    const kid = createKid();
    const arm = kid.limbs.rightArm;
    arm.rotation.x = CLIMB_WAVE_ARM_X;
    arm.rotation.z = CLIMB_WAVE_ARM_Z + waggle;
    kid.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(arm);
    if (box.max.y < lowest) lowest = box.max.y;
  }
  return { handTop: lowest, headHeight: KID_HEAD_HEIGHT };
}

/**
 * The height of the leaf canopy directly above `(x, z)`, or `-Infinity` if this
 * tree has no foliage over that point at all.
 *
 * Each canopy blob is an ellipsoid: `position` is its centre and `scale` its
 * semi-axes, exactly as `Scenery` builds the `InstancedMesh` from. Trunks are
 * skipped — a trunk is a cylinder, and treating one as an ellipsoid would
 * invent a dome over the middle of the tree that is not there.
 */
function canopyHeightAt(tree: FoliageOccluder, x: number, z: number): number {
  let highest = -Infinity;
  for (const part of tree.parts) {
    if (part.kind === 'trunk') continue;
    const dx = (x - part.position.x) / part.scale.x;
    const dz = (z - part.position.z) / part.scale.z;
    const planar = dx * dx + dz * dz;
    if (planar >= 1) continue;
    const surface = part.position.y + part.scale.y * Math.sqrt(1 - planar);
    if (surface > highest) highest = surface;
  }
  return highest;
}

const { handTop, headHeight } = measureHandTop();
/** How far below her head the waving hand tops out. The number that bites. */
const handBelowHead = headHeight - handTop;

const park = buildHeadlessPark();
const { scenery } = park.world;
const trees = scenery.climbableTrees;

if (trees.length === 0) {
  console.error('check:climb-wave FAILED — the park generated no climbable trees at all.');
  process.exit(1);
}

interface Result {
  index: number;
  clearance: number;
  canopyTopY: number;
  worstBearing: number;
}

const results: Result[] = [];

for (const [index, tree] of trees.entries()) {
  // The occluder built from the same trunk, by position. Scenery publishes the
  // two lists separately and they share no id.
  let occluder: FoliageOccluder | null = null;
  let bestDistance = 0.05;
  for (const candidate of scenery.foliageOccluders) {
    const distance = Math.hypot(candidate.x - tree.x, candidate.z - tree.z);
    if (distance < bestDistance) {
      occluder = candidate;
      bestDistance = distance;
    }
  }
  if (!occluder) {
    console.error(
      `check:climb-wave FAILED — climbable tree ${index} at (${tree.x.toFixed(1)}, ` +
        `${tree.z.toFixed(1)}) has no matching foliage occluder, so its canopy ` +
        'cannot be measured.',
    );
    process.exit(1);
  }

  // Where the hand gets to is fixed by the tree's own canopy top, wherever she
  // climbed up from — `climbPose` puts the head at `canopyTopY` regardless.
  const handWorldY = tree.canopyTopY + WAVE_RISE - handBelowHead;

  let worst = Infinity;
  let worstBearing = 0;
  const perch = tree.trunkRadius + CLIMB_EDGE_GAP;
  for (let i = 0; i < BEARINGS; i += 1) {
    const bearing = (i / BEARINGS) * Math.PI * 2;
    const x = tree.x + Math.sin(bearing) * perch;
    const z = tree.z + Math.cos(bearing) * perch;
    const leaves = canopyHeightAt(occluder, x, z);
    // No canopy over this bearing means nothing to be hidden by.
    if (leaves === -Infinity) continue;
    const clearance = handWorldY - leaves;
    if (clearance < worst) {
      worst = clearance;
      worstBearing = bearing;
    }
  }

  results.push({ index, clearance: worst, canopyTopY: tree.canopyTopY, worstBearing });
}

results.sort((a, b) => a.clearance - b.clearance);

if (verbose) {
  console.log('  tree   canopyTopY   worst bearing   hand clearance');
  for (const result of results) {
    console.log(
      `  ${String(result.index).padStart(4)}   ${result.canopyTopY.toFixed(2).padStart(10)}   ` +
        `${((result.worstBearing * 180) / Math.PI).toFixed(0).padStart(13)}°   ` +
        `${result.clearance.toFixed(3).padStart(14)}`,
    );
  }
}

const worst = results[0];
if (!worst) {
  console.error('check:climb-wave FAILED — no tree produced a measurement.');
  process.exit(1);
}

console.log(
  `check:climb-wave: kid's waving hand tops out ${handBelowHead.toFixed(3)} m below her head ` +
    `(head ${headHeight.toFixed(2)}, hand ${handTop.toFixed(3)}); WAVE_RISE ${WAVE_RISE} lifts her.`,
);
console.log(
  `check:climb-wave: ${trees.length} climbable trees, worst hand clearance ` +
    `${worst.clearance.toFixed(3)} m (tree ${worst.index}), need ${REQUIRED_CLEARANCE}.`,
);

if (worst.clearance < REQUIRED_CLEARANCE) {
  console.error(
    `\ncheck:climb-wave FAILED — the waving hand is only ${worst.clearance.toFixed(3)} m clear ` +
      `of the leaves on tree ${worst.index} (needs ${REQUIRED_CLEARANCE} m).\n` +
      'She waves from up a tree and nobody can see it. Raise WAVE_RISE in\n' +
      'world/TreeClimbing.ts, or find out which of the kid rig, the wave angle or\n' +
      'the canopy sizes moved.',
  );
  process.exit(1);
}

console.log('check:climb-wave OK');
