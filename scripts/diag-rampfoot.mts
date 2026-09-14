/**
 * Why is the downhill ramp twice as tall as BRIDGE_RISE?
 *
 * The crown is set from `worstGroundY + BRIDGE_RISE` — the HIGHEST ground under
 * the crown footprint — while the ramp has to come down to whatever the ground
 * is at its own foot. On sloping ground those are not the same number, and the
 * difference is the whole error.
 */
import './headless-canvas.mjs';
const seed = process.env['LGP_SEED'] ?? 'default(canonical)';
const { buildHeadlessPark } = await import('./park-harness.mts');
const park = buildHeadlessPark();
const { computeCrossings } = await import('../src/world/train/crossings.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const { BRIDGE_RISE } = await import('../src/world/train/clearance.ts');
const { MAX_RAMP_GRADIENT } = await import('../src/world/train/bridgeFootprint.ts');
const { terrainHeight } = await import('../src/world/terrain.ts');

console.log(`seed ${seed}: BRIDGE_RISE=${BRIDGE_RISE.toFixed(2)}, MAX_RAMP_GRADIENT=${MAX_RAMP_GRADIENT.toFixed(3)}, so the planner sizes a run of ${(BRIDGE_RISE/MAX_RAMP_GRADIENT).toFixed(2)} m`);
for (const c of computeCrossings(TRAIN_PLAN.route)) {
  const bridge = park.world.train.bridges.find((b) => b.deckCovers(c.x, c.z));
  if (!bridge) continue;
  const atCrossing = terrainHeight(c.x, c.z);
  const row = (along: number): string => {
    const x = c.x + c.pathDirX * along;
    const z = c.z + c.pathDirZ * along;
    return `${terrainHeight(x, z).toFixed(2)}`;
  };
  const drop = (along: number): number => {
    const x = c.x + c.pathDirX * along;
    const z = c.z + c.pathDirZ * along;
    return atCrossing - terrainHeight(x, z);
  };
  console.log(`\ncrossing (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) r=${Math.hypot(c.x,c.z).toFixed(1)}  terrain here ${atCrossing.toFixed(2)}`);
  console.log(`  terrain at -15/-10/-5/+5/+10/+15 along: ${row(-15)} ${row(-10)} ${row(-5)} ${row(5)} ${row(10)} ${row(15)}`);
  for (const along of [-15, 15] as const) {
    const need = BRIDGE_RISE + Math.max(0, drop(along));
    console.log(
      `  side ${along < 0 ? '-' : '+'}: ground falls ${drop(along).toFixed(2)} m over ${Math.abs(along)} m. ` +
        `True rise to clear = BRIDGE_RISE + fall = ${need.toFixed(2)} m, ` +
        `needing ${(need / MAX_RAMP_GRADIENT).toFixed(1)} m of run — the planner sized ${(BRIDGE_RISE/MAX_RAMP_GRADIENT).toFixed(1)} m`,
    );
  }
}
