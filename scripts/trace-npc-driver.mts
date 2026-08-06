/**
 * **Does the crowd still behave exactly the same?**
 *
 * ```
 * npm run check:crowd
 * ```
 *
 * Everything a `WanderDriver` decides comes from a seeded {@link Rng} — one
 * stream per child — so a park of children is a pure function of its seeds and
 * the frames it is shown. That is the property that makes a refactor of the
 * behaviour script checkable rather than merely plausible: run this before,
 * run it after, compare the two hashes. Identical hash, identical crowd.
 *
 * It was written for the Wave-3 `Activity` extraction (ARCHITECTURE-DECISIONS
 * Decision 2 §2), where ~500 lines of behaviour moved between files and the
 * whole claim was "nothing changed". It deliberately touches only the driver's
 * long-standing public surface — `WanderDriver`, `setTrainService`,
 * `registerFacePaintStall` — so the *same file* runs against an older checkout
 * without edits.
 *
 * It runs in `npm run build` (0.2 s), where its job is narrower than the hash:
 * it **fails if any of the five behaviours never happens at all**. A golden
 * hash is deliberately *not* asserted, because the crowd is meant to be tuned —
 * the hash is for a human comparing two revisions, the coverage floor is for
 * the build (ARCHITECTURE-REVIEW review 7, F7: an unrun script is a claim
 * frozen at whenever somebody last ran it).
 *
 * What it is not: a physics test. The body here is a straight integrator with
 * no collision, because collision is not what a driver decides. Wedging, and
 * therefore the stuck-sidestep and the timeouts, are exercised by the pinned
 * child (see `WEDGED_CHILD`) rather than by geometry.
 *
 * ## The second scenario
 *
 * The trace above answers "did anything change?". It cannot answer "does the
 * face-paint stall survive a child who gets stuck on the way to it?", because
 * a whole-park hash is exactly the wrong shape for a question with a yes/no
 * answer. {@link runWedge} is that question, asserted rather than hashed:
 * ARCHITECTURE-REVIEW C1 was a bug whose entire symptom was a feature quietly
 * doing *nothing*, and nothing hashes beautifully.
 *
 * ## What this trace cannot see, and where that now lives
 *
 * Everything here is a **decision**. There is no park, no scene graph and no
 * character with a body — the climbable trees a few lines down are two made-up
 * literals, deliberately, so the trace does not move every time somebody plants
 * a bush. So the hash is completely blind to *where a climbing child physically
 * ends up*: issue #224 found that raising every NPC climber by five metres left
 * it reading `639ad23c`, unchanged.
 *
 * `scripts/check-npc-perch.mts` owns that question, and `npm run check:crowd`
 * runs it straight after this. Keeping them apart is the point rather than an
 * accident — this one must stay cheap and park-independent to be worth
 * comparing across revisions, and a geometric assertion needs the real park.
 */

import { spawnSync } from 'node:child_process';
import { Vector3 } from 'three';
import { Rng } from '../src/core/mathUtils.ts';
import {
  RUN_INTENT,
  createIntent,
  clearIntent,
  type CharacterIntent,
} from '../src/entities/npc/driver.ts';
import type { PoiGraph, PoiNode } from '../src/entities/npc/poiGraph.ts';
import {
  WanderDriver,
  paintedNpcFaces,
  registerFacePaintStall,
} from '../src/entities/npc/wanderDriver.ts';
import { setTrainService, type TrainService, type TrainStop } from '../src/world/train/service.ts';

const FRAMES = 90_000; // 25 minutes of park at 60 Hz
const DT = 1 / 60;
const CHILDREN = 12;
const WALK_SPEED = 1.85;

/** One child is pinned to the spot, so every walk timeout and stuck-sidestep
 *  in the file gets exercised instead of being dead code in the trace. */
const WEDGED_CHILD = 3;

