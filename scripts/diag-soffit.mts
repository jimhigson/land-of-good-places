/**
 * Diagnostic: is the low bridge soffit a flat-datum bug in the crown solve, or
 * a world-y-versus-radial-up bug?
 *
 * The two predict different numbers. If the crown were solved on a flat datum,
 * the shortfall would track the TERRAIN's own sag across the span — a local,
 * wave-sized number with no relation to where in the park the bridge stands.
 * If instead the deck is placed along world y while the train's clearance is
 * measured along the LOCAL up (radial, on a 220 m sphere), the reading is the
 * designed vertical clearance times cos(tilt), and the shortfall is a pure
 * function of distance from the park's centre.
 */
import './headless-canvas.mjs';

const { buildHeadlessPark } = await import('./park-harness.mts');
const seed = process.env['LGP_SEED'] ?? 'default(canonical)';
buildHeadlessPark();

const { GROUND_SPHERE_RADIUS } = await import('../src/core/constants.ts');
const { BRIDGE_RISE, TRAIN_CLEARANCE_Y } = await import('../src/world/train/clearance.ts');
const { terrainHeight } = await import('../src/world/terrain.ts');
const { computeCrossings } = await import('../src/world/train/crossings.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');

const need = TRAIN_CLEARANCE_Y;
console.log(
  `seed ${seed}: sphere R=${GROUND_SPHERE_RADIUS}, BRIDGE_RISE=${BRIDGE_RISE.toFixed(3)}, ` +
    `TRAIN_CLEARANCE_Y=${need.toFixed(3)}`,
);
console.log('crossing            r    tilt   cos    terrain sag over 24 m   need*cos (radial-up reading)');
for (const c of computeCrossings(TRAIN_PLAN.route)) {
  const r = Math.hypot(c.x, c.z);
  const tilt = Math.asin(Math.min(1, r / GROUND_SPHERE_RADIUS));
  const cos = Math.cos(tilt);
  const sag = Math.abs(
    terrainHeight(c.x, c.z) -
      (terrainHeight(c.x + 12, c.z) + terrainHeight(c.x - 12, c.z)) / 2,
  );
  console.log(
    `(${c.x.toFixed(1)}, ${c.z.toFixed(1)})`.padEnd(20) +
      `${r.toFixed(1).padStart(6)} ${((tilt * 180) / Math.PI).toFixed(1).padStart(5)}deg ` +
      `${cos.toFixed(4)} ${sag.toFixed(3).padStart(12)} m ${(need * cos).toFixed(3).padStart(18)} m`,
  );
}
