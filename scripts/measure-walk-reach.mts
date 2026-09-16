/**
 * **Does the sampler's step-up reach agree with the planet? (#643)**
 *
 * `WalkSurfaces.sample(x, z, y)` refuses any surface more than
 * `BUILDING_STEP_UP` above the reference it is asked from. The question this
 * measures is *which way* that 0.62 m is counted — up the world `y` axis, or
 * along the local up (away from the planet's centre) — and whether the
 * difference ever decides a real stride on the real park.
 *
 * ```
 * node --import ./scripts/ts-extension-resolver-register.mjs scripts/measure-walk-reach.mts
 * ```
 *
 * It drives the shared `SimPlayer` (the same copy of `Player.update` the
 * deck-fallthrough harness uses) at a sprint, at every frame rate that harness
 * sweeps and 16 start phases, across every bridge, every station platform and
 * the castle's facade steps, on 16 bearings each. Every sub-step's ground
 * sample is intercepted and judged twice:
 *
 * - **world demand**: `surface.y - reference.y`, what the shipped reach counts;
 * - **radial demand**: the surface point's distance from the planet's centre
 *   minus the distance of **the foot she is actually standing on** (her
 *   previous sub-step's column and height) — the rise along her own up, which
 *   is the frame #641's grade clause measures in.
 *
 * A stride is a *continuous climb* when its radial demand is inside
 * `BUILDING_STEP_UP` — an honest foot would take it. The harness reports every
 * stride the two measures disagree on, and the margin left on each.
 *
 * Only outdoors: indoors up is `+Y` and the two measures are identical.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { CollisionWorld } from '../src/world/Collision.ts';
import { circleBoundary } from '../src/world/boundary.ts';
import { SimPlayer } from './playerSim.mts';
import {
  BUILDING_STEP_UP,
  GROUND_SPHERE_RADIUS,
  MAX_FRAME_DELTA,
} from '../src/core/constants.ts';
import {
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  ENTRANCE_RAMP,
} from '../src/world/building/layout.ts';
import { isOutdoors } from '../src/world/up.ts';

const R = GROUND_SPHERE_RADIUS;
const radiusOf = (x: number, y: number, z: number): number => Math.hypot(x, y + R, z);

const { world } = quietly(() => buildHeadlessPark());
const surfaces = world.building.surfaces;

const DELTAS = [MAX_FRAME_DELTA, 1 / 15, 1 / 20, 1 / 30, 1 / 60];
const PHASES = Array.from({ length: 16 }, (_, i) => i / 16);
const BEARINGS = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);
const HALF_RUN = 16;

interface Site {
  readonly label: string;
  readonly x: number;
  readonly z: number;
}

const sites: Site[] = [];
for (const c of world.train.crossings) {
  if (world.train.bridges.some((b) => b.deckCovers(c.x, c.z))) {
    sites.push({ label: `bridge @(${c.x.toFixed(1)}, ${c.z.toFixed(1)})`, x: c.x, z: c.z });
  }
}
for (const s of world.train.stationTapAreas()) {
  sites.push({ label: `station @(${s.x.toFixed(1)}, ${s.z.toFixed(1)})`, x: s.x, z: s.z });
}
{
  const fp = ENTRANCE_RAMP.footprint;
  const x = BUILDING_CENTRE_X + (fp.minX + fp.maxX) / 2;
  const z = BUILDING_CENTRE_Z + (fp.minZ + fp.maxZ) / 2;
  sites.push({ label: `facade steps @(${x.toFixed(1)}, ${z.toFixed(1)})`, x, z });
}

function collisionWorld(): CollisionWorld {
  const collision = new CollisionWorld();
  collision.setPlayBounds(circleBoundary(4000));
  // Same reason as measure-deck-fallthrough: the park's thinnest collider sets
  // the sub-step length, far from any march.
  collision.addWall(2000, -50, 2000, 50, 0.18, 1, false);
  return collision;
}

interface Tally {
  /** Sub-steps climbing a continuous surface (a ramp, a hump, a hillside). */
  ramps: number;
  worstRampWorld: number;
  worstRampRadial: number;
  continuous: number;
  worstWorld: number;
  worstRadial: number;
  /** Continuous climbs the world-`y` reach refused: a child falling through. */
  wrongRefusals: number;
  /** Radial-refused steps the world-`y` reach admitted: climbing a riser. */
  wrongAdmissions: number;
  firstWrong: string | null;
}

const report: { site: Site; lean: number; tally: Tally }[] = [];