// --- a park to walk around ---------------------------------------------------
//
// A 5x5 lattice with a few interesting nodes and one dead end, standing in for
// `PoiGraph`. Built by hand rather than from the real park so the trace does
// not move every time somebody plants a bush.

function buildGraph(): PoiGraph {
  const nodes: PoiNode[] = [];
  const index = (ix: number, iz: number) => iz * 5 + ix;
  for (let iz = 0; iz < 5; iz += 1) {
    for (let ix = 0; ix < 5; ix += 1) {
      nodes.push({
        index: index(ix, iz),
        x: (ix - 2) * 6,
        z: (iz - 2) * 6,
        interesting: (ix + iz) % 3 === 0,
        indoors: false,
        neighbours: [],
      } as unknown as PoiNode);
    }
  }
  const link = (a: number, b: number) => {
    (nodes[a]!.neighbours as number[]).push(b);
    (nodes[b]!.neighbours as number[]).push(a);
  };
  for (let iz = 0; iz < 5; iz += 1) {
    for (let ix = 0; ix < 5; ix += 1) {
      if (ix < 4 && !(iz === 4 && ix === 3)) link(index(ix, iz), index(ix + 1, iz));
      if (iz < 4) link(index(ix, iz), index(ix, iz + 1));
    }
  }

  return {
    node: (i: number) => nodes[i],
    nearest: (x: number, z: number) => {
      let best: PoiNode | null = null;
      let bestDistance = Infinity;
      for (const node of nodes) {
        if (node.neighbours.length === 0) continue;
        const d = (node.x - x) ** 2 + (node.z - z) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          best = node;
        }
      }
      return best;
    },
    spawnNodes: () => nodes,
  } as unknown as PoiGraph;
}

// --- a train to catch --------------------------------------------------------

const STOPS: readonly TrainStop[] = [
  { index: 0, name: 'Bluebell Halt', x: -26, z: 4 },
  { index: 1, name: 'Sunny Side', x: 26, z: -4 },
];

/** Trundles between the two stops on a fixed clock, with four seats. */
function installTrain(): () => void {
  const seats: (number | null)[] = [null, null, null, null];
  let clock = 0;
  const service: TrainService = {
    stops: STOPS,
    nearestStop: (x, z) => {
      let best: TrainStop | null = null;
      let bestDistance = Infinity;
      for (const stop of STOPS) {
        const d = (stop.x - x) ** 2 + (stop.z - z) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          best = stop;
        }
      }
      return best;
    },
    claimSeat: (stop) => {
      if (service.stoppedAt() !== stop) return null;
      const free = seats.indexOf(null);
      if (free < 0) return null;
      seats[free] = stop;
      return free;
    },
    seatValid: (seat) => seats[seat] !== null,
    stoppedAt: () => {
      // 8 s standing at a platform, 22 s running between them.
      const phase = clock % 60;
      if (phase < 8) return 0;
      if (phase >= 30 && phase < 38) return 1;
      return null;
    },
    leaveSeat: (seat) => {
      seats[seat] = null;
    },
  };
  setTrainService(service);
  return () => {
    clock += DT;
  };
}

// --- the run -----------------------------------------------------------------

interface Child {
  readonly driver: WanderDriver;
  readonly position: Vector3;
  readonly intent: ReturnType<typeof createIntent>;
  /** Previous frame's observable state, for counting transitions. */
  wasClimbing: boolean;
  wasSeated: boolean;
  wasTalking: boolean;
}

/**
 * What the run actually exercised.
 *
 * A trace hash that matches because nothing happened is worse than no trace at
 * all, so the run reports its own coverage and refuses to be quiet about a zero.
 */
interface Coverage {
  climbs: number;
  trips: number;
  chats: number;
  paints: number;
  waves: number;
  hops: number;
}

