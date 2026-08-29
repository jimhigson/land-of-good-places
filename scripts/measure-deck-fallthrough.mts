/**
 * **Can a long frame carry the player through a deck she is walking up?**
 *
 * The vertical twin of `measure-wall-tunnelling.mts`, and issue #358.
 * `CollisionWorld.resolveMovement` cuts a frame's *lateral* movement into
 * pieces short enough that no wall can be crossed without being overlapped.
 * The *vertical* ground sample used not to be cut up at all: `Player` asked
 * `WalkSurfaces.sample` once, at the position the whole frame's movement ended
 * at, and asked it from her **damped** height — which lags behind her on a
 * climb. On a steep enough deck the surface she was walking on was simply not
 * found, she got the terrain metres below instead, and a six-year-old fell
 * through the bridge she was running across.
 *
 * ```
 * node \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-deck-fallthrough.mts
 * ```
 *
 * It drives the **real** `WalkSurfaces.sample` and the **real**
 * `CollisionWorld`, through the shared `scripts/playerSim.mts` copy of
 * `Player.update`'s integration — the same one the two wall harnesses use, so
 * the three measurements cannot describe different players.
 *
 * ### The failure, stated so that a legitimate descent cannot trip it
 *
 * Not "did she go airborne". Going briefly airborne on a **descent** is normal
 * and harmless: the damped height lags *above* the ground going downhill, so
 * she steps off into a short hop and lands again a moment later. An earlier
 * rig counted that as a fall, never simulated the landing, and so reported
 * failures on bridge geometry that ships and works.
 *
 * The failure is **losing the surface**: the deck exists under her feet, and
 * the sampler handed back something below it. This harness built the deck, so
 * it knows exactly where the deck is, and compares `sample`'s answer against
 * that ground truth. A descent returns the deck at a lower height, which
 * matches; a fall-through returns the terrain, which does not.
 *
 * ### What is swept
 *
 * - **Gradient**, 0.10 to 2.40, which brackets both the old ceiling and the
 *   new one.
 * - **Direction**: up the ramp and down it. Down is where the over-counting
 *   rig went wrong, so it is measured rather than assumed.
 * - **Speed**: walk and sprint.
 * - **Frame delta**: `MAX_FRAME_DELTA` (the clamp a stuttering phone actually
 *   gets, and the worst case) plus ordinary rates, because a bug that only
 *   appears on the long frames is exactly what this is.
 * - **Start phase**: 64 offsets of the frame clock against the foot of the
 *   ramp, so the long step lands at every distance from the slope. Testing one
 *   phase tests nothing — the fall-through is a coincidence between where a
 *   frame boundary falls and where the geometry is.
 *
 * Every case runs **twice**: once with `groundSubstepping: false`, the pre-fix
 * single end-of-frame sample and the control, and once with it on, which is
 * what ships.
 */
import { Vector3 } from 'three';
import { CollisionWorld } from '../src/world/Collision.ts';
import { circleBoundary } from '../src/world/boundary.ts';
import { WalkSurfaces } from '../src/world/building/surfaces.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import {
  BUILDING_STEP_UP,
  MAX_FRAME_DELTA,
  PLAYER_LONGEST_STEP,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPRINT_MULTIPLIER,
} from '../src/core/constants.ts';
import { SimPlayer } from './playerSim.mts';

/**
 * The park's own thinnest collider — the entrance stop sign's post. Registered
 * far away from the walk so it blocks nothing, purely so `maxSafeStep` is the
 * one the shipping park has. The vertical sub-step length is the lateral one,
 * by construction (that is the whole point of hanging it off `resolveMovement`
 * rather than inventing a second decomposition), so a harness that left the
 * collider world empty would measure an infinitely long sub-step and report a
 * fix that does not exist.
 */
const PARK_THINNEST_HALF_WIDTH = 0.18;

/** Where the ramp starts, in the garden and well clear of anything. */
const RAMP_X0 = -40;
/** Long enough that a sprint spends several seconds on it at every gradient. */
const RAMP_LENGTH = 30;
const RAMP_Z = 0;
/** Half-width of the deck, comfortably wider than the player. */
const RAMP_HALF_WIDTH = 3;

const GRADIENTS = [
  0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.512, 0.55, 0.6, 0.62, 0.65, 0.67, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4,
  1.6, 1.65, 1.67, 1.7, 1.8, 2.0, 2.1, 2.2, 2.4,
];
const DELTAS = [MAX_FRAME_DELTA, 1 / 15, 1 / 20, 1 / 30, 1 / 60];
/** 64 offsets of the frame clock against the foot of the ramp. */
const PHASES = Array.from({ length: 64 }, (_, i) => i / 64);
const RUN_SECONDS = 6;

/**
 * How far below the deck the sampler's answer has to be before it counts as
 * having lost it. Generous: the real failure drops her to the terrain, metres
 * down, so nothing near this margin is ambiguous.
 */
const LOST_MARGIN = 0.05;

/** The deck's own surface, and the ground truth every verdict is read against. */
function deckSurfaceAt(base: number, gradient: number, x: number): number {
  const along = Math.min(Math.max(x - RAMP_X0, 0), RAMP_LENGTH);
  return base + gradient * along;
}

