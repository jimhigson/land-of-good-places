# Handoff — procgen stage 3, step 2: the trestles become claims

## READ THIS FIRST — cold start (written 7 Sep 2026 on Jim's pause)

**Branch and sha you are picking up:** `feat/procgen-step2-trestles-claim`
at **`a6652ca3`** (pushed). Base: `design/round-robin-generation` at
f6ad6032 (contains `main` and #596). Make your own worktree; never the
shared checkout; never `git stash`.

**Model:** this workstream runs on **Fable, by Jim's standing ruling**. A
replacement runs the same model.

**Approval state:** step 2 is **approved by the Architect at `a06178a4`**
(it re-measured everything itself, including its own red proofs). Nothing
on the branch up to a06178a4 needs re-review.

**The ONE outstanding change** — the duck-bar fairness clause re-cut, ruled
by the Architect at **`064e834b` on the design branch**: fairness is a
property of the race, and the race happens on the ride-scale ring only ("on
the walk-past ring nobody is racing, but the rivals do not know that" — no
standings, no winner, no player), so equal-per-racer on the walk-past ring
measured the wrong object. Required: equal-per-racer on the **race ring
only**; on the walk-past ring no-two-touch stays and each lane's count must
equal the race ring's count for that lane **minus the bars whose slot the
road rule skipped on that ring**, the skipped count printed per seed to
`process.stderr` ("walk-past ring: N bars lost to the road rule at slot S"),
so a bar missing for any other reason is still caught. **State: written and
committed at `a6652ca3` but UNVERIFIED beyond the canonical seed** — `tsc`,
`typecheck:test` and the canonical fairness test pass ("0 bars lost to the
road rule"). Still to do: (1) the red proof — drop one walk-past bar for a
non-road reason (e.g. in `buildRailRaceTrack`'s bar loop, skip
`layout.bars[0]` on the walk-past ring), watch the clause fail, revert by
the INVERSE EDIT (never `git checkout <file>` — that cost this branch a
commit once, b49cc4c0); (2) the sphere scratch-merge run, expected
**706/706** on `test:procgen`, with the stderr line on seed 131 ("1 bar lost
… (lane 2)" — 131's walk-past measured 10/10/9/10 before).

**The ONE blocker:** the PR cannot open until the sphere
(`feat/sphere-combined`, PR against `main`) lands on `main` and the
Architect re-merges `main` into `design/round-robin-generation`. Then:
fetch, rebase onto the design branch, apply the recipe below, run the gates
(`pnpm run check`, `test:procgen`, `build`, plus standalone `check:coplanar`,
`check:swept-bus`, `check:park-pool`; verify the check chain by PARSING
`package.json`'s scripts, never grep), take the per-seed whole-park digest
against the design base (`scripts/park-digest.mts`, one seed per child
process; it hashes `instanceMatrix`), and open the PR **against
`design/round-robin-generation`, never `main`**, from the drafted body at
`/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/pr-body-step2.md`
(session-local scratchpad; if gone, its substance is in the checkpoints
below — rebuild it). The 92-vs-93 walk-past legs sentence for Jim ("a post
near the bus's road is gone, not moved") must be measured on the real merge
before it is written.

**The merge recipe, collected** (worked out on a scratch merge with the
sphere at b6b1a983; the sphere has moved since — expect the same shapes):
- `track.ts`: ours in every hunk (ladders gone; registry-first (lean, arc)
  search; `treeStandsOn`; `legacyRefuser`); graft the sphere's
  `addPostCollider` (leaning collider) and make the `registerCollision`
  closure call `addPostCollider(collision, spot.tree.trunkFoot,
  spot.tree.trunkTop, ringSizeVsRace)` instead of the single foot circle;
  drop the sphere's `postClearsEntranceRoad`, `isInEntranceRoad`,
  `SUPPORT_MAX_RADIAL_NUDGE` imports and its "whole post, not just its foot"
  comment; add `POST_TOP_RADIUS` to the trestleGeometry import; drop the
  `footRadius` parameter; keep exactly one `TALLEST_CHILD_HEIGHT` import.
- `roadCorridor.ts`: import `PATH_KERB_OVERHANG` only (no `CAT_BUS_*`; the
  claim carries no headroom); the sphere's per-run body stays.
- `check-swept-bus.mts`: ours (parent-side owner and driven assertions, the
  walk-past-by-name sweep), then the sphere's arc lines (`fromAt/toAt`,
  `entranceRoadAt/Facing`) in the summary block.
- `check-ground-claims.mts`: both import lines (`RAIL_RACE_FEATURE`,
  `ROAD_HALF_WIDTH`).
- `parkFacts.ts`: keep both imports (`InstancedMesh`, `measureGateArch`);
  the `busRun` fact reads the ARC through `roadRoute`'s accessors
  (`entranceBusArriveAt/VanishAt`, `entranceRoadAt/Facing`, ±half a bus,
  points every `PLAYER_RADIUS`, right vector `cos/−sin facing`) — the sphere
  deletes `layout.ts`'s three straight-road constants.
- `invariants.ts`: keep both list entries; `theRoadClaimCoversTheBusRun`
  samples the arc points through the sphere's `distanceOutside`; clause 4 of
  the ring invariant: keep the sphere's `legAxis` line beside our
  `RADIUS_SLACK`/`CENTRE_SLACK`.
- `swept-bus-baseline.mts`: deleted (ours). `supportGround.ts` STAYS — the
  road reads it; #601 is filed for its orphaned constant; do NOT re-derive
  it here (it moves the road and erases the digest evidence).

**The fact the whole rewrite rests on:** the two Rail Race rings are
**never in the world at once** (`RailRace.setActiveRing` shows exactly one;
the race ring registers no collider). Both the one-feature change (both
rings claim as `railRace`; neither refuses the other) and the road rule's
asymmetry (the walk-past ring skips its legs over the road; the ride ring
keeps every leg) rest on it. **If that fact were ever false, both are wrong
together.** `check:swept-bus` sweeps the walk-past ring alone, by name, for
the same reason.

**Red proofs already run (do not re-derive), each reverted by inverse edit:**
one-function claim proof (claims committed 1 cm wider than searched → red
on both rings); `layout.falseRefusal` (#596: exemption −1e9 → red on seed
1); `CAT_BUS_TOP` +1 cm → `check:swept-bus` "off by −0.0100", exit 1;
`CAT_BUS_DRIVEN_TOP` +1 cm → same, in the parent; union check (commit only
the walk-past slice → "126 railRace claims but the slices total 302");
ring-solidity clause (register the race ring's feet → "registered a collider
of its own radius 0.680 m"; the Architect reproduced it, 46 legs); radius
guard (equal radii → "this clause cannot tell the rings apart"). The
fairness re-cut's red proof is the one NOT yet run.

**Numbers to expect on the sphere scratch merge (b6b1a983 + a06178a4):**
`check:swept-bus` 0 posts on 14/14, owner and driven 0.0000; trestle
refusals 0 on every pool seed, both rings built; canonical race ring
`legacy:collision` 0; walk-past ring skips one gate slot on 24, 115, 131,
346, 428, 451; `test:procgen` 705/706 before the fairness re-cut (residue:
131's walk-past 10/10/9/10), 706/706 expected after. Hill: 3/14 build (a
road running along the ring; retired).

Everything below is the chronological record.

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

## Rulings 3 and 4 built; Architect's driven-top finding built (6–7 Sep, night)

Head **65982c2a** (pushed). Commits: 8cad795b ruling 4 (`legacyRefuser`
names the predicate; per-ring stderr coverage line); f92830c1 ruling 3
(`CAT_BUS_TOP` derived from the face's crown — measured vertex-precise: face
6.0429, ears 5.9845, old constant 5.9751; the "6.15" was `Box3.setFromObject`'s
default box of a tilted cone); c5544009 the owner assertion moved to the
check's PARENT (the child's stdout is the JSON channel — inaudible there);
65982c2a **driven top**: `suspensionTravelAt(z, x)` is the one owner of
heave + pitch·|z| + roll·|x| (ride lift, mudguard, step and crown all read
it); `CAT_BUS_DRIVEN_TOP = 6.6411` (+0.5982); the corridor claim carries it;
`check:swept-bus` sweeps the box raised by it and still asserts rest top ==
Box3 (proved red at +1 cm, "off by −0.0100", exit 1).

Corrections from #596 QA, recorded: the seed-1 digest `48740be264e8be1f` is
the PRE-rebase value (post-rebase `d918bf4082f679da`, 5561 meshes); my pair
was measured pre-rebase on both sides but quoted after the rebase push.
`test:procgen` on the design branch is 676 passed; the 766 was my terminal on
the pre-rebase head. **Step 3 todo (Overseer):** `probed-alone=0` in the
layout trace needs its sentence, one line in `parkLayout.ts`.

Scratch merge (`scratchpad/step2-sphere-merge`, now at step 2 65982c2a +
sphere **b6b1a983** — the sphere has since moved to 40dcbc87; re-merge before
trusting these on a newer sphere). Extra recipe items: drop the sphere's
"whole post, not just its foot" comment in `legacyRefuser` (describes the
deleted `isInEntranceRoad`); `check-swept-bus.mts` summary block: owner line
+ driven line, then the sphere's arc line; `roadCorridor.ts` import =
`CAT_BUS_DRIVEN_TOP` + `PATH_KERB_OVERHANG`.
Measured with the driven headroom: `check:swept-bus` **0 posts, 14/14
built**, owner 0.0000 off, driven 6.6411; trestle refusals **0** on all 14 pool
seeds and on the ten of 0..15 whose rings build (rings-built read off the
coverage lines; 1/12/14 crossings, 3/8/10 train route never reach the ring);
race ring `legacy:collision` 97–100 per seed (one per slot's first candidate),
walk-past 0 except seed 346 (1). **Digest vs sphere alone (b6b1a983, same
instrument), 14 pool seeds:** byte-identical whole park on 8 (5, 11, 128,
208, 274, 326, 225, 20260728); on 24, 115, 131, 346, 428, 451 only the three
`railRace:trestle-*` groups differ — no other group on any seed (answers the
World.ts build-order question by measurement). Logs: `digest2/`,
`merge-seeds2/`, `merge-swept-bus4.log`.

## Driven top, second round (7 Sep, small hours) — head 61b306e0

Architect at 65982c2a: roll does not belong at the crown (x = 0; second-order
it LOWERS it, −4.8 mm at full roll), the linear pitch·FACE_Z overstated the
rotated crown, and nothing compared the derived number to the mesh. Built:
`crownHeightUnderPitch` = `FACE_Y cos + FACE_Z sin + FACE_SEMI_Y cos` — the
drawn face is a 38-segment sphere whose POLE VERTEX stays the top for any
pitch under π/38, and the smooth ellipsoid's support function overstates that
by 0.9 mm (measured; fails the millimetre). `CAT_BUS_DRIVEN_TOP` = 6.4991
(RIDE_LIFT + heave 0.2 + crown at pitch 0.042). `check:swept-bus` poses the
chassis (heave +MAX, pitch ±MAX, roll 0/±MAX) inside the at-origin unrotated
window, sweeps with the highest vertex-precise top, and the parent holds the
owner to it at 1 mm; red at +1 cm. `suspensionTravelAt` stays for chin, wheel,
step. **Trap paid for:** b49cc4c0 undid its red-proof mutation with
`git checkout <file>`, which also discarded the uncommitted pole-form edit —
the commit shipped the assertion against the old owner. Undo a proof
mutation with its inverse edit, never by checking the file out (61b306e0).
A first posing read 6.2003: the bus had already been put back at its world
position and heading — pose in the same at-origin window as the rest box.

Scratch merge now at 61b306e0 + sphere b6b1a983: `check:swept-bus` 0 posts,
14/14, owner 0.0000, driven 0.0000 (posed 6.4991 at heave +0.2, pitch −0.042,
roll 0); trestle refusals 0 on all 14 pool seeds, both rings built on every
one. `ENTRANCE_ROAD_OUTSET` 19.070 — `max(8.26, outsetClearOfSupports(3.89))`
from `supportGround`'s typed band; the road does not march the registry, so
the headroom cannot move it (ruled: NOT in this PR — filed as #601; re-derive
`SUPPORT_MAX_RADIAL_NUDGE` from `maxTrunkLean`, ≈8.1 vs 8, in this PR or the
sphere's). **Observation for the sphere engineer:** at b6b1a983
`entranceRoadBrow()` is 1.0 m, so `check:swept-bus` drives the bus only from
+1 to −1 m of arc (`entranceBusArriveAt/VanishAt`) — about one bus length of
road round the stop; whether that is the whole run the bus drives is theirs.
**`legacy:collision` named (probe, canonical seed):** all 100 race-ring
refusals are 0.728 m from a circle r = 0.272 — the walk-past ring's post
collider (`POST_FOOT_RADIUS × 0.4`), centre exactly 1.0 m off: the 1.1 m
clear-circle test refuses what the registry's compatibility (foot 0.68 vs
0.272, gap 0.048) allows. First stage-5 item, for the PR body.
**Moved feet (scratch vs sphere alone, same instrument):** 24, 115, 131, 428,
451 — one leg per ring; 346 — two per ring; 14 legs across six seeds, every
other leg byte-identical, and no non-trestle group on any seed.

**Step 2 approved by the Architect at 61b306e0** (re-posed: 0.0000 rest and
driven; ellipsoid support 0.96 mm above the polygon pole). PR-body item: the
canonical walk-past ring draws 92 legs vs 93 under the rest-top claim (a
non-mandatory slot near the road skipped by the taller headroom) — Jim's
sentence: **a post near the bus's road is gone, not moved.** NOT reproduced on
the scratch with sphere b6b1a983 (50 + 50 legs on sphere-alone, rest-top and
driven heads, 0 differ); measure on the real merge and put it in the digest
table. Open the PR from `scratchpad/pr-body-step2.md` once the sphere is on
the design branch.

## One rail race, one feature; Jim's road rule; headroom deleted (7 Sep) — head ab763a4d

Rulings (Overseer/Architect, recorded on the design branch): (a) there is ONE
rail race drawn at two scales, so both rings claim as `RAIL_RACE_FEATURE =
'railRace'` (`railRace/feature.ts`, a leaf) — 7eba9cc0; the walk-past
colliders register AFTER both rings are placed (`RailRaceTrack.
registerCollision`), so the race ring's `legacy:collision` never sees them:
canonical race ring 100 → 0. (b) Jim: *"just skip all the legs over the road,
otherwise keep them"* — 609fd20a; extended to the WHOLE drawn tree at the
nominal slot and of every march candidate (`treeStandsOn`) — 091d813c —
because claims now clip at `TALLEST_CHILD_HEIGHT` and a candidate's branches
over the carriageway are otherwise invisible to the registry. Deleted:
`Claim.headroom`, `tallestHeadroom`, the corridor's driven-top headroom,
`trestleClaims`' headroom parameter. Kept: `CAT_BUS_TOP`, `CAT_BUS_DRIVEN_TOP`
(posed crown), `suspensionTravelAt`; `check:swept-bus` is the guard. (c) The
ring-solidity clause re-cut by radius (0.272 vs 0.680) — ab763a4d; red by
registering the race feet.

Hill (this branch alone): 14/14 pool seeds BUILD (2/14 before); the guard's
residue on 5, 11, 326, 346, 451 is all beyond the kerb claim's clipped inner
end (Architect: 0 of 25 posts inside the claim) — the road's, hill-only.
Hill-only costs of the rule where a road runs ALONG the ring: widest
unsupported run 59.7/71.7 m (seed 11), 59.4 m (131) vs 40 m; fairness
9/9/8/9 (11), 10/9/9/8 (131); `theRoadClaimCoversTheBusRun` on 5, 11, 24, 326.

Sphere scratch (b6b1a983 + all four): typecheck:test 0; swept-bus 0 posts
14/14, driven 0.0000; refusals 0; legacy:collision 0; **test:procgen 704/706**
— the rule fires at the GATE (the road runs radially in and crosses the band):
one slot per ring on 24, 115, 131, 346, 428, 451, race-only on 128, 326; on
131 (race 9/10/10/10) and 326 (walk-past 10/10/9/10) that slot carries a duck
bar → fairness red. Reported, not pre-solved: Jim's pending question (legs on
the bus road) now has a cost. Recipe additions for the real merge:
`roadCorridor.ts` import = `PATH_KERB_OVERHANG` only; drop the duplicate
`TALLEST_CHILD_HEIGHT` import in `track.ts`; `registerCollision`'s closure
calls `addPostCollider(collision, spot.tree.trunkFoot, spot.tree.trunkTop,
ringSizeVsRace)`; `invariants.ts` clause 4: keep the sphere's `legAxis` line.
Logs: `merge-swept-bus7.log`, `merge-seeds4/`, `merge-procgen5.log`.

## Jim's final road rule; radius guard (7 Sep) — head a06178a4

Jim, with the duck-bar cost put to him: *"ok fine, make the big version have
all its legs, but the normal version can have them selectively."*
`RailRaceTrackOptions.respectsRoad` — walk-past true, race false;
`treeStandsOn` asked of the walk-past ring only; the race ring places every
slot and backtracks off the road's claim like any other (it does not skip).
Sound because the rings are never co-present — the same fact the one feature
rests on (stated in `RailRace.ts`). `check:swept-bus` sweeps the walk-past
ring only, by exact group name, and reports the race-ring instances it did
not sweep. Clause 4 asserts the rings' foot radii differ by > `RADIUS_SLACK`
before measuring (red at equal radii; Architect's item on ab763a4d, which it
approved with its own red proof).

Sphere scratch (b6b1a983 + whole series, cherry-picks clean): swept-bus 0
posts 14/14, driven 0.0000; refusals 0, both rings built everywhere;
walk-past skips one gate slot on 24, 115, 131, 346, 428, 451; **test:procgen
705/706** — the residue is seed 131's walk-past ring 10/10/9/10 (its gate slot
carries a bar): the ruling's alarm, not pre-solved; Overseer's call. Hill:
3/14 build (race claims meet the road along the ring) — retired cost;
canonical hill invariants green. Logs: `merge-swept-bus8.log`,
`merge-procgen6.log`, `merge-seeds5/`. PR body: `scratchpad/pr-body-step2.md`.

## Fairness re-cut: red proof run (11 Sep, on the rebased head 3dd39a3f)

Rebased clean onto `design/round-robin-generation` 1eb6f210 (three-dot stat:
the same 15 files, one deletion — `swept-bus-baseline.mts`, ours); `tsc` 0,
`typecheck:test` 0. Canonical-seed geometry the proof was taken against:
race ring 10/10/10/10, walk-past ring 10/10/10/10, **0 bars lost to the road
rule**. Mutation in `buildRailRaceTrack`'s bar loop — `for (const
[redProofIndex, bar] of layout.bars.entries()) { if (redProofIndex === 0 &&
<cond>) { barSlots.push([]); continue; } …` — undone each time by restoring a
byte copy taken before the edit (residue 0, `git status` clean):

- **A, race ring** (`!options.respectsRoad`): `2 failed | 90 passed`, the
  clause says *"the race ring gives its four racers 9/10/10/10 duck bars"*
  and, from the walk-past comparison, *"walk-past 10/10/10/10 but the race
  ring gives 9/10/10/10 … expected 9/10/10/10"*.
- **B, walk-past ring** (`options.respectsRoad`): `2 failed | 90 passed`:
  *"the walk-past ring gives its lanes 9/10/10/10 duck bars, but the race ring
  gives 10/10/10/10 and the road rule accounts for 0 on this ring (expected
  10/10/10/10) — a bar is missing for a reason the road rule does not
  explain"*. The stderr line printed on the passing side of each run:
  `walk-past ring seed 20260728: 0 bars lost to the road rule`.

(The second red in each run is the support clause — a dropped bar has no
support under its slot — not this one.) A first version of the script did
not prove anything: its `-t` filter matched no test name (92 skipped) and its
`barIndex` shadowed track.ts's own; a proof that skips everything reads as
green — read the pass count.

## PR body draft (rebuilt 11 Sep — the scratchpad copy was lost; this one lives on the branch)

Open against `design/round-robin-generation`, never `main`. Fill every
`«…»` from the real merge before opening; nothing below is to be quoted from
the scratch merge if the real base moved the number.

---

**Stage 3, step 2: the Rail Race's trestles become claims — one search, one
shape, Jim's road rule**

Base: `design/round-robin-generation` (the sphere on `main` merged in).
Brief: `docs/BRIEF-stage3-step2-trestles-claim.md`; rulings in
`docs/DESIGN-round-robin-generation.md` ("Stage 3, ruled") and the Architect's
`HANDOFF-architect-procgen.md`. Approved by the Architect at `a06178a4`; the
fairness re-cut (`064e834b`) is the one change after that, proved red both
ways (below).

**What a player sees.** On the walk-past ring, no trestle leg stands on the
cat bus's road any more, and every post is solid along its whole lean, not
just at its foot. `/spawn?pos=«x,z»&facing=«deg»` stands you at the gate
looking along the road under the ring: «one sentence naming what is
different there, measured on the real merge». The ride-scale ring is unchanged
to look at — it keeps every leg (Jim: *"make the big version have all its
legs, but the normal version can have them selectively"*).

**What changed.**
- `track.ts`: the five nudge ladders are gone. Each slot does one outward
  march over (lean, arc), nearest first, bounded by `maxTrunkLean(trunkHeight)`
  (`trestleGeometry.ts`: a trunk may not lean further from vertical than its
  own branches fork) and `arcReach = TRESTLE_SPACING/2 − foot` (two slots can
  never share ground). The registry is asked first, with the drawn tree
  (`trestleTreeAt` → `trestleClaims`, one function for search, build and
  commit); the four unmigrated predicates stay behind it, and a refusal names
  its predicate (`legacy:collision`, `legacy:distanceToPath`, …) with a
  per-ring count on stderr.
- One rail race, one feature (`RAIL_RACE_FEATURE`): both rings claim as it;
  the walk-past colliders register after both rings are placed
  (`RailRaceTrack.registerCollision`), through the sphere's `addPostCollider`
  along the lean to `TALLEST_CHILD_HEIGHT`.
- Jim's road rule, final form: `respectsRoad` — the walk-past ring does not
  build a slot whose drawn tree stands on the road's corridor claim
  (`treeStandsOn`, asked of the nominal slot and of every march candidate);
  the ride ring ignores the road. Sound because the rings are **never in the
  world at once** (`RailRace.setActiveRing`) — the one fact both this and the
  one-feature change rest on.
- Headroom deleted (`Claim.headroom`, `tallestHeadroom`, the corridor's
  driven-top claim). Kept as the guard: `check:swept-bus` sweeps the drawn bus
  **posed at its highest** (`CAT_BUS_DRIVEN_TOP` = «6.4991», heave + pitch,
  the pole vertex of the drawn face) against the walk-past ring only, by
  name, and **fails on any post on any seed** — the ratchet baseline
  (`swept-bus-baseline.mts`, 364 posts) is deleted. `CAT_BUS_TOP` is derived
  from the face's crown and asserted equal to the drawn `Box3` in the check's
  parent (the child's stdout is the JSON channel).
- Fairness re-cut: equal-per-racer on the race ring only; the walk-past ring's
  lane counts equal the race ring's minus the bars whose slot the road rule
  skipped (`RailRace.barsLostToRoad`), printed per seed to stderr.
- `supportGround.ts` stays (the road reads it; #601 owns its orphaned
  constant). Step 4 converts the throw on a refused slot; blockers are named.

**Measured on the real merge («sha») — 14 pool seeds + canonical.**
- `check:swept-bus`: 0 posts on 10/10 pool seeds (scratch: 11, 24, 128, 131,
  208, 274, 326, 428, 451, 20260728), walk-past ring only by name; owner
  `CAT_BUS_TOP` 6.0429 vs drawn 6.0429 (off 0.0000), driven
  `CAT_BUS_DRIVEN_TOP` 6.4991 vs posed 6.4991 (off 0.0000); both controls
  held. «re-quote on the real merge»
- Trestle refusals: «0» on every seed; both rings built on every seed.
- Walk-past ring skips one gate slot on «24, 115, 131, 346, 428, 451».
- `test:procgen`: «611/611» (scratch: 19 files, 611 passed, 0 failed, 0
  skipped). **Why not the 706 quoted earlier on this branch:** that was 20
  files on sphere b6b1a983; sphere commit 364672c1 retired pool seeds 5, 115,
  225 and 346 and deleted `test/procgen/seed-5.test.ts`. The two sorted file
  lists diff to exactly that line; `vitest list` collects 95 tests per seed
  file on this tree and 611 in total, and 706 − 611 = 95 = one seed file. Not
  a file that stopped being collected. Seed 131: `walk-past ring seed 131: 1 bar(s)
  lost to the road rule at slot «S» (lane «L»)` — the road rule's one cost,
  put to Jim with the number and accepted.
- Whole-park digest per seed (`scripts/park-digest.mts`, hashes
  `instanceMatrix`) vs the base without step 2: «byte-identical on N seeds;
  on the rest only the three `railRace:trestle-*` groups differ — no other
  group on any seed». Moved feet: «table».
- Walk-past legs on the canonical seed: «N» vs «N» on the base — «"a post
  near the bus's road is gone, not moved" / or: no leg differs».
- `check:park-pool`: 10/10 pool seeds pass with the ratchet enforced
  (scratch). `pnpm run check` «66 steps, all green», `build` green,
  `check:coplanar` green; chain verified by parsing `scripts` (66 = the
  design branch's 65 + the sphere's `check:arrival-camera`; every step of
  both parents present).

**Red proofs (each reverted by inverse edit):** claims 1 cm wider than
searched → red on both rings; `layout.falseRefusal` → red on seed 1;
`CAT_BUS_TOP` +1 cm → `check:swept-bus` "off by −0.0100", exit 1;
`CAT_BUS_DRIVEN_TOP` +1 cm → same, in the parent; committing only the
walk-past slice → "126 railRace claims but the slices total 302"; registering
the race ring's feet → "registered a collider of its own radius 0.680 m";
equal foot radii → "this clause cannot tell the rings apart"; a race bar
dropped → "9/10/10/10"; a walk-past bar dropped → "a bar is missing for a
reason the road rule does not explain".

**For stage 5 (the migration list, read off the refusal traces):** the 1.1 m
`legacy:collision` clear-circle refuses what the registry's compatibility
allows (measured: 0.728 m from a 0.272 m walk-past post, gap 0.048 m).

**Invariants added/changed:** `railRaceSupportsAreClaimedAsDrawn`,
`theRoadClaimCoversTheBusRun` (samples the road's arc through
`distanceOutside`), ring-solidity clause re-cut by radius with the
radius guard, `duckBarsAreOnePerLaneAndNeverTouch` re-cut as above.

---

## Sphere scratch merge, 11 Sep (step 2 3dd39a3f + sphere 903982ba): test:procgen 611/611, and why not 706

`test:procgen`: **19 files, 611 passed, 0 failed, 0 skipped**; seed 131 says
`walk-past ring seed 131: 1 bar(s) lost to the road rule at slot 28 (lane 2)`;
every other seed `0 bars lost`. The earlier figure (706 / 20 files) was on
sphere b6b1a983; the one file gone is **`test/procgen/seed-5.test.ts`**,
deleted by sphere commit 364672c1 (6 Sep, "Retire pool seeds 5, 115, 225 and
346 while the generator is being replaced") — checked by diffing the two
sorted `ls-tree`/`ls-files` lists (exactly that line) and by `vitest list`:
95 tests per seed file on this tree, 611 collected = 611 run, 706 − 611 = 95.
Not a file that stopped being collected. **Quote the pass count against a
collection count, not against last time's total** — the pool is shrinking
under this branch by design.
