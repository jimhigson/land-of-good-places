/**
 * **Why a park's duck bars have nowhere to stand** — one seed and restart.
 *
 * ```
 * LGP_SEED=11 LGP_PARK_RESTART=0 node ... scripts/measure-duck-bars.mts
 * ```
 *
 * Solves the plan only (no `World`), then asks `simulate.ts`'s own owners —
 * `reachRefusedSlots` and `refusedBarSlots` — per lane and per lane rotation,
 * and prints one `duck-bars: {json}` line. It measures the rings the plan
 * decided, so since the `railRaceBars` builder chooses the arch station it
 * reports a ring that fits (`decided`) — the refused stations are in the
 * plan's `park-solve` trace on stderr.
 */
import './headless-canvas.mjs';
import { solveParkPlanNow } from '../src/world/parkPlan.ts';
import { RAIL_RACE_PLAN } from '../src/world/railRace/plan.ts';
import { barPlanDecision, reachRefusedSlots, refusedBarSlots } from '../src/world/railRace/simulate.ts';
import { DuckBarRefusal, TRESTLE_SPACING } from '../src/world/railRace/hazards.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';

const t0 = performance.now();
solveParkPlanNow();
const tSolve = performance.now() - t0;
const race = RAIL_RACE_PLAN.raceRing;
const walk = RAIL_RACE_PLAN.walkPastRing;
const count = Math.max(1, Math.floor(race.length / TRESTLE_SPACING));
const sizes = (m: ReadonlyMap<number, ReadonlySet<number>>): number[] => [0, 1, 2, 3].map((l) => m.get(l)?.size ?? 0);
const reachRace = reachRefusedSlots(race.length, [race]);
const reachWalk = reachRefusedSlots(race.length, [walk]);
const t1 = performance.now();
const reachBoth = reachRefusedSlots(race.length, [walk, race]);
const tReach = performance.now() - t1;
const t2 = performance.now();
const shifts: { shift: number; ok: boolean; physicsRefused?: number[]; message?: string }[] = [];
for (let shift = 0; shift < 4; shift += 1) {
  try {
    const refused = refusedBarSlots(race, shift, reachBoth);
    shifts.push({ shift, ok: true, physicsRefused: sizes(refused).map((n, l) => n - (reachBoth.get(l)?.size ?? 0)) });
  } catch (error) {
    if (!(error instanceof DuckBarRefusal)) throw error;
    shifts.push({ shift, ok: false, message: error.message.slice(0, 160) });
  }
}
const tShifts = performance.now() - t2;
let decided: string;
try {
  decided = `laneShift ${barPlanDecision(race, [walk, race]).laneShift}`;
} catch (error) {
  decided = `THROWS ${(error as Error).name}`;
}
console.log(
  'duck-bars: ' +
    JSON.stringify({
      seed: PARK_SEED,
      restart: Number(process.env['LGP_PARK_RESTART'] ?? 0),
      ringLength: +race.length.toFixed(2),
      slots: count,
      reachRace: sizes(reachRace),
      reachWalk: sizes(reachWalk),
      reachBoth: sizes(reachBoth),
      shifts,
      decided,
      startDistance: +race.startDistance.toFixed(2),
      ms: { solve: Math.round(tSolve), reach: Math.round(tReach), shifts: Math.round(tShifts) },
    }),
);
