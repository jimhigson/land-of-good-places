/**
 * The clump, measured: per proven bridge, how much ribbon is laid inside its
 * footprint zone, and how far any route walks BACKWARDS along the bridge's
 * axis before crossing it.
 *
 * Method: sample the drawn ribbon, keep the samples inside the zone, project
 * onto the bridge axis, and decompose that 1-D signal into maximal monotone
 * runs with a hysteresis so 0.5 m of Catmull-Rom wobble is not a reversal.
 * The clump is a run that goes one way and a following run that comes back.
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { ROUTES, routeCurve } from '../src/world/pathGraph.ts';
import { DECK_HALF_LENGTH } from '../src/world/train/clearance.ts';

const park = buildHeadlessPark();
const built = park.world.train.bridges;
const isBuilt = (s: { x: number; z: number }): boolean =>
  built.some((b) => b.pavingHeightAt(s.x, s.z) !== null);

const HYSTERESIS = 0.6;

/** Maximal monotone runs of a 1-D signal, as signed lengths. */
function runs(signal: readonly number[]): number[] {
  const out: number[] = [];
  let anchor = signal[0];
  let dir = 0;
  if (anchor === undefined) return out;
  let peak = anchor;
  for (const v of signal) {
    if (dir === 0) {
      if (Math.abs(v - anchor) > HYSTERESIS) { dir = Math.sign(v - anchor); peak = v; }
      continue;
    }
    if (Math.sign(v - peak) === dir) { peak = v; continue; }
    if (Math.abs(v - peak) > HYSTERESIS) { out.push(peak - anchor); anchor = peak; dir = Math.sign(v - peak); peak = v; }
  }
  if (dir !== 0) out.push(peak - anchor);
  return out;
}

console.log(`seed ${PARK_SEED}`);
let worstBack = 0, worstWhere = '';
let totalZone = 0;
for (const site of CROSSING_SITES) {
  if (!site.bridge) continue;
  const alongMax = DECK_HALF_LENGTH + site.rampReachPos;
  const alongMin = -(DECK_HALF_LENGTH + site.rampReachNeg);
  const ZONE = 6;
  const isb = isBuilt(site);
  let zoneMetres = 0;
  const lines: string[] = [];
  for (const def of ROUTES) {
    const curve = routeCurve(def);
    const total = curve.getLength();
    const n = Math.max(2, Math.ceil(total / 0.5));
    const step = total / n;
    // One route may enter the zone more than once; each visit is its own signal.
    const visits: number[][] = [];
    let current: number[] = [];
    let inZone = 0;
    for (let i = 0; i <= n; i += 1) {
      const p = curve.getPointAt(i / n);
      const dx = p.x - site.x, dz = p.z - site.z;
      const across = -dx * site.dirZ + dz * site.dirX;
      const along = dx * site.dirX + dz * site.dirZ;
      const inside = Math.abs(across) <= site.halfWidth + ZONE &&
        along <= alongMax + ZONE && along >= alongMin - ZONE;
      if (!inside) { if (current.length) { visits.push(current); current = []; } continue; }
      inZone += step;
      current.push(along);
    }
    if (current.length) visits.push(current);
    zoneMetres += inZone;
    if (inZone < 1) continue;
    // The backtrack: within one visit, the largest run opposing the visit's
    // own net direction.
    let back = 0;
    for (const v of visits) {
      const r = runs(v);
      const net = Math.sign((v[v.length - 1] as number) - (v[0] as number));
      for (const run of r) if (net !== 0 && Math.sign(run) !== net) back = Math.max(back, Math.abs(run));
    }
    lines.push(`      ${def.name.padEnd(30)} ${inZone.toFixed(1).padStart(6)} m in zone, walks back ${back.toFixed(1).padStart(5)} m along the axis`);
    if (isb && back > worstBack) { worstBack = back; worstWhere = `${def.name} at railD ${site.railDistance.toFixed(0)}`; }
  }
  if (isb) totalZone += zoneMetres;
  console.log(`  site railD ${site.railDistance.toFixed(0).padStart(4)} (${site.x.toFixed(1)},${site.z.toFixed(1)}) ${isb ? 'BUILT ' : 'unbuilt'} — ${zoneMetres.toFixed(1)} m of ribbon in its zone`);
  for (const l of lines) console.log(l);
}
console.log(`  TOTAL ribbon in built bridges' zones: ${totalZone.toFixed(1)} m`);
console.log(`  WORST backtrack at a built bridge: ${worstBack.toFixed(1)} m (${worstWhere})`);
