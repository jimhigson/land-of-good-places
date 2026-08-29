/**
 * **Does the park's crowd actually spread out across the park?**
 *
 * ```
 * npm run check:npc-dispersal            # part of npm run build
 * LGP_SEED=20260801 npm run check:npc-dispersal
 * npm run check:npc-dispersal -- --mutate   # prove it can go red
 * ```
 *
 * ## Why this exists
 *
 * Issue #350, reported by Jim on 27 August 2026: *"on entering the park, all
 * the NPCs gather in one place quite soon."* They did. `WanderDriver` walked a
 * non-backtracking random walk on `PoiGraph` — no destination anywhere in the
 * system — and a random walk is **diffusive**, so the crowd's occupancy
 * converged on whichever region had the highest node degree and the longest
 * dwell. In this park that is the plaza: six waypoints packed inside the kerb,
 * mutually visible, every one of them `interesting` and so worth a 0.62-chance
 * pause. Twenty-four children, one fountain.
 *
 * The fix gives every child a real destination and the player's own `NavGrid`
 * to get there. This check is what stops the crowd quietly pooling again — a
 * regression nothing else in the build could see, because the park is
 * perfectly *valid* with every child standing on the same paving slab.
 *
 * ## What is measured, off the running simulation
 *
 * The **real** `World`, stepped through the **real** `world.update` at 1/60 for
 * {@link RUN_SECONDS}. Nothing here models a crowd; it builds one and watches
 * it, which is the same rule `check-npc-separation.mts` and `park-harness.mts`
 * follow.
 *
 * Measured over the children the **journey system is actually steering** —
 * those no activity currently owns (`WanderDriver.occupied`). This is not a
 * loophole, and assertion 4 below is what stops it becoming one.
 *
 * It is necessary because the park deliberately gathers children in places.
 * Investigating a clump this check flagged at the gate turned up ten of the
 * eleven bus children held by `TrainTrip` — **queueing on a station platform
 * for a train**, for about thirty seconds. That is the game working: they are
 * standing together on purpose, at a thing you wait at. Counting them measures
 * the railway timetable, not whether children choose their own destinations.
 * The same goes for a child up a tree, mid-chat, being face-painted, or still
 * aboard the cat bus.
 *
 * Four assertions, and they are deliberately different in kind:
 *
 * 1. **Spread.** The crowd's RMS radius about its own centroid, against the RMS
 *    a *uniform* scatter over the park's own area would have.
 * 2. **No single clump.** No disc a tenth of the park wide holds more than a
 *    third of the children.
 * 3. **The mechanism is what did it.** The children are walking to several
 *    genuinely different attractions. A geometric test alone cannot tell "they
 *    spread out because each is going somewhere" from "they happened to drift
 *    apart", and the second would pass a build that had lost the feature.
 * 4. **Most of the crowd is actually free.** At least half the children must be
 *    out walking rather than held by an activity. Without this, a regression
 *    that parked twenty of the twenty-four on a station platform for ever would
 *    pass by leaving four well-spread children to be measured — the check would
 *    have excused exactly the bug it exists to catch.
 *
 * ## Where the thresholds come from — and why none of them is a number
 *
 * CLAUDE.md: *take thresholds from the game rather than from the generator's
 * own target*, and a check whose limit is a magic constant is a check that gets
 * loosened the first time it is inconvenient. Every threshold below is derived
 * from {@link PARK_BOUNDARY} — the park's own shape — so a park that grows or
 * changes shape re-derives them rather than needing this file edited.
 *
 * - {@link PARK_EQUIVALENT_RADIUS} = `sqrt(area / π)`: the radius of a disc of
 *   the park's own area. The park is a gentle spline, not a circle, so its
 *   `maxRadius` overstates it and its area does not — area is the honest
 *   single number for "how big is this place".
 * - {@link UNIFORM_RMS} = `PARK_EQUIVALENT_RADIUS / √2`: the **exact** RMS
 *   distance from the centre for points scattered uniformly over that disc
 *   (∫₀ᴿ r² · 2r/R² dr = R²/2). This is the honest yardstick: it is what
 *   "spread out over this park" measures, computed rather than guessed.
 * - {@link CLUMP_RADIUS} = `PARK_EQUIVALENT_RADIUS / 10`: "in one place" means
 *   within a tenth of the park's width. On the canonical park that is about
 *   8 m — a knot of children you would read as a crowd rather than as
 *   passers-by, and it is the park that decides it, not this file.
 *
 * ## The clump metric is a disc, not a cluster — and that matters
 *
 * The first version of this check used single-linkage clustering, and it was
 * wrong in a way worth recording. Single linkage is **transitive**: it joins A
 * to C whenever some B sits between them. Eleven children walking away from the
 * gate down the same paved corridor, strung out over eighty metres and plainly
 * not gathered anywhere, came out as one cluster of eleven and failed the
 * check — for the whole first eighty seconds, on correct behaviour.
 *
 * A queue is not a crowd. What Jim reported was children *gathered in one
 * place*, so what is measured is the densest **disc**: the largest number of
 * children within {@link CLUMP_RADIUS} of any one of them. That cannot chain
 * along a path, and it is a direct reading of the words in the complaint.
 *
 * The two *fractions* ({@link MIN_SPREAD_FRACTION}, {@link MAX_CLUMP_FRACTION})
 * are the actual judgement being made, and they are stated as fractions on
 * purpose so that judgement is visible and arguable rather than buried inside a
 * metre figure that looks derived. Children congregate at attractions, and
 * attractions are not uniformly scattered, so the crowd can never reach a
 * uniform scatter's spread — half of it is a real bar that the pre-fix
 * behaviour misses comfortably and the fixed behaviour clears comfortably. See
 * the `--mutate` numbers in the PR.
 *
 * ## Proving the check is real
 *
 * `--mutate` gives every child the **same** destination, which is precisely the
 * park Jim complained about: a crowd with somewhere to be, all of it the same
 * somewhere. It is a truer mutation than deleting the feature would be, because
 * it leaves the pathfinding, the arrivals and the pauses all working and
 * changes only the thing this check is about. It must fail. CLAUDE.md has a
 * whole section on checks that pass without checking anything; this is the
 * answer to it, and the red output is quoted in the PR.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { WanderDriver } from '../src/entities/npc/wanderDriver.ts';
import { JourneyPlanner } from '../src/entities/npc/journey.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import type { FrameContext } from '../src/core/types.ts';

const mutate = process.argv.includes('--mutate');

const DT = 1 / 60;
/**
 * Long enough for the bus cohort to have dispersed and for everybody to have
 * completed at least one trip across the park. The pre-fix crowd was already
 * visibly pooled well inside this.
 */
