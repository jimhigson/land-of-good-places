/**
 * **Can a child be sent into the fountain, and can she get out, and is she
 * left alone when she is only walking past?** Measured on one built park.
 *
 * The one owner of the question. `test/procgen`'s `aTapOnTheFountainWadesIn`
 * asks it of every supported park, on the park that suite has already built,
 * and `scripts/check-fountain-hop.mts` asks it of whatever park its process
 * builds. The script's header has the full account of the four mechanisms this
 * guards and how each was proved red.
 *
 * It returns every clause with its verdict, so a passing run can still say
 * what it measured (the numbers are in the text of each clause).
 */
import type { CollisionWorld } from './Collision';
import { MAX_AUTO_HOP_HEIGHT, autoHopClears } from './Collision';
import type { Fountain } from './Fountain';
import { MAX_ROUTE_WAYPOINTS, NavGrid } from './NavGrid';
import { PLAYER_RADIUS } from '../core/constants';
import { JUMP_APEX_HEIGHT } from '../entities/Player';

export interface FountainHopClause {
  readonly ok: boolean;
  readonly what: string;
}

export function measureFountainHop(
  fountain: Fountain,
  collision: CollisionWorld,
  /** The ground as the player's own sampler answers it (`HeadlessPark.sample`). */
  parkSample: (x: number, z: number, y: number) => number,
): FountainHopClause[] {
  const clauses: FountainHopClause[] = [];
  const check = (ok: boolean, what: string): void => {
    clauses.push({ ok, what });
  };

  const sample = (x: number, z: number, y: number): number => fountain.groundLevel(x, z, parkSample(x, z, y));
  const navGrid = new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT);
  const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

  const centreX = fountain.centre.x;
  const centreZ = fountain.centre.z;
  const waterRadius = fountain.rimRadius - 0.3;

  interface Route {
    reached: boolean;
    endY: number;
    /** How near the fountain's centre the walk ever passes. */
    closest: number;
  }

  const plan = (ax: number, az: number, bx: number, bz: number): Route => {
    const count = navGrid.findRoute(ax, az, sample(ax, az, 500), bx, bz, sample(bx, bz, 500), sample, out);
    let closest = Math.hypot(ax - centreX, az - centreZ);
    let px = ax;
    let pz = az;
    for (let i = 0; i < count; i += 1) {
      const x = out[i * 2] ?? 0;
      const z = out[i * 2 + 1] ?? 0;
      // Sampled along each leg, not just at its ends: a straight line between
      // two points outside the rim can still pass straight through the water.
      const steps = Math.max(1, Math.ceil(Math.hypot(x - px, z - pz) / 0.25));
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        closest = Math.min(closest, Math.hypot(px + (x - px) * t - centreX, pz + (z - pz) * t - centreZ));
      }
      px = x;
      pz = z;
    }
    return { reached: navGrid.lastRouteReachedGoal, endY: navGrid.lastRouteEndY, closest };
  };

  // ------------------------------------------------- 1. the flag is not inert

  let rimSegments = 0;
  let rimHoppable = 0;
  let tallestRimTop = 0;
  collision.forEachWall((x1, z1, x2, z2, _half, topHeight, autoHoppable) => {
    // The rim by its geometry rather than by a count typed in here: both ends
    // of a rim segment stand on the rim circle, at the fountain's own radius.
    const onRim = (x: number, z: number): boolean => Math.abs(Math.hypot(x - centreX, z - centreZ) - fountain.rimRadius) < 0.05;
    if (!onRim(x1, z1) || !onRim(x2, z2)) return;
    rimSegments += 1;
    tallestRimTop = Math.max(tallestRimTop, topHeight);
    if (autoHoppable && autoHopClears(topHeight, JUMP_APEX_HEIGHT)) rimHoppable += 1;
  });
  check(rimSegments > 0, `the fountain rim is registered as walls (${rimSegments} segments)`);
  check(
    rimHoppable === rimSegments,
    `every rim segment is hoppable, and the hop predicate agrees ` +
      `(${rimHoppable}/${rimSegments}; tallest top ${tallestRimTop.toFixed(2)} m against ` +
      `MAX_AUTO_HOP_HEIGHT ${MAX_AUTO_HOP_HEIGHT.toFixed(2)} m)`,
  );

  // ------------------------------------------- 2. a tap on the water gets there

  const outsideX = centreX;
  const outsideZ = centreZ + fountain.rimRadius + 4;
  const inbound = plan(outsideX, outsideZ, centreX, centreZ);
  check(inbound.reached, `a tap on the water routes into it rather than stopping at the rim (reached=${inbound.reached})`);
  const wading = sample(centreX, centreZ, 500);
  check(
    Math.abs(inbound.endY - wading) < 0.01,
    `and the route ends on the wading surface, not on the paving outside ` +
      `(ends at ${inbound.endY.toFixed(3)} m, water ${wading.toFixed(3)} m)`,
  );

  // ------------------------------- 2b. anywhere on the water, at its own height
  // (See scripts/check-fountain-hop.mts for why one centre tap is luck: the
  // wading surface is tilted, and the route must end at the water under the
  // tap itself, at every phase of the 0.5 m lattice.)
  let worstGap = 0;
  let worstWhere = '';
  let unreached = 0;
  let goals = 0;
  for (const ring of [0.4, 1.3, 2.2, 3.1]) {
    const around = ring < 1 ? 7 : 13;
    for (let k = 0; k < around; k += 1) {
      const bearing = (k / around) * Math.PI * 2 + ring;
      const gx = centreX + Math.cos(bearing) * ring;
      const gz = centreZ + Math.sin(bearing) * ring;
      goals += 1;
      const route = plan(outsideX, outsideZ, gx, gz);
      if (!route.reached) {
        unreached += 1;
        continue;
      }
      const gap = Math.abs(route.endY - sample(gx, gz, 500));
      if (gap > worstGap) {
        worstGap = gap;
        worstWhere = `(${gx.toFixed(2)}, ${gz.toFixed(2)})`;
      }
    }
  }
  check(unreached === 0, `every tap across the basin is reached (${goals - unreached}/${goals})`);
  check(
    worstGap < 0.01,
    `and every one ends at the height of the water under the tap itself ` +
      `(worst gap ${(worstGap * 1000).toFixed(1)} mm at ${worstWhere || '-'}, over ${goals} taps)`,
  );

  // --------------------------------------------- 3. and she can get out again

  const outbound = plan(centreX, centreZ, outsideX, outsideZ);
  check(
    outbound.reached,
    `a child standing in the water can be routed back out of it — the basin is not a trap (reached=${outbound.reached})`,
  );

  // ----------------------------------- 4. but walking past is left well alone
  // Straight across the plaza, the fountain squarely in the way. Going round
  // is a few metres; cutting through the water would be shorter, and the whole
  // point of the penalty is that she does not.
  const across = plan(centreX, centreZ + fountain.rimRadius + 4, centreX, centreZ - fountain.rimRadius - 4);
  check(
    across.closest > waterRadius,
    `walking past the fountain keeps out of the water rather than paddling through it ` +
      `(closest approach ${across.closest.toFixed(2)} m, water edge ${waterRadius.toFixed(2)} m)`,
  );

  return clauses;
}