function run(coverage: Coverage): string {
  const graph = buildGraph();
  const tickTrain = installTrain();
  registerFacePaintStall(9, -9, 8.2, -8.6);

  const climberBudget = { active: 0, max: 3 };
  const chatBudget = { active: 0, max: 2 };
  const layout = new Rng(20260728);

  const children: Child[] = [];
  for (let i = 0; i < CHILDREN; i += 1) {
    const startNode = layout.int(0, 24);
    const node = graph.node(startNode)!;
    children.push({
      driver: new WanderDriver({
        graph,
        rng: new Rng(4242 + i * 977),
        startNode,
        pace: layout.range(0.86, 1.12),
        climbableTrees: [
          { x: 6, z: 6, radius: 0.4, height: 5 },
          { x: -12, z: 0, radius: 0.45, height: 6 },
        ] as never,
        climberBudget,
        chatBudget,
      }),
      position: new Vector3(node.x, 0, node.z),
      intent: createIntent(),
      wasClimbing: false,
      wasSeated: false,
      wasTalking: false,
    });
  }

  const player = new Vector3(0, 0, 0);
  let playerStationaryFor = 0;
  let hash = 2166136261 >>> 0;
  const mix = (value: number) => {
    hash ^= Math.round(value * 4096) & 0xffffffff;
    hash = Math.imul(hash, 16777619) >>> 0;
  };

  for (let frame = 0; frame < FRAMES; frame += 1) {
    const elapsed = frame * DT;
    tickTrain();

    // The player loiters, then walks a lap, then loiters again — the cue chat
    // waits for is "stood still for a couple of seconds".
    const cycle = elapsed % 40;
    const walking = cycle > 18;
    if (walking) {
      player.set(Math.cos(elapsed * 0.35) * 9, 0, Math.sin(elapsed * 0.35) * 9);
      playerStationaryFor = 0;
    } else {
      playerStationaryFor += DT;
    }
    const playerHopped = !walking && Math.abs((cycle % 6) - DT) < DT * 0.5;

    // Face painting has no per-child getter by design — the visit keeps that
    // to itself — so it is counted through the decal registry the stall reads.
    //
    // The registry is hashed as well as counted. It is a real per-frame output
    // of the driver — `FacePaintStall` positions its decals straight off it —
    // and it is the one output that is *not* an intent field, so nothing else
    // in this trace covers it. That mattered: ARCHITECTURE-REVIEW C2 was the
    // head position silently ceasing to be updated on every frame an activity
    // held, and it moved not one bit of this hash until these three lines
    // existed.
    const faces = paintedNpcFaces();
    coverage.paints = Math.max(coverage.paints, faces.length);
    for (let i = 0; i < faces.length; i += 1) {
      const face = faces[i]!;
      mix(face.x);
      mix(face.z);
      mix(face.yaw);
    }

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      clearIntent(child.intent);
      child.driver.update(
        {
          dt: DT,
          elapsed,
          position: child.position,
          playerPosition: player,
          playerHopped,
          grounded: true,
          playerStationaryFor,
          playerWearingHat: elapsed % 120 < 60,
        },
        child.intent,
      );

      mix(child.intent.moveX);
      mix(child.intent.moveZ);
      mix(child.intent.wave);
      mix(child.intent.lookAt ?? 99);
      mix(child.intent.hop ? 1 : 0);
      mix(EXPRESSIONS.indexOf(child.intent.expression));
      mix(child.driver.targetNode);
      mix(child.driver.trainSeat ?? -1);
      mix(child.driver.climbPhase === null ? -1 : PHASES.indexOf(child.driver.climbPhase));
      mix(child.driver.chatBubbleText === null ? -1 : child.driver.chatBubbleText.length);

      const climbing = child.driver.climbPhase !== null;
      const seated = child.driver.trainSeat !== null;
      const talking = child.driver.chatBubbleText !== null;
      if (climbing && !child.wasClimbing) coverage.climbs += 1;
      if (seated && !child.wasSeated) coverage.trips += 1;
      if (talking && !child.wasTalking) coverage.chats += 1;
      if (child.intent.wave > 0.9) coverage.waves += 1;
      if (child.intent.hop) coverage.hops += 1;
      child.wasClimbing = climbing;
      child.wasSeated = seated;
      child.wasTalking = talking;

      // The body: straight integration, no collision. One child is wedged.
      if (i === WEDGED_CHILD) continue;
      const speed = Math.min(Math.hypot(child.intent.moveX, child.intent.moveZ), RUN_INTENT);
      if (speed > 1e-6) {
        const scale = (WALK_SPEED * DT * speed) / Math.hypot(child.intent.moveX, child.intent.moveZ);
        child.position.x += child.intent.moveX * scale;
        child.position.z += child.intent.moveZ * scale;
      }
    }
  }

  setTrainService(null);
  return hash.toString(16).padStart(8, '0');
}