const RUN_SECONDS = Number(process.env['SECONDS'] ?? 240);
const FRAMES = Math.ceil(RUN_SECONDS / DT);
/**
 * Measurement starts here. The first seconds are the arrival — eleven children
 * genuinely are in one place, standing on the cat bus, and that is the game
 * working. Judging dispersal before they are off it would measure the bus.
 */
const SETTLE_SECONDS = 60;
/** One sample every ten seconds. */
const SAMPLE_FRAMES = Math.round(10 / DT);

// --- thresholds, every one of them derived from the park's own shape --------

/** Radius of a disc with the park's own area. See the file comment. */
const PARK_EQUIVALENT_RADIUS = Math.sqrt(PARK_BOUNDARY.area / Math.PI);
/** Exact RMS distance from centre for a uniform scatter over that disc. */
const UNIFORM_RMS = PARK_EQUIVALENT_RADIUS / Math.SQRT2;
/** "In one place" — within a tenth of the park's width. */
const CLUMP_RADIUS = PARK_EQUIVALENT_RADIUS / 10;
/** The crowd must reach at least this share of a uniform scatter's spread. */
const MIN_SPREAD_FRACTION = 0.5;
/** No single clump may hold more than this share of the park's children. */
const MAX_CLUMP_FRACTION = 1 / 3;
/**
 * The crowd must be heading for at least this many genuinely different
 * attractions at the end of the run — a quarter of the children, so it scales
 * with the cast rather than being a count typed in here.
 */
const MIN_DISTINCT_DESTINATIONS_FRACTION = 0.25;

// ---------------------------------------------------------------- the park

const park = buildHeadlessPark();
const world = park.world;

