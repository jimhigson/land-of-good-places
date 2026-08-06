/**
 * **Where the ginormous slide puts a child down: in the balls.**
 *
 * Jim, having ridden it on 5 August 2026: *"at the bottom of the slide, at the
 * end of the ride, the player appears clipped into the slide, not in the ball
 * pit like they should"*. Both halves of that sentence were true, and they had
 * the same cause.
 *
 * ### Why she ended up inside the chute
 *
 * The ride finished at `SLIDE_PLAN.exitX/exitZ`, which `planExit()` picks by
 * fanning bearings out from the pit **starting at `fromCastle`** — the far side,
 * "because that is where a child is facing when they land, and it keeps the
 * exit off the chute". It does not keep the exit off the chute. `planExit`
 * rejects ground inside the castle and ground inside another plot, and that is
 * the whole of its knowledge: **it has never been told where the chute is.**
 *
 * So the chute's mouth and the spot a rider is teleported to were two formulas
 * fanned off the same bearing with nothing making them agree — this repo's
 * standing bug, and the reason it is fixed by deletion rather than by an offset.
 * The numbers make it certain rather than unlucky: the mouth sits `0.9` m above
 * the grass (`END_Y`), the trough hangs `CHUTE_ENVELOPE.below` under its centre
 * line and rises `CHUTE_ENVELOPE.above` over it, and a child is 2.12 m tall. Any
 * rider standing on the ground near the mouth is inside the chute from about
 * the waist up. Standing her on the **pit floor** is worse, not better: the pit
 * is scooped `BALL_PIT_DEPTH` down, so it lowers the floor without lowering the
 * chute, leaving 1.34 m of headroom for a 2.12 m child.
 *
 * `resolveDismount` could never have rescued it either. It pushes a rider out of
 * things in the **collision world**, and the chute is not in it — you are meant
 * to be able to walk underneath the ride. Only its legs are solid
 * (`supports.ts`). The safety net was real and was watching the wrong thing.
 *
 * ### What replaces it
 *
 * One owner, derived from the chute's own mouth: carry on **past the end of the
 * chute**, along the heading she is already travelling, and land in the balls.
 * There is no second bearing fan and no authored coordinate, so there is nothing
 * left that can drift when the route changes.
 *
 * The walk-graph exit node stays exactly where it is. It is what `check:park`
 * proves a child can walk away from (GAME_DESIGN.md's EXIT rule) and it is
 * still true: she lands in the pit, climbs out over the rim onto the grass, and
 * the node is the first place she can stand. What changed is that it is no
 * longer where the ride *drops* her.
 */

import { PLAYER_RADIUS } from '../../core/constants';
import { CHUTE_ENVELOPE } from '../building/SlideRide';

/**
 * Where the balls are, as an argument rather than an import.
 *
 * **This module deliberately reaches nothing seeded.** `BALL_PIT_X/Z` come from
 * `building/layout.ts`, which resolves a placement out of `parkManifest.ts` at
 * module load — so importing them here would mean `test/procgen/invariants.ts`
 * could not `import` this file without fixing the park's seed before the
 * harness has set `LGP_SEED`. That trap has cost this repo a whole suite going
 * quietly *skipped* rather than red, more than once.
 *
 * Taking the pit as a parameter also means this file needs no edit at all when
 * the pit stops being pinned and starts following the slide (#229): the one
 * thing it wants to know is where the balls ended up.
 */
export interface PitCircle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * How far past the mouth she carries on, in metres.
 *
 * **Derived from having to be clear of the thing she just came out of**, not
 * chosen for feel. The chute's centre line stops at the mouth, so the nearest
 * chute to her is the mouth itself: her body clears it by
 * `RUN_ON − CHUTE_ENVELOPE.halfWidth − PLAYER_RADIUS`, which at 2.6 m is 1.03 m
 * of daylight. At the 2.0 m first tried it is 0.43 m, which is clear but reads
 * as a near miss from the chase camera — you land looking straight back up the
 * chute you came out of, so the gap is the shot.
 *
 * It cannot run her out of the pit: `pitPoses` offers mouths at
 * `BALL_PIT_RADIUS − 1` at the furthest out, all of them facing the middle, so
 * 2.6 m of run-on ends up nearer the centre than it started. {@link clampToPit}
 * is the guarantee rather than the expectation.
 */
