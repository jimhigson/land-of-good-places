/**
 * **If the bridge shell leans, how far does it move in plan — and what stops
 * agreeing with it?**
 *
 * `placeOnSphere` preserves a height above the ground *in its own column*, but
 * it does not keep the column: it slides a point outward by `height·sin(tilt)`.
 * That is harmless for a ride, whose rider is placed by the same transform. A
 * bridge is different — a child walks on a `MovingPlatform` keyed by `(x, z)`
 * and is stopped by walls built from `planEdge`'s flat `(x, z)` pairs. If the
 * drawn stone moves and those do not, she walks on air beside the parapet, or
 * is stopped by nothing where the stone now is.
 *
 * This measures that shift against `PLAYER_RADIUS`, which is the scale at which
 * it stops being a rendering detail and becomes CLAUDE.md's "anything that
 * looks solid must be solid".
 */
import './headless-canvas.mjs';
import { Quaternion, Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const seed = process.env['LGP_SEED'] ?? 'default(canonical)';
const park = buildHeadlessPark();

const { GROUND_SPHERE_RADIUS, PLAYER_RADIUS } = await import('../src/core/constants.ts');
const { terrainHeight, placeOnSphere } = await import('../src/world/terrain.ts');
const { computeCrossings } = await import('../src/world/train/crossings.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');

const position = new Vector3();
const quaternion = new Quaternion();

console.log(
  `seed ${seed}: R=${GROUND_SPHERE_RADIUS}, PLAYER_RADIUS=${PLAYER_RADIUS.toFixed(2)} m`,
);
console.log('  crossing                r    tilt    deck height   plan shift of the DECK   of the PARAPET TOP');
for (const c of computeCrossings(TRAIN_PLAN.route)) {
  const bridge = park.world.train.bridges.find((b) => b.deckCovers(c.x, c.z));
  if (!bridge) continue;
  const ground = terrainHeight(c.x, c.z);
  const deck = bridge.heightAt(c.x, c.z);
  const deckHeight = deck - ground;
  // The parapet stands about a metre over the road; read the real one where we
  // can, and say so when we are assuming.
  const parapetHeight = deckHeight + 1.0;

  const shiftOf = (height: number): number => {
    placeOnSphere({ x: c.x, y: ground + height, z: c.z }, 0, position, quaternion);
    return Math.hypot(position.x - c.x, position.z - c.z);
  };

  const r = Math.hypot(c.x, c.z);
  const tilt = (Math.asin(Math.min(1, r / GROUND_SPHERE_RADIUS)) * 180) / Math.PI;
  const deckShift = shiftOf(deckHeight);
  const parapetShift = shiftOf(parapetHeight);
  console.log(
    `  (${c.x.toFixed(1)}, ${c.z.toFixed(1)})`.padEnd(24) +
      `${r.toFixed(1).padStart(6)} ${tilt.toFixed(1).padStart(5)}deg ` +
      `${deckHeight.toFixed(2).padStart(9)} m ` +
      `${deckShift.toFixed(3).padStart(16)} m ` +
      `${parapetShift.toFixed(3).padStart(16)} m` +
      `${parapetShift > PLAYER_RADIUS ? '   > PLAYER_RADIUS' : ''}`,
  );
}
