# Handoff — procgen stage 3, step 2: the trestles become claims

- **Model: Fable (`claude-fable-5-1`).** Jim's instruction, 6 Sep 2026: the
  big procgen refactor is always worked by Fable. **A replacement must run
  Fable too.** The Architect who owns the design and reviews this is also
  Fable, resumable through the Overseer.
- **Branch**: `feat/procgen-step2-trestles-claim`, cut from `origin/main`
  `d7da0408`. **Worktree**: `.claude/worktrees/procgen-step2`.
- **Brief**: `docs/BRIEF-stage3-step2-trestles-claim.md` on
  `origin/design/round-robin-generation` (not on `main`). Authority:
  `docs/DESIGN-round-robin-generation.md` there, "Stage 3, ruled (5 Sep, Jim)".
- **Two phases, not blurred.** Phase 1 (now): everything not dependent on the
  ground's shape. Phase 2 (when #511 merges): rebase, re-measure everything the
  ground touches. **Never guess the sphere's numbers in advance.**

## Findings that contradict the brief (reported to the Overseer, 6 Sep)

1. **Step 1 (#522) is NOT on `main`.** It merged into
   `design/round-robin-generation`. `main` has no `roadCorridor.ts`, no
   `GroundClaims` in production, no `roadCorridor` scheduler task. Step 2
   needs all three, so commit `d81d0820` **carries step 1 squashed onto
   `main`** (code only; the design docs stay on the design branch). The one
   conflict was `package.json`'s check chain, rebuilt from `main`'s 62 steps
   + `check:ground-claims` after `check:park-boot`, verified by parsing
   `scripts` (63 steps, none of `main`'s missing). **Drop that commit when
   #522 lands on `main` in its own right.**
2. **#511 is an open issue; its code is `origin/feat/sphere-combined`**
   (78 files, +14k, based on current `main`, does NOT contain step 1). It
   rewrites `Entrance.ts` (+710) which step 1 also edits (−124), adds
   `entrance/roadRoute.ts` (the curved road, outset ~16 read from
   `railRace/supportGround.ts`'s `SUPPORT_GROUND_BAND` — the interim owner
   step 2 deletes), and refactors `track.ts` (`trestleTreeAt`, a per-post
   leaning collider). Expect a real merge when it lands; phase 2 absorbs it.

## What step 2 is, in code terms (mapped 6 Sep)

- `src/world/railRace/track.ts`: `groundIsClear` (four predicates:
  `collision.isClearCircle(1.1)`, `distanceToPath < 2.8`,
  `distanceToRailCorridor < 2.4`, `PARK_LAYOUT.entries` bounding + 2.4),
  `ARC_NUDGES`/`RADIAL_NUDGES`/`WIDE_ARC_NUDGES`/`MANDATORY_RADIAL_NUDGES`/
  `WIDE_RADIAL_NUDGES`, `searchForClearGround`, `trestleSpots` (three-tier
  ladder), the trestle loop at ~L825 (`forkPlan`, `strut`, `collision.addCircle`).
- Consumers of the ladders outside `track.ts`: only doc comments —
  `test/procgen/invariants.ts` L2952 (`DUCK_BAR_SUPPORT_TOLERANCE` doc) and
  L3245 (a message), `test/procgen/parkFacts.ts` L2094 (comment naming
  `groundIsClear`). No code reads them.
- `RailRace.ts` L416: the walk-past ring registers collision first so the race
  ring's search sees its posts — the construction-order trick that becomes
  claim order.
- `World.ts`: `RailRace` built at ~L214, `Entrance` at ~L268; step 1
  re-commits the road corridor right after `Entrance` (spur end provisional
  z 52.00 → realised 55.91 on the canonical seed).
- Registry: `src/boot/groundClaims.ts` (`Claim` = footprint|corridor|
  walkable|surface, `Disc`|`Capsule`, `allows`, `blockers`, `commit` keeps a
  feature's order across re-commits). No heights on claims.
- Instruments on `main`: `check:swept-bus` (ratchet, 364 posts / 16 seeds,
  bidirectional, `scripts/swept-bus-baseline.mts`), step 1's
  `scripts/park-digest.mts` + `park-digest-sweep.sh` (per-mesh sha per seed;
  `railRace:trestle-legs` digest IS the leg-position hash), `check:ground-claims`.

## Ground-independence estimate (for Jim's progress number)

Roughly **70 % of step 2 by effort is ground-independent**: the claim shapes
from the drawn support (one function for build, explore and commit), the
registry wiring for both rings, the ladder deletion and the one outward march
with a derived lean limit, the invariants (claim count == leg count; no leg
claim overlaps another feature's), the instruments with controls (leg-position
digest per seed, one-function break, two-process determinism, spur-end vs foot
reach), and flipping `check:swept-bus` to fail-on-any. Ground-dependent
(phase 2): the road's outset marching the registry from its 8.26 floor (the
road on `main` is a fixed chord; the marching road lives in the sphere branch),
deleting `supportGround.ts`, the per-seed foot margin and outset report, driving
the swept-bus count to zero and deleting the baseline, the 40 m-run and
duck-bar invariants' final numbers.

## Baselines taken on this base (`d81d0820`)

- `check:swept-bus`: see scratchpad `swept-bus-before.log` (expected 364).
- Park digests, 16 seeds: scratchpad `before/<seed>.txt`.
(scratchpad = `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad`)

## Phase 1 built and measured (6 Sep, commits f5229ace, 5b26f233, 0f00bc17)

**What is in:** `track.ts` — the five nudge lists and the three-tier ladder
deleted; `trestleTreeAt` / `trestleStruts` / `trestleClaims` (one solved tree,
drawn and claimed from the same object); one outward march per slot, lean outer
(nearest first, inward before outward) × arc inner, bounded by
`maxTrunkLean(trunkHeight)` (`trestleGeometry.ts`, `tan(BRANCH_ANGLE)` × the
drawn trunk's height) and `arcReach = TRESTLE_SPACING/2 − foot`; the registry
asked first with the drawn geometry below `tallestHeadroom`, then the four
unmigrated predicates (`legacyGroundIsClear`); a duck-bar slot with no support
**throws** (`refused by <features>`). `Claim.headroom` +
`GroundClaims.tallestHeadroom`; the road's claims carry `CAT_BUS_TOP`.
`RailRace(collision, groundClaims)`; `World` builds it after the road's
realised re-commit (headless parks have no generator registry — the brief's
option 2). `STRUT_RADII` one owner. `check:ground-claims` probe 2 widened to
`[road, walk-past-ring, race-ring]`. Invariant
`railRaceSupportsAreClaimedAsDrawn` (registry == claims rebuilt from the drawn
struts through `trestleClaims`, float32 slack; lean ≤ `maxTrunkLean`; every
cross-feature claim pair obeys `CLAIM_COMPATIBILITY`; coverage on stderr).
`ParkFacts.railRaceSupports` decodes the instance buffers.

**Instrument control that failed, and the fix.** `scripts/park-digest.mts`
hashed `matrixWorld` + vertex positions only; an `InstancedMesh` keeps its
instances in `instanceMatrix`, so the whole-park digest was byte-identical
(`1ef4ff81decec5d4`) while `check:swept-bus` on the same park went 28 → 0.
Step 1's "byte-identical on all 16 seeds" could never have seen a leg move.
Fixed (hashes instanceMatrix + instanceColor, over `count`); re-baselined on
`d81d0820` in a scratch worktree (`scratchpad/before2/`), branch in
`scratchpad/after2/`.

**Measured on the hill (`main` geometry), all 16 pool seeds:**

| seed | result |
|---|---|
| 20260728 | builds; swept-bus **0 posts / 0 feet** (was 28 / 8); walk-past ring widest run **51.1 m** (>40) |
| 225 | builds; swept-bus **0 / 0** (was 24 / 8) |
| 5, 11, 24, 115, 128, 131, 208, 267, 274, 288, 326, 346, 428, 451 | **REFUSED**: "no support can stand for the duck bar at slot N of railRace:walk-past-ring (24: race-ring) … lean limit reached … refused by road" |

Why: on the hill the road (z=69, ±3.89 m) runs *through* the ring's band, and
a trunk's claim always contains the point under the rails (the top is under
the rails and below the bus's 5.98 m headroom), so no lean clears it — the
over-determination the design re-examination found; the old ladder "escaped"
only by leaning posts through the bus at height. **Step 2 cannot be green on
the hill. Phase 2 (the sphere, road outside the ring) is not optional.** Per
Jim, none of this is to be propped up.

**One-function proof (acceptance 3), red then reverted:** committing the
claims 1 cm wider than the ones the search asked with (`halfWidth + 0.01` at
the `commit` in `buildRailRaceTrack`) → invariant red on both rings, canonical
seed: walk-past claim 0 `capsule(18.52345, 73.00811, …, 0.282)` vs drawn
`0.272`; race claim 0 `capsule(20.42003, 73.64285, …, 0.69)` vs drawn `0.68`.
Green again on revert (93 trestles, 651 struts, 16,376 pairs).

**Observation for the Architect:** the walk-past ring's rails sit at 3.8 m and
the bus is 6 m tall; on the hill the bus's road crosses *under the walk-past
ring itself*, and no instrument measures rails vs bus (swept-bus sweeps
trestles only). Hill-only — on the sphere the bus never crosses the ring (only
the walking spur does) — but nobody has measured that either.

**`CAT_BUS_TOP` (5.98 m) vs the drawn box (6.15 m):** a 0.17 m pre-existing
gap between the asset-contract constant and the drawn ears; the headroom uses
the constant, the swept-bus check the drawn box. The check is the instrument
that would catch a branch in between.

**Gates on the hill (branch `50bc8380`):** `tsc`, `typecheck:test`, `build`,
`check:park`, `check:rail-race`, `check:ground-claims`, `check:seed-pool`,
`check:seed-coverage` green; `pnpm run check` runs 31 steps green then stops at
`check:fountain-hop`, the first multi-seed step (6 of its 7 seeds refuse — all
six errors are the refusal, nothing else). The 31 steps after it were run one by
one: **all 31 green** (scratchpad `chain-rest.log`). `check:swept-bus` exits 1: 2 seeds at 0/0/0,
14 NOT BUILT. `test:procgen`, `check:park-pool`, `check:gateway`: red on the
refusing seeds until phase 2 — not run in full, by design.

## Rebased onto main 930f5195 (#589 merged: seeds 267, 288 retired) — re-measured

Branch is 10 commits on `930f5195`; the two 0..15 pool commits were dropped
(that change lives in #584, open and red by design until the generator builds
0..15). The 0..15 table above was measured on the branch **with** `readSeed`
accepting 0, so its seed-0 rows were genuinely seed 0 — but that pool is not
on `main` yet, so the numbers that stand today are these, on the fourteen-seed
sweep (thirteen pool seeds plus the canonical):

| result | seeds |
|---|---|
| **build, 0 posts in the bus** | 20260728, 225 |
| **refuse** — a duck-bar slot the hill road blocks (`refused by road`) | 5, 11, 24 (race ring), 115, 128, 131, 208, 274, 326, 346, 428, 451 |

**New placer on the hill: 2 of 14 build, 12 refuse.** Retiring 267 and 288
removed two refusals and no builds. The sphere (road outside the ring) is the
thing that moves 12 → 0; nothing else is named by any refusal.

## Phase 2 checklist (when #511 is on `main`)

1. Rebase; drop the step-1 carry commit if #522 has landed on its own.
2. Merge with the sphere's `track.ts` (`trestleTreeAt`, `addPostCollider`,
   `SUPPORT_MAX_RADIAL_NUDGE` import) — keep this branch's search; take the
   sphere's leaning collider if it survives review.
3. Delete `railRace/supportGround.ts`; make `roadRoute.ts`'s outset march
   the registry from the 8.26 floor (`DOOR_PAVEMENT + BUS_DOOR_INBOARD`)
   until `allows` — report the outset per seed in the PR body.
4. Re-measure everything above on 16 seeds; expect 0 refusals; quote foot
   margins; re-run the digest before/after and account for every moved foot.
5. `check:swept-bus` must read 0 everywhere at POST_STEP 0.02 too, then the
   flip (fail-on-any, baseline deleted — already on this branch) is green.
6. `check:park-pool`, `check:gateway`, `check:coplanar`, `check`, `build`,
   `test:procgen`; chain parsed.

## Open questions for the Architect (asked through the Overseer)

1. Arc nudges: delete with the radial ladders, replacing both with one derived
   bound (`TRESTLE_SPACING / 2 − foot`, so neighbouring slots can never share
   ground), or keep arc as a free dimension? Proposed: one search over
   (lean, arc), nearest-first, lean-outer/arc-inner as today.
2. Lean limit: proposed `maxLean = tan(BRANCH_ANGLE) × trunkHeight`, trunk
   height from `forkPlan` (the `MIN_TRUNK_FRACTION` floor) — a trunk may not
   lean further from vertical than its own branches fork. Owner:
   `trestleGeometry.ts`.
3. Headroom owner: `catBus.ts` exports the body top (the sphere branch adds
   `CAT_BUS_BODY_TOP_Y`); the swept-bus check measures the drawn `Box3`
   (ears included). Which is "the bus's own owner"?
4. The four legacy predicates in `groundIsClear` stay, behind the one
   predicate function, as the not-yet-migrated obstacle list (stage 5), with
   the registry asked first. Confirm.

## Phase 2 measured on a scratch merge with the sphere (6 Sep, night)

Branch rebased onto `design/round-robin-generation` f6ad6032 (pushed
11d822c6; the step-1 carry commit is gone, `main` is in the base). The four
open questions are ruled — `HANDOFF-architect-procgen.md` at e422a951:
(1) (lean, arc) search as built; (2) `maxTrunkLean` as built; (3) headroom =
the DRAWN bus, `catBus.ts`'s owner made equal to the drawn top and
`check:swept-bus` asserting owner == Box3 top; (4) legacy predicates stay
behind the one function, each refusal NAMES its predicate
(`legacy:distanceToPath`), stderr count per seed. The throw on a refused slot
is step 4's to convert; keep the blockers named.

Scratch merge `scratchpad/step2-sphere-merge` (detached at 11d822c6 +
`origin/feat/sphere-combined`, NOT pushed, measurement only). Conflicts and
how they resolve — the recipe for the real merge once the sphere lands:
- `track.ts`: ours in all six hunks (ladders gone, registry-first search);
  graft the sphere's `addPostCollider` (leaning collider, walks the lean to
  `TALLEST_CHILD_HEIGHT`) called with `spot.tree.trunkFoot/trunkTop` in
  place of the single foot circle; drop its `postClearsEntranceRoad`,
  `isInEntranceRoad`, `SUPPORT_MAX_RADIAL_NUDGE` imports (the road is a
  corridor claim with headroom; the registry answers first); add
  `POST_TOP_RADIUS` to the trestleGeometry import; drop `footRadius` param.
- `roadCorridor.ts`: keep both imports (drop `CAT_BUS_LENGTH`); the sphere's
  per-run body already carries `headroom: CAT_BUS_TOP`.
- `parkFacts.ts`/`invariants.ts`: keep both; `busRun` fact becomes the ARC
  (`entranceBusArriveAt/VanishAt`, `entranceRoadAt/Facing`, ±half a bus,
  points every PLAYER_RADIUS with the right vector `cos/−sin facing`), and
  `theRoadClaimCoversTheBusRun` samples those through the sphere's
  `distanceOutside` (one owner) — the straight-road constants it read from
  `layout.ts` are deleted on the sphere.
- `swept-bus-baseline.mts`: deleted (ours). `supportGround.ts` STAYS: the
  road reads `outsetClearOfSupports` from it (road files are the sphere
  engineer's); re-derive its band from the lean bound rather than delete.

Numbers on the merge (`tsc` 0, `typecheck:test` 0):
- `check:swept-bus`: **0 posts on all 14 pool seeds, every seed built** (hill: 2/14).
- `check:park` per seed, trestle refusals: **0 on every pool seed (14/14
  built)**; seeds 0..15: 0 refusals on the ten whose ring gets built
  (0,2,4,5,6,7,9,11,13,15); 1, 12, 14 throw at the crossings and 3, 8, 10 at
  the train route BEFORE the ring exists — unmeasured, other producers'.
  Post-build reds are `poi.stranded`/`nospot` (the #596 rung, not in this tree).
- `test:procgen` 706/706; `railRaceSupportsAreClaimedAsDrawn`: worst lean
  **0 % of its limit on every seed** (98–100 trestles, ~40k claim pairs);
  `theRoadClaimCoversTheBusRun`: 87 samples, 17.8 m run, 0 outside, every seed.
Logs: scratchpad `merge-*.log`, `merge-seeds/`.
