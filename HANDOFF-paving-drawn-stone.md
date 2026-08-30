# HANDOFF — paving follows the drawn stone (branch `fix/paving-follows-drawn-stone`)

## Current state, 29 Aug — PR #391 open, NOT mergeable

Rebased onto `origin/main` at 62318f05. `npm run build` **exit 0**;
`npm run test:procgen` **exit 1** at **457 / 458** — the one failure is seed 2's
bridge count, explained in full below, and it is a *different* failure from the
one this branch was handed over with. The standability bug is fixed.

**Worktree is `.claude/worktrees/bridge-seed2`** — the predecessor's `eng-paving`
worktree was deleted by someone else's cleanup mid-session (nothing was lost; it
was clean at the pushed tip). No dev server was started; the shared Chrome was
not granted, so this branch has had **no visual QA**.

**The next decision is the Overseer's**, not the next engineer's: see "Where that
leaves the branch" at the bottom. Do not start the 35% bridge shortening off this
— it was gated on this landing.

---

## REUSABLE RECIPE: "what is this collider, and who made it?"

Keep this. It answered in one run a question two engineers had spent a session on.

**Do not walk `park.scene` to identify a blocker.** Much of what stops a walker
has no scene node at all — every bridge parapet is registered straight into the
collision world by `ParkTrain.ts`'s `guardRails` loop and draws nothing of its
own, and scenery is instanced besides. A scene-graph search for these returns
empty *however carefully it is done*, and the emptiness looks like a bug in the
search rather than a wrong question.

Interrogate the collision world instead, and make the colliders carry their own
provenance:

1. `import` `Collision.ts` and wrap `CollisionWorld.prototype.addCircle` /
   `addWall` **before the park is built**.
2. In each wrapper, call through, then record `new Error().stack` against every
   collider object newly appended to the private arrays.
3. Build the park. TypeScript `private` is erased at runtime, so
   `world.collision as unknown as { circles, walls }` reads them straight out.
4. Probe your point with the same circle-vs-collider overlap test
   `isClearCircle` uses, and print the birth certificate of everything that
   overlaps.

`scripts/probe-seed2-blocker.mts` is a working copy.

**Then prove authorship, do not infer it.** "A parapet is near the failure" is
not "this is *bridge 1's* parapet". Project each candidate segment onto *both*
candidate owners' frames and see which one it sits at `±wallLine` in. That is
what turned a plausible story into a fact here.

**Trap already paid for**: `object.position` is the node's offset inside its
parent group, not its park position — `updateMatrixWorld()` then
`getWorldPosition()`. This matters only for the scene-graph route, which is the
route you should not be taking.

---

Worktree `.claude/worktrees/eng-paving`. Its `node_modules` is a **symlink** to
`eng-349`'s (deps identical); it shows as untracked because gitignore matches
directories, not symlinks. **Never `git add` it.**

Successor to PR #352, which was **closed, not merged** — see
`HANDOFF-bridge-clipping-349.md` on branch `bridge-paving-clip` for why.

## State: 457 / 458 on `main`'s full-length bridges

Three commits, each a deliberate step:

1. `10d11def` — the shell publishes `ShellGeometry.planEdge`: the outer face in
   plan, one entry per ring, the same points the sweep uses for its own quads.
   Producer only, nothing consumes it.
2. `6ab46a55` — `pavingHeightAt` asks `planEdge` instead of `footprint.covers`.
   **Deliberately red on all five seeds**, and the failure is the finding:
   *"the bridges carry 218 path-surface vertices but 76 path-kerb ones — the
   kerb is torn off the paving it borders somewhere over a bridge"*. Asking the
   stone honestly refuses to lift a kerb that has no stone under it. Also brings
   `bridgePavingIsCarriedByItsOwnMasonry` and its fact across from #352.
3. `ed0965e8` — `bridgeRoadHalfFor` = `pathHalfWidth + PATH_KERB_OVERHANG`. The
   road becomes as wide as the path it draws; the tear goes.

**Why the middle commit is red on purpose.** #352 died because the coupling
between the paving fix and the widening was discovered at the end. Here it is a
proved fact in the history: commit 2 shows the tear, commit 3 removes it.

