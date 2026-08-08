# HANDOFF: cat bus seating, sill, floating block, title (`e-cat-bus-seating`)

Pushes to `e/cat-bus-stage-a` (PR #246). Worktree
`/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-cat-bus-seating`,
branch `e-cat-bus-seating-work` off `origin/e/cat-bus-stage-a` @ `e82936c`.
`npm ci` done, exit 0.

**Read first:** `HANDOFF-cat-bus-round5.md`, `HANDOFF-cat-bus-stage-b.md`,
`HANDOFF-cat-bus-stage-a.md`. None of their findings is repeated here.

## The bar, reconciled

`origin/main` was merged in (PR #246 had gone `CONFLICTING` after the Rail Race,
`0b0b120`). **236 -> 281 tests**, and the 45 are main's nine new Rail Race
invariants across the five seeds (9 x 5). Not accepted, worked out.

Bar is now **281 tests / 11 files / 0 skipped**, `build` exit 0.

## The merge, and the one thing to check if you redo it

`main` moved `applyRidePose` to the **end of `animate()`**; calling it after
`animate` returned made it the last writer of `body.rotation.x` and deleted the
Rail Race's pose. This branch still called it after `animate` in the
scripted-walk branch. That call is gone. It was a no-op (`applyRidePose` returns
immediately for `'walking'`) but it contradicted main's new comment.

`invariants.ts`: both sides appended function blocks sharing **one `/**`
opener**, so a naive concatenation folds main's first doc comment into this
branch's last function. Both blocks kept, main's given its own opener.

## Root causes, all measured off the built scene

| Jim | what it actually was |
|---|---|
| children "clipped through the floor" | `CAT_BUS_FLOOR_Y = BODY_BOTTOM_Y` — **the underside of the floor pan, not its top**. Everything standing "on the floor" stood 0.174 m inside an opaque slab. |
| children "aren't sitting on seats" | **no pose at all**. `seatRiders` was `seat.add(kid.root)` and nothing else. Twelve children stood bolt upright with the 0.3 m cushions through their shins. |
| "windows go all the way down to the floor" | sill was `BODY_BOTTOM_Y + 0.55`, a picked number, 0.38 m above the real floor. |
| "strange block floating off the back" | **the rear bumper**, positioned at `-BODY_LENGTH / 2` while the bodywork actually ends at `cabinBackZ`, 1.51 m forward. It hung in clear air 1.05 m behind the bus. |

### Things worth not re-deriving

- **`BODY_LENGTH` is a budget, not the bodywork.** The shell is `cabinLength`
  centred on `bodyCentreZ`, pulled forward by `FACE_RADIUS * 0.55` so the box
  sinks into the cat's face. **Anything at the back must use `cabinBackZ`.**
  Three things did not: bumper (1.05 m of air), tail (0.88 m), door step
  (0.20 m). All three fixed.
- **The rig has no knee, so a seated child's lowest drawn point is her own hem,
  level with her origin** (measured: -0.012 m). That is why putting the origin
  on the cushion top *is* sitting on it, with no offset to derive.
- **A seated child's head pivot is `KID_HEAD_HEIGHT * cos(RIDE_POSE_BODY_PITCH)`
  above her origin**, not `KID_HEAD_HEIGHT` — the pose leans her forward 0.3 rad,
  which is 6 cm. The window sill is derived through that angle, not through a
  copy of the 6 cm.
- **`applyRidePose` had to be extracted** to `src/entities/ridePose.ts`. It could
  not be imported from `Player.ts`: that reaches `world/terrain`, which reaches
  `PARK_BOUNDARY`, and the ride's whole job is to draw before the park is solved.
  `Player.ts` re-exports every name, so `check:climb-wave` was untouched.
- **`BusDriver.setWalkPhase(0, 0)` silently un-seats the driver.** Both call
  sites passed zeroes; `applyWalk` at speed 0 writes *zero* into all four limb
  rotations. Removed the method and both calls — he never walks.
- **The sill cannot reach halfway.** Chibi children: head is 59% of height and
  1.32 m across. Sill at the seated chin = 34% up the side. Raising the children
  is not available — the tallest already clears the header band by 90 mm. Only a
  taller bus buys a higher sill, and that changes an approved silhouette.

## Measured results

- twelve seats + driver: lowest point **1.082 m**, cushion top 1.094, floor
  0.794. **Nothing under the floor.**
- worst head **3.428** vs ceiling 3.518 — clears by 0.090 m, over 4 s of bouncing.
- **every drawn part touches the bodywork** (was: three detached).
- glass band 1.751..3.500; sill **34%** up the bodywork side (was 16%).

## Status

- [x] Own worktree, `npm ci`, merged `origin/main`, test count reconciled
- [x] `applyRidePose` extracted to a leaf module the ride can reach
- [x] Seating: floor constant, cushion anchors, shared pose, driver, per-rider bounce
- [x] Window sill derived from a seated child's chin
- [x] Floating block (rear bumper) + tail + step reattached
- [ ] Title card — bold, no background, palette per character, bouncing
- [ ] Guards, each proved red
- [ ] Browser: interior on several beats, plus rear and side exteriors
