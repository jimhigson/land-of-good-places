import { Rng } from '../../core/mathUtils';
import type { Pose2 } from '../rail/segments';
import { GARDEN_PLAY_BOUNDARY } from '../boundary';
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
 */
export function bridgeableCrossingPoses(seed: number): Pose2[] {
  const candidates: Pose2[] = [];
  for (let x = -SWEEP_REACH; x <= SWEEP_REACH; x += POINT_PITCH) {
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
  return candidates.slice(0, POSES_OFFERED);
}