**The headline result**: seed 2's `bridge-82.0`, which hung **0.513 m** of
paving past its own masonry, is green — measured on the **36.7 m** bridges, the
geometry #352 never tested. The error is length-dependent (0.371 m at 22 m), so
measuring it at the short end is what let it survive a whole PR.

## The one remaining failure

Seed 2: *"the bridge deck at (-2.2, -47.0) is not reachable from the entrance on
the real nav lattice / not standable -14.2 m along its own centreline"*.

Probed along the crossing's own centreline with the game's `collision.resolve`
at `PLAYER_RADIUS`, changing **only** `bridgeRoadHalfFor`:

| road width | blocked span (along) | bridge `covers()` from |
| --- | --- | --- |
| narrow (`main`) | −16.5 … −15.0 | −14.2 |
| wide (this branch) | −16.0 … **−14.5** | −14.2 |

Worst push-out 0.71 m in both cases, so it is one solid object, not the bridge.
**The obstacle moves 0.5 m along when only the road width changes** — so
whatever places it is keyed off the bridge footprint, and at the wide setting it
lands overlapping the bridge's own covered extent at the ramp foot.

## Hypothesis — **TESTED AND DEAD.** Do not spend time on it again.

`ACROSS_MARGIN` was varied **alone**, 2.0 → 3.0 → 1.0, re-probing each time
(0.25 m steps, so the span is resolved four times finer than the table above):

| `ACROSS_MARGIN` | blocked span |
| --- | --- |
| 2.0 (shipped) | −16.00 … −14.25 |
| 3.0 | −16.00 … −14.25 |
| 1.0 | −16.00 … −14.25 |

**Identical to the sample.** The conservative footprint's width is *not* what
places this object, so the `isInBridgeFootprint` / `halfGap + ACROSS_MARGIN`
story below is wrong. It remains true that `bridgeRoadHalfFor` — the **real**
pass's width — does move it (−16.5…−15.0 narrow vs −16.0…−14.5 wide, the same
push-out sequence displaced by one 0.5 m step), so the lever is somewhere on the
real-pass side, not the reservation side.

