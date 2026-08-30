# HANDOFF — wild pets on the roof garden (issue #406)

Branch `feat/wild-pets-roof-garden`, worktree `.claude/worktrees/wild-pets`.
**Stacked on `feat/ripika-is-a-pet` (PR #409)** — that one must merge first.
Dev server port **5406**, killed by PID when done.

## Environment

Just type `pnpm`; it resolves per project. `pnpm --version` cannot tell you
which version runs — check `npm_config_user_agent`. Build chain is **47**
steps, parsed not grepped; `test:procgen` is **not** in it, run it separately.

## What is built

- **`roofMeadow.ts`** — the long grass and the burrows. Region and burrow
  placement are both *derived* (clearance scoring + farthest-point), so #407's
  smaller roof and its market should move them rather than break them.
- **`WildPets.ts`** — emergence, roaming, the flee rule, the dive gate,
  catching, and the announcement.
- **`Building.ts`** — constructs it, updates it above the `!player` return,
  and puts its zones first in `interactZones()`.
- **`catalogue.ts`** — `pet.ripikaWild`, `shopId: 'roofGarden'` (not a real
  shop, same trick as `candy.spookyHouse`).
- **`store.ts`** — `catchWildPet`, `collectFlower`'s sibling.
- **`test/store/wild-pets-catch.test.ts`** — 9 tests, in CI.

## The two bugs worth knowing about

1. **`burrowAwayFrom` returned `null` for every creature.**
   `let bestDistance = -1` with `if (distance > bestDistance) continue` skips
   every hole. Nothing ever left, the population hit its cap of four in fifteen
   seconds and stood static for the session — half the feature dead. **Nothing
   on screen said so**; four pets roaming is what it should look like.
   Measured: 200 s with the player far away gave 4 creatures, **0 departures**.
   Now 16 and 13.
2. **The test guarding the dive gate was dead code**, which is why (1) lived.
   Deleting the gate left it green. That is the tell — a mutation cannot fail a
   test whose subject never runs.

There is now a second test pinning the *opposite* direction (creatures must
cycle), because a gate that froze everything forever would pass the first one
alone, and very nearly did.

## Four wrong grass shapes, all of which read fine in the file

Only visible by looking at it running:

1. thin leaning blades → a wire tripod, a spider on a lawn
2. chunky + upright + 7 close together → fused into a cone: tiny fir trees
3. evenly spaced angles, matched leans → symmetrical fan: teepees
4. jittered bearings but leaning to 0.62 and spread to 0.26 → spiky thistles

And the turf: square tiles stair-stepped; discs fixed that, but a 12-gon's
**inradius** (0.823 m) is less than a cell's half-diagonal (0.849 m), which put
a regular grid of **pink specks** through the lawn. `TURF_RADIUS` is derived
from the segment count now.

## Numbers, and where they came from

`PLAYER_MAX_SPEED` is 7.4 m/s. Burst **6.5** (just under her walk, so a burst
outruns her briefly and a chase always closes), cruise **3.0**, alternating —
average ~3.4. Flee **80 %** at destination-choice. Catch radius **2.2 m**.
`SAFE_DIVE_RANGE` **9 m**. Time above ground **35–60 s**, respawn **3–6 s**,
population **4**, burrows **5**.

## Not done / open

- **Not QA'd by a QA agent.** I looked at it in a headless browser and have
  screenshots; that is an engineer's check, not a QA verdict.
- **Not rebased onto #407** (still open). The meadow's derivation is *designed*
  to absorb the smaller roof and the market — **verify that rather than assume
  it**, it is the claim the design makes.
- `petBlob.ts` is still there and still used by `NpcSystem.ts:760`. Deleting it
  is #406's stated aim and is not done — it is a separate change and would have
  made this diff much larger.
- Two pets of the same kind can be out at once (uniform random over 5 kinds).
  Not wrong, but a "prefer a kind not already out" rule would read better.

## Status

- [x] Long grass, burrows, roaming, flee, dive gate, catching, announcement
- [x] Wild RiPika colourway — verified distinct: `#ffd63f` vs `#5fc86b`
- [x] tsc 0, tsc:test 0, build 0 (47 steps), test:procgen 0 (16 files, 474)
- [x] `check:castle` 0
- [x] Two mutations red, one test each, restored green
- [ ] PR opened
- [ ] Review + QA