const EXPRESSIONS = ['neutral', 'happy', 'blink', 'sad', 'surprised'];
const PHASES = ['up', 'peek', 'down'];

// --- scenario 2: a child wedged on the way to the face-paint stall -----------

/**
 * **Does face painting still work when somebody gets stuck on the way?**
 *
 * A park with nothing in it but children and the face-paint stall — no train,
 * no trees, no chat budget — so the only thing that can happen is a visit to
 * the stall, and one child pinned to the spot the moment they set off for it.
 *
 * The property under test is the whole of ARCHITECTURE-REVIEW C1, stated the
 * way a player would notice it: **four children can still be painted**, which
 * is `MAX_CONCURRENT_PAINTED`, even though one of them is wedged and will never
 * arrive. A wedged child who keeps their slot leaves only three, for the rest
 * of the session, silently.
 *
 * Measured, at the time of writing:
 *
 * | | painted | fourth painted at |
 * | --- | --- | --- |
 * | before the C1 fix | **3** | never |
 * | after | **4** | t≈91 s |
 *
 * `fourthPaintedAt` is checked as well as the count, and that is not
 * decoration: it is what stops the check passing *vacuously*. Unpinned, this
 * park paints its fourth child by t≈38 s. Only a slot handed back by a walk
 * that timed out can push it past the sixty-second mark. If a future change
 * means the pinned child never sets off for the stall at all, this run stops
 * proving anything — and the timing assertion is what says so out loud instead
 * of going quietly green.
 */
function runWedge(): { painted: number; fourthPaintedAt: number } {
  const graph = buildGraph();
  registerFacePaintStall(9, -9, 8.2, -8.6);
  const layout = new Rng(20260728);

  const children: { driver: WanderDriver; position: Vector3; intent: CharacterIntent }[] = [];
  for (let i = 0; i < CHILDREN; i += 1) {
    const startNode = layout.int(0, 24);
    const node = graph.node(startNode)!;
    children.push({
      // No trees, no budgets and no train service installed: nothing else in
      // this park can take the frame, so a walk that never ends is the only
      // thing that can hold a slot.
      driver: new WanderDriver({
        graph,
        rng: new Rng(4242 + i * 977),
        startNode,
        pace: layout.range(0.86, 1.12),
      }),
      position: new Vector3(node.x, 0, node.z),
      intent: createIntent(),
    });
  }

  // The player stands well out of the way — `reactToPlayer` is not what this
  // scenario is about.
  const player = new Vector3(60, 0, 60);
  let painted = 0;
  let fourthPaintedAt = Infinity;

  for (let frame = 0; frame < WEDGE_FRAMES; frame += 1) {
    const elapsed = frame * DT;

    const now = paintedNpcFaces().length;
    if (now > painted) {
      painted = now;
      if (painted === 4) fourthPaintedAt = elapsed;
    }

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      clearIntent(child.intent);
      child.driver.update(
        {
          dt: DT,
          elapsed,
          position: child.position,
          playerPosition: player,
          playerHopped: false,
          grounded: true,
          playerStationaryFor: 0,
          playerWearingHat: false,
        },
        child.intent,
      );

      if (i === WEDGED_VISITOR) continue;
      const speed = Math.min(Math.hypot(child.intent.moveX, child.intent.moveZ), RUN_INTENT);
      if (speed > 1e-6) {
        const scale = (WALK_SPEED * DT * speed) / Math.hypot(child.intent.moveX, child.intent.moveZ);
        child.position.x += child.intent.moveX * scale;
        child.position.z += child.intent.moveZ * scale;
      }
    }
  }

  return { painted, fourthPaintedAt };
}

