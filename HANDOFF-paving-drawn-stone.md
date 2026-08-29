# HANDOFF — paving follows the drawn stone (branch `fix/paving-follows-drawn-stone`)

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
