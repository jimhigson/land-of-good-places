/**
 * **Is the child actually on the slide, and actually drawn, all the way down?**
 *
 * ```
 * npm run check:slide-rider
 * ```
 *
 * This exists because of a bug that survived a first-person ride, a peer
 * review, a procgen suite and a family play-test, and was found only when the
 * camera turned round.
 *
 * `Building.advanceRide` placed the **rider** at `pointAt(t)` plus the castle's
 * centre and base height, while `rideMount` — the seat the camera hangs off —
 * copied `pointAt(t)` straight through. Only one of those can be right, and it
 * was the mount: the chute is built from `SLIDE_PLAN.points`, which are already
 * world coordinates, onto a `parkRoot` whose world offset is exactly zero. So
 * the rider rode the entire slide **26.65 m away from it, in mid-air** — and
 * nobody could see it, because first person hid her model. The one thing in the
 * wrong place was the one thing not being drawn.
 *
 * Jim found it the instant the ride became a chase camera: *"in the chase cam
 * it seems the player is still not drawn"*. She was drawn. She was 26 m away.
 *
 * ### Why this is a script and not a procgen invariant
 *
 * `test/procgen/invariants.ts` measures a **built park**, and the park is built
 * without a `Player` — nothing in it rides anything. This has to drive the real
 * `Building.update` loop with a real `Player` attached, because the defect was
 * in the per-frame code and not in the geometry. A test that recomputed the
 * rider's position from the chute would have agreed with the chute and passed
 * while the game disagreed with both; **it has to observe, not recompute.**
 *
 * ### What it asserts, every frame of a real ride
 *
 * 1. **She is drawn.** `player.group.visible`, and every ancestor up to the
 *    scene. An assertion that the camera mode is `chase` would have been true
 *    all along while she was invisible, so the question asked is the child's
 *    one: is there anything on screen.
 * 2. **She is on the chute.** Her feet are within the built trough
 *    (`CHUTE_ENVELOPE` plus `PLAYER_RADIUS`) of the curve's nearest point. This
 *    is the clause that catches the 26.65 m bug, and it is measured against the
 *    chute as drawn rather than against the plan it was drawn from.
 * 3. **The seat agrees with the rider.** The camera's mount and the player end
 *    up in the same place, which is the specific disagreement that caused this.
 *
 * Coverage is asserted too, in the tradition of `check:crowd` and
 * `check:ride-camera`: a ride that never started, or ended after two frames,
 * must fail rather than quietly prove nothing.
 *
 * ### And, since 6 August, it asks each camera the question that camera answers
 *
 * The ride now cuts between a **chase** camera and three **trackside** ones —
 * `world/slide/cameras.ts`, and Jim's ruling quoted there. That splits this
 * check's central question in two, and getting the split wrong would be worse
 * than not having it at all:
 *
 * - **Her body must read on a trackside camera.** Every trackside sample is
 *   measured in pixels and must put at least {@link TRACKSIDE_BODY_FLOOR} of
 *   the frame on her body. Not "more than zero": a child who is four pixels of
 *   shoulder in the corner of the shot is not a child you can see, and
 *   **unoccluded is not the same as legible** — which is the exact distinction
 *   the per-part raycast this replaced could not make. Jim, on the build where
 *   that raycast reported every part unobstructed: *"still can't see a body,
 *   maybe it is hidden behind the head anyway?"*.
 * - **Her body must NOT be demanded of the chase.** She lies on her back feet
 *   first, so her head is between a lens behind her and the rest of her *by
 *   construction* — measured at head ~2500 px, body 0. A clause demanding body
 *   pixels from both cameras would **fail correct behaviour**, and the pressure
 *   would then be to wreck the chase shot to satisfy it. What the chase is held
 *   to instead is that she is **on screen at all**: some of her, head or body.
 *   That is the assertion that would still have caught her riding 26.65 m off
 *   the chute, which is what this file exists for.
 *
 * ### Every part of the ride is covered by some camera
 *
 * A beat where neither camera has her is the kind of hole nobody notices until
 * a child rides it, so three separate things are asserted: **every ridden
 * frame** finds a live shot and a camera to render it with; **every beat in the
 * plan** is live at some point (a camera nobody cuts to is a camera nobody has
 * ever looked through); and **every beat is sampled**, so no beat can pass by
 * never having been measured.
 *
 * ### Measured in pixels, and only where she could possibly be
 *
 * Rays go through the **live** camera — the real object the game would render
 * with, from `Building.rideCameraNow` — but only across the rectangle her world
 * bounding box projects into. Pixels outside it provably cannot be her, so the
 * counts are exact and the check costs a fraction of a full raster. The box is
 * taken `precise`, from vertices rather than from each part's own axis-aligned
 * box: she is lying down, so the loose version is the union of thirty rotated
 * boxes and comes out 2.46 m across for a 1.1 m child, which is three times the
 * rays for the same answer. If any corner of the box is behind the lens the
 * whole frame is rastered instead, because the projection cannot be trusted
 * there.
 *
 * The raster is 240x135 — **landscape**, and the same one the head ~2500 px /
 * body 0 px measurement of the chase was taken on, so the numbers below are
 * comparable with it. A portrait phone widens the field of view
 * (`fitCameraToViewport`), which scales what fraction of the frame she fills
 * but changes nothing about *what is in front of her*, and occlusion is the
 * question here.
 */

import './headless-dom.mjs';
import { ACCEPTANCE_SCOPE, exitVoid } from './lib/checkScope.mts';
import { slideRider } from './lib/slideRider.mts';

// The check is `lib/slideRider.mts`'s, one owner with the acceptance loop.
const result = await slideRider();
if (result.voids.length > 0) {
  console.error('check:slide-rider VOID — measured nothing it could judge by');
  for (const line of result.voids) console.error(`  - ${line}`);
  exitVoid();
}
// Under the acceptance scope (`lib/checkScope.mts`) only decision clauses fail;
// in CI every clause does.
const failing = [...result.decisions, ...(ACCEPTANCE_SCOPE ? [] : result.code)];
if (ACCEPTANCE_SCOPE) {
  for (const complaint of result.code) {
    console.log(`  CODE (outside acceptance: fixed at cause, never restarted around) ${complaint}`);
  }
}
if (failing.length > 0) {
  console.error('check:slide-rider FAILED');
  for (const complaint of failing) console.error(`  - ${complaint}`);
  process.exit(1);
}
for (const note of result.notes) console.log(note);
