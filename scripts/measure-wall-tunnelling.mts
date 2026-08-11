/**
 * **Can a long frame carry the player through a wall?**
 *
 * The P1 this exists for: at `MAX_FRAME_DELTA` (1/12 s — the clamp any phone
 * that hitches for a moment actually gets) a full sprint covers 0.93 m in one
 * integration step, which is wider than a garden wall's whole footprint.
 * `CollisionWorld.resolve` is a point test, so a step that lands past the
 * wall's middle is pushed out of the *nearest* face — now the far one — and
 * she is through. At **any** height: a collider she overlaps at neither end of
 * the step is never asked about her height, so the hop-clearance rules are
 * skipped entirely and a 2 m wall goes through as easily as a 0.7 m one.
 *
 * ```
 * node \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-wall-tunnelling.mts
 * ```
 *
 * It drives the **real** `CollisionWorld` through the shared
 * `scripts/playerSim.mts` copy of `Player.update`'s integration — the same one
 * `measure-hop-clearance.mts` uses, so the two measurements cannot describe
 * different players.
 *
 * Every case is run **twice**: once with `substepping: false`, which is the
 * pre-fix integration and the control, and once with it on, which is what
 * ships. A fix nobody can demonstrate the absence of the bug for is a fix
 * nobody can defend a year from now.
 *
 * ### What is swept
 *
 * - **Frame delta** 1/12 (the clamp) up to 1/120, including the awkward
 *   in-between rates a mid-range phone actually produces.
 * - **Speed**: walk and sprint.
 * - **Wall half-thickness** 0.15 m to 0.6 m, spanning everything the park
 *   registers (the thinnest is the entrance stop sign's 0.18 m post; the
 *   garden walls are 0.22 m wooden and 0.34 m stone).
 * - **Approach angle** 0° (square on) to 85° (a glancing scrape along the
 *   face, the case a naive swept test against a wall's centre line misses).
 * - **Timing phase**: 96 evenly spaced offsets of the frame clock against the
 *   approach, so the long step lands at every distance from the wall. This is
 *   the sweep that matters — a tunnel is a coincidence between where a frame
 *   boundary falls and where the wall is, and testing one phase tests nothing.
 * - **Shape**: a single long wall; a right angle charged into from the
 *   diagonal (a corner is two colliders' end caps meeting, the weakest point
 *   of any segment-based world); and a fence built as a chain of short
 *   segments, where the ends are everywhere.
 *
 * ### The two suites
 *
 * **Solid** registers every wall as non-hoppable, so nothing may ever reach
 * the far side and any crossing at all is a tunnel — the unambiguous test.
 * **Hoppable** registers the 0.7 m walls the way `Scenery.ts` does, so the
 * auto-hop fires and the flight is part of the run; there a crossing *in the
 * air* is the feature working and a crossing *on foot* is the bug.
 */
import { circleBoundary } from '../src/world/boundary.ts';
import { Vector3 } from 'three';
import { clearsTop, CollisionWorld, MAX_DEPENETRATION_SPEED } from '../src/world/Collision.ts';
import {
  MAX_FRAME_DELTA,
  PLAYER_LONGEST_STEP,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPRINT_MULTIPLIER,
} from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT, SimPlayer } from './playerSim.mts';

const DELTAS = [MAX_FRAME_DELTA, 1 / 15, 1 / 20, 1 / 24, 1 / 30, 1 / 45, 1 / 60, 1 / 120];
const ANGLES = [0, 20, 40, 60, 75, 85];
const HALF_THICKNESSES = [0.15, 0.18, 0.22, 0.28, 0.34, 0.45, 0.6];
/** 96 offsets of the frame clock, so the long step lands everywhere. */
const PHASES = Array.from({ length: 96 }, (_, i) => i / 96);
/**
 * Seconds simulated. She starts 6 m out and covers that in well under a
 * second; the rest is time spent against the wall, which is where an escort
 * would have its chance to walk her through it.
 */
