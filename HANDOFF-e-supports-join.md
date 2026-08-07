# HANDOFF — e-supports-join

Branch `e/track-supports` (PR #248), continuing the previous agent's
`HANDOFF-e-track-supports.md` — **read that first for what was originally built.**
Worktree `.claude/worktrees/e-supports-join`, own dev port **5451**.
`origin/fix/cart-watertight-mesh` (PR #249) is **merged in**.

**Jim withdrew approval of the whole PR on 7 August.** Five faults; all five are
fixed, measured, guarded and looked at.

## The five

1. **Branches did not reach the track.** Fixed — each ends at the middle of its
   own lane.
2. **The vertical stub was not wanted.** Fixed — droppers deleted entirely.
3. **Sky Cruiser pylons.** Checked; raised to the middle of the track.
4. **Sleepers.** Checked — they were never floating, and now there is a guard
   that would notice if they were.
5. **Hands clipped through the cart after a bonk.** Fixed — and the cause was
   not a pose.

## The root cause behind faults 1-4, and it is one thing

**Every support check in `test/procgen/invariants.ts` measured in plan view.**

- `railCentreLines` builds its geometry with `point.set(x, 0, z)` — y discarded.
- `skyCruiserStandsOnItsOwnSupports` measured
  `Math.hypot(on.x - top.x, on.z - top.z)`.
- the sleeper check measured `nearestRail(grid, gaugePoint.x, gaugePoint.z)`.

Flatten the world onto the ground and a post that stops four metres below the
track sits in exactly the right place. That is how four checks confirmed the
trestles exist, their thickness, their fork angles, their spacing and their
count while **not one of them touched the track**. They were not weak checks;
they were checks about the wrong quantity, and being wrong the same way is why
their agreement was worth nothing.

The same mistake bit me twice more while fixing it, which is worth knowing:

- `route.nearestPoint(x, z)` is **itself** a ground-plane lookup. On a ride that
  crosses over itself and dives through the castle it answered with a stretch of
  track 0.89 m away in height from a pylon whose own track was 0.02 m above it.
- `nearestRail`'s "stop as soon as `nearest <= radius`" is only valid in 2D.
  `nearestTrackMiddle` widens one full ring past the first hit.

## Measured, canonical seed

| | before | after |
| --- | --- | --- |
| trestle branch top to middle of its lane | **0.58 – 4.30 m** | **0.011 – 0.045 m** |
| Sky Cruiser pylon top to middle of track | 0.131 – 0.152 m | **0.000 – 0.024 m** |
| sleeper centre below rail centre | 0.103 / 0.256 m | unchanged (correct) |
| worst arm clearance, all poses × sway | **−0.023 m (through)** | **+0.017 m** |

## Fault 1/2 — the design, and why it is not just "make them longer"

Branch tops are now `route.pointAt(lane, spot.at)` in full, height included.
Droppers are gone.

**The level tops were not arbitrary and the reason had to be replaced.** Each
lane undulates on its own phase, so at one station the four lanes stand up to
**4.38 m** apart in height (**3.02 m** within a single pair). Hang four branches
off one level fork and they swing towards horizontal — exactly what the old
comment in `trestleGeometry.ts` predicted.

So a fork node's height is measured **down from the lowest lane it carries**,
never the mean:

- the branch to that lower lane gets exactly the solved drop, so it opens at
  exactly the solved angle;
- its partner has further to climb, so it stands *more upright*, never wider.

The settled angles (30.0° walk-past, 41.6° race) are therefore **the widest the
fork can ever open**, and are otherwise untouched. `BEAM_DROP` moved into
`trestleGeometry.ts` so the test solves the same plan the builder did.

**The fork-angle invariant was re-expressed, not relaxed:** the *widest* branch
of each generation must **equal** the solved angle. Equality, not a ceiling — a
ceiling alone would be satisfied by a tree whose branches all went vertical.

## Fault 3 — the honest version, smaller than it first looked

The pylons were sunk a flat 0.15 m under a centre line whose ties occupy
0.08–0.16 m below it, so their tops were inside the tie **by about a
centimetre**. They did touch. **The Sky Cruiser was never floating the way the
Rail Race was.** What was true is that a centimetre of engagement on a 0.68 m
post is contact by luck, and nothing measured it either way. They now end at the
middle of the track, staying straight and vertical as Jim specified.

New leaf module `src/world/coaster/cruiserDimensions.ts` (rail radius, tie
thickness, tie drop, reach tolerance) on the `trestleGeometry.ts` precedent —
the test needed those numbers and copying them in would be the two-definitions
bug again.

## Fault 5 — the thing that clips is **not a pose**

The arm check held a hand-written list of five named poses. I replaced it with a
sweep of the whole pose space, which is a finite job: `RiderPose` is exactly
`duck`, `pump`, `cheer`, each clamped to 0..1, so the cube *is* the set of poses
the ride can make. 1331 states instead of 5.

**The swept cube came back clean at 0.057 m, and that is the finding.**
`RailRace.poseRider` places her at `cart.position.x + wobble` while the cart
stays at `cart.position.x`. A bonk therefore slides her sideways **relative to
the tub she is sitting in** — a displacement applied *after* the pose pipeline,
and invisible to any amount of pose sweeping. At the old 0.08 m her arm went
**0.023 m through** the wall.

So the sweep runs the cube at each of −sway, 0, +sway: **3993 states**.

**The cart is untouched.** `CART_WIDTH_AT_PARK_SCALE` stays 1.10 — a measured
ceiling, not a preference (1.12 fails `raceCameraNeverRunsBackwards` on seed 5,
and lane spacing derives from it). `BONK_SWAY` 0.08 → **0.04**, in
`duckPose.ts`, leaving 0.017 m of margin. The check asserts that relationship
against the **built** hopper, so changing either number re-does the subtraction.

Re-verified after merging #249: same numbers on the watertight tub.

## Guards, all proved red by mutation

`supportsMeetWhatTheyCarry` (new, replaces `droppersHangUnderRealRails`) keeps
`y` and measures branch tops, pylon tops and sleepers against the middle of the
track in 3D, off the built rails — averaging both of a lane's rail meshes by
shared `uv.x` lands halfway between them at rail height. Tolerance is the
track's own structure: one rail radius plus half a sleeper.

| mutation | result |
| --- | --- |
| branch tops back on the level plane (**today's geometry**) | red, "4.03 m from the middle of the nearest lane" |
| pylons sunk 0.15 m again | red, "0.15 m ... over the 0.115 m its ties reach down" |
| sleepers dropped a metre | red, "1.11 m ... it is floating" |
| a `trestle-droppers` mesh comes back | red |
| `BONK_SWAY` back to 0.08 | red, "arm goes 0.023 m through the side of the cart" |

**One of my own guards failed its mutation first**: the cruiser tolerance was
written as 0.16 (the full depth the ties reach), so a pylon grazing the tie's
lowest fibre counted as carrying it and the 0.15 m sink stayed green.

## Watched — and why the previous agent's watching did not show it

Headless Chromium (Playwright, throwaway profile, never the shared
chrome-devtools one), own dev server on **5451**, 0 console errors.
Shots in
`/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/68ade46a-c81d-46a8-8676-003ebeeaa648/scratchpad/joins/`.

**My first attempt reproduced the previous agent's mistake and I threw it away.**
`canonical-walkpast-b0-side.png` put the camera inside a rival's cart: rails and
a post visible, join completely obscured. A close crop of a trestle that does not
frame the *top* is not evidence about the join. The shots that count are aimed
**radially outward from the park centre** at the mean of a trestle's four branch
tops, from below (`-under`), level (`-level`) and from inside the ring
(`-inner`) — three angles, so a gap cannot hide behind the post.

Best single frames: `seed2-t3-under.png` (fork and four branches meeting four
lanes at four heights), `canonical-t3-under.png`, `seed2-cruiser7-under.png`
(pylon top embedded in the ties).

**Only the walk-past ring is visible to `/view` — the race ring's group is
`visible = false` until you board.** The race ring is the same code and is
covered on all five seeds by the invariant.

**Browser seed override does not exist** — `seedOverride()` is Node-only
(`LGP_SEED`), so the bundle always builds the canonical park. Seed 2 shots
required temporarily editing `PARK_SEED`'s fallback; **restored**. Do not leave
that patched, and do not run `npm run build` while it is (I did, and got a
bogus 2-failure procgen run out of it).

## Traps paid for, do not re-pay

- **`git checkout -- <file>` destroyed uncommitted work.** I did it to restore a
  mutation on `duckPose.ts`, which was also holding the only copy of `BONK_SWAY`.
  The cat-bus handoff records this exact lesson and I repeated it. **Commit
  before mutating.**
- **`--strictPort` earned its keep.** Port 5433 answered HTTP 200 while my vite
  had failed to start — another agent's server. Always check `lsof` and the log,
  not just curl.

## Open question for Jim — raised, deliberately not acted on

A branch now runs much further than it used to, and its **tip is 0.124 m radius
at race scale** — exactly the radius the old droppers were, which is what Jim's
*"far too thin"* landed on last time. On a station where one lane sits 3 m above
its neighbour the tallest branch reads as a long slender spike (visible in
`seed2-t3-under.png`). Thickness is not on my do-not-change list, but nor was I
asked to change it, so it is left alone and flagged. One number
(`BRANCH_TAPER`, or the upper branch's top radius) if he wants it chunkier.

## Status

- `npm run build` exit 0.
- `npm run test:procgen` **241 passed / 9 files / 0 skipped**.
- Pushed to `e/track-supports`. **Not merged.**