for (const site of sites) {
  if (!isOutdoors(site.x, site.z)) continue;
  const tally: Tally = {
    ramps: 0,
    worstRampWorld: -Infinity,
    worstRampRadial: -Infinity,
    continuous: 0,
    worstWorld: -Infinity,
    worstRadial: -Infinity,
    wrongRefusals: 0,
    wrongAdmissions: 0,
    firstWrong: null,
  };
  for (const bearing of BEARINGS) {
    const dx = Math.sin(bearing);
    const dz = Math.cos(bearing);
    for (const delta of DELTAS) {
      for (const phase of PHASES) {
        let last: { x: number; z: number; y: number } | null = null;
        const ground = (x: number, z: number, y: number): number => {
          const answer = surfaces.sample(x, z, y);
          // The highest thing there, whatever the reach: the surface she would
          // be on if nothing refused it.
          const top = surfaces.sample(x, z, 1e6);
          if (last !== null && Math.abs(y - last.y) < 1e-9 && top > y + 1e-6) {
            const worldDemand = top - y;
            const radialDemand = radiusOf(x, top, z) - radiusOf(last.x, last.y, last.z);
            const honest = radialDemand <= BUILDING_STEP_UP;
            const shipped = worldDemand <= BUILDING_STEP_UP;
            // A ramp or a riser? Walk the segment in eight pieces and look for a
            // jump in the highest surface's radius: a riser is one piece holding
            // the whole climb, a ramp spreads it.
            let biggestJump = 0;
            let prevR = radiusOf(last.x, surfaces.sample(last.x, last.z, 1e6), last.z);
            for (let k = 1; k <= 8; k += 1) {
              const px = last.x + ((x - last.x) * k) / 8;
              const pz = last.z + ((z - last.z) * k) / 8;
              const r = radiusOf(px, surfaces.sample(px, pz, 1e6), pz);
              biggestJump = Math.max(biggestJump, r - prevR);
              prevR = r;
            }
            if (biggestJump < 0.1 && Math.abs(radiusOf(last.x, last.y, last.z) - radiusOf(last.x, surfaces.sample(last.x, last.z, 1e6), last.z)) < 1e-6) {
              tally.ramps += 1;
              tally.worstRampWorld = Math.max(tally.worstRampWorld, worldDemand);
              tally.worstRampRadial = Math.max(tally.worstRampRadial, radialDemand);
            }
            if (honest) {
              tally.continuous += 1;
              tally.worstWorld = Math.max(tally.worstWorld, worldDemand);
              tally.worstRadial = Math.max(tally.worstRadial, radialDemand);
            }
            if (honest !== shipped) {
              if (honest) tally.wrongRefusals += 1;
              else tally.wrongAdmissions += 1;
              tally.firstWrong ??=
                `at (${x.toFixed(2)}, ${z.toFixed(2)}), ${(1 / delta).toFixed(0)} fps: ` +
                `surface y=${top.toFixed(3)}, reference y=${y.toFixed(3)} — world demand ` +
                `${worldDemand.toFixed(3)}, radial demand ${radialDemand.toFixed(3)}`;
            }
          }
          last = { x, z, y: answer };
          return answer;
        };
        const player = new SimPlayer(collisionWorld(), { ground });
        const offset = phase * 0.925;
        player.placeOnGround(site.x - dx * (HALF_RUN + offset), site.z - dz * (HALF_RUN + offset));
        last = null;
        const frames = Math.ceil((2 * HALF_RUN) / (5.5 * delta));
        for (let f = 0; f < frames; f += 1) {
          player.step(delta, dx, dz, true);
          last = { x: player.position.x, z: player.position.z, y: player.groundHeight };
        }
      }
    }
  }
  const lean = (Math.asin(Math.min(1, Math.hypot(site.x, site.z) / R)) * 180) / Math.PI;
  report.push({ site, lean, tally });
}

console.log('\nWalk reach, world-y against radial, on the real park (#643)\n');
console.log('  site                                   r(m)  lean   ramp steps  worst ramp world/radial   climbs  worst world  worst radial  refused  admitted');
let refusals = 0;
let admissions = 0;
let worstWorld = -Infinity;
let worstRadial = -Infinity;
for (const { site, lean, tally } of report) {
  refusals += tally.wrongRefusals;
  admissions += tally.wrongAdmissions;
  worstWorld = Math.max(worstWorld, tally.worstWorld);
  worstRadial = Math.max(worstRadial, tally.worstRadial);
  console.log(
    `  ${site.label.padEnd(38)} ${Math.hypot(site.x, site.z).toFixed(1).padStart(5)} ` +
      `${lean.toFixed(1).padStart(5)} ${String(tally.ramps).padStart(12)} ` +
      `${tally.worstRampWorld.toFixed(3).padStart(12)}/${tally.worstRampRadial.toFixed(3).padEnd(12)} ` +
      `${String(tally.continuous).padStart(7)} ` +
      `${tally.worstWorld.toFixed(3).padStart(12)} ${tally.worstRadial.toFixed(3).padStart(13)} ` +
      `${String(tally.wrongRefusals).padStart(8)} ${String(tally.wrongAdmissions).padStart(9)}`,
  );
  if (tally.firstWrong) console.log(`      first disagreement: ${tally.firstWrong}`);
}
console.log(
  `\n  worst world demand ${worstWorld.toFixed(3)} (margin ${(BUILDING_STEP_UP - worstWorld).toFixed(3)} m), ` +
    `worst radial demand ${worstRadial.toFixed(3)} (margin ${(BUILDING_STEP_UP - worstRadial).toFixed(3)} m)`,
);
console.log(`  continuous climbs the world-y reach refused: ${refusals}`);
console.log(`  radial-refused steps the world-y reach admitted: ${admissions}\n`);

void Vector3;