/**
 * The park's own children, and only those.
 *
 * `world.npcs.all` also holds the hotel's seven residents, who live on a
 * `WaypointDriver` circuit ~600 m away in their own spaces. Including them
 * makes every statistic meaningless — the RMS is then ~420 m and is entirely
 * about the distance to the hotel. This bit is load-bearing; the first attempt
 * at measuring this got it wrong.
 */
const kids = world.npcs.all.filter((c) => c.driver instanceof WanderDriver);

/** The children the journey system is steering right now. See the file comment. */
function freeKids(): typeof kids {
  return kids.filter((k) => !(k.driver as WanderDriver).occupied);
}

if (mutate) {
  // Every child wants the same thing: the park Jim reported. Patched on the
  // prototype rather than by editing the driver, so the code under test is the
  // shipping code and the mutation is visibly confined to this script.
  const real = JourneyPlanner.prototype.destinationsIn;
  JourneyPlanner.prototype.destinationsIn = function (space) {
    const all = real.call(this, space);
    return all.length > 0 ? [all[0]!] : all;
  };
}

const input = new InputSystem();
// The player stands at the plaza rather than at the origin: a stationary player
// is what makes children come over for a chat (`activities/chatToPlayer.ts`),
// and a check that parked them at (0,0) in empty space would never exercise it.
const playerPosition = new Vector3(0, 0, 0);
const cameraForward = new Vector3(0, 0, 1);

interface Sample {
  readonly t: number;
  readonly rms: number;
  readonly largestClump: number;
  readonly distinctDestinations: number;
  readonly free: number;
}

/**
 * The most children inside any one disc of {@link CLUMP_RADIUS} — "how many are
 * gathered in the same place?".
 *
 * Centred on each child in turn, which is the standard way to find the densest
 * disc without searching the plane: the densest disc can always be slid until a
 * child is at its centre without losing anybody, so this is exact enough for a
 * count and needs no grid. Deliberately NOT single-linkage clustering — see the
 * file comment, which records why that read a queue as a crowd.
 */
function largestClump(group: typeof kids): number {
  let worst = 0;
  for (let i = 0; i < group.length; i += 1) {
    const a = group[i]!;
    let here = 0;
    for (let j = 0; j < group.length; j += 1) {
      const b = group[j]!;
      if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) <= CLUMP_RADIUS) {
        here += 1;
      }
    }
    if (here > worst) worst = here;
  }
  return worst;
}

function measure(t: number): Sample {
  const free = freeKids();
  if (free.length === 0) {
    return { t, rms: 0, largestClump: 0, distinctDestinations: 0, free: 0 };
  }

  let cx = 0;
  let cz = 0;
  for (const k of free) {
    cx += k.position.x;
    cz += k.position.z;
  }
  cx /= free.length;
  cz /= free.length;
  let sum = 0;
  for (const k of free) sum += (k.position.x - cx) ** 2 + (k.position.z - cz) ** 2;

  const destinations = new Set<string>();
  for (const k of free) {
    const id = (k.driver as WanderDriver).destinationId;
    if (id) destinations.add(id);
  }

  return {
    t,
    rms: Math.sqrt(sum / free.length),
    largestClump: largestClump(free),
    distinctDestinations: destinations.size,
    free: free.length,
  };
}

const samples: Sample[] = [];
for (let frame = 0; frame < FRAMES; frame += 1) {
  const context: FrameContext = {
    dt: DT,
    elapsed: frame * DT,
    input,
    playerPosition,
    cameraForward,
    frame,
  };
  quietly(() => world.update(context));
  // Sampled every 10 s after the arrival has finished, so a single lucky
  // instant cannot carry the check — the assertions below are on the WORST
  // sample, not the last one. Counted in frames rather than by testing the
  // clock modulo, which matched two consecutive frames and sampled twice.
  if ((frame + 1) % SAMPLE_FRAMES !== 0) continue;
  const t = (frame + 1) * DT;
  const m = measure(t);
  if (t >= SETTLE_SECONDS) samples.push(m);
  if (process.env['TRACE']) {
    console.log(
      `  t=${String(m.t.toFixed(0)).padStart(3)}s rms=${m.rms.toFixed(1)} ` +
        `clump=${m.largestClump} dests=${m.distinctDestinations}`,
    );
  }
}

