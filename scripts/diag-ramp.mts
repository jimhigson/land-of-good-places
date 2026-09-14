/**
 * The built walk-surface profile along a crossing's own centreline, sampled
 * exactly as the invariant samples it, so a grade of 0.869 can be seen rather
 * than inferred. Prints per-sample height, the step to the previous sample, and
 * how far the surface stands over bare terrain.
 */
import './headless-canvas.mjs';
const seed = process.env['LGP_SEED'] ?? 'default(canonical)';
const { buildHeadlessPark } = await import('./park-harness.mts');
const park = buildHeadlessPark();
const { computeCrossings } = await import('../src/world/train/crossings.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const { MAX_RAMP_GRADIENT, DECK_HALF_LENGTH } = await import('../src/world/train/bridgeFootprint.ts');
const { BUILDING_STEP_UP } = await import('../src/core/constants.ts');

console.log(`seed ${seed}: MAX_RAMP_GRADIENT=${MAX_RAMP_GRADIENT.toFixed(3)}, DECK_HALF_LENGTH=${DECK_HALF_LENGTH.toFixed(2)}, BUILDING_STEP_UP=${BUILDING_STEP_UP.toFixed(2)}`);
const STEP = 0.25;
for (const c of computeCrossings(TRAIN_PLAN.route)) {
  const bridge = park.world.train.bridges.find((b) => b.deckCovers(c.x, c.z));
  console.log(`\ncrossing (${c.x.toFixed(1)}, ${c.z.toFixed(1)})${bridge ? '' : ' — no bridge'}`);
  if (!bridge) continue;
  let previous: number | null = null;
  const rows: string[] = [];
  let worstStep = 0;
  let worstAt = 0;
  for (let along = -20; along <= 20 + 1e-6; along += STEP) {
    const x = c.x + c.pathDirX * along;
    const z = c.z + c.pathDirZ * along;
    const h = park.sample(x, z, 40);
    const terrain = park.world.building.surfaces.sample(x, z, -1e6);
    const step = previous === null ? 0 : h - previous;
    if (Math.abs(step) > Math.abs(worstStep)) { worstStep = step; worstAt = along; }
    rows.push(
      `  ${along.toFixed(2).padStart(6)}  h=${h.toFixed(3).padStart(7)}  step=${step.toFixed(3).padStart(7)}  ` +
        `grade=${(step / STEP).toFixed(2).padStart(6)}  over-terrain=${(h - terrain).toFixed(2).padStart(6)}` +
        `${Math.abs(step / STEP) > MAX_RAMP_GRADIENT * 1.5 ? '   <-- STEEP' : ''}`,
    );
    previous = h;
  }
  // Ramp anatomy: find the foot (surface meets terrain) and the crown on each
  // side, and report mean grade, peak grade and the ratio between them --
  // which is what HUMP_BLEND claims to be 1.333.
  const prof: { along: number; h: number; over: number }[] = [];
  for (let along = -20; along <= 20 + 1e-6; along += STEP) {
    const x = c.x + c.pathDirX * along;
    const z = c.z + c.pathDirZ * along;
    const h = park.sample(x, z, 40);
    const terrain = park.world.building.surfaces.sample(x, z, -1e6);
    prof.push({ along, h, over: h - terrain });
  }
  const crown = prof.reduce((a, b) => (b.over > a.over ? b : a));
  for (const side of [-1, 1] as const) {
    const arm = prof.filter((r) => (r.along - crown.along) * side > 0).sort((a, b) => (a.along - b.along) * side);
    const foot = arm.find((r) => r.over <= 0.05);
    if (!foot) { console.log(`  side ${side}: no foot within 20 m -- ramp runs past the sample window`); continue; }
    const run = Math.abs(foot.along - crown.along);
    const rise = crown.h - foot.h;
    let peak = 0;
    let peakAt = 0;
    const armToFoot = arm.filter((r) => Math.abs(r.along - crown.along) <= run);
    for (let i = 1; i < armToFoot.length; i += 1) {
      const g = Math.abs((armToFoot[i]!.h - armToFoot[i - 1]!.h) / STEP);
      if (g > peak) { peak = g; peakAt = armToFoot[i]!.along; }
    }
    const mean = run > 0 ? rise / run : 0;
    console.log(
      `  side ${side > 0 ? '+' : '-'}: run ${run.toFixed(2)} m, rise ${rise.toFixed(2)} m, ` +
        `mean grade ${mean.toFixed(3)} (budget ${MAX_RAMP_GRADIENT.toFixed(3)})${mean > MAX_RAMP_GRADIENT ? ' OVER' : ' ok'}, ` +
        `peak ${peak.toFixed(3)} at ${peakAt.toFixed(1)} (budget 0.512)${peak > 0.512 ? ' OVER' : ' ok'}, ` +
        `peak/mean ${(peak / (mean || 1)).toFixed(2)} (HUMP_BLEND claims 1.33)`,
    );
  }
}
