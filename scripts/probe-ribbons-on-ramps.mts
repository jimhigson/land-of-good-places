/**
 * **Does a DRAWN ribbon enter a proven bridge's ramp footprint that its own
 * CONTROL polyline stays out of?** (#414, defect A.)
 *
 * `paths.ts` screens lattice edges and branch points against
 * `pointStandsOnABridgeRamp`, so a leg's *control* points are kept off a
 * bridge's ground. What is finally drawn — and what a child walks, and what
 * `poiGraph` chains along — is the swept Catmull-Rom through those points,
 * which bows off the control polyline by metres on a bend.
 *
 * This asks the **real screen** (imported, never restated) about both, per
 * route, so "the swept curve bows into the ramp" and "the router let the leg
 * through" are distinguished by measurement rather than by reasoning.
 *
 * Not used by the game.
 * `LGP_SEED=5 node --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-ribbons-on-ramps.mts`
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { ROUTES, routeCurve } from '../src/world/pathGraph.ts';
import { pointStandsOnABridgeRamp } from '../src/world/paths.ts';
import { DECK_HALF_LENGTH } from '../src/world/train/clearance.ts';

buildHeadlessPark();
const route = TRAIN_PLAN.route;

console.log(`seed ${PARK_SEED}, loop ${route.length.toFixed(1)} m`);
console.log(
  `proven bridge sites: ${CROSSING_SITES.filter((s) => s.bridge)
    .map((s) => s.railDistance.toFixed(0))
    .join(',')}`,
);

/** The real screen at zero slack — the ground the bridge truly stands on. */
const onRamp = (x: number, z: number): boolean => pointStandsOnABridgeRamp(x, z, 0);

let drawnOnly = 0;
let both = 0;
for (const definition of ROUTES) {
  const control = definition.points;
  const controlHits = control.filter((p) => onRamp(p[0], p[1])).length;

  const curve = routeCurve(definition);
  const samples = Math.max(2, Math.ceil(curve.getLength() / 0.5));
  const drawn: { x: number; z: number }[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const p = curve.getPointAt(i / samples);
    if (onRamp(p.x, p.z)) drawn.push({ x: p.x, z: p.z });
  }
  if (drawn.length === 0) continue;

  // How far the drawn ribbon strays from its own control polyline where it
  // sits on a ramp — the number that says whether the bow is the mechanism.
  let worstStray = 0;
  for (const d of drawn) {
    let nearest = Infinity;
    for (let i = 1; i < control.length; i += 1) {
      const a = control[i - 1] as readonly [number, number];
      const b = control[i] as readonly [number, number];
      const vx = b[0] - a[0];
      const vz = b[1] - a[1];
      const len2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((d.x - a[0]) * vx + (d.z - a[1]) * vz) / len2));
      nearest = Math.min(nearest, Math.hypot(d.x - (a[0] + vx * t), d.z - (a[1] + vz * t)));
    }
    worstStray = Math.max(worstStray, nearest);
  }

  // Which site's ground, and does this route actually CROSS the rail there?
  // A crossing leg travels along the site axis and changes rail side; a
  // foreign leg does not, and is what must be kept off.
  const sites = new Set<string>();
  let crosses = false;
  for (const site of CROSSING_SITES) {
    if (!site.bridge) continue;
    let neg = false;
    let pos = false;
    let touches = false;
    for (const d of drawn) {
      const dx = d.x - site.x;
      const dz = d.z - site.z;
      if (Math.abs(-dx * site.dirZ + dz * site.dirX) > site.halfWidth) continue;
      // The site's OWN rectangle, along as well as across — otherwise a point
      // on a distant site's ramp still falls inside this one's infinite band.
      const along = dx * site.dirX + dz * site.dirZ;
      if (along > DECK_HALF_LENGTH + site.rampReachPos) continue;
      if (along < -(DECK_HALF_LENGTH + site.rampReachNeg)) continue;
      touches = true;
      if (along < 0) neg = true;
      if (along > 0) pos = true;
    }
    if (touches) {
      sites.add(`${site.railDistance.toFixed(0)}${neg && pos ? '(crosses)' : '(foreign)'}`);
      if (neg && pos) crosses = true;
    }
  }
  const verdict = `${controlHits === 0 ? 'DRAWN ONLY' : 'control too'} ${crosses ? '' : 'FOREIGN '}sites=[${[...sites].join(' ')}]`;
  if (controlHits === 0) drawnOnly += 1;
  else both += 1;
  const first = drawn[0] as { x: number; z: number };
  const last = drawn[drawn.length - 1] as { x: number; z: number };
  console.log(
    `  ${definition.name}: ${verdict} — ${drawn.length} drawn samples on a ramp ` +
      `(${controlHits} control points), from (${first.x.toFixed(1)}, ${first.z.toFixed(1)}) ` +
      `to (${last.x.toFixed(1)}, ${last.z.toFixed(1)}), ` +
      `worst stray from its own control polyline ${worstStray.toFixed(2)} m`,
  );
}
console.log(
  `\n${drawnOnly} route(s) enter a ramp ONLY when drawn; ${both} enter it as control points too.`,
);