Also attempted and inconclusive: naming the object by walking `park.scene` for
anything within 3 m of (12.4, −44.0) in **world** space (`updateMatrixWorld`
then `getWorldPosition` — local `.position` is useless here, it reports the
node's offset inside its parent group). Nothing named came back, which most
likely means the blocker is an **instanced** mesh (scenery is instanced) or a
collider with no scene node of its own. **Next attempt should interrogate the
collision world directly rather than the scene graph** — find what
`collision.isClearCircle` refuses at (12.4, −44.0) and work back to its owner.

## THE OBJECT IS NAMED: the bridge's own parapet wall

**Proved 29 Aug** by `scripts/probe-seed2-blocker.mts` (throwaway diagnostic,
delete before the PR lands if it is not wanted).

**The recipe — reuse this, it is the instrument that worked.** The scene graph
is the wrong place to look (instanced scenery has no node). Instead, wrap
`CollisionWorld.prototype.addCircle`/`addWall` **before the park is built** and
record `new Error().stack` against each collider object as it is pushed onto
the private `circles`/`walls` arrays (TS `private` is erased at runtime, so
`world.collision as unknown as { circles, walls }` reads them fine). Then walk
the centreline, test the same circle-vs-collider overlap `isClearCircle` uses,
and print the birth certificate of everything that overlaps. One run named it.

The blocker at (12.4, −44.0) is a **wall, half-thickness 0.15, top 2.98
absolute**, registered at `ParkTrain.ts:274` — which is the
`for (const rail of built.guardRails)` loop, i.e. **the bridge's own masonry
parapet/spandrel wall**, added with `topIsAbsolute = true`.

That fits every measurement already taken:

- it ignores `ACROSS_MARGIN`, because the parapet is placed by the **real**
  pass, not by the conservative reservation;
- it moves exactly one step when `bridgeRoadHalfFor` changes, because the
  parapet is placed **at the road's half-width** — widen the road and the
  parapet moves with it;
- the push-out is one solid object with a 0.71 m worst case, because it is one
  wall segment, not a scatter of scenery.

The two segments involved are `(12.99, −41.17)→(12.65, −43.10)` (top 3.94) and
`(12.65, −43.10)→(12.31, −45.07)` (top 2.98) — consecutive parapet segments
stepping down the ramp.

### ROOT CAUSE (proved): `nearOtherGuardRail` models a 6.4 m rail that is really ~22 m

Seed 2 has **two** bridges: index 0 over our crossing (−2.19, −46.97), index 1
over (15.35, −35.74). Their ramps run at each other.

Authorship of the blocking segment was **proved, not inferred**, by projecting
every registered parapet onto *both* crossings' frames. Bridge 0's own parapets
sit at `across = ±1.87` in bridge 0's frame; the wandering run that crosses the
walked centreline sits at `across = ±1.87` **in bridge 1's frame** — that is
bridge 1's own `wallLine`, so bridge 1 built it:

| bridge 0 along | across (b0) | top | owner | in bridge 1's frame |
| --- | --- | --- | --- | --- |
| −16.30 | −1.47 | 3.94 | 1 | 6.75 / −1.87 |
| **−15.00** | **+0.11** | **2.98** | 0+1 | **8.73 / −1.88** |
| −13.98 | +1.80 | 2.03 | 0+1 | 10.73 / −1.88 |

**Bridge 1's ramp parapet runs straight across bridge 0's ramp**, crossing the
walked centreline at `across = +0.11` — dead on the walking line. Its top is
still 2.98 m absolute there because that point is high up bridge 1's own ramp,
so it is solid to a walker whose feet are at ~2.4 m climbing bridge 0.

`planReal` **does** have a cross-crossing exclusion, `nearOtherGuardRail`, and
it is the thing that failed. It models a neighbour's guard rail as running only
the deck's own span:

```ts
const alongClamped = Math.max(-DECK_HALF_LENGTH, Math.min(DECK_HALF_LENGTH, along));
```

`DECK_HALF_LENGTH = FENCE_OFFSET + 1.2 = 3.2 m`, so the modelled rail is 6.4 m
long. The real parapet loop in `bridges.ts` runs `-lengthNeg … +lengthPos` —
**the deck and both ramps** — gated only by `PARAPET_MIN_HUMP`. Measured, they
reach `along ±11.27` and beyond: ~22 m, not 6.4 m.

The blocking segment is at bridge 1's `along +8.73`, i.e. **5.53 m past the end
of the rail `nearOtherGuardRail` believes in**. Clamping gives `dAlong = 5.53`,
so `hypot(dAlong, dAcross)` is far outside `GUARD_RAIL_MARGIN` (0.08 +
`REAL_PROBE_RADIUS`) and the check reports "no nearby guard rail". Bridge 0 then
plans its ramp straight through a wall that is about to be built.

**The comment above that check — "never a ramp: see that file's own
`railHalfAcross`" — is stale.** It describes an older geometry in which parapets
really did stop at the deck. They have not for some time; the measurement above
is against the built park.

This also explains both surviving observations exactly:

- **`bridgeRoadHalfFor` moves it** because `railAcross = deck.halfAcross`
  = `roadHalf + BRIDGE_WALL_THICKNESS`. Widen the road and bridge 1's parapet
  slides laterally, moving where it cuts bridge 0's centreline — one 0.5 m step.
- **`ACROSS_MARGIN` does not**, because it belongs to the conservative
  reservation, which places no parapets at all.

### The fix (landed)

`parapetReachFor(rampRun)` is now the **one owner** of a bridge's parapet reach.
`bridges.ts` draws its parapet run from it (`lengthPos`/`lengthNeg`); `planReal`'s
`nearOtherGuardRail` clamps to it. They cannot disagree any more. `DeckPlan`
carries the neighbour's `frame`, `rampRunPos` and `rampRunNeg` so a sibling can
ask; the exclusion also projects onto the neighbour's **curved frame** instead of
extrapolating a tangent, which was fine over ±3.2 m and is not over 11 m.

**Proved load-bearing by desynchronising it** (the Overseer's ask): restore the
`DECK_HALF_LENGTH` clamp, keep everything else including the frame projection,
and seed 2's original failure returns *verbatim* — "the crossing at (−2.2, −47.0)
is not standable −14.2 m along its own centreline". The frame-projection change
alone fixes nothing; the clamp is what does the work.

## THE REMAINING FAILURE IS A DIFFERENT ONE, AND IT IS REAL

**Do not treat this as the old bug returning.** The standability failure is gone
on all five seeds. Seed 2 now fails a *different* assertion:

> only 1 of 3 railway crossings carry a real bridge (2 fell back to level
> crossings)

Full suite: **388 / 389**, the single failure above. The other four seeds are
completely unaffected.

### Why: these two crossings genuinely cannot both have a bridge

With the exclusion telling the truth, bridge 0's `+` ramp truncates at **6.2 m**
against a floor of **11.07 m**, blocked at (12.1, −45.2) — which is 0.25 m from
the real parapet endpoint (12.31, −45.07) measured off the built park. **The
exclusion is firing on a wall that is genuinely there.**

The floor is not arbitrary:

```
WALKABLE_FLOOR = BRIDGE_RISE / MAX_RAMP_GRADIENT          (= 10.57 m)
MAX_RAMP_GRADIENT = SPRINT_PEAK_GRADE_BUDGET * (1 - HUMP_BLEND)
```

So each bridge needs `DECK_HALF_LENGTH + 10.57 + 0.5 = 14.27 m` of half-length.
The two crossings are `hypot(17.54, 11.23) = 20.83 m` apart, and two ramps
facing each other need `28.54 m`. **They are ~7.7 m short of fitting.** The old
code "fitted" them only by building one straight through the other's wall.

### Two fixes tried and MEASURED DEAD — do not redo either

1. **Narrow the exclusion to the walkable band.** The samples run to the
   *structural* edge (`halfAcross`), but `covers()` only promises `walkHalf`, so
   two bridges whose masonry abuts are arguably fine. Implemented in all three
   sample loops (`deckClears`, `provisionalReach`, pass 2's `clearAt`).
   **Result: no change at all — still 1 of 3.** The neighbour's parapet
   intrudes into bridge 0's *walkable* band too, not merely its structural
   edge. Reverted, because a weaker exclusion that buys nothing is strictly
   worse.
2. **Unfreeze the gradient budget** (`MAX_RAMP_GRADIENT` from #378's 1.670
   ceiling instead of the frozen `SPRINT_PEAK_GRADE_BUDGET`). **Result: worse,
   and instructive.** The railway replans entirely — seed 2 goes from 3
   crossings to **5** — and it reintroduces the exact failure the frozen budget
   exists to prevent: *"the crossing at (19.5, −36.5) climbs 0.785 m in one
   sprinted frame … she needs 1.028 m of a 0.62 m reach and loses the surface …
   through the deck, into the tunnel"*. This is a direct warning for the
   shortening ticket: **raising that budget is not free, and it moves sites.**

A third option is arithmetically ruled out without needing a run: making the
planner co-adapt so bridge 1 yields ground cannot work either, because
`2 x 14.27 = 28.54 > 20.83`. **One of these two crossings must fall back.** It
is not a scheduling problem; there is not enough ground.

### Where that leaves the branch — a decision for the Overseer

Seed 2 genuinely supports only one bridge among these crossings at the current
gradient. The invariant's expectation is therefore unsatisfiable on seed 2
*without* the bug. This is exactly the case CLAUDE.md names: **"Never weaken an
assertion to make a seed pass — swap the seed and write down why."** The
assertion is right; the seed is now known to be geometrically over-subscribed.

The complication, and why this was not done unilaterally: **seed 2 is the seed
that carries the 36.7 m bridges** this whole branch exists to fix (#352 died by
measuring only 22 m geometry, where the error is 0.371 m instead of 0.513 m). A
replacement must be chosen for having *comparable long-bridge geometry*, not
merely for being green — otherwise the swap quietly throws away the coverage
that caught the original bug.

### THE SWAP IS BLOCKED: no green seed exists to swap to

**Scanned 18 seeds against the full invariant suite. Not one is green.**

| seed | bridges | longest | full-suite failures |
| --- | --- | --- | --- |
| 4 | 2/3 | 36.5 m | 2 |
| 6 | 1/2 | 28.5 m | 5 |
| 9 | 1/1 | 29.0 m | 3 |
| 12 | 2/7 | 36.5 m | 5 |
| 13 | 1/1 | 36.5 m | 1 |
| 14 | 2/3 | 36.5 m | 2 |
| **15** | **2/2** | **36.5 m** | **2** |
| 16 | 1/2 | 28.5 m | 4 |
| 20 | 1/1 | 36.5 m | 4 |
| 21 | 4/4 | 31.5 m | 4 |
| 22 | 3/5 | 28.5 m | 3 |
| 26 | — | — | 5 |
| 27 | — | — | 4 |
| 28 | — | — | 3 |
| 29 | — | — | 2 |
| 30 | — | — | 4 |
| 3, 8, 10, 24, 25 | — | — | park failed to build at all |

Seed 15 is the best candidate on geometry by some way — **2 of 2 crossings carry
a bridge and both are 36.5 m**, which is *better* long-bridge coverage than seed
2 ever had. Its two failures are `every paved path runs on grid axes` and `every
street sits on the shared 12 m lattice`. **Neither has anything to do with
bridges.**

**What this actually means.** The five seeds in the suite (canonical, 2, 5, 11,
18) are not merely a sample — they appear to be the only seeds known to be
green, and the invariant suite is in practice *fitted to them*. Every unsampled
seed exposes 1–5 genuine generator defects in unrelated subsystems (path grid
and street lattice, the Rail Race duck bar failing to slow a rider, the Sky
Cruiser never entering the castle, spurs branching off nothing, a ferris
connector 64x longer by paving than in a straight line).

So "swap the seed" cannot be executed as a small change here: **there is nothing
green to swap to.** Doing it would mean either taking a seed with 1–2 unrelated
red invariants (trading one red for two, and hiding real defects behind a
different seed), or first fixing the defects that seed exposes — which is
several tickets' worth of work in subsystems this branch does not touch.

**This is a finding, not a refusal.** The options, for the Overseer:

1. **Land #349 with seed 2 red**, on the strength of #392 documenting exactly
   why (the assertion is right; the seed is geometrically over-subscribed).
   Zero-tolerance says no, which is why this is not just done.
2. **Fix #392 first** — teach the site planner a pairwise separation
   constraint. Then seed 2 stops proposing two crossings 20.83 m apart, both get
   bridges, and the assertion passes honestly with no swap at all. This is the
   *correct* fix and it makes the problem disappear rather than relocating it.
   It moves sites on every seed, so it is its own ticket with its own sweep.
3. **Swap to seed 15 and fix its two grid/lattice failures** as part of that
   swap. Bounded, but it is path-network work, unrelated to bridges, and it
   would ride in on a bridge PR.

**Recommendation: option 2.** #392 is the real defect; this branch's fix is what
made it visible, and fixing the planner retires the symptom on every seed at
once instead of moving the measurement somewhere it does not yet show.

### I took option 2, implemented it, and it does NOT fix seed 2

Recording this against myself, because a recommendation that turned out wrong is
worth more written down than quietly dropped.

The separation constraint is landed and is correct: each site as the oriented
rectangle its bridge will really fill, `MIN_BRIDGE_HALF_LENGTH` (published by
`bridgeFootprint.ts`, not restated) by its proven `halfWidth`, separating-axis
test between kept sites. **Bridge counts across canonical and all four sweeps
are unchanged** — 2/2, 1/3, 2/3, 2/4, 1/2 — so nothing loses a bridge to it.

**It never fires on seed 2, because seed 2 has no bridge sites to separate:**

| seed | proven bridge sites |
| --- | --- |
| canonical 20260728 | 4 |
| 5 | 3 |
| 11 | 3 |
| 18 | 1 |
| **2** | **0** |

All seven of seed 2's kept sites are `level`. Every bridge that exists on that
seed is **opportunistic** — built by the late `planReal` pass on a crossing
planned as a *level* crossing. That is why two of them collided: they were never
planned as a pair, because they were never planned as bridges at all.

**This is the biggest finding of the session.** `crossingPlanSolve.ts`'s whole
premise is *"the drawn network only ever meets the railway where a bridge
belongs"*, written to replace an old discover-it-afterwards order that measured
**0 bridges buildable on all three required seeds**. On seed 2 that premise is
silently inactive, and the old order is what is actually running. A seed that
proves no bridge sites and then builds a perfectly good 28.5 m bridge anyway
suggests `bridgeCandidateAt`'s probe is too strict rather than the ground being
genuinely unusable — but that is unproven and is now #392's re-scoped question.

**So seed 2's assertion still fails, honestly, and this branch still needs a
decision.** What has changed is that the reason is now understood three layers
down rather than one.

## Seed 15 — a candidate for WIDENING the suite later

Not a swap. Once its two path-lattice failures (`every paved path runs on grid
axes`, `every street sits on the shared 12 m lattice`) are somebody's ticket,
seed 15 is worth **adding**: it carries **2 of 2 crossings bridged, both 36.5 m**,
which is better long-bridge coverage than seed 2 has ever had. Widening beats
swapping — it adds honest coverage instead of moving the measurement.

### Why it blocks: absolute tops on a ramp the walker is climbing

The parapet's top is **absolute** world Y at the local road surface. At the
ramp foot the walker's feet are near ground level while the parapet segment
beside her still tops out at 2.98 m, so it is solid to her. That is correct
behaviour for a parapet *beside* the road. The failure is that at −14.2 m the
segment is not beside the walking line — the probe point sits essentially *on*
the segment (overlap 0.71 m against a 0.15 m half-thickness). **Still to prove:
whether the parapet is mis-placed onto the centreline, or the centreline
`frameFor` walks diverges from the road the parapet was built around.** Do not
state a cause until that is measured.

The original hypothesis, retained so nobody re-derives it:

## (dead) Conservative-width hypothesis

`bridgeKeepout.ts`'s `isInBridgeFootprint` reads the **conservative** footprint
pass, whose width is seeded `halfAcross = crossing.halfGap + ACROSS_MARGIN`
(`bridgeFootprint.ts` ~line 525). `halfGap` is the *level crossing's fence gap*
— a different quantity on a different axis — and it has no reason to track
`bridgeRoadHalfFor`, which the real pass now uses. Same two-definitions shape as
everything else in this ticket.

Against it: the conservative pass reserves the **full ideal ramp run** (15.16 m,
so out to ~18.4 m along), which already covers −16. So a pure width mismatch
does not obviously explain an obstacle at −16 surviving the keepout. Something
else may place it, or `KEEPOUT_MARGIN` may be the term that matters.

**What would confirm or kill it**, cheaply, and what to do next:

1. Change **`ACROSS_MARGIN` alone** and re-run the probe. If the blocked span
   moves, placement is keyed to the conservative width and the hypothesis holds.
   If it does not move, the conservative width is not the lever and the
   hypothesis is dead — either result is worth having.
2. Identify the object. The probe only reports that *something* pushes; it never
   names it. Query the collision world at (12.4, −44.0) for what is registered
   there — a lamp, a tree, a fence post — because a lamp is `LampPosts.ts`,
   which reads `REAL_PROBE_RADIUS` and has its own keep-back story in
   `bridgeFootprint.ts`'s own comment.
3. Only then decide the fix.

The probe script is small and worth rewriting rather than hunting for: build the
park, find the bridge whose crossing is at (−2.2, −47.0), walk `frame.pointAt`
from −18 to −8 in 0.5 m steps, set a `Vector3` at `bridge.heightAt`, call
`collision.resolve(probe, PLAYER_RADIUS)` and print how far it moved.

## Traps

- **Measure at the long end.** Every number in #352 was taken on 22 m bridges
  and the escape grows with length. Check which geometry any figure came from.
- **`npm run test:procgen` is not in the build chain** — run it *and*
  `npm run build`, both unpiped with the exit code checked.
- The fall-simulation rig described in `HANDOFF-bridge-clipping-349.md`
  **over-counts on descents**. Do not revive it; the validated one is PR #375's
  reviewer's.

## After this lands

The 35% shortening, as a **fresh branch off a `main` that has this**. #378 has
raised the walk ceiling, but note its engineer froze `SPRINT_PEAK_GRADE_BUDGET`
to the old value on purpose because it feeds `SITE_RAMP_FLOOR` — raising it
**will** re-plan crossing sites, so re-derive the maximum shortening **by
measurement, not arithmetic** (the closed form over-predicted by ~10% last
time), and report bridge counts per seed plainly rather than trimming the hump
until a seed passes.