function covers(x: number, z: number): boolean {
  return (
    x >= RAMP_X0 - 0.001 &&
    x <= RAMP_X0 + RAMP_LENGTH + 0.001 &&
    Math.abs(z - RAMP_Z) <= RAMP_HALF_WIDTH
  );
}

interface Outcome {
  /** Runs in which the sampler stopped finding the deck under her feet. */
  lost: number;
  runs: number;
  /** Worst gap between where the deck was and what the sampler returned. */
  worstGap: number;
  /** The first failure's own words, for the red-run transcript. */
  firstMessage: string | null;
}

interface Config {
  gradient: number;
  delta: number;
  phase: number;
  sprint: boolean;
  uphill: boolean;
  groundSubstepping: boolean;
}

function run(config: Config, outcome: Outcome): void {
  const { gradient, delta, phase, sprint, uphill, groundSubstepping } = config;

  // The deck sits clear above the terrain, so losing it is unambiguous: the
  // only thing under it is ground several metres down.
  const base = terrainHeight(RAMP_X0, RAMP_Z) + 6;

  const surfaces = new WalkSurfaces();
  surfaces.addPlatform({
    surfaceY: base,
    covers,
    surfaceYAt: (x) => deckSurfaceAt(base, gradient, x),
  });

  const collision = new CollisionWorld();
  collision.setPlayBounds(circleBoundary(4000));
  // Far from the walk; present only to set the sub-step length. See above.
  collision.addWall(2000, -50, 2000, 50, PARK_THINNEST_HALF_WIDTH, 1, false);

  const player = new SimPlayer(collision, {
    ground: (x, z, y) => surfaces.sample(x, z, y),
    groundSubstepping,
  });

  // Start a phase-shifted fraction of one long step back from the ramp's foot
  // (or its head, going down), so the frame boundaries land everywhere.
  const offset = phase * PLAYER_LONGEST_STEP;
  const startX = uphill ? RAMP_X0 + offset : RAMP_X0 + RAMP_LENGTH - offset;
  player.placeOnGround(startX, RAMP_Z);

  const dirX = uphill ? 1 : -1;
  const frames = Math.ceil(RUN_SECONDS / delta);

  outcome.runs += 1;
  for (let frame = 0; frame < frames; frame += 1) {
    player.step(delta, dirX, 0, sprint);
    const { x, z } = player.position;
    if (!covers(x, z)) break; // walked off the end of the deck; nothing to judge

    const deck = deckSurfaceAt(base, gradient, x);
    const gap = deck - player.groundY;
    if (gap > outcome.worstGap) outcome.worstGap = gap;
    if (gap > LOST_MARGIN) {
      outcome.lost += 1;
      if (outcome.firstMessage === null) {
        outcome.firstMessage =
          `a ${sprint ? 'sprinting' : 'walking'} child ${uphill ? 'up' : 'down'} a ` +
          `gradient-${gradient.toFixed(3)} deck at ${(1 / delta).toFixed(0)} fps ` +
          `(phase ${phase.toFixed(4)}) lost the surface at x=${x.toFixed(2)}: the deck is at ` +
          `y=${deck.toFixed(3)} but the sampler returned ${player.groundY.toFixed(3)}, ` +
          `${gap.toFixed(3)} m below her own feet — she falls through it.`;
      }
      break;
    }
  }
}

function measure(groundSubstepping: boolean): Map<number, Outcome> {
  const byGradient = new Map<number, Outcome>();
  for (const gradient of GRADIENTS) {
    const outcome: Outcome = { lost: 0, runs: 0, worstGap: 0, firstMessage: null };
    for (const delta of DELTAS)
      for (const phase of PHASES)
        for (const sprint of [true, false])
          for (const uphill of [true, false])
            run({ gradient, delta, phase, sprint, uphill, groundSubstepping }, outcome);
    byGradient.set(gradient, outcome);
  }
  return byGradient;
}

/** The steepest gradient with no lost surface anywhere in the sweep. */
function ceiling(results: Map<number, Outcome>): number {
  let best = 0;
  for (const gradient of GRADIENTS) {
    if (results.get(gradient)!.lost > 0) break;
    best = gradient;
  }
  return best;
}

const before = measure(false);
const after = measure(true);

/**
 * The sub-step length a given frame delta actually produces — the lateral
 * decomposition, which since #358 is also the vertical one.
 *
 * **The longest sub-step is not the longest frame.** The count is a `ceil`, so
 * it jumps in whole steps while the distance grows smoothly, and the worst
 * granularity sits just *after* a jump: 12 fps covers 0.925 m in 3 sub-steps of
 * 0.308 m, while 15 fps covers 0.740 m in only 2, of 0.370 m. Sweeping the
 * clamp alone would have measured the wrong ceiling and called it the answer.
 */