const RUN_SECONDS = 4;
/** A fence long enough that the glancing runs stay on it for most of the run. */
const FENCE_SEGMENTS = 40;
const FENCE_SEGMENT_LENGTH = 1.5;
/** Each arm of the right-angled corner, in metres. */
const CORNER_ARM = 40;

interface Case {
  readonly name: string;
  readonly build: (collision: CollisionWorld) => void;
  readonly startX: number;
  readonly startZ: number;
  readonly dirX: number;
  readonly dirZ: number;
  /** How tall the barrier is, for deciding whether the flight cleared it. */
  readonly topHeight: number;
  /** True once she is on the far side of the barrier. */
  readonly through: (position: Vector3) => boolean;
  /**
   * True while she is over the barrier's footprint — which is where being
   * above its top counts as flying over it rather than merely jumping nearby.
   */
  readonly overFootprint: (position: Vector3) => boolean;
  /**
   * True while the barrier is still the only thing between her and the far
   * side. Goes false when she has walked past the end of a finite fence, at
   * which point the run stops and is not scored: rounding a corner is not
   * tunnelling, and counting it as one would bury the real signal.
   */
  readonly stillFenced: (position: Vector3) => boolean;
}

interface Wall {
  readonly halfThickness: number;
  readonly topHeight: number;
  readonly autoHoppable: boolean;
}

/** One long wall lying along x at z = 0, walked at from z < 0. */
function straightWall(wall: Wall, angleDegrees: number): Case {
  const angle = (angleDegrees * Math.PI) / 180;
  const face = wall.halfThickness + PLAYER_RADIUS;
  return {
    name: `wall ${describe(wall)} angle=${angleDegrees}`,
    // Long enough that walking round the end is not on the table, so "reached
    // the far side" can only ever mean "went through".
    build: (collision) =>
      collision.addWall(-5000, 0, 5000, 0, wall.halfThickness, wall.topHeight, wall.autoHoppable),
    startX: 0,
    startZ: -6,
    dirX: Math.sin(angle),
    dirZ: Math.cos(angle),
    topHeight: wall.topHeight,
    through: (position) => position.z > face + 0.05,
    overFootprint: (position) => Math.abs(position.z) < face,
    stillFenced: () => true,
  };
}

/**
 * A fence built the way the park builds them — a chain of short segments — so
 * she crosses a join rather than the middle of one long collider.
 */
function fenceChain(wall: Wall, angleDegrees: number): Case {
  const angle = (angleDegrees * Math.PI) / 180;
  const face = wall.halfThickness + PLAYER_RADIUS;
  const halfSpan = FENCE_SEGMENTS * FENCE_SEGMENT_LENGTH * 0.5;
  return {
    name: `fence ${describe(wall)} angle=${angleDegrees}`,
    build: (collision) => {
      // A join sits at x = 0, exactly where a square-on approach arrives.
      for (let i = -FENCE_SEGMENTS / 2; i < FENCE_SEGMENTS / 2; i += 1) {
        collision.addWall(
          i * FENCE_SEGMENT_LENGTH,
          0,
          (i + 1) * FENCE_SEGMENT_LENGTH,
          0,
          wall.halfThickness,
          wall.topHeight,
          wall.autoHoppable,
        );
      }
    },
    startX: 0,
    startZ: -6,
    dirX: Math.sin(angle),
    dirZ: Math.cos(angle),
    topHeight: wall.topHeight,
    through: (position) => position.z > face + 0.05,
    overFootprint: (position) => Math.abs(position.z) < face,
    // A glancing approach slides a long way along the fence; stop before she
    // reaches its end rather than score walking round it as going through it.
    stillFenced: (position) => Math.abs(position.x) < halfSpan - 2,
  };
}

/**
 * A right-angled corner — two walls meeting — charged from the diagonal, where
 * a wall's end cap does the least work and two corrections fight each other.
 */
