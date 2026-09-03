import { Vector3 } from 'three';
import { PATH_GRAPH } from '../src/world/pathGraph.ts';
import { routeCurve, debugPointStandsOnBridgeMasonry } from '../src/world/paths.ts';

/** Masonry, as paths.ts screens it: the parapet band flanking deck and ramps.
 * Rebuilt here from the same public predicate so the probe cannot drift. */
const onRamp = (x: number, z: number): boolean => debugPointStandsOnBridgeMasonry(x, z);

let drawnHits = 0;
let controlHits = 0;
for (const edge of PATH_GRAPH.edges) {
  if (!edge.paved) continue;
  const control = edge.route.points;
  let controlOnRamp = 0;
  for (let i = 1; i < control.length; i += 1) {
    const a = control[i - 1] as readonly [number, number];
    const b = control[i] as readonly [number, number];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      if (onRamp(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) controlOnRamp += 1;
    }
  }
  const curve = routeCurve(edge.route);
  const n = Math.max(16, Math.ceil(curve.getLength() / 0.5));
  const p = new Vector3();
  let drawnOnRamp = 0;
  for (let i = 0; i <= n; i += 1) {
    curve.getPointAt(i / n, p);
    if (onRamp(p.x, p.z)) drawnOnRamp += 1;
  }
  if (drawnOnRamp > 0) drawnHits += 1;
  if (controlOnRamp > 0) controlHits += 1;
  if (drawnOnRamp > 0 || controlOnRamp > 0) {
    console.log(
      `${edge.route.name.padEnd(34)} control samples on ramp ${String(controlOnRamp).padStart(4)}  drawn ${String(drawnOnRamp).padStart(4)}`,
    );
  }
}
console.log(`routes touching a ramp: control ${controlHits}, drawn ${drawnHits}`);
