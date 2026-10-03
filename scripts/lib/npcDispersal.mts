/**
 * **`check:npc-dispersal`, as a function** — one owner, asked by the script
 * (which prints it and fails on every clause) and by the root acceptance loop
 * (`scripts/park-attempt.mts`), which restarts on the clauses the park's layout
 * decides — whether the crowd spreads, clumps, varies, goes indoors and walks
 * free. What every clause asks, and why, is the script's header.
 *
 * It takes a **builder**: it runs the crowd for minutes of game time, which
 * moves the world, so it is handed a fresh World of its own.
 */
import type { HeadlessPark } from '../park-harness.mts';
import { Vector3 } from 'three';
import { quietly } from '../park-harness.mts';
import { InputSystem } from '../../src/core/input/InputSystem.ts';
import { WanderDriver } from '../../src/entities/npc/wanderDriver.ts';
import { JourneyPlanner } from '../../src/entities/npc/journey.ts';
import { PARK_BOUNDARY } from '../../src/world/boundary.ts';
import {
  MAX_CONCURRENT_CHATTERS,
  MAX_CONCURRENT_CLIMBERS,
  MAX_CONCURRENT_RIDERS,
} from '../../src/entities/npc/NpcSystem.ts';
import { MAX_CONCURRENT_PAINTED } from '../../src/entities/npc/activities/facePaintVisit.ts';
import { MAX_INSIDE } from '../../src/entities/npc/journey.ts';
import { SPACE_GARDEN, spaceAt } from '../../src/world/spaces.ts';
import { PARK_SEED } from '../../src/world/parkManifest.ts';
import type { FrameContext } from '../../src/core/types.ts';
import type { ClauseKind } from './checkScope.mts';


export interface SimFindings {
  /** The instrument could not measure — a void, never a restart. */
  readonly voids: readonly string[];
  /** Failed clauses a park's own decisions set. */
  readonly decisions: readonly string[];
  /** Failed clauses of code, the same on every park. */
  readonly code: readonly string[];
  /** The transcript lines the script prints. */
  readonly notes: readonly string[];
}

