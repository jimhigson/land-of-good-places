import { Rng } from '../../core/mathUtils';
import type { Pose2 } from '../rail/segments';
import { GARDEN_PLAY_BOUNDARY } from '../boundary';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } from '../entrance/layout';
import {
  NARROW_HALF_WIDTH,
  SITE_BOUNDARY_MARGIN,
  SITE_HALF_WIDTH,
  SITE_PLOT_MARGIN,
  SITE_RAMP_FLOOR,
  SITE_RAMP_IDEAL,
  probeBridgeReach,
} from './bridgeFit';

/**
 * **Where the railway may begin — a crossing a bridge provably fits at.**
 *
 * Jim, 30 August 2026, ruling on issue #414 after the same bridge was reported
 * three times:
 *
 * > "level crossings are now not allowed, but also I think the procgen should
 * > be able to make parks that meet constraints and this should be a
 * > constraint"
 *
 * and, on how:
 *
 * > choose where a path crosses the railway first, then grow the railway from
 * > there, at right angles.
 *
 * That is what this module supplies. Each pose stands at a point where a
 * bridge's deck and both its ramps provably fit, headed **perpendicular to the
 * path that will cross there** — so the railway runs square under the bridge
 * by construction, and a park with no bridgeable crossing stops being
 * something the generator can produce.
 *
 * ## Why a ranked field and not one chosen crossing
 *
 * The literal reading — pick a crossing, grow the loop from it — does not
 * survive contact with the search. `budgets.restarts` comes straight from
 * `startPoses.length`, and measured on `origin/main`
 * (`scripts/measure-train-solve-budget.mts`) **three of the five CI seeds need
 * 53-61 of the 96 rim start poses before one solves**; only the canonical seed
 * solves on its first. A single pose, or a handful, would simply fail to close
 * a loop on most seeds.
 *
 * So the choice is still pseudo-random and still a crossing, but it is offered
 * as a **ranked field** that the search walks best-first — exactly as it
 * already walked a ring of rim bearings, which is why this replaces the
 * *generator* of start poses and not the search. Every pose in the field is
 * bridgeable, so whichever one the search closes a loop from, the park has a
 * bridgeable crossing.
 *
 * There is room to do this: measured at ~1200 bridgeable poses per seed
 * (`scripts/measure-crossing-poses.mts`) against the 96 being replaced. And
 * the number that says why this is worth doing at all — **seed 2 offers 1183
 * bridgeable poses while its solved loop proves zero bridge sites.** Its park
 * is full of ground a bridge fits on; the loop just never went near any of it.
 */

/**
 * **The walk in from the gate gets first refusal on the crossing.**
 *
 * `paths.ts` runs an authored corridor down the radial from just inside the
 * arch — the park's main avenue, and **the one leg of the network that is not
 * routed through a planned crossing site**. Every other path is; this one is
 * hand-drawn because a child walks it from her first second in the park. So
 * wherever the loop happens to cut it, the network meets the railway somewhere
 * `crossingPlanSolve.ts` never offered, and the whole premise fails at the
 * park's front door. Measured before this existed: seed 11 crossed at
 * (0.0, 55.3), seed 5 at (0.0, 54.8).
 *
 * **Choosing the crossing here is Jim's design applied to the path that
 * matters most** — pick where a path and the railway cross, then grow the
 * railway from it. The entrance crossing then *is* a planned, bridgeable site
 * by construction, rather than something checked afterwards.
 *
 * ## Why not keep the railway off the corridor instead
 *
 * That was built and measured on this branch, and it **fails**: solve rate
 * 14/15 → **9/15**, with seeds 5 and 11 — two of the five CI seeds — unable to
 * build a park at all, and the canonical seed surviving only at restart #86 of
 * 96. The reason is structural rather than tunable: a keep-out down the
 * corridor is a ~10 m × 30 m bar driven into the park **from the rim**, and it
 * severs the rim the closed loop wants to run along. Narrowing it narrows the
 * spike; the rim is still cut. Reverted.
 *
 * `HANDOFF-bridge-at-the-front-door.md` reached the same place from the other
 * side: it made the entrance cross on a bridge by **routing the path**, never
 * by moving the railway. That was the right lever, and this is the same lever
 * one step earlier.
 *
 * These poses are simply put at the head of the ranked field, so the search
 * tries them first and falls back to the rest if none closes a loop. Costs the
 * search nothing: it constrains which pose is picked, not where the loop runs.
 */
function gateCorridorPoses(): Pose2[] {
  const length = Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z) || 1;
  // Inward along the radial — the direction the corridor itself runs, and so
  // the direction the path crosses in.
  const dirX = -ENTRANCE_GATE_X / length;
  const dirZ = -ENTRANCE_GATE_Z / length;
  const poses: Pose2[] = [];
  // From just inside the arch to the far end of the authored corridor
  // (`paths.ts` runs it from z = 54 to at most z = 30, i.e. 6-30 m in).
  for (let step = 6; step <= 30; step += 1) {
    const x = ENTRANCE_GATE_X + dirX * step;
    const z = ENTRANCE_GATE_Z + dirZ * step;
    if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) < SITE_BOUNDARY_MARGIN) continue;
    for (const halfWidth of [SITE_HALF_WIDTH, NARROW_HALF_WIDTH]) {
      const { pos, neg, deckClear } = probeBridgeReach(
        x,
        z,
        dirX,
        dirZ,
        halfWidth,
        SITE_RAMP_IDEAL,
        SITE_BOUNDARY_MARGIN,
        SITE_PLOT_MARGIN,
      );
      if (deckClear && pos >= SITE_RAMP_FLOOR && neg >= SITE_RAMP_FLOOR) {
        // Square across the walk, exactly as for any other crossing.
        poses.push({ x, z, hx: -dirZ, hz: dirX });
        break;
      }
    }
  }
  return poses;
}