/** Five minutes: long enough for a sixty-second walk to time out and for the
 *  child who inherits the freed slot to walk over and be painted. */
const WEDGE_FRAMES = 18_000;

/** The child who sets off for the stall first, and is pinned so they never get
 *  there. Deliberately not `WEDGED_CHILD` — that one is busy being wedged on
 *  the way to a station, in a park this scenario does not build. */
const WEDGED_VISITOR = 8;

/** Every slot the stall has (`MAX_CONCURRENT_PAINTED`). The number that has to
 *  still be reachable with one child wedged. */
const PAINT_SLOTS = 4;

/** A fourth painted child sooner than this means nobody was ever wedged, so the
 *  run proves nothing — see {@link runWedge}. */
const WEDGE_MUST_OUTLAST = 60;

// --- what to run -------------------------------------------------------------
//
// The two scenarios cannot share a process. `facePaintVisits` in
// `activities/facePaintVisit.ts` is a module-level registry that children join
// at construction and never leave, and the whole-park paint cap counts it — so
// a second park in the same process starts with the first park's four painted
// children already holding every slot. That is real (a rebuilt `World` would
// hit it too; ARCHITECTURE-REVIEW C5), but adding a test-only reset to
// production code to work around it would be worse than paying for a process.

if (process.env.CROWD_SCENARIO === 'wedge') {
  const { painted, fourthPaintedAt } = runWedge();
  const at = fourthPaintedAt === Infinity ? 'never' : `t=${fourthPaintedAt.toFixed(1)}s`;
  console.log(`wedged-visitor painted=${painted}/${PAINT_SLOTS} fourth-painted ${at}`);

  if (painted < PAINT_SLOTS) {
    console.error(
      `PAINT SLOT LEAKED: only ${painted} of ${PAINT_SLOTS} children could be painted with one ` +
        `wedged on the way to the stall. A walk that never gives up holds its slot for ever ` +
        `(ARCHITECTURE-REVIEW C1).`,
    );
    process.exitCode = 1;
  } else if (fourthPaintedAt < WEDGE_MUST_OUTLAST) {
    console.error(
      `NOT EXERCISED: the fourth child was painted at ${at}, sooner than the walk timeout — so ` +
        `nobody was actually wedged and this run proves nothing. Re-pick WEDGED_VISITOR.`,
    );
    process.exitCode = 1;
  }
} else {
  const coverage: Coverage = { climbs: 0, trips: 0, chats: 0, paints: 0, waves: 0, hops: 0 };
  const trace = run(coverage);

  console.log(`frames=${FRAMES} children=${CHILDREN}`);
  console.log(
    `covered climbs=${coverage.climbs} trips=${coverage.trips} chats=${coverage.chats} ` +
      `paints=${coverage.paints} waves=${coverage.waves} hops=${coverage.hops}`,
  );
  console.log(`trace=${trace}`);

  const missing = Object.entries(coverage).filter(([, count]) => count === 0);
  if (missing.length > 0) {
    console.error(`NOT EXERCISED: ${missing.map(([name]) => name).join(', ')}`);
    process.exitCode = 1;
  }

  // …and now the same file again, in its own process, for scenario 2.
  const wedge = spawnSync(process.execPath, [...process.execArgv, process.argv[1]!], {
    env: { ...process.env, CROWD_SCENARIO: 'wedge' },
    stdio: 'inherit',
  });
  if (wedge.status !== 0) process.exitCode = 1;
}
