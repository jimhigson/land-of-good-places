# HANDOFF: cat bus Stage B (`e-cat-bus-stage-b`, branch `e/cat-bus-stage-b`)

The journey, the loading screen, the skip, and the three visual faults Stage A
left open. Issue #245, PR #246.

**Read first:** `HANDOFF-cat-bus-stage-a.md` in this same tree — six rounds of
root causes, all measured, none repeated here.

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-cat-bus-stage-b`,
branched off `origin/e/cat-bus-stage-a` @ `1f5acd3`. `npm ci` done, exit 0.
**Pushes to `e/cat-bus-stage-a`** (PR #246's head) — the branch of the same name
is checked out in another worktree, which is why this one has its own.

## Baseline, read off the screen before touching anything

- `npm run build` — **exit 0**
- `npm run test:procgen` — **exit 0**, `Test Files 11 passed (11)` /
  `Tests 226 passed (226)`, **0 skipped**

That is the bar. A drop in the *pass* count is the tell for the seed-skip trap
(CLAUDE.md), not the fail count.

## The number that shapes the whole loading-screen design

**The park's `World` constructor takes 277–488 ms** (three runs, Node, this
branch, measured via `buildHeadlessPark().buildMs`). Not seconds.

The 16 s worst-seed figure in the brief is **the slide branch**, which is not in
this tree. On this branch a 20 s ride outruns generation by a factor of forty,
every time. That does not make the amortisation pointless — see below — but it
does mean the "generation outruns the ride" branch is a correctness requirement
rather than the common case, and must be **guarded rather than trusted**.

Module-scope work (`COASTER_PLANS` solved at import, `parkManifest`,
`PARK_BOUNDARY`) is *not* in that figure. It is paid at import time, before any
frame can render, which is why the boot is a blank screen today.

## Findings so far

### The foreground trees are the *treeline*, and it consults nothing

`ENTRANCE_CLEAR_X/Z/RADIUS` is a **10 m disc centred at (0, 56)**. The bus's
kerb is at `z = ENTRANCE_BUS_STOP_Z` = **69**. The disc covers z 46–66. **It has
never covered the bus at all** — it was sized for the old bus that parked
*inside* the park at z 54.6, and stayed put when the stop moved outside.

The trees actually in shot are `Scenery.ts`'s `buildTreeline()` — 540 trees in a
band `edgeRadiusAt + 11.5 .. + TERRAIN_APRON - 1.5`, i.e. from **z 71.5**
outward on the gate bearing. `buildTreeline` does **not** go through
`isPlantable`, so it never asked about the entrance keep-out even after Stage A
wired one up.

Arithmetic that names them, from the game's own camera constants
(`CAMERA_YAW_DEGREES` 45, `CAMERA_PITCH_DEGREES` 38 — the camera is
**orthographic**, so every view ray is parallel):

- view direction `(0.5573, 0.6156, 0.5573)` back towards the camera;
- a point at kerb `z` is crossed by the ray to the bus at height
  `busTop + 1.1046 * (z - 69)`;
- bus top ≈ 5.36 m, so at **z = 71.5 the ray is 8.2 m up** and a tall treeline
  tree reaches **9.3 m** (`height` up to 5.1 + canopy radius 3.1 × 1.35).
  **It blocks.** By z = 74 the ray is 10.9 m up and nothing reaches it.

So the keep-out wanted is not a bigger disc: it is *"nothing may stand in the
camera's own line to the bus, anywhere along the bus's run"* — derived from the
bus's box, its run along the kerb, and the camera's own angles.

## The keep-out — done, and the mutations that proved it

`src/world/entrance/arrivalSightline.ts`. The park camera is **orthographic**,
so occlusion depends only on its *direction* and "is this in front of the bus?"
has a closed form — no tuned radius. Angles from `core/constants`, bus extents
from `catBus.ts` (newly exported), run from `layout.ts`.

| mutation | went red with |
|---|---|
| treeline keep-out off | **25** planted things, canonical — *"treeline-canopies at 19.3, 78.6 reaching 7.0 m"* |
| tree keep-out off | seed 2 — *"tree-cones at 21.2, 64.8 reaching 4.1 m"* |
| bush keep-out off | seed 2 — *"bushes at 18.7, 64.7 reaching 0.7 m"* |

**Two of my own mistakes, both caught by measurement rather than by reading:**

1. **The occlusion test was inverted.** It asked whether the grazing ray fell
   *below the roof*; the right question is whether the object's top, projected
   to the bus, still lands *above the kerb*. The wrong version flags far
   harmless things and exempts the tall near ones, and it *looked* right — it
   did clear the corridor, just of the wrong trees. The tell was seed 2
   reporting a **0.7 m bush** as hiding an 18 m bus.
2. **I called the tree and bush keep-outs vacuous and deleted them.** I had
   measured "all three off" against "treeline off" **on the canonical seed
   only** and generalised to five. Seeds 2 has both a tree and two bushes in the
   corridor — the boundary bulges to 92 m off the gate's bearing, so the
   plantable scatter *can* reach the kerb. The invariant went red immediately.
   Exactly CLAUDE.md's *"quote the count off the screen, never the one you
   expected"*, and worth the entry because the deletion was the confident move.

## Stage B — built and watched

`src/world/entrance/BusJourney.ts` (its own `Scene`),
`journeyDirector.ts` (the sequencing, so a check can hold it),
`ui/JourneySkip.ts`, `scripts/check-bus-journey.mts`.

`Engine` is **hoisted out of `Game`'s constructor** — the ride draws before
`Game` exists and a second `WebGLRenderer` on one canvas is not a thing WebGL
gives you.

### Faults found by watching, that no check would have caught

1. **The lane's hills were 100 m out of step with everything on it.** The ground
   plane was displaced by `groundHeight(x, LOCAL z)` and then the *mesh* moved
   100 m down the lane; the road, hedges, trees and bus all read the same
   function in world coordinates. On screen it read as *"the camera is too
   high"*, which it was not.
2. **A shut door was a black rectangle.** `catBus.ts`'s *"dark opening behind
   the door"* sat **0.26 m in front of it**, on a slab 1.09 m thick. Pre-existing;
   invisible until something orbited the bus.
3. **Moving that slab inboard at full thickness broke `check:cat-bus`** — it
   then stood behind two windows. `WALL_THICKNESS` is what filling an aperture
   means.
4. **`WhatsNew` opens from `Game`'s constructor and pauses the park**, so the
   ride handed over to a modal with the bus frozen behind it.
5. **The first hill tuning hit a 27-degree gradient.** Shortening a wavelength
   makes a hill steeper without making it taller. Now 12.6, guarded both ways.

### Guards — `check:bus-journey`, all eight mutations red

| mutation | went red with |
|---|---|
| camera stops tracking the bus | *"the bus fills only 3.0% of the frame height"* |
| `BUS_SPEED = 0` | *"travelled only 0.0 m in 20s"* |
| settle aims off the park bearing | *"ends 34.4 degrees off the park camera's own bearing"* |
| `turns: 0` | *"sweeps only 0 degrees in half a ride"* |
| flat lane | *"never exceeds 0.0 degrees — this is a table"* |
| `skipOffered` always true | *"offered on the first frame, before any park exists"* |
| `readyToHandOver` ignores the park | *"hands over to a park that has not finished generating"* |
| park built on frame 1 | *"must wait until a frame of the ride has been drawn"* |

## NOT DONE, and this is the honest headline

**The 4.03 s of module-scope generation still happens before the ride, not
during it.** The ride hides only the 442 ms `World` build — about 10% of the
boot cost. `planSlide()` alone is **~3.46 s, 86% of it**, and it runs at import
of `src/world/slide/plan.ts`.

The route to fixing it, measured and specific:

1. Stop statically importing `Game` from `main.ts`. Every solved artefact is an
   independent module-scope `const` (boundary 43 ms, layout 3, train 44,
   coaster 37, rail race 13, paths 12–29) — `await import()` them in dependency
   order between ride frames and each is one frame's work.
2. That leaves `planSlide()`. Its cost is a single `solveRailRoute` with
   `restarts: 700` (`slide/plan.ts:1064`) — **700 independent attempts**, which
   is a generator waiting to happen: yield between restarts, drive it from the
   ride, and cache the result so `SLIDE_PLAN` picks it up at import.
3. Keep `SLIDE_PLAN` a module-scope `const` that runs to completion
   synchronously when nothing pre-warmed it, so `park-harness.mts`,
   `check:park` and `test:procgen` stay byte-identical and stay green. One
   solver, two drivers.

Do **not** convert the §7 module-scope constants to lazy accessors: that
invalidates the one-module-registry-per-seed contract `buildParkFacts` depends
on, and the blast radius is `vitest.config.ts` plus all five seed files.

## Decisions

- **The rail-race rainbow arch stays.** It crosses in front of the bus in every
  arrival frame and it is the loudest thing in the shot — and it is also the
  single strongest *"this is a theme park"* signal in the first frame of the
  park a child ever sees. The alternatives all cost more than the complaint:
  moving a solved four-rail route, moving the gate (the one fixed thing,
  Decision 5), or popping a rainbow rollercoaster into existence at hand-over.
  Reversible in one place if Jim disagrees.
- **The journey's passengers are copies, not the park NPCs.** They cannot be the
  crowd — it does not exist yet. They are dressed from the crowd's own lists
  (`art/models/kidLooks.ts`, moved out of `NpcSystem.ts` so this file can reach
  them without dragging `PARK_BOUNDARY` in), and her own look is carried across.

## Status

- [x] Read CLAUDE.md, issue #245 + 3 comments, PR #246 + 2 comments, Stage A handoff
- [x] Own worktree, `npm ci`, baseline build + procgen measured
- [x] Measured park generation cost (277–488 ms)
- [x] Root-caused the foreground trees (treeline, not the plantable scatter)
- [x] Bus dimensions exported; sightline keep-out + invariant (231 tests, 3 mutations red)
- [x] Opening framing — derived from the bus's bounding sphere; cat's face fully in shot
- [x] Rainbow arch ruling — stays; reasoning above
- [x] Stage B journey — built, watched, guarded
- [~] Loading screen — the `World` build is hidden by the ride; the 4 s of
      module-scope solving is **not**. Plan above.
- [x] Skip — gated on a park object existing, both directions guarded
- [x] Watched end to end in headless Chromium (SwiftShader), four rounds
