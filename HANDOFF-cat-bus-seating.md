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
  which is 6 cm. Worth knowing if you ever aim anything at their faces; the sill
  ended up not needing it (it uses the shoulder line, which needs no trig).
- **`applyRidePose` had to be extracted** to `src/entities/ridePose.ts`. It could
  not be imported from `Player.ts`: that reaches `world/terrain`, which reaches
  `PARK_BOUNDARY`, and the ride's whole job is to draw before the park is solved.
  `Player.ts` re-exports every name, so `check:climb-wave` was untouched.
- **`BusDriver.setWalkPhase(0, 0)` silently un-seats the driver.** Both call
  sites passed zeroes; `applyWalk` at speed 0 writes *zero* into all four limb
  rotations. Removed the method and both calls — he never walks.
- **The sill is the seated shoulder line, and that *is* "about halfway".** The
  first attempt used the **chin** and reached only 34% — safe, but it still read
  as a glasshouse. `KID_SHOULDER_HEIGHT` (0.99, measured off the built `torso`)
  is where a real coach's glazing starts: panel below is bodies, band above is
  heads. That lands **44%**. It hides the bottom 25% of the skull — the jaw —
  and the mouth is painted 60% down the face canvas, so faces stay whole.
- **The door had its own idea of where windows start.** `DOOR_HEIGHT * 0.68`,
  not `WINDOW_SILL_Y` — **0.94 m out of step** on the bus Jim complained about.
  It then landed within 12 mm of the new sill by accident, which kept the guard
  green by being the lowest glass it could find. Found only by mutation.
- **The title's colours have to avoid the park's colours.** All six rainbow
  bands were used; the green vanishes over grass and the blue over sky, and the
  lane is grass, trees and sky. Now the four warm bands. A hue problem, not a
  weight problem — the chunky font was already there.

## Measured results

- twelve seats + driver: lowest point **1.082 m**, cushion top 1.094, floor
  0.794. **Nothing under the floor.**
- worst head **3.428** vs ceiling 3.518 — clears by 0.090 m, over 4 s of bouncing.
- **every drawn part touches the bodywork** (was: three detached).
- glazing starts **2.084 m**, **44%** up the bus's side (was 16%), 0.003 m off
  the lowest shoulder aboard, hiding **24%** of a head. Solid lower panel 0.55 m
  -> 1.50 m.
- title: 16 characters, 4 colours, `background-color` `rgba(0,0,0,0)`, weight
  900, 3.4rem, present and moving on all 12 captured frames.

## Status

- [x] Own worktree, `npm ci`, merged `origin/main`, test count reconciled
- [x] `applyRidePose` extracted to a leaf module the ride can reach
- [x] Seating: floor constant, cushion anchors, shared pose, driver, per-rider bounce
- [x] Window sill derived from a seated child's chin
- [x] Floating block (rear bumper) + tail + step reattached
- [x] Title card — chunky, no background, warm palette per character, bouncing
- [x] Guards, **ten mutations each proved red** (two of them found guards that
      could not fail; both rewritten)
- [x] Browser: 12 ride frames (both inside beats, three outside), plus a frozen
      orbit for rear/flank. Headless Chromium, throwaway profile, port 5473,
      killed by PID.

## Known, unchanged, and worth Jim seeing

- **The inside view is two enormous near heads and a lot of aisle floor.** The
  near pair are 0.53 m from the lens and there is nowhere to retreat to
  (round 5's finding, unchanged). Sitting the children 0.47 m higher moved the
  lens up with them — it is derived from the seats — so the floor's share of the
  frame grew about a fifth. It reads as a busy bus, and the faces beyond the
  near pair are clear and smiling, but it is the thing I would change next.
- Round 5's open items 1, 3, 4, 5 are untouched: the destination board crowding
  the face, the park being off to one side at the settle, the rail-race arch
  crossing the arrival, and `NPC_COUNT` unmeasured on a device.

## Capture recipe (worked, reuse it)

`playwright` at `~/.npm/_npx/e41f203b7505f1fb/node_modules`. **A fresh profile
lands on character creation, not on the ride** — click `.charcreate-go` first;
that cost a run. `page.waitForFunction(fn, arg, options)` — the second argument
is the *arg*, so `{ timeout }` in that slot is silently ignored and you get the
30 s default. Poll `window.journey.ride.elapsed`, never sleep. To inspect the
bus from an arbitrary angle, set `ride.update = () => {}` to freeze the whole
ride, then drive `ride.camera` yourself; the loop keeps rendering.
