# HANDOFF — e-slide-family-notes

Six items from Jim after riding the ginormous slide on 5 August 2026. Branch
`e-slide-family-notes`, **pushed to `feat/slide-parapet-gap`** (PR #227) — that
branch is checked out in the `e10-generator` worktree which is serving the game
to Jim and **must be left alone**, hence the separate local branch name.

Worktree: `.claude/worktrees/e-slide-family-notes`. My dev server port: **5412**.

## Status

| # | Item | State |
|---|---|---|
| 1 | Landing: clipped into the slide, not in the pit | **done**, invariant + mutation proof |
| 2 | Chase cam instead of first person | **done** + the 26.65 m rider bug it exposed |
| 3 | Half the chute see-through (#228) | **done**, wants Jim's eyes |
| 4 | Start attached to the castle roof | **done**, moved to 1.225 m from the edge |
| 5 | Ball pit follows the slide (#229) | **NOT DONE** — measured blocker, posted on #229 |
| 6 | Balls scatter when she lands | **done**, wants Jim's eyes |

**Count is now 181 passed / 0 skipped across 9 files** — was 167/8 before
merging `origin/main` (#238, #216, #221), whose own 14 tests account for the
whole rise. Both invariants this branch adds still run on all five seeds
(verified by name, 5 each), and all 20 of main's invariants survive the merge
(checked by diffing the registered names — CLAUDE.md's new "squash merge
silently reverts branches" warning). `npm run build` exit 0, and now also runs
`npm run check:slide-rider`.

### Merged, not rebased

42 commits on this branch, most of them another agent's reviewed PR #227 work.
Force-pushing a rewrite of that was not worth it, and merging main in is this
branch's own precedent. Three conflicts, all resolved by union rather than by
picking a side: the build chain in `package.json`, the imports in
`invariants.ts`, and `rail/boundary` -> `world/boundary` (#216 moved it).

### The riding pose: she lies on her back now

`Player.ridePosture: 'seated' | 'reclined'`. The **seated pose is untouched** —
it is shared by the train, coaster, ferris wheel and Rail Race, all family-QA'd.

Recline is on `model.root`, not `body`: **no knee in the rig** and the hips hang
off `body`, so a waist bend folds her in half with her legs still standing.
`RIDE_RECLINE = -1.35`, and **the sign was measured on the built rig** because
the codebase reads both ways — at -1.35 her head is 1.33 m behind her feet and
0.30 m above them.

Two traps, both caught by the guard rather than by eye:

- the check never called `player.update`, so the pose code was not exercised;
- `ridePosture` was set *before* `startRide`, whose `beginRide` resets it.

And the recline must be measured **against the chute, not world vertical** — the
first version went red on the steepest frames while the pose was correct,
because she lies along a slide that is itself tilted.

### The big one: the rider was 26.65 m off the chute

Jim: *"in the chase cam it seems the player is still not drawn"*. **Not a
visibility bug.** `advanceRide` placed the rider at `pointAt(t)` +
`BUILDING_CENTRE_X/Z` + `BUILDING_BASE_Y`; `rideMount`, which the camera hangs
off, copied `pointAt(t)` straight through. The mount was right — the chute is
built from `SLIDE_PLAN.points`, already world coordinates, onto a `parkRoot`
whose world offset measures exactly (0,0,0).

Chute ends (8.86, 1.09, -28.46), 2.00 m from the pit. The rider was put at
(-6.48, 1.53, -50.25) — 26.04 m from the pit. Invisible for months because
first person hid her model and the camera followed the mount.

Fixed with one owner, `Building.ridePointToWorld`. The helter-skelter really
does need an offset (authored around the interior origin), so the frame is a
property of the ride.

**Guard: `npm run check:slide-rider`.** Drives the real ride with a real
`Player` and asserts every frame that she is drawn, is inside the built trough,
and is where the seat is. A *script*, not a procgen invariant, because the park
is built without a Player and because recomputing her position from the chute
would agree with the chute and pass while the game disagreed with both — it has
to observe, not recompute. Proved red both ways (re-hide: "not drawn for 686 of
686 frames"; restore the offset: "rode 26.65 m off the chute").

## Findings worth keeping

### Item 1 root cause (settled)

The dismount was `SLIDE_PLAN.exitX/exitZ` from `planExit()`, which fans bearings
out from the pit and **has never been told where the chute is** — it only rejects
ground inside the castle and inside other plots. The mouth and the dismount were
two formulas fanned off the same `fromCastle` bearing with nothing keeping them
level.

The numbers make it certain, not unlucky: mouth 0.9 m over the grass (`END_Y`),
trough 0.06 m below / 0.86 m above its centre line, child 2.12 m. **Standing her
on the pit floor is worse** — the pit is scooped 0.5 m down, lowering the floor
without lowering the chute: 1.34 m of headroom for a 2.12 m child.

`resolveDismount` could never have fixed it: it pushes riders out of the
**collision world**, and the chute is not in it (you walk under the ride; only
the legs are solid). The safety net was watching the wrong thing.

Fix: `src/world/slide/landing.ts`, one owner — carry on 2.6 m past the mouth
along the heading she is already travelling. Mutation to run-on 0 turns the new
invariant red on 5/5 seeds at "1.57 m inside its own chute".

### `slide/landing.ts` must stay seed-free

It takes the pit as a `PitCircle` argument instead of importing `BALL_PIT_X/Z`.
That is what lets `test/procgen/invariants.ts` import it **statically** — a
static import of anything reaching `parkManifest` fixes the seed before the
harness sets `LGP_SEED`, and that shows up as *skipped* tests, not red ones.
Import closure verified: 9 modules, none seeded. **Do not add a layout import.**

### She was riding bolt upright (found via item 2)

`setRidePose` takes a `pitch` and the slide never passed one — its own docstring
warns about exactly this. Invisible while the ride was first person. Fixed with
the chase camera that exposed it. Needs `rotation.order = 'YXZ'` or the pitch is
taken about world X and becomes a barrel roll a quarter of the way round the
castle — the trap `GROWN_UP_RECLINE` already documents.

Set slide-locally and restored in `finishRide`, **not** globally: with pitch 0
the two orders are identical so no other ride can tell, but the **Rail Race does
pass a non-zero pitch** and quietly changing its composition frame would alter a
ride the family has signed off. (Latent: RailRace's own pitch is composed in
`XYZ` and so is a roll away from north. Observed, not touched — not this PR.)

### Item 5 — attempted, measured, and deliberately stopped

**Not delivered.** Full write-up posted as a comment on #229. Short version:

`train/route.ts:252` keeps the railway clear of the ball pit, and the train is
solved **before** the slide:

```
slide/plan.ts -> coaster/plan.ts -> train/plan.ts -> train/route.ts
```

A pit that follows the slide is a position that does not exist when the train
solves — a dependency cycle, not a keep-out. So the relationship must invert:
the slide's landing dodges the train.

I expected dropping the train's keep-out to be a no-op (nearest approach
25.60 m against the 6.45 m needed; train radius floor 39.20 m on all ten seeds
against a pit at r ~ 28.8). **It is not.** Removing it changes the solved route
on all ten seeds — canonical 354.9544 -> 355.7980 m, every SHA differs —
because the pit's circle was setting `lo(θ)` to ~39.4 on its bearings, which is
what produces that 39.20 floor. And it fails the build:

```
RATCHET LOOSE: rail.walkable: recorded 30, now 29
```

That is a railway change plus a `check:park` ratchet edit. It belongs in its own
PR, not bolted onto five ride-feel fixes that are re-entering review. Reverted;
`train/route.ts` is untouched on this branch.

Carry forward: `LANDING_MAX_RADIUS` should hold the pit's **outer edge** inside
the train's 39.20 m floor — a pit centre no further out than ~32 m.

### Item 5 conditions (non-negotiable, from the review)

- **Do not write "near landings are easier."** Tested and disproved: seed 5's
  *furthest* band is its easiest (44 attempts) while three near bands fail
  outright. Document the ordering key as **chosen empirically, mechanism
  unconfirmed**.
- Un-pin the pit in `parkManifest.ts` (~line 147) and delete the comment saying
  it exists to serve the slide.
- Re-run the sweep; do not take #229's table on trust.

## Gotchas

- `theGinormousSlideLeavesOverTheBattlements` finds castle stonework by **mesh
  name** and has a `Number.isFinite` guard so a rename fails loudly. Item 4 adds
  geometry at the roof — check the regex still matches what it means to, and
  **do not weaken the guard**.
- Read the test **count**, not the colour. A seed-dependent module-load failure
  shows up as skipped.
- Never pipe `npm run build` through `head`/`tail`.


## Round 4: the floating head, and the guard that could not see it

`check:slide-rider` reported **686/686 green while Jim was looking at a floating
head**. It asked `drawn(player.group)` — which walks *upwards*, so it answered
"is her hierarchy visible", not "is she". **Proved hollow**: with her limbs
hidden in product code the old check still printed "drawn throughout", exit 0.

Now asserts all six body parts individually, plus a **raycast from the chase
camera** to each against the chute *and her own model*. Two plausible
hypotheses — the trough's 0.86 m wall occluding her, and her own head occluding
her body because she lies feet-first toward the camera — were both **disproved**
by that raycast. Worth knowing; both looked right on paper.

**Cause: `TreeClimbing.hidePlayerBody`, now deleted.** Only thing in the game
that hid part of her, and it hid her *permanently*: it cleared
`playerHiddenParts` then skipped already-hidden children, so a second call
without an intervening show recorded nothing and the restore put nothing back —
a floating head everywhere afterwards, including rides that never heard of
trees. Matches `feat/climb-wave-and-npc-climb`, which deleted the same pair for
the tree complaint. **NPC climb-hiding deliberately left alone.**

Camera measured (eye 2.62 m above her, 3.7 m behind, all parts unobstructed) and
**not** moved.

**Three faults on this ride now share one shape**: a check about a *container*
passing while the thing itself was wrong — rider 26.65 m off the chute, pose
never exercised because the harness never called `Player.update`, visibility
asked of the wrong object. Assert the thing, not its wrapper.
