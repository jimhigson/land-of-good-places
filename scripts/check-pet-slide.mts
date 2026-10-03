/**
 * **Do the pets actually come down the slide behind her?** (issue #468)
 *
 * ```
 * pnpm run check:pet-slide
 * ```
 *
 * Jim: *"When going down the slide, the pet should slide down behind the
 * player."*
 *
 * ### Why a script, and why it drives every frame
 *
 * Every failure mode of this feature is **mid-ride**, and mid-ride is the one
 * place screenshots cannot reach: the QA browser renders this park at 0.2–0.5
 * fps on swiftshader and a backgrounded tab throttles `requestAnimationFrame`,
 * so a sequence of frames costs minutes and arrives stale. A pet that is fine
 * at the lip and fine in the ball pit and gone for the two seconds in between
 * would pass a pair of stills and fail a six-year-old, who watches for it the
 * whole way down.
 *
 * So this rides the real `Building.update` loop with a real `Player` and a real
 * `Parade` — the same harness `check:slide-rider` uses, and for the same
 * reason: the defect class here is per-frame, not geometric. It **observes**
 * the bodies the game would draw. Nothing below recomputes where a pet ought to
 * be from the chute and compares that with itself; every number is read off a
 * `root.position` after the frame that moved it.
 *
 * ### What it asserts, every frame of a real descent
 *
 * 1. **Every companion is drawn** — `root.visible`, and every ancestor up to
 *    the scene. "Vanishes at the lip and reappears at the bottom is worse than
 *    one that never left" is Jim's own bar, so absence is a failure and not
 *    merely a gap.
 * 2. **Every companion is on the chute**, within the built trough
 *    (`CHUTE_ENVELOPE`), from shortly after boarding to the mouth. The grace at
 *    the start is not slack: the line runs on backwards behind the lip so that
 *    eight animals do not stand inside one another for the first second and a
 *    half (see `slide/petRiders.ts`), and this asserts that each one is aboard
 *    within {@link BOARD_SECONDS} and never off it afterwards.
 * 3. **Behind her, and in order.** Each companion's nearest point on the chute
 *    is further **up** the slide than the child's, and each next one is further
 *    up still — so "behind her" and "no two on the same spot" are both measured
 *    on the built curve rather than trusted to the spacing constants.
 * 3a. **And not inside her.** No companion's drawn geometry may touch the
 *    child's drawn geometry, mesh against mesh, on any ridden frame. Jim, 1
 *    September 2026: *"Pet on the slide shouldn't mean they clip inside the
 *    player's head."* This is the clause that would have caught that, and the
 *    reason none of the ones above did is worth reading: they are all about
 *    *distance along the chute* and about the *camera*, and a pet 1.5 m behind
 *    her on the curve is 0.78 m inside a child whose arms reach 2.28 m back.
 *    Ordering is not clearance and framing is not clearance. See
 *    {@link touching}.
 * 3b. **Lying down, as she is.** Every companion's own up axis is tipped at
 *    least {@link LYING_DOWN_DOT} back against the chute's tangent, which is a
 *    body on its back with its feet down the slide and not a body standing on a
 *    falling floor. Asked of the world quaternion the renderer would use, so it
 *    covers the pose *and* the frame it is composed in — the first attempt at
 *    this feature turned a pet in `XYZ`, where a recline and a yaw compose the
 *    other way round and a pet on a bend corkscrews out of the trough.
 * 4. **In the shot.** The first companion is inside the live ride camera's
 *    frustum on essentially every chase frame. This is the clause that answers
 *    "behind her *and clearly so*" — judged off what is framed, not off a gap
 *    in metres, because an agent this week rendered 116 clouds of which zero
 *    were on screen by reasoning about extents instead of looking.
 * 5. **No jump, ever.** No companion moves more than {@link MAX_STEP} in one
 *    frame after the boarding teleport — which covers the two hand-offs a child
 *    would see as a stutter: onto the chute and off it.
 * 6. **Back to her at the bottom.** Some frames after the ride ends every
 *    companion is off the slide and back within following distance of her.
 *
 * ### The control, and why it is in the file
 *
 * A green instrument proves nothing until it has been shown to go red. Several
 * checks in this repo have been clean, decisive and measuring the wrong thing —
 * `WildPets` compared a world position against floor-local coordinates and
 * every distance in the file was 1341.6 m while nothing was red.
 *
 * So this runs the descent **twice**. The second time the ride is not told
 * about the parade at all (`building.petParade = null`), which is exactly the
 * game as it stood before #468: the pets keep following the trail on the
 * ground. That run **must fail** the same clauses, and the check fails if it
 * passes — a control that cannot go red is not a control. It is asserted
 * positively, printed, and it is the reason to believe the green run.
 */

import './headless-dom.mjs';
import { ACCEPTANCE_SCOPE, exitVoid } from './lib/checkScope.mts';
import { petSlide } from './lib/petSlide.mts';

// The check is `lib/petSlide.mts`'s, one owner with the acceptance loop.
const result = await petSlide();
if (ACCEPTANCE_SCOPE && result.voids.length > 0) {
  for (const line of result.voids) console.error(`check:pet-slide VOID — ${line}`);
  exitVoid();
}
// Under the acceptance scope (`lib/checkScope.mts`) only the framing clauses
// fail; in CI every clause does, voids included.
if (ACCEPTANCE_SCOPE) {
  for (const line of result.code) console.log(`  CODE (outside acceptance: fixed at cause, never restarted around) ${line}`);
}
const failures = ACCEPTANCE_SCOPE ? [...result.decisions] : [...result.voids, ...result.decisions, ...result.code];
if (failures.length > 0) {
  // The seed goes on the failure line as well as the opening one: a red log is
  // what gets quoted into an issue, and quoted without the park it is about it
  // reads as flakiness rather than as a finding about one seed. #507's two red
  // seeds were each mistaken for a flake exactly this way.
  console.error(`check:pet-slide FAILED on park seed ${result.seed} (${result.source})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
for (const note of result.notes) console.log(note);