function substepLengthAt(delta: number): number {
  const distance = PLAYER_MAX_SPEED * PLAYER_SPRINT_MULTIPLIER * delta;
  const limit = 0.5 * (PARK_THINNEST_HALF_WIDTH + PLAYER_RADIUS);
  const steps = distance > limit ? Math.min(Math.ceil(distance / limit), 16) : 1;
  return distance / steps;
}

const worstSubstep = Math.max(...DELTAS.map(substepLengthAt));
const predicted = BUILDING_STEP_UP / worstSubstep;

console.log('\nCan a long frame carry the player through the deck she is walking up? (#358)\n');
console.log(
  `  worst sub-step over the frame rates swept: ${worstSubstep.toFixed(3)} m ` +
    `(at ${(1 / DELTAS[DELTAS.map(substepLengthAt).indexOf(worstSubstep)]!).toFixed(0)} fps), ` +
    `against the park's thinnest ${PARK_THINNEST_HALF_WIDTH} m collider`,
);
console.log(
  `  so the predicted ceiling is BUILDING_STEP_UP / that = ${predicted.toFixed(3)}\n`,
);
console.log('  gradient   before: lost/runs  worst gap    after: lost/runs  worst gap');
for (const gradient of GRADIENTS) {
  const b = before.get(gradient)!;
  const a = after.get(gradient)!;
  console.log(
    `  ${gradient.toFixed(3).padStart(8)}   ${String(b.lost).padStart(6)}/${String(b.runs).padEnd(5)} ` +
      `${b.worstGap.toFixed(3).padStart(9)}    ${String(a.lost).padStart(6)}/${String(a.runs).padEnd(5)} ` +
      `${a.worstGap.toFixed(3).padStart(9)}`,
  );
}

const beforeCeiling = ceiling(before);
const afterCeiling = ceiling(after);
console.log(
  `\n  steepest deck with no fall-through anywhere in the sweep:\n` +
    `    before (single end-of-frame sample, damped height): ${beforeCeiling.toFixed(3)}\n` +
    `    after  (sample rides the sub-steps, true surface):  ${afterCeiling.toFixed(3)}\n`,
);

const firstBefore = GRADIENTS.map((g) => before.get(g)!.firstMessage).find((m) => m !== null);
if (firstBefore) console.log(`  the control's first failure:\n    ${firstBefore}\n`);

const firstAfter = GRADIENTS.map((g) => after.get(g)!.firstMessage).find((m) => m !== null);
if (firstAfter) console.log(`  the first failure that survives the fix:\n    ${firstAfter}\n`);

// The guaranteed floor: even a park whose thinnest collider is so fat that the
// whole step is one sub-step still gets BUILDING_STEP_UP over PLAYER_LONGEST_STEP,
// because the sample no longer spends a third of its allowance on the damp lag.
const floor = BUILDING_STEP_UP / PLAYER_LONGEST_STEP;
console.log(
  `  guaranteed floor, independent of what the park contains: ${floor.toFixed(3)}\n` +
    `  (BUILDING_STEP_UP ${BUILDING_STEP_UP} / PLAYER_LONGEST_STEP ${PLAYER_LONGEST_STEP.toFixed(3)})\n`,
);

let failed = false;

// 1. Every gradient inside the park-independent floor must be safe. This is
//    the assertion that protects real geometry: anything built to `floor` is
//    walkable whatever the park grows later.
for (const gradient of GRADIENTS) {
  if (gradient > floor) break;
  const a = after.get(gradient)!;
  if (a.lost > 0) {
    failed = true;
    console.error(
      `FAIL: gradient ${gradient.toFixed(3)} is within the guaranteed floor of ` +
        `${floor.toFixed(3)}, but ${a.lost} of ${a.runs} runs lost the surface.\n` +
        `      ${a.firstMessage}`,
    );
  }
}

// 2. The measured ceiling must match what the sub-step arithmetic predicts. A
//    ceiling that has quietly drifted away from `BUILDING_STEP_UP` over the
//    worst sub-step means the sample has stopped riding the sub-steps — the
//    exact regression this file exists to catch — and it would otherwise show
//    up only as a number nobody was checking against anything.
const nextAbove = GRADIENTS.find((g) => g > afterCeiling) ?? Infinity;
if (!(afterCeiling <= predicted && predicted < nextAbove)) {
  failed = true;
  console.error(
    `FAIL: the measured ceiling ${afterCeiling.toFixed(3)} does not bracket the ` +
      `predicted ${predicted.toFixed(3)} (next gradient tried: ${nextAbove.toFixed(3)}). ` +
      `The ground sample is no longer following the movement sub-steps.`,
  );
}

// 3. The fix must actually buy something over the control.
if (afterCeiling <= beforeCeiling) {
  failed = true;
  console.error(
    `FAIL: sub-stepping the ground sample bought nothing — the ceiling went ` +
      `${beforeCeiling.toFixed(3)} -> ${afterCeiling.toFixed(3)}.`,
  );
}

if (!failed) {
  console.log(
    `  ceiling ${beforeCeiling.toFixed(3)} -> ${afterCeiling.toFixed(3)}, ` +
      `bracketing the predicted ${predicted.toFixed(3)}. OK\n`,
  );
}

process.exit(failed ? 1 : 0);