export async function npcDispersal(
  build: () => HeadlessPark,
  options: { readonly quiet?: boolean; readonly clauses?: 'all' | 'decisions'; readonly mutate?: boolean } = {},
): Promise<SimFindings> {
  const quiet = options.quiet ?? false;
  const all = (options.clauses ?? 'all') === 'all';
  void all;
  let lastError = '';
  const log = (...parts: unknown[]): void => {
    if (!quiet) console.log(...parts);
  };
  const err = (...parts: unknown[]): void => {
    lastError = parts.map(String).join(' ');
    if (!quiet) console.error(...parts);
  };
  const write = (text: string): void => {
    if (!quiet) process.stderr.write(text);
  };
  const mutate = options.mutate ?? false;

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
   * How much of the destination pool the crowd must have in play, on average.
   *
   * Derived from the number of attractions actually available rather than from
   * the size of the cast, which is what it used to be and was simply the wrong
   * denominator: the question is "are the children choosing among the places
   * there are?", so the places there are is what it has to be measured against.
   * Merging each ride with its own ticket booth changed the pool from 12 to 10
   * and turned that mistake into a red seed.
   *
   * Averaged over the run for the same reason {@link MIN_SPREAD_FRACTION} is —
   * a count of distinct destinations across a dozen children at one instant is a
   * noisy estimator, and seed 5 read 5 at t=200s while spreading to 80% of a
   * uniform scatter with a worst clump of three. Sustained variety is the
   * property; one frame is not.
   *
   * Deliberately generous. This assertion's job is to catch "the crowd has
   * stopped choosing", not to police exactly how varied they are: the `--mutate`
   * run averages **1**, and the five real seeds average 7–8 of 10.
   */
  const MIN_DESTINATION_POOL_FRACTION = 0.4;
  /**
   * The fewest children that can be out in the garden and free while every
   * whole-park cap is simultaneously full — **derived from those caps**, never
   * chosen.
   *
   * This is assertion 4, and it is what stops "measure only the free children in
   * the garden" from becoming a way to excuse a parked crowd. The earlier version
   * was a flat half of the crowd, which a review pointed out had **one child of
   * headroom** (the caps then summed to 13 against a bar of 12) in a check that
   * blocks the build — and adding the castle would have made it unsatisfiable
   * outright.
   *
   * Deriving it fixes both problems at once. If somebody raises a cap, this moves
   * with it instead of going red for a reason that has nothing to do with
   * dispersal; and if the caps are ever raised past the crowd itself, the
   * assertion below says so in those words rather than failing obscurely.
   *
   * It still has real teeth: it is precisely "no more children are held or indoors
   * than the caps allow", so a regression parking twenty of the twenty-four on a
   * station platform fails it.
   */
  const HELD_AT_MOST =
    MAX_CONCURRENT_CLIMBERS +
    MAX_CONCURRENT_RIDERS +
    MAX_CONCURRENT_PAINTED +
    MAX_CONCURRENT_CHATTERS +
    MAX_INSIDE;

  // ---------------------------------------------------------------- the park

  const park = build();
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

  /**
   * The children this check measures: **out in the garden**, and not held by an
   * activity.
   *
   * The garden test is load-bearing and was learned twice. The handoff records
   * the first time — measuring across `world.npcs.all` gave an RMS of ~420 m
   * that was entirely about the hotel's seven residents six hundred metres away.
   * The second time was this PR's own castle work reintroducing it: children
   * walking into the castle stand at interior coordinates ~600 m off, and the
   * check went from 37 m to **276 m and still "passed"** — 476% of a uniform
   * scatter, which should have been impossible and was the loudest possible sign
   * the number had stopped meaning anything.
   *
   * "Are the park's children spread across the park" is a question about the
   * children who are *in* the park. A child in a shop is somewhere on purpose,
   * exactly like one on the train.
   */
  function measuredKids(): typeof kids {
    return kids.filter(
      (k) =>
        !(k.driver as WanderDriver).occupied &&
        spaceAt(k.position.x, k.position.z) === SPACE_GARDEN,
    );
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
    /** Park children standing in the castle at this instant. */
    readonly inside: number;
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
    const free = measuredKids();
    if (free.length === 0) {
      return {
        t,
        inside: kids.filter((k) => spaceAt(k.position.x, k.position.z) !== SPACE_GARDEN).length,
        rms: 0,
        largestClump: 0,
        distinctDestinations: 0,
        free: 0,
      };
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
      inside: kids.filter((k) => spaceAt(k.position.x, k.position.z) !== SPACE_GARDEN).length,
      rms: Math.sqrt(sum / free.length),
      largestClump: largestClump(free),
      distinctDestinations: destinations.size,
      free: free.length,
    };
  }

  /** Every castle shop any child chose during the run — assertion 4's evidence. */
  const shopsChosen = new Set<string>();
  /** Every child who was ever inside. */
  const wentInside = new Set<string>();

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
    for (const k of kids) {
      const id = (k.driver as WanderDriver).destinationId;
      if (id?.startsWith('shop:')) shopsChosen.add(id);
      if (spaceAt(k.position.x, k.position.z) !== SPACE_GARDEN) wentInside.add(k.name);
    }
    if (t >= SETTLE_SECONDS) samples.push(m);
    if (process.env['TRACE']) {
      log(
        `  t=${String(m.t.toFixed(0)).padStart(3)}s rms=${m.rms.toFixed(1)} ` +
          `clump=${m.largestClump} dests=${m.distinctDestinations} free=${m.free}`,
      );
    }
  }

  // -------------------------------------------------------------- assertions

  const decisions: string[] = [];
  const code: string[] = [];
  const notes: string[] = [];
  /**
   * One clause, and what kind it is: `decision` where the park's own layout —
   * where its attractions, castle door, stations and trees stand — decides how
   * the crowd spreads; `code` where it is the caps' own arithmetic, the same on
   * every park.
   */
  const check = (ok: boolean, message: string, kind: ClauseKind): void => {
    if (ok) return;
    (kind === 'decision' ? decisions : code).push(message);
  };

  const worstSpread = samples.reduce((a, b) => (b.rms < a.rms ? b : a));
  /**
   * The spread **sustained across the run**, which is the honest form of this
   * particular question.
   *
   * The other two assertions take the worst single sample, and should: one moment
   * with fifteen children in an eight-metre disc is a clump whenever it happens.
   * Spread is different. It is an average over a dozen points, and a dozen points
   * measured at one instant is a noisy estimator — children crossing the park to
   * a dozen different attractions all pass through the middle of it, so there are
   * moments when a perfectly-dispersed crowd reads low.
   *
   * **Be clear about how much work this is doing: none of the five seeds needs
   * it.** Under the old worst-single-sample rule they read 53%, 64%, 66%, 64% and
   * 57%, so every one of them clears the 50% bar either way. What the mean buys
   * is margin on the canonical seed, which sits **three points** above the bar on
   * its worst sample and comfortably clear on its mean — and three points of
   * headroom in a check that blocks the build is thin enough to go red on an
   * unlucky afternoon rather than on a regression.
   *
   * (An earlier version of this comment justified the change with seed 18 reading
   * 39%. That was true when it was written and is not any more — merging each
   * ride with its own ticket booth moved that seed to 57%. The argument was
   * re-checked rather than left standing on a number that had quietly expired.)
   *
   * Taking the mean is **not** a loosened bar — the 50% threshold is untouched.
   * It is the same quantity estimated properly instead of from one frame. The
   * worst single sample is still computed and still reported, so a genuine
   * collapse is visible in the output either way.
   */
  const meanRms = samples.reduce((total, s) => total + s.rms, 0) / samples.length;
  const worstClump = samples.reduce((a, b) => (b.largestClump > a.largestClump ? b : a));
  const worstVariety = samples.reduce((a, b) =>
    b.distinctDestinations < a.distinctDestinations ? b : a,
  );
  const meanVariety =
    samples.reduce((total, sample) => total + sample.distinctDestinations, 0) / samples.length;
  /**
   * How many places there are to go from the garden.
   *
   * **State-dependent, and worth knowing about.** `destinationsIn` filters the
   * castle's shops out while the castle is full, so this reads 10 or 17 depending
   * on what the last frame happened to look like, which moves the variety bar
   * between 4 and 6. It changes no verdict today — the five seeds average 7.8–8.9
   * — but it means this is a *snapshot* of the pool rather than the fixed size of
   * it, and a future change that made the castle full more often would quietly
   * raise the bar rather than lower it. Sampled after the run for that reason:
   * the bar should never be read from a frame in the middle of one.
   */
  const destinationPool = (
    world.npcs as unknown as { planner: { destinationsIn: (s: string) => unknown[] } }
  ).planner.destinationsIn(SPACE_GARDEN).length;
  const worstFree = samples.reduce((a, b) => (b.free < a.free ? b : a));

  check(
    wentInside.size > 0 && shopsChosen.size > 0,
    `no child ever went inside the castle across ${RUN_SECONDS}s ` +
      `(${wentInside.size} children indoors, ${shopsChosen.size} shops chosen). Jim asked for the ` +
      'castle by name — "This can include things inside the castle" — and the first cut of #350 ' +
      'shipped the shops, the castle lattice and the deck connectors as unreachable code because ' +
      'nothing could carry a child over the threshold. If this is red, the portals in ' +
      'entities/npc/portals.ts have stopped working and a whole requirement has gone quietly missing',
    'decision',
  );

  const minimumFree = kids.length - HELD_AT_MOST;
  check(
    minimumFree > 0,
    `the whole-park caps now sum to ${HELD_AT_MOST}, which is not fewer than the ${kids.length} ` +
      'children in the park, so every child could legitimately be held or indoors at once and this ' +
      'check can no longer prove anything about dispersal. Lower a cap, or raise NPC_DENSITY',
    'code',
  );
  check(
    minimumFree <= 0 || worstFree.free >= minimumFree,
    `only ${worstFree.free} of ${kids.length} children were out in the garden and free to walk at ` +
      `t=${worstFree.t.toFixed(0)}s, fewer than the ${minimumFree} that must be, given the whole-park ` +
      `caps allow at most ${HELD_AT_MOST} to be held or indoors (${MAX_CONCURRENT_CLIMBERS} climbing, ` +
      `${MAX_CONCURRENT_RIDERS} on the railway, ${MAX_CONCURRENT_PAINTED} being painted, ` +
      `${MAX_CONCURRENT_CHATTERS} chatting, ${MAX_INSIDE} in the castle). Something is holding children ` +
      'past its own cap, or the dispersal numbers below are about a handful of children and mean nothing',
    'decision',
  );

  const minimumRms = UNIFORM_RMS * MIN_SPREAD_FRACTION;
  check(
    meanRms >= minimumRms,
    `the crowd's RMS radius averaged ${meanRms.toFixed(2)} m across the run ` +
      `(worst single sample ${worstSpread.rms.toFixed(2)} m at t=${worstSpread.t.toFixed(0)}s, ` +
      `across ${worstSpread.free} children), below ${minimumRms.toFixed(2)} m — ` +
      `${(MIN_SPREAD_FRACTION * 100).toFixed(0)}% of the ` +
      `${UNIFORM_RMS.toFixed(2)} m a uniform scatter over this park's own area ` +
      `(${PARK_BOUNDARY.area.toFixed(0)} m², equivalent radius ${PARK_EQUIVALENT_RADIUS.toFixed(1)} m) ` +
      'would have. The children are pooling instead of going places — issue #350',
    'decision',
  );

  const maximumClump = Math.floor(kids.length * MAX_CLUMP_FRACTION);
  check(
    worstClump.largestClump <= maximumClump,
    `${worstClump.largestClump} of ${worstClump.free} free children were within ${CLUMP_RADIUS.toFixed(1)} m of ` +
      `one another at t=${worstClump.t.toFixed(0)}s (a tenth of the park's width), more than the ` +
      `${maximumClump} a third of the crowd allows — that is the clump issue #350 was raised for`,
    'decision',
  );

  const minimumDestinations = Math.max(3, Math.floor(destinationPool * MIN_DESTINATION_POOL_FRACTION));
  check(
    meanVariety >= minimumDestinations,
    `the crowd averaged only ${meanVariety.toFixed(1)} distinct attractions across the run ` +
      `(fewest ${worstVariety.distinctDestinations} at t=${worstVariety.t.toFixed(0)}s), below the ` +
      `${minimumDestinations} expected of a ${destinationPool}-destination park — they may be spread ` +
      'out, but not because each is going somewhere of their own, so the mechanism this check exists ' +
      'for is not what did it',
    'decision',
  );

  // ------------------------------------------------------------------ report

  notes.push(`park seed ${PARK_SEED}${mutate ? ', --mutate: every child sent to one attraction' : ''}`);
  notes.push(`${kids.length} park children (of ${world.npcs.all.length} NPCs; the rest are the hotel's)`);
  notes.push(
    `park area ${PARK_BOUNDARY.area.toFixed(0)} m² -> equivalent radius ${PARK_EQUIVALENT_RADIUS.toFixed(1)} m, ` +
      `uniform-scatter RMS ${UNIFORM_RMS.toFixed(2)} m, clump radius ${CLUMP_RADIUS.toFixed(1)} m`,
  );
  notes.push(
    `ran ${RUN_SECONDS}s, sampled every 10s from ${SETTLE_SECONDS}s (${samples.length} samples)`,
  );
  notes.push(
    `mean spread: RMS ${meanRms.toFixed(2)} m = ${((meanRms / UNIFORM_RMS) * 100).toFixed(0)}% of uniform ` +
      `(needs >= ${minimumRms.toFixed(2)} m). Worst single sample ${worstSpread.rms.toFixed(2)} m ` +
      `(${((worstSpread.rms / UNIFORM_RMS) * 100).toFixed(0)}%) at t=${worstSpread.t.toFixed(0)}s`,
  );
  notes.push(
    `worst clump: ${worstClump.largestClump} children at t=${worstClump.t.toFixed(0)}s (allows <= ${maximumClump})`,
  );
  notes.push(
    `destination variety: mean ${meanVariety.toFixed(1)} of ${destinationPool} available ` +
      `(needs >= ${minimumDestinations}); fewest ${worstVariety.distinctDestinations} at ` +
      `t=${worstVariety.t.toFixed(0)}s`,
  );
  notes.push(
    `castle: ${wentInside.size} children went inside, ${shopsChosen.size} of the 7 shops chosen, ` +
      `peak ${Math.max(...samples.map((r) => r.inside))} indoors at one sample (cap ${MAX_INSIDE})`,
  );
  notes.push(
    `fewest measured (in the garden, no activity holding them): ${worstFree.free} at ` +
      `t=${worstFree.t.toFixed(0)}s (needs >= ${minimumFree} of ${kids.length}; caps allow ` +
      `${HELD_AT_MOST} held or indoors)`,
  );
  return { voids: [], decisions, code, notes: notes.map((note, i) => (i === 0 ? note : `  ${note}`)) };
}
