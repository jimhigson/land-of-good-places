/**
 * Walk every DRAWN ribbon with `poiGraph`'s own clearance test and report
 * every stretch a child cannot walk, naming the collider that blocks it and
 * where it sits along the railway.
 *
 * The point of the instrument: a spur may be routed through a planned
 * crossing and still be severed, if the thing that seals it is not the
 * routing but the fence. This distinguishes the two without reasoning.
 *
 * Not used by the game.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { ROUTES, routeCurve, isOnPath } from '../src/world/pathGraph.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { NPC_RADIUS } from '../src/core/constants.ts';

const park = buildHeadlessPark();
const collision = park.world.collision;
const bridges = park.world.train.bridges;
const route = TRAIN_PLAN.route;

const PAVED_CLEARANCE = NPC_RADIUS - 0.02;
const CLEARANCE = 0.7;
const probe = new Vector3();
const clear = (x: number, z: number): boolean => {
  probe.set(x, bridgeHeightAt(bridges, x, z) ?? 0, z);
  collision.resolve(probe, isOnPath(x, z, 0) ? PAVED_CLEARANCE : CLEARANCE);
  return (probe.x - x) ** 2 + (probe.z - z) ** 2 < 1e-6;
};

const anyCollision = collision as unknown as {
  circles: { x: number; z: number; radius: number; topHeight: number }[];
  walls: { x1: number; z1: number; x2: number; z2: number; halfThickness: number; topHeight: number }[];
};
const blamed = (x: number, z: number, r: number): string => {
  const hits: string[] = [];
  for (const c of anyCollision.circles)
    if (Math.hypot(x - c.x, z - c.z) < c.radius + r)
      hits.push(`circle r=${c.radius.toFixed(1)} top=${c.topHeight.toFixed(1)}`);
  for (const w of anyCollision.walls) {
    const dx = w.x2 - w.x1;
    const dz = w.z2 - w.z1;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (z - w.z1) * dz) / l2));
    if (Math.hypot(x - (w.x1 + dx * t), z - (w.z1 + dz * t)) < w.halfThickness + r)
      hits.push(
        `wall len=${Math.hypot(dx, dz).toFixed(1)} halfT=${w.halfThickness.toFixed(2)} top=${w.topHeight.toFixed(1)}`,
      );
  }
  return hits.join(' + ') || '(nothing named)';
};

const at = new Vector3();
console.log(`seed ${PARK_SEED}, loop ${route.length.toFixed(1)} m`);
console.log(`bridge sites ${CROSSING_SITES.map((s) => s.railDistance.toFixed(0)).join(',')}`);

let totalBlocked = 0;
for (const definition of ROUTES) {
  const curve = routeCurve(definition);
  const length = curve.getLength();
  const steps = Math.max(2, Math.ceil(length / 0.5));
  let runStart: number | null = null;
  let worst: { x: number; z: number } | null = null;
  const flush = (end: number): void => {
    if (runStart === null || !worst) return;
    const d = route.distanceNear(worst.x, worst.z);
    route.pointAt(d, at);
    const gap = Math.hypot(worst.x - at.x, worst.z - at.z);
    const onPath = isOnPath(worst.x, worst.z, 0);
    console.log(
      `  ${definition.name}: BLOCKED ${(runStart * length / steps).toFixed(1)}-${(end * length / steps).toFixed(1)} m ` +
        `of ${length.toFixed(1)} — at (${worst.x.toFixed(1)}, ${worst.z.toFixed(1)}) railD ${d.toFixed(1)} ` +
        `railGap ${gap.toFixed(1)} onPath=${onPath} :: ${blamed(worst.x, worst.z, onPath ? PAVED_CLEARANCE : CLEARANCE)}`,
    );
    totalBlocked += 1;
    runStart = null;
    worst = null;
  };
  for (let i = 0; i <= steps; i += 1) {
    const p = curve.getPoint(i / steps);
    if (clear(p.x, p.z)) {
      flush(i);
    } else if (runStart === null) {
      runStart = i;
      worst = { x: p.x, z: p.z };
    }
  }
  flush(steps);
}
console.log(`\n${totalBlocked} blocked stretches across ${ROUTES.length} drawn ribbons`);