export const LANDING_RUN_ON = 2.6;

/**
 * How high above the balls she is handed back, in metres.
 *
 * Small on purpose. She is not thrown — the last thing a slide does is deliver
 * you, and a child arriving three metres up reads as being dropped. This is one
 * short plop into the balls, and it is what makes the scatter
 * (`BallPit.splash`) land on the frame she touches them rather than a beat
 * before, which is the difference between the balls reacting to her and the
 * balls happening to move.
 */
export const LANDING_DROP = 0.85;

/** How far inside the rim she is guaranteed to be, whatever the route did. */
const PIT_MARGIN = PLAYER_RADIUS + 0.3;

export interface LandingSpot {
  readonly x: number;
  readonly z: number;
}

/**
 * The spot a rider is put down, from the chute's mouth and the way it points.
 *
 * Exported and pure so that `Building.finishRide` and
 * `test/procgen/invariants.ts` ask the **same** function rather than each
 * carrying its own copy of the arithmetic. The invariant then measures the
 * answer this returns against the chute and the pit that were actually built,
 * which is the only way it can catch this going wrong again.
 *
 * `mouth` and `heading` are world-space; `heading` need not be normalised and
 * its vertical component is ignored, because where she lands is a question
 * about the ground.
 */
export function slideLandingSpot(
  mouthX: number,
  mouthZ: number,
  headingX: number,
  headingZ: number,
  pit: PitCircle,
): LandingSpot {
  const run = Math.hypot(headingX, headingZ);
  // A mouth pointing straight down has no opinion about which way to carry on.
  // Aim at the middle of the pit instead of dividing by zero.
  const [unitX, unitZ] =
    run > 1e-6 ? [headingX / run, headingZ / run] : unitTowards(mouthX, mouthZ, pit.x, pit.z);

  return clampToPit(mouthX + unitX * LANDING_RUN_ON, mouthZ + unitZ * LANDING_RUN_ON, pit);
}

/**
 * Pulls a spot radially in until it is inside the pit's rim.
 *
 * Radially rather than back along the heading, which would walk her *towards*
 * the mouth she is trying to get clear of — the one direction this must never
 * move her.
 */
function clampToPit(x: number, z: number, pit: PitCircle): LandingSpot {
  const dx = x - pit.x;
  const dz = z - pit.z;
  const distance = Math.hypot(dx, dz);
  const limit = pit.radius - PIT_MARGIN;
  if (distance <= limit || distance < 1e-6) return { x, z };
  return { x: pit.x + (dx / distance) * limit, z: pit.z + (dz / distance) * limit };
}

function unitTowards(fromX: number, fromZ: number, toX: number, toZ: number): [number, number] {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const length = Math.hypot(dx, dz);
  return length > 1e-6 ? [dx / length, dz / length] : [0, 1];
}

/**
 * How much daylight a rider standing at `(x, z)` has from a chute centre line
 * passing through `(cx, cy, cz)` — negative means she is inside it.
 *
 * The threshold is the built trough ({@link CHUTE_ENVELOPE}) plus her own
 * radius, never `slide/plan.ts`'s `CORRIDOR_RADIUS`: that is the wider margin
 * the *generator* steers by, and measuring against it would report a clip half a
 * metre before there is one. Shared with the invariant for the usual reason.
 */
export function riderClearanceFromChute(
  x: number,
  feetY: number,
  z: number,
  riderHeight: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const horizontal = Math.hypot(x - cx, z - cz) - (CHUTE_ENVELOPE.halfWidth + PLAYER_RADIUS);
  // Her head and the trough's underside, or the trough's top and her feet —
  // whichever pair is closer to touching.
  const vertical = Math.max(cy - CHUTE_ENVELOPE.below - (feetY + riderHeight), feetY - (cy + CHUTE_ENVELOPE.above));
  // Two solids overlap only where they overlap on *both* axes, so the daylight
  // between them is the larger of the two gaps, not the smaller.
  return Math.max(horizontal, vertical);
}