function corner(wall: Wall): Case {
  const face = wall.halfThickness + PLAYER_RADIUS;
  return {
    name: `corner ${describe(wall)}`,
    build: (collision) => {
      collision.addWall(-CORNER_ARM, 0, 0, 0, wall.halfThickness, wall.topHeight, wall.autoHoppable);
      collision.addWall(0, 0, 0, -CORNER_ARM, wall.halfThickness, wall.topHeight, wall.autoHoppable);
    },
    startX: -6,
    startZ: -6,
    dirX: Math.SQRT1_2,
    dirZ: Math.SQRT1_2,
    topHeight: wall.topHeight,
    // Beyond either wall's own plane: she started fenced into x < 0, z < 0.
    through: (position) => position.z > face + 0.05 || position.x > face + 0.05,
    overFootprint: (position) => Math.abs(position.z) < face || Math.abs(position.x) < face,
    stillFenced: (position) => position.x > -CORNER_ARM + 2 && position.z > -CORNER_ARM + 2,
  };
}

function describe(wall: Wall): string {
  return `half=${wall.halfThickness.toFixed(2)} top=${wall.topHeight.toFixed(2)}`;
}

/** What one walk at one wall, at one frame rate and one phase, came to. */
type Verdict =
  /** Stopped, as she should have been. */
  | 'held'
  /** Got across, having been above the wall's top over its footprint: a hop. */
  | 'flew'
  /** Got across on the ground. The bug. */
  | 'tunnelled'
  /** Walked past the end of a finite fence; nothing to say either way. */
  | 'left';

interface Run {
  verdict: Verdict;
  /**
   * The furthest a single frame carried her beyond where she asked to go, in
   * metres — the fling watch. Only a capped depenetration escort may push at
   * all, so this must stay under `MAX_DEPENETRATION_SPEED · dt`.
   */
  worstOvershoot: number;
  /** The fastest she was ever travelling, in m/s — the other fling watch. */
  peakSpeed: number;
}

function run(testCase: Case, dt: number, sprint: boolean, phase: number, substepping: boolean): Run {
  const collision = new CollisionWorld();
  collision.setPlayBounds(circleBoundary(100000));
  testCase.build(collision);

  const player = new SimPlayer(collision, {
    substepping,
    hopProbe: (probe) => collision.wouldAutoHopClear(probe, PLAYER_RADIUS, JUMP_APEX_HEIGHT),
  });
  player.position.set(testCase.startX, 0, testCase.startZ);

  let worstOvershoot = 0;
  let peakSpeed = 0;
  /**
   * Set the moment she is over the wall's footprint with her feet above its
   * top — i.e. genuinely flying over it. This, and not "was she airborne when
   * we noticed her on the far side", is what separates the feature from the
   * bug: a hop that lands a hair past the far face is grounded again on the
   * very frame the crossing is spotted.
   */
  let flew = false;

  let time = 0;
  let first = true;
  while (time < RUN_SECONDS) {
    // The first frame is short by `phase`, sliding the whole frame clock
    // against the approach: the long step then lands at a different distance
    // from the wall in every run.
    const frame = first ? dt * (1 - phase) : dt;
    first = false;
    time += frame;

    player.step(frame, testCase.dirX, testCase.dirZ, sprint);
    worstOvershoot = Math.max(worstOvershoot, player.lastOvershoot);
    peakSpeed = Math.max(peakSpeed, Math.hypot(player.velocity.x, player.velocity.z));

    if (
      testCase.overFootprint(player.position) &&
      clearsTop(testCase.topHeight, player.hopClearance)
    ) {
      flew = true;
    }
    if (testCase.through(player.position)) {
      return { verdict: flew ? 'flew' : 'tunnelled', worstOvershoot, peakSpeed };
    }
    if (!testCase.stillFenced(player.position)) {
      return { verdict: 'left', worstOvershoot, peakSpeed };
    }
  }
  return { verdict: 'held', worstOvershoot, peakSpeed };
}

