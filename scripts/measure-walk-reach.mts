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
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { CollisionWorld } from '../src/world/Collision.ts';
import { circleBoundary } from '../src/world/boundary.ts';
import { SimPlayer } from './playerSim.mts';
import {
  BUILDING_STEP_UP,
  GROUND_SPHERE_RADIUS,
  MAX_FRAME_DELTA,
  SPRINT_PEAK_GRADE_BUDGET,
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
const surfacesModule: Record<string, unknown> = await import('../src/world/building/surfaces.ts');
/** The tree's own reference carry, where it has one (it does not before #643). */
const carryReferenceIfAny = (fx: number, fz: number, y: number, tx: number, tz: number): number =>
  typeof surfacesModule['carryReference'] === 'function'
    ? (surfacesModule['carryReference'] as (a: number, b: number, c: number, d: number, e: number) => number)(fx, fz, y, tx, tz)
    : y;
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
  /** Honest climbs (radial rise within a step) the sampler refused. */
  wrongRefusals: number;
  /** Radially too-tall steps the sampler admitted. */
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
          // Only strides where she is following the surface she stood on — asked
          // from that height, either as-is (a world-y reach) or carried to this
          // column at the same radius (the radial one), whichever the tree has.
          const following =
            last !== null &&
            (Math.abs(y - last.y) < 1e-9 ||
              Math.abs(y - carryReferenceIfAny(last.x, last.z, last.y, x, z)) < 1e-9);
          // The bare ground is offered unconditionally — a hillside is never
          // "out of reach" — so a climb onto it is not the reach's decision.
          const builtTop = top > surfaces.sample(x, z, -1e6) + 1e-6;
          if (last !== null && following && builtTop && top > y + 1e-6) {
            const worldDemand = top - last.y;
            const radialDemand = radiusOf(x, top, z) - radiusOf(last.x, last.y, last.z);
            const honest = radialDemand <= BUILDING_STEP_UP;
            // What this tree's sampler actually did with it.
            const shipped = answer >= top - 1e-6;
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
                `surface y=${top.toFixed(3)}, standing y=${last.y.toFixed(3)} — world demand ` +
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
console.log(`  honest climbs (radial rise <= BUILDING_STEP_UP) the sampler refused: ${refusals}`);
console.log(`  radially over-tall steps the sampler admitted: ${admissions}\n`);

// --- the same physics, on a ramp far from the park's centre -----------------
// No ramp on this park stands further out than ~53 m, so the real-park table
// above cannot say what happens where the lean is large. This builds one: a
// deck whose **local** grade is exactly `g` (its distance from the planet's
// centre rises `g` metres per metre of ground), `DECK_LIFT` over the sphere,
// laid along the -x axis and climbing towards the park, registered with a real
// `WalkSurfaces`, and sprinted up and down by the same `SimPlayer`.

const DECK_LIFT = 6;
const DECK_LENGTH = 20;
const DECK_HALF_WIDTH = 3;
const SYNTH_GRADES = [0.1, 0.2, 0.3, 0.357, 0.4, 0.5, 0.512, 0.6, 0.67, 0.8, 1.0, 1.2, 1.4, 1.6];
const SYNTH_RADII = [0, 30, 60, 94, 117, 140];

/** The ramp's radius at arc-angle `phi`, rising towards the park. */
function deckRadius(far: number, grade: number, phi: number): number {
  const phiFar = far / R;
  const climbed = Math.min(Math.max((phiFar - phi) * R, 0), DECK_LENGTH);
  return R + DECK_LIFT + grade * climbed;
}

/** World `y` of that deck over plan point `(x, z)` — solved, since phi depends on it. */
function deckY(far: number, grade: number, x: number, z: number): number {
  const rho = Math.hypot(x, z);
  let radius = deckRadius(far, grade, rho / R);
  for (let i = 0; i < 80; i += 1) radius = deckRadius(far, grade, Math.asin(Math.min(1, rho / radius)));
  return Math.sqrt(Math.max(0, radius * radius - rho * rho)) - R;
}

function syntheticLosses(far: number, grade: number, inward: boolean): { lost: number; runs: number; first: string | null } {
  const { WalkSurfaces } = walkSurfacesModule;
  // Plan extent of the deck: from the far end inwards by DECK_LENGTH of arc.
  const xFar = -R * Math.sin((far / R));
  const xNear = -R * Math.sin(((far - DECK_LENGTH) / R));
  const covers = (x: number, z: number): boolean => Math.abs(z) <= DECK_HALF_WIDTH && x >= Math.min(xFar, xNear) && x <= Math.max(xFar, xNear);
  const walk = new WalkSurfaces();
  walk.addPlatform({ surfaceY: 0, covers, surfaceYAt: (x, z) => deckY(far, grade, x, z) });
  let lost = 0;
  let runs = 0;
  let first: string | null = null;
  for (const delta of DELTAS) {
    for (const phase of PHASES) {
      runs += 1;
      const player = new SimPlayer(collisionWorld(), { ground: (x, z, y) => walk.sample(x, z, y) });
      const offset = phase * 0.925 + 0.05;
      const startX = inward ? Math.min(xFar, xNear) + offset : Math.max(xFar, xNear) - offset;
      player.placeOnGround(startX, 0);
      const dir = inward ? 1 : -1;
      const frames = Math.ceil((DECK_LENGTH * 1.2) / (5.5 * delta));
      for (let f = 0; f < frames; f += 1) {
        player.step(delta, dir, 0, true);
        const { x, z } = player.position;
        if (!covers(x, z)) break;
        const deck = deckY(far, grade, x, z);
        if (deck - player.groundY > 0.05) {
          lost += 1;
          first ??=
            `r=${far} local grade ${grade} ${inward ? 'up (towards the park)' : 'down'} at ${(1 / delta).toFixed(0)} fps: ` +
            `deck y=${deck.toFixed(3)}, sampler gave ${player.groundY.toFixed(3)} at x=${x.toFixed(2)} — she falls ${(deck - player.groundY).toFixed(2)} m`;
          break;
        }
      }
    }
  }
  return { lost, runs, first };
}

const walkSurfacesModule = await import('../src/world/building/surfaces.ts');

console.log('  A deck of known LOCAL grade, sprinted up towards the park, far from its centre:\n');
console.log('    r(m)  lean   steepest local grade with no fall-through (up / down)');
const firstFalls: string[] = [];
const synthCeilings = new Map<number, number>();
for (const far of SYNTH_RADII) {
  const ceilingFor = (inward: boolean): number => {
    let best = 0;
    for (const g of SYNTH_GRADES) {
      const out = syntheticLosses(Math.max(far, DECK_LENGTH), g, inward);
      if (out.lost > 0) {
        if (out.first) firstFalls.push(out.first);
        break;
      }
      best = g;
    }
    return best;
  };
  const up = ceilingFor(true);
  const down = ceilingFor(false);
  synthCeilings.set(far, up);
  const lean = (Math.asin(Math.max(far, DECK_LENGTH) / R) * 180) / Math.PI;
  console.log(`    ${String(Math.max(far, DECK_LENGTH)).padStart(4)} ${lean.toFixed(1).padStart(5)}   ${up.toFixed(3)} / ${down.toFixed(3)}`);
}
if (firstFalls.length) console.log(`\n    first fall-through at each radius:\n      ${firstFalls.join('\n      ')}`);
console.log();

// --- verdicts -----------------------------------------------------------------
const failures: string[] = [];
for (const { site, tally } of report) {
  // A site the marches never climbed onto measured nothing; say so loudly
  // rather than counting its zeros as agreement.
  if (tally.continuous === 0) failures.push(`VOID: no climb onto ${site.label} was measured at all`);
}
if (refusals > 0) failures.push(`${refusals} honest climb(s) (radial rise within BUILDING_STEP_UP) were refused by the sampler`);
if (admissions > 0) failures.push(`${admissions} radially over-tall step(s) were admitted by the sampler`);
for (const [far, up] of synthCeilings) {
  if (up < SPRINT_PEAK_GRADE_BUDGET) {
    failures.push(
      `at r=${Math.max(far, DECK_LENGTH)} m a sprinting child falls through a ramp of local grade ` +
        `${up === 0 ? SYNTH_GRADES[0] : SYNTH_GRADES[SYNTH_GRADES.indexOf(up) + 1]} — inside the planner's own ` +
        `SPRINT_PEAK_GRADE_BUDGET (${SPRINT_PEAK_GRADE_BUDGET.toFixed(3)})`,
    );
  }
}
for (const f of failures) console.error(`FAIL: ${f}`);
if (failures.length === 0) console.log('  walk reach OK\n');
process.exit(failures.length > 0 ? 1 : 0);
