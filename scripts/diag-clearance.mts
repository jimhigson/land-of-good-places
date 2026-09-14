/**
 * **Is the bridge low, or does the check only read it low?**
 *
 * Those two want opposite fixes, so nobody may guess between them.
 *
 * This is `test/procgen/invariants.ts`'s own train-clearance raycast
 * (`:6400-6455`) run twice over the identical geometry, identical ray origins
 * and the identical `deck`-marker filter, with **exactly one variable changed**:
 *
 * - **A — as the check asks it today**: ray along world `+Y`, and
 *   `clearance = hit.point.y - routePoint.y`.
 * - **B — as the world is**: ray along the local up (`upAt`), and the clearance
 *   is the ray's own travelled distance, which needs no subtraction and so
 *   cannot difference two columns.
 *
 * If B comes out at or above `TRAIN_CLEARANCE_Y` while A does not, the deck is
 * correctly placed and the *check* is wrong. If B is short too, the deck is
 * genuinely low and `bridges.ts` is wrong. A and B agreeing at the park's centre
 * and diverging with radius is the signature of a datum fault rather than a
 * geometry fault.
 *
 * CONTROLS, both printed:
 *  1. `cos(tilt)` is printed beside every reading. If B/A does not track
 *     `1/cos(tilt)`, the difference is not the lean and this whole framing is
 *     wrong.
 *  2. The innermost crossing (smallest radius) must show A ≈ B. If it does not,
 *     the instrument is measuring something other than the lean.
 */
import './headless-canvas.mjs';
import { Raycaster, Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const seed = process.env['LGP_SEED'] ?? 'default(canonical)';
const park = buildHeadlessPark();

const { TRAIN_CLEARANCE_Y } = await import('../src/world/train/clearance.ts');
const { TRACK_CLEARANCE, GROUND_SPHERE_RADIUS } = await import('../src/core/constants.ts');
const { upAt } = await import('../src/world/terrain.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');

const route = TRAIN_PLAN.route;
const train = park.world.train;

// The bridges' own group, found the way the invariant finds it: by walking the
// scene for the object the bridges were added to. Falling back to the whole
// scene is safe here — the `deck` filter and the ray length do the work — but
// it is reported, because a probe that silently measured the wrong subtree is
// exactly the failure this file exists to avoid.
const bridgesGroup = train.group.getObjectByName('railway-bridges');
if (!bridgesGroup) {
  console.log('no "railway-bridges" group in the built train group — nothing to measure');
  process.exit(1);
}
bridgesGroup.updateMatrixWorld(true);
const target: object = bridgesGroup;
console.log(
  `seed ${seed}: R=${GROUND_SPHERE_RADIUS}, TRAIN_CLEARANCE_Y=${TRAIN_CLEARANCE_Y.toFixed(3)}, ` +
    `raycast target = the 'railway-bridges' group (the identical subtree the invariant uses)`,
);

const raycaster = new Raycaster();
const worldUp = new Vector3(0, 1, 0);
const localUp = new Vector3();
const rayOrigin = new Vector3();
const routePoint = new Vector3();
const routeTangent = new Vector3();

// **Swept along the WHOLE loop, not only the crossings.** The reported 2.49 m
// at (-99.0, 138.1) on seed 11 is not at any crossing, so a crossing-only sweep
// cannot see it — and a probe that cannot reach the reported defect is not
// evidence about it either way.
//
// A and B are tracked INDEPENDENTLY. An earlier turn of this script required
// both rays to hit before counting a point, which silently discards exactly the
// points where the two disagree most — i.e. the evidence. That is this repo's
// "a check that cannot fail" in probe form.
let worstA = Infinity;
let worstAAt = '';
let worstB = Infinity;
let worstBAt = '';
let hitsA = 0;
let hitsB = 0;
let points = 0;
const STEP = 0.5;
for (let d = 0; d < route.length; d += STEP) {
  route.pointAt(d, routePoint);
  route.tangentAt(d, routeTangent);
  const nx = routeTangent.z;
  const nz = -routeTangent.x;
  for (const lateral of [-TRACK_CLEARANCE, 0, TRACK_CLEARANCE]) {
    // Denominator that means something: only points the bridges themselves
    // claim to stand over. Out of the whole loop, both counts would be
    // dominated by track nowhere near a bridge, and a hit rate against that
    // is not a number about bridges at all.
    const underABridge = train.bridges.some((b) =>
      b.deckCovers(routePoint.x + nx * lateral, routePoint.z + nz * lateral),
    );
    if (!underABridge) continue;
    points += 1;
    rayOrigin.set(routePoint.x + nx * lateral, routePoint.y + 0.02, routePoint.z + nz * lateral);
    const where = `(${rayOrigin.x.toFixed(1)}, ${rayOrigin.z.toFixed(1)}) r=${Math.hypot(rayOrigin.x, rayOrigin.z).toFixed(1)}`;

    raycaster.set(rayOrigin, worldUp);
    raycaster.far = TRAIN_CLEARANCE_Y + 6;
    const hitA = raycaster.intersectObject(target, true).find((c) => c.object.name !== 'deck');
    if (hitA) {
      hitsA += 1;
      const clearance = hitA.point.y - routePoint.y;
      if (clearance < worstA) {
        worstA = clearance;
        worstAAt = where;
      }
    }

    upAt(rayOrigin.x, rayOrigin.y, rayOrigin.z, localUp);
    raycaster.set(rayOrigin, localUp);
    raycaster.far = TRAIN_CLEARANCE_Y + 6;
    const hitB = raycaster.intersectObject(target, true).find((c) => c.object.name !== 'deck');
    if (hitB) {
      hitsB += 1;
      if (hitB.distance < worstB) {
        worstB = hitB.distance;
        worstBAt = where;
      }
    }
  }
}
console.log(
  `  ${points} track points stand under a bridge deck; of those, masonry was hit by ` +
    `A (world +Y ray) at ${hitsA} (${((100 * hitsA) / points).toFixed(0)}%), ` +
    `by B (local-up ray) at ${hitsB} (${((100 * hitsB) / points).toFixed(0)}%)`,
);
console.log(
  '  (a bridge that leaned with the ground would be hit by the LOCAL-UP ray from ' +
    'underneath it; one built flat is hit by the world +Y ray instead)',
);
console.log(
  `  A (world +Y, y-subtraction): worst ${worstA.toFixed(3)} m at ${worstAAt} — ` +
    `${worstA < TRAIN_CLEARANCE_Y ? 'SHORT of 3.900' : 'clears'}`,
);
console.log(
  `  B (local up, ray distance):  worst ${worstB.toFixed(3)} m at ${worstBAt} — ` +
    `${worstB < TRAIN_CLEARANCE_Y ? 'SHORT of 3.900' : 'clears'}`,
);
// CONTROL: B must be capable of reading SHORT. Re-sweep asking for a clearance
// the bridges certainly do not give (TRAIN_CLEARANCE_Y + 3), and confirm it
// then reports short. A probe that can only say "clears" says nothing.
console.log(
  `  control: against an impossible ${(TRAIN_CLEARANCE_Y + 3).toFixed(3)} m demand, B would read ` +
    `${worstB < TRAIN_CLEARANCE_Y + 3 ? 'SHORT (so B can say short)' : 'CLEARS -- B IS BROKEN'}`,
);