interface Summary {
  counts: Record<Verdict, number>;
  runs: number;
  worstOvershoot: number;
  peakSpeed: number;
  /** A few tunnels, named, so a failure says where to look. */
  examples: string[];
}

function sweep(cases: readonly Case[], substepping: boolean): Summary {
  const summary: Summary = {
    counts: { held: 0, flew: 0, tunnelled: 0, left: 0 },
    runs: 0,
    worstOvershoot: 0,
    peakSpeed: 0,
    examples: [],
  };
  for (const testCase of cases) {
    for (const dt of DELTAS) {
      for (const sprint of [false, true]) {
        for (const phase of PHASES) {
          const result = run(testCase, dt, sprint, phase, substepping);
          summary.runs += 1;
          summary.counts[result.verdict] += 1;
          if (result.verdict === 'tunnelled' && summary.examples.length < 6) {
            summary.examples.push(
              `${testCase.name} at ${Math.round(1 / dt)} fps, ` +
                `${sprint ? 'sprint' : 'walk'}, phase ${phase.toFixed(3)}`,
            );
          }
          summary.worstOvershoot = Math.max(summary.worstOvershoot, result.worstOvershoot);
          summary.peakSpeed = Math.max(summary.peakSpeed, result.peakSpeed);
        }
      }
    }
  }
  return summary;
}

/**
 * **Does sub-stepping change how she moves at an ordinary frame rate?**
 *
 * Walks the same case twice, frame for frame, with and without, and returns
 * the largest distance the two ever end up apart. The claim being checked is
 * not "close enough" but *identical*: below the sub-step limit
 * `resolveMovement` takes the single-step branch, which is the old code, so
 * the answer must be exactly 0 — no drift, no last-bit difference. The walk
 * she has today is a thing the family tuned, and a fix for a stutter has no
 * business touching it.
 */
function divergence(testCase: Case, dt: number, sprint: boolean, phase: number): number {
  const worlds = [false, true].map((substepping) => {
    const collision = new CollisionWorld();
    collision.setPlayBounds(circleBoundary(100000));
    testCase.build(collision);
    const player = new SimPlayer(collision, {
      substepping,
      hopProbe: (probe) => collision.wouldAutoHopClear(probe, PLAYER_RADIUS, JUMP_APEX_HEIGHT),
    });
    player.position.set(testCase.startX, 0, testCase.startZ);
    return player;
  });
  const [plain, stepped] = worlds as [SimPlayer, SimPlayer];

  let worst = 0;
  let time = 0;
  let first = true;
  while (time < RUN_SECONDS) {
    const frame = first ? dt * (1 - phase) : dt;
    first = false;
    time += frame;
    plain.step(frame, testCase.dirX, testCase.dirZ, sprint);
    stepped.step(frame, testCase.dirX, testCase.dirZ, sprint);
    worst = Math.max(worst, plain.position.distanceTo(stepped.position));
  }
  return worst;
}

function buildCases(wallsOf: (halfThickness: number) => Wall): Case[] {
  const cases: Case[] = [];
  for (const halfThickness of HALF_THICKNESSES) {
    const wall = wallsOf(halfThickness);
    for (const angle of ANGLES) cases.push(straightWall(wall, angle));
  }
  for (const halfThickness of [0.18, 0.22, 0.34]) {
    const wall = wallsOf(halfThickness);
    cases.push(corner(wall));
    for (const angle of [0, 40, 75, 85]) cases.push(fenceChain(wall, angle));
  }
  return cases;
}

const sprintStep = PLAYER_LONGEST_STEP;
const probe = new CollisionWorld();
probe.addWall(0, 0, 1, 0, 0.18);
const limit = probe.maxSafeStep(PLAYER_RADIUS);
console.log(`A sprint at MAX_FRAME_DELTA moves ${sprintStep.toFixed(3)} m in one integration step.`);
console.log(
  `The park's thinnest collider is a 0.18 m post, so the sub-step limit is ${limit.toFixed(3)} m — ` +
    `${Math.ceil(sprintStep / limit)} sub-steps for that worst frame, 1 for every ordinary one.`,
);