/** Grid pitch for candidate crossing points, metres. Fine enough not to step
 * over a usable strip of ground, coarse enough to sweep a park in ~95 ms. */
const POINT_PITCH = 4;

/** Candidate path headings per point. A bridge is symmetric about its own
 * axis, so only a half-turn of headings is distinct. */
const HEADINGS = 8;

/** How far out the sweep looks. The boundary test rejects everything past the
 * park, so this only has to be comfortably larger than the park. */
const SWEEP_REACH = 90;

/**
 * How many poses are handed to the search.
 *
 * **Kept at the number the rim ring offered**, deliberately: the search's
 * restart budget is `startPoses.length`, three seeds already spend 53-61 of
 * it, and this is not the change that should also alter how hard the search is
 * allowed to try. With ~1200 candidates available and 96 taken, the field is a
 * sample of the bridgeable ground rather than all of it — which is what keeps
 * two seeds from producing the same park for the same structural reason.
 */
const POSES_OFFERED = 96;

/**
 * Every (point, heading) a bridge provably fits at, in a deterministic
 * pseudo-random order, capped at {@link POSES_OFFERED}.
 *
 * The heading returned is the **railway's**, perpendicular to the path that
 * crosses it. The probe is asked in terms of the *path* direction, because
 * that is the axis a bridge's deck and ramps run along.
 *
 * **A generator, because the whole sweep is 102 ms and it used to run in one
 * frame.** It is called from `trainRouteSearch`'s own first line, before that
 * generator's first `yield`, so the entire park sweep landed inside a single
 * `ParkGeneration.advance()` — measured at 100.1 ms against an 8 ms budget and
 * a 20 ms ceiling, twelve times over, and `check:park-boot` red because of it
 * (see `scripts/profile-park-boot-slice.mts`). A frame that blocks that long
 * is a visible jolt in the bus's orbit, which is the thing that check exists
 * to catch.
 *
 * It yields once per **x row** — 46 of them, ~2.2 ms each — which is a unit
 * comfortably inside the budget without making the yield itself the cost.
 * Suspending cannot move the result: the sweep's whole state is generator
 * locals and the only `Rng` in here is drawn after it finishes, the same
 * argument `rail/generate.ts` makes for slicing its own search.
 */
export function* bridgeableCrossingPosesSearch(seed: number): Generator<number, Pose2[], void> {
  const candidates: Pose2[] = [];
  let row = 0;
  for (let x = -SWEEP_REACH; x <= SWEEP_REACH; x += POINT_PITCH) {
    yield (row += 1);
    for (let z = -SWEEP_REACH; z <= SWEEP_REACH; z += POINT_PITCH) {
      if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) < SITE_BOUNDARY_MARGIN) continue;
      for (let h = 0; h < HEADINGS; h += 1) {
        const angle = (h / HEADINGS) * Math.PI;
        const dirX = Math.cos(angle);
        const dirZ = Math.sin(angle);
        let fits = false;
        for (const halfWidth of [SITE_HALF_WIDTH, NARROW_HALF_WIDTH]) {
          const { pos, neg, deckClear } = probeBridgeReach(
            x,
            z,
            dirX,
            dirZ,
            halfWidth,
            SITE_RAMP_IDEAL,
            SITE_BOUNDARY_MARGIN,
            SITE_PLOT_MARGIN,
          );
          if (deckClear && pos >= SITE_RAMP_FLOOR && neg >= SITE_RAMP_FLOOR) {
            fits = true;
            break;
          }
        }
        if (!fits) continue;
        // The railway runs square across the path: the pose's heading is the
        // path direction turned a quarter turn. This is the "at right angles"
        // half of the ruling, and it is true by construction rather than
        // checked afterwards.
        candidates.push({ x, z, hx: -dirZ, hz: dirX });
      }
    }
  }

  // Deterministic shuffle: the crossing is pseudo-random per Jim's design, and
  // a fixed sweep order would hand every seed the same corner of the park
  // first. Fisher-Yates against the park's own seed, so a park is reproducible
  // and two seeds do not rhyme.
  const rng = new Rng(seed ^ 0x0c9e);
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.unit() * (i + 1));
    const a = candidates[i] as Pose2;
    candidates[i] = candidates[j] as Pose2;
    candidates[j] = a;
  }
  // The gate corridor's own crossings go first — see {@link gateCorridorPoses}.
  // They are not shuffled into the field: their whole point is to be tried
  // before anything else, so the park's front door gets the planned crossing
  // whenever one is possible there at all.
  const gate = gateCorridorPoses();
  return [...gate, ...candidates].slice(0, POSES_OFFERED);
}

/**
 * {@link bridgeableCrossingPosesSearch} driven straight through — for the
 * measurement scripts and any caller with no frame to spend. The game's own
 * path goes through `trainRouteSearch`, which slices it.
 */
export function bridgeableCrossingPoses(seed: number): Pose2[] {
  const search = bridgeableCrossingPosesSearch(seed);
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}