// -------------------------------------------------------------- assertions

const failures: string[] = [];
const notes: string[] = [];
const check = (ok: boolean, message: string): void => {
  if (!ok) failures.push(message);
};

const worstSpread = samples.reduce((a, b) => (b.rms < a.rms ? b : a));
const worstClump = samples.reduce((a, b) => (b.largestClump > a.largestClump ? b : a));
const worstVariety = samples.reduce((a, b) =>
  b.distinctDestinations < a.distinctDestinations ? b : a,
);

const minimumRms = UNIFORM_RMS * MIN_SPREAD_FRACTION;
check(
  worstSpread.rms >= minimumRms,
  `the crowd's RMS radius fell to ${worstSpread.rms.toFixed(2)} m at t=${worstSpread.t.toFixed(0)}s, ` +
    `below ${minimumRms.toFixed(2)} m — ${(MIN_SPREAD_FRACTION * 100).toFixed(0)}% of the ` +
    `${UNIFORM_RMS.toFixed(2)} m a uniform scatter over this park's own area ` +
    `(${PARK_BOUNDARY.area.toFixed(0)} m², equivalent radius ${PARK_EQUIVALENT_RADIUS.toFixed(1)} m) ` +
    'would have. The children are pooling instead of going places — issue #350',
);

const maximumClump = Math.floor(kids.length * MAX_CLUMP_FRACTION);
check(
  worstClump.largestClump <= maximumClump,
  `${worstClump.largestClump} of ${kids.length} children were within ${CLUMP_RADIUS.toFixed(1)} m of ` +
    `one another at t=${worstClump.t.toFixed(0)}s (a tenth of the park's width), more than the ` +
    `${maximumClump} a third of the crowd allows — that is the clump issue #350 was raised for`,
);

const minimumDestinations = Math.max(2, Math.floor(kids.length * MIN_DISTINCT_DESTINATIONS_FRACTION));
check(
  worstVariety.distinctDestinations >= minimumDestinations,
  `the crowd was heading for only ${worstVariety.distinctDestinations} distinct attraction(s) at ` +
    `t=${worstVariety.t.toFixed(0)}s, fewer than the ${minimumDestinations} expected of ` +
    `${kids.length} children — they may be spread out, but not because each is going somewhere ` +
    'of their own, so the mechanism this check exists for is not what did it',
);

// ------------------------------------------------------------------ report

console.log(`park seed ${PARK_SEED}${mutate ? ', --mutate: every child sent to one attraction' : ''}`);
notes.push(`${kids.length} park children (of ${world.npcs.all.length} NPCs; the rest are the hotel's)`);
notes.push(
  `park area ${PARK_BOUNDARY.area.toFixed(0)} m² -> equivalent radius ${PARK_EQUIVALENT_RADIUS.toFixed(1)} m, ` +
    `uniform-scatter RMS ${UNIFORM_RMS.toFixed(2)} m, clump radius ${CLUMP_RADIUS.toFixed(1)} m`,
);
notes.push(
  `ran ${RUN_SECONDS}s, sampled every 10s from ${SETTLE_SECONDS}s (${samples.length} samples)`,
);
notes.push(
  `worst spread: RMS ${worstSpread.rms.toFixed(2)} m at t=${worstSpread.t.toFixed(0)}s ` +
    `(needs >= ${minimumRms.toFixed(2)} m, i.e. ${(worstSpread.rms / UNIFORM_RMS * 100).toFixed(0)}% of uniform)`,
);
notes.push(
  `worst clump: ${worstClump.largestClump} children at t=${worstClump.t.toFixed(0)}s (allows <= ${maximumClump})`,
);
notes.push(
  `fewest distinct destinations: ${worstVariety.distinctDestinations} at ` +
    `t=${worstVariety.t.toFixed(0)}s (needs >= ${minimumDestinations})`,
);
for (const note of notes) console.log(`  ${note}`);

if (failures.length > 0) {
  console.error(`\nFAIL: the park's children are not spread across the park${mutate ? ' (--mutate: expected)' : ''}.`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nnpc dispersal OK');