const suites: readonly { readonly label: string; readonly cases: Case[] }[] = [
  {
    label: 'SOLID walls (nothing may ever cross — every crossing is a tunnel)',
    cases: [
      // A wall she is meant to be able to hop, made solid, so the *only* way
      // across is the bug; and a wall nothing should ever get over.
      ...buildCases((halfThickness) => ({ halfThickness, topHeight: 0.7, autoHoppable: false })),
      ...buildCases((halfThickness) => ({ halfThickness, topHeight: 2.0, autoHoppable: false })),
      ...buildCases((halfThickness) => ({
        halfThickness,
        topHeight: Infinity,
        autoHoppable: false,
      })),
    ],
  },
  {
    label: 'HOPPABLE 0.7 m walls (crossing in the air is the feature; on foot is the bug)',
    cases: buildCases((halfThickness) => ({ halfThickness, topHeight: 0.7, autoHoppable: true })),
  },
];

for (const suite of suites) {
  console.log(
    `\n=== ${suite.label}\n    ${suite.cases.length} shapes × ${DELTAS.length} frame rates × ` +
      `2 gaits × ${PHASES.length} phases`,
  );
  for (const substepping of [false, true]) {
    const label = substepping ? 'WITH sub-stepping (what ships)' : 'WITHOUT (the old code)';
    const started = Date.now();
    const summary = sweep(suite.cases, substepping);
    console.log(
      `  ${label}\n` +
        `    runs                  ${summary.runs}\n` +
        `    TUNNELLED THROUGH     ${summary.counts.tunnelled}\n` +
        `    flew over (a hop)     ${summary.counts.flew}\n` +
        `    held by the wall      ${summary.counts.held}\n` +
        `    walked off the end    ${summary.counts.left}  (not scored)\n` +
        `    worst one-frame shove ${summary.worstOvershoot.toFixed(3)} m ` +
        `(escort cap at 1/12 s is ${(MAX_DEPENETRATION_SPEED * MAX_FRAME_DELTA).toFixed(3)})\n` +
        `    peak speed            ${summary.peakSpeed.toFixed(2)} m/s ` +
        `(a sprint is ${(PLAYER_MAX_SPEED * PLAYER_SPRINT_MULTIPLIER).toFixed(2)})\n` +
        `    took                  ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    for (const example of summary.examples) console.log(`      e.g. ${example}`);
  }
}

// --- and the thing that must NOT have changed --------------------------------
//
// Ordinary walking. Sub-stepping is only ever allowed to alter the frames that
// were unsafe; every frame rate a child actually plays at must produce the
// same walk, to the last bit.
console.log(
  '\n=== Ordinary movement is untouched\n' +
    '    Same walk, frame for frame, with and without sub-stepping. Anything\n' +
    '    but an exact 0 below the sub-step limit is a change to how she moves.',
);
console.log('\n   fps  gait    sub-steps  worst divergence');
const identityCases = [
  ...buildCases((halfThickness) => ({ halfThickness, topHeight: 0.7, autoHoppable: true })),
  ...buildCases((halfThickness) => ({ halfThickness, topHeight: 2.0, autoHoppable: false })),
];
for (const dt of DELTAS) {
  for (const sprint of [false, true]) {
    const step = PLAYER_MAX_SPEED * (sprint ? PLAYER_SPRINT_MULTIPLIER : 1) * dt;
    let worst = 0;
    for (const testCase of identityCases) {
      for (const phase of [0, 0.17, 0.41, 0.63, 0.88]) {
        worst = Math.max(worst, divergence(testCase, dt, sprint, phase));
      }
    }
    console.log(
      `   ${String(Math.round(1 / dt)).padStart(3)}  ${sprint ? 'sprint' : 'walk  '}  ` +
        `${String(Math.ceil(step / limit)).padStart(9)}  ${worst.toFixed(6)} m` +
        (worst === 0 ? '   (identical)' : ''),
    );
  }
}
