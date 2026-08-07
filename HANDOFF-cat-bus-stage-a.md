# HANDOFF: cat bus Stage A (`e-cat-bus-stage-a`, branch `e/cat-bus-stage-a`)

Wiring up the arrival that PR #27 shipped as dead code. Issue #245.
Predecessor investigation: `HANDOFF-cat-bus-arrival.md` on `e/cat-bus-arrival` —
**read that first**, it is the root cause and is not repeated here.

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-cat-bus-stage-a`,
off `origin/main` @ `929d792`. `npm ci` done, exit 0.

## Scope

Stage A only: bus rolls to the gate, door opens, player + other children hop
off, gameplay starts at the park edge. **Stage B (the animated journey down a
lane) is specified but NOT in scope** — see "Stage B seam" below.

**On skipping — the ruling changed mid-task, and the later one is Stage B's.**

1. First: *not skippable.* Appearance is editable in-game, so a child never
   restarts to change her hair — the arrival really is once per new character.
2. Then, once the loading-screen idea landed: *"make it skippable only once the
   park has generated."*

**Stage A implements neither, and that is correct.** The skip is defined
entirely in terms of generation progress, and in Stage A there is no generation
running and nothing to skip *to* — the park is already built before the bus
moves. The skip belongs with Stage B's generate-during-the-ride work, together
with its two-way guard (not offered while incomplete, offered once done).
**Do not add a skip to Stage A on the strength of ruling 2.**

## THE DECISION THAT MATTERS — where the arrival is constructed

**`World` owns `Entrance`; `Entrance` owns the arrival. NOT `Game`.**

This is not a style preference, it is the whole guard. Measured facts:

- Tests run in **plain node** (`vitest.config.ts` sets no `environment`), no
  jsdom anywhere. `three` imports fine; `scripts/headless-canvas.mjs` stubs the
  DOM that art code paints textures into.
- **`Game` is not constructible in a test** — `src/Game.ts` imports `Engine`,
  which is a real `WebGLRenderer`. Nothing in `test/` or `scripts/` builds one.
- **`scripts/park-harness.mts`'s `buildHeadlessPark()` builds a real `Scene`
  and a real `World`**, and `test/procgen/parkFacts.ts` already does
  `scene.updateMatrixWorld(true)` + `scene.traverse(...)` over it.

So: anything hung off `World` is reachable by the invariant suite that CI
**blocks the merge** on. Anything hung off `Game` is reachable by nothing at
all — which is precisely how a whole merged feature went twelve days unseen.
Wiring this into `Game.ts` would have rebuilt the original bug's blind spot.

## Trigger — `arrivedByBus` is the mechanism, and it fails SAFE

The brief suggested triggering on the character-creation path with
`arrivedByBus` as belt-and-braces. **I inverted that, deliberately.**

`arriveByBus` defaults to `!hasArrivedBefore()`. So the arrival plays unless
something *actively opts out*. Rationale:

- "Every time a new game is started" is already exactly `arrivedByBus === false`
  — `main.ts`'s `startFresh` calls `clearSave()`, so a new game always has the
  flag false. A continued game has it true. The two never disagree except when
  she quits mid-arrival, where replaying is the *correct* answer: she never
  finished arriving.
- **Direction of failure.** If the trigger were "someone must remember to pass
  `arriveByBus: true`", then forgetting is silent and the arrival never plays —
  the exact twelve-day failure, rebuilt. With the default the safe way round,
  the dangerous mutation requires actively passing `false`.

Explicit opt-outs (`arriveByBus: false`), both correct:
- `RIDE_DEEP_LINKS` (`/rail-race` etc.) — the point is to board instantly.
- `/view` debug camera — shows the park, not a cutscene.

`markArrived()` is called when control is handed over, not before, so a quit
mid-sequence replays it.

## Staging (geometry, all from `layout.ts`, nothing hand-placed)

Gate (0, 60); bus stop (0, 52); bus parks (0, 54.6); player ends (−1.60, 51.60)
= `ENTRANCE_PLAYER_X/Z`. Bus arrives at z = 64, vanishes at z = 68.

- Bus drives in **forward**, `rotation.y = π`, so the cat face leads into the
  park — best first impression, and it means the door (local −X) opens onto
  **world +X**, which is where `Entrance.ts` already puts the shelter (+3.5)
  and says so: *"so the cat bus's curb-side door opens directly onto it"*.
- Everyone steps down onto that curb, walks forward past the bus's front, and
  turns into the park. Player is released at `ENTRANCE_PLAYER_X/Z`.
- **Why that release point matters:** `ENTRANCE_PLAYER_X/Z` is imported only by
  `check-park.mts`, `check-npc-jitter.mts` and `parkFacts.ts`, never by `src/`.
  `check:park`'s "15/15 attractions route from the entrance" has been measuring
  from a point the game never put her at. Moving `DEFAULT_SPAWN` there makes
  that check honest.

## The `ENTRANCE_CLEAR_*` trap (brief item 4) — real, confirmed

`ENTRANCE_CLEAR_X/Z/RADIUS` has **zero consumers**, so `Scenery.ts` does not in
fact keep trees and bushes off the stop, despite `layout.ts`'s comment claiming
it does. Idiomatic fix found: one `if (onEntrancePlaza(x, z, clearance)) return
false;` inside `isPlantable` (`Scenery.ts:980-993`), sibling to the existing
`onRideExit`. `isPlantable` is also called by the wall generator via
`runIsClear`, so walls are covered too. Plus an invariant in the same PR.

Watch the anti-vacuity floors when this thins the scatter: `trees > 24`,
`bushes > 107`, `climbableTrees > 24`, on all five seeds.

## Baseline to beat

`npm run test:procgen` on `origin/main`: **9 files, 200 tests, 0 skipped**.
(200 = 5 seeds x (1 + 34 invariants) = 175, plus 25 across the 4 non-seed
files.) Final measured: **11 files, 216 tests** — +10 (5 seeds x 2 invariants) +6 (save round trip).
**Quote the count off the screen, never the one you expected.**

## Stage B seam (do not build, do not make harder)

Stage B = straight narrow lane, camera orbiting the bus, hills and trees going
past, its own self-contained scene. It hands over to Stage A at exactly one
point: **bus at `ENTRANCE_BUS_ARRIVE_Z` (z = 64), outside the gate, player
aboard, door shut.** Stage A's first phase begins there, so Stage B attaches in
front of it with no seam. Keep that boundary a named phase.

## Status — Stage A complete

- [x] Read brief, docs, all six `src/world/entrance/` files, boot path
- [x] Harness mapped; guard strategy decided (see above)
- [x] `ArrivalSequence.ts` written — the timeline nobody had written
- [x] Wired: `World` -> `Entrance` -> arrival; `DEFAULT_SPAWN` moved to the gate
- [x] `ENTRANCE_CLEAR_*` wired into `Scenery.ts` + invariant
- [x] Guards proved red by mutation (five of them, below)
- [x] `npm run build` exit 0; `npm run test:procgen` exit 0, **11 files / 216 tests / 0 skipped** (was 10 / 200)
- [ ] **Browser QA — NOT DONE, tooling unavailable. See below.**
- [x] PR raised referencing #245

## Measured results

`npm run check:cat-bus` (new, in the `build` chain):

```
handed over at -1.60, 51.60 (ENTRANCE_PLAYER_X/Z, drift 0.0000 m)
nobody walks through the parked bus — the route goes round its nose
child 0 walked 3.77 m, finishing at 0.50, 50.40
child 1 walked 6.14 m, finishing at -3.30, 50.90
bus travelled 13.40 m, z 68.0 down to 54.6
door swung to 2.05 rad while unloading, shut at both ends
339 frames riding, 217 frames walking
phases: rolling-in -> doors-opening -> kids-off -> stepping-down -> walking-in
        -> departing over 12.4 s
```

She gets the controls at **9.2 s**; the bus departs behind her over the
remaining 3.2 s.

**The investigation's own smoking gun, re-run on this build's `dist/`:**
`cat-bus` 0 -> 2, `chassis` 0 -> 1, `entrance-kid-` 0 -> 1, `arrivedByBus`
12 -> 13. The code now actually ships.

## Mutations proved red (all restored)

1. Arrival built but never added to the scene -> **5/5 seeds red**, "no node
   named `cat-bus` anywhere in the built scene".
2. `onEntrancePlaza` removed from `Scenery.ts` -> **4/5 seeds red**.
3. Door never opens -> `check:cat-bus` red.
4. Hand-over moved to the plaza -> red, "44.63 m from ENTRANCE_PLAYER_X/Z".
5. `readFlags` stops reading `arrivedByBus` -> 2 of 6 save tests red.

**Two of my own checks were vacuous first and measurement caught it** — worth
knowing, because the same trap is waiting in Stage B:

- The keep-out invariant at a bare `PLAYER_RADIUS` passed on all five seeds
  *with the keep-out removed*: the nearest bush to her spawn on the canonical
  seed is 0.94 m, clear of her 0.62 m body. Re-derived at 1.5 m (0.62 body +
  0.85 widest clump), matching `Scenery.ts`'s own ride-exit clearance.
- "Widest the door ever swung" passed on a door that never opened, because
  `depart` starts by closing it *from fully open* and so writes a swing of 1 on
  its first frame. Now scoped to the phases where somebody is getting out.

## BROWSER QA: NOT DONE — read this

**No browser tooling exists in this session.** The chrome-devtools MCP is not
present and the Claude-in-Chrome extension is not set up, so **nobody has
watched this sequence with their eyes.** Dev server was started on **5418**
(`--strictPort`) and killed by PID; ports 5200/5210/5410 untouched.

Instead there is `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/`
`68ade46a-c81d-46a8-8676-003ebeeaa648/scratchpad/arrival-plan-view.svg.png` —
a plan view plotted from the 748 real traced frames. It is **not a screenshot**.
It confirms the geometry (the walk goes round the bus's nose, she lands on
`ENTRANCE_PLAYER_X/Z`) and nothing about how it *looks*.

**What still needs a human with a browser**, in priority order:

1. **Does the camera behave while she is inside the bus?** `IsoCamera` follows
   the player, and for the first ~3.8 s she is parented nowhere — posed inside
   an opaque bus. The camera should track the bus in. Untested visually.
2. **Is she visible at all during the ride?** The bus's windows use
   `PALETTE.buildingWindow` with `MeshToonMaterial` and are **opaque**, so she
   and the driver are probably not visible through them. Fine for Stage A;
   **Stage B explicitly requires seeing them through the windows**, so this is
   the first thing Stage B has to fix.
3. **Does 9.2 s before control feel long?** It reads fine on paper. A
   six-year-old is the only real judge.
4. Do the sounds fire? WebAudio needs a gesture; character creation provides
   one, but this is unverified.
5. Does the door read as opening on the shelter side, and does walking round
   the nose look deliberate rather than like a bug?

## Two things verified by reading, worth not re-deriving

- **"Start again" does not carry a stale flag.** `saveFlags.hydrate` is called
  in exactly one place (`main.ts:224`, inside `continueGame`). The
  `onStartAgain` path never hydrates, so `saveFlags` stays at its module
  defaults and `arrivedByBus` is false — a brand-new character always gets the
  arrival, a continued save never does. Both directions correct on the real
  boot path.
- **Quitting mid-arrival replays it**, correctly: `markArrived()` only fires at
  hand-over. The autosave may record her position inside the bus, but the
  arrival overrides the restored spawn on the next boot.

## Known caveat, deliberately not fixed in Stage A

**The bus has no collision.** For the 3.2 s of `departing` she has the controls
while a solid-looking bus is still there and walk-through-able. `CollisionWorld`
is built once from static circles and has no removal, so a moving collider is
not a small change. Low risk — she is handed control beside a bus that is
already leaving, so she has to chase it — but it is real, and a child might.
Worth doing properly if Stage B gives the bus a longer on-screen life.


---

# Round 2 (7 Aug) — Jim's three faults from the first watched run

All three fixed and pushed. `build` exit 0; `test:procgen` **11 files / 221
tests / 0 skipped**.

## Geometry facts, measured — do not re-derive these

- Ground outside the gate on the gate axis is **flat only to z = 72**
  (−0.13 m), then falls: −1.35 at 74, −14 at 80. Hilltop diorama.
- **`PARK_BOUNDARY` is a spline pinned to 60 m at the gate bearing and bulging
  to 92 m within 40 degrees** (#115). A straight kerb near the wall therefore
  re-enters the park at both ends. Safe centre-x window for an 11 m bus:
  **15 m at kerb z=64.5, 41 m at z=69**. Kerb is now `ENTRANCE_GATE_Z + 9`.
- Practical parking band on the gate axis is also bounded above by the
  **treeline** (`edgeRadiusAt + 11.5..22`, i.e. z 71.5–82, 540 trees).
- Bus as built: **11.07 x 4.51 x 5.36 m**, 12 seats. Child 2.12,
  child-in-a-hat `TALLEST_CHILD_HEIGHT` 2.97.
- **ARCHITECTURE-DECISIONS §147: clearances use `TALLEST_CHILD_HEIGHT`, not
  `KID_HEIGHT`.** I used the wrong one first; the bus is sized on the right one
  now (`TALLEST_CHILD_HEIGHT + RIDER_HEADROOM`).

## Decision taken without asking, and reversible

**All eleven other children get off**, not two. A bus arriving at a park
unloads, and it is the fullest answer to *"walks into the park alongside
several other children"*. If that reads as a stampede, the fix is one number:
slice fewer routes in `ArrivalSequence`'s `kidRoutes`.

## A guard that could not fail — the lesson of this round

Closing the gate gap again left `check:cat-bus` **green**. Its wall guard asked
whether walkers cross inside the gate's *angle*, which is true whether or not
there is stone in the way — a predicate about geometry, not a measurement of
the built park. The wall is now measured in the invariant suite instead
(`theGateIsAHoleInTheWall`), and goes red with *"11 boundary wall blocks stand
inside the gate opening"*.

Two more of my own measurement bugs surfaced the same way: the check tracked
only 2 of 11 children, and read seated children's **local** coordinates as
world ones (a 19 m walk reported as 49 m). **Anything parented into the bus
must be read with `getWorldPosition`.**

## Still unseen, and now longer

No browser tooling in this session at any point. The arrival is now **~15 s**,
controls at **~11.9 s**, because twelve walk in rather than two. That length is
the single thing most worth a human judgement.

Glazing is done, so Stage B's "children visible through the windows" should now
be possible — but **nobody has confirmed the glass reads correctly**, and
transparent `MeshToonMaterial` with `depthWrite: false` is exactly the sort of
thing that sorts wrongly against the cabin interior. Check that first.

## Next, in order

1. The incremental park-generation architecture report (owed to the Overseer).
2. Stage B.


---

# Round 3 (7 Aug) — Jim: "ok, better", plus four

**Done and pushed: 1, 2, 4.** Children get off at their own moment, walk
their own jittered route at their own pace, push each other apart rather than
overlapping, and `NPC_COUNT` is derived from park area (12 -> **24**).
`build` exit 0; `test:procgen` **11 files / 221 tests / 0 skipped**.

**NOT done: 3 — the children becoming permanent park NPCs.** Investigated in
full; findings below. This is a real restructure, not a bolt-on.

## #3 is feasible, and the Overseer's instinct is right — the code proves it

**`NpcSystem` has no public `add`/`spawn`/`remove`.** The population is built
entirely in its constructor, and `KidCrowd(NPC_COUNT)` sizes a fixed-capacity
`InstancedMesh`; `InstancedCrowd.spawn()` **throws** on
`index >= this.capacity`. So eleven children arriving *later* is impossible
without raising capacity up front — i.e. **they must be NPCs from birth**,
which is exactly the "no conversion step" shape asked for.

### The mechanism already exists, twice — use the climb one, not the train one

| | `setCarriedPose` (train) | `beginClimb`/`setClimbPose`/`endClimb` (tree) |
|---|---|---|
| writes | x, z only | **x, y, z and facing** |
| gravity / collision | y still damped to ground | **fully bypassed** |
| exempt from `separate()` | **NO** | **YES** |
| begin / end | implicit | explicit |

`NpcCharacter.ts` branches on `climbingFlag` / `carriedFlag` before `move()`,
and `move()` is the only thing that applies the soft park boundary — so a
scripted NPC is free to be outside the wall, inside a moving bus, at any y.

### The gotcha that will bite whoever does it

`SEPARATION = NPC_RADIUS * 2` = **1.0 m**, and the bus's `SEAT_PITCH` is
**1.0 m**. Fore-and-aft seat neighbours sit exactly on the threshold, and
`separateFrom` bails only on `climbingFlag`. **A new `scripted` flag must be
added to the separation guards too**, or the crowd shoves the passengers out
through the sides of the bus.

### Shape to build

1. Eleven `PinnedKidSpec` entries in `PINNED_KIDS`, ported from
   `disembarkingKids.ts`'s `VARIANTS` (they are already 12 hand-authored
   looks). **Keep them inside the instanced envelope** — a `hat`, a
   `petItemId`, or a hair style outside `CROWD_HAIR_STYLES` escalates that
   child to a full `CharacterModel` at ~25 draw calls each.
2. `beginScripted` / `setScriptedPose(x, y, z, facing)` / `endScripted` on
   `NpcCharacter`, modelled on the climb flag, **exempt from separation**.
3. A `BusArrival` activity (`hold: 'child'`, `busy: true`, first in
   `WanderDriver`'s list) so nobody waves from a bus seat or gets poached by
   the train.
4. Drive it from **`World.update`, before `npcs.update`** — like
   `train.carryPassengers` — not as a `Game` system. `TreeClimbing` is a
   `Game` system and its climbers' instance matrices lag a frame; that is fine
   up a tree and not fine at the gate.
5. Hand back with `rejoinGraph(context, 'full')`. Note `WanderDriver`'s
   constructor calls `chooseNext()` immediately, so a child held on a bus for
   30 s otherwise wakes with a stale target across the park; `'full'` fixes
   exactly that.
6. Then `disembarkingKids.ts` goes away, and `ArrivalSequence` drives NPC
   bodies instead of its own. Its header comment ("deliberately NOT the
   `entities/npc` system") becomes wrong and should go with it.

## The one real cost question — needs a decision

Draw calls are **independent** of NPC count (instanced, one material). But
**triangles scale linearly and nothing is frustum-culled**
(`frustumCulled = false`). ARCHITECTURE.md budgets *"40 draw calls and ~310k
triangles for twelve children and two pets"*, against a whole-scene worst case
of *"~540 calls / 400k tris"*.

**So 12 -> 24 children takes the crowd alone from ~310k to ~620k triangles,
past the stated whole-scene worst case.** Those two numbers may simply be
inconsistent in the doc, but they are the only budget written down.
**Nothing in the repo measures NPC render cost** — `NpcSystem.drawCallCost`
exists and has *no consumers anywhere*, despite its comment claiming it is in
the debug overlay. The reusable harness is `buildHeadlessPark()`: traverse and
count instances/triangles before and after.

**24 is pushed and green, but unmeasured on a device.** If it is too much, the
density constant is the one place to change it.

## Stale comments spotted, not fixed

`wanderDriver.ts:107` and `activities/activity.ts:54` both say *"there are
eighteen children"*. Neither 12 nor 24 — they were already wrong.

## Process lesson, paid for

I ran a mutation-restore (`git checkout <file>`) against a file holding
**uncommitted** work and destroyed the stagger/push-apart implementation, then
had to rewrite it. **Commit before mutating.**


---

# Round 4 (7 Aug) — `e-cat-bus-npcs`, six faults + the NPC restructure

**No browser tooling in this session either** (no chrome-devtools MCP, no
Claude-in-Chrome; the only MCP present is Blender). Driving headless Chromium
via Playwright with a throwaway profile instead — see "Seeing it" below.

## Root causes, all measured off the built objects, none guessed

### 1. The children vanish — `ArrivalSequence.finish()` deletes them

`finish()` calls `this.dispose()`, which calls `kid.dispose()` on all eleven and
`removeFromParent()` on the group. They are one-off `createKid()` models owned
by the cutscene, so when the cutscene ends they cease to exist. Nothing
"hands them over" because there is nothing to hand them to.

### 2. They walk at 1.17–1.92 m/s against the park's 2.55

`KID_WALK_SPEED = 1.5` in `ArrivalSequence.ts`, times a per-child
`0.78 + rng()*0.5`, so **1.17–1.92 m/s**. `NPC_WALK_SPEED` in
`NpcCharacter.ts:39` is **2.55**. They walk at 46–75% of park pace — Jim's
"unnaturally slowly" is exactly right, and it is a literal, not an emergent
effect. Same disease as #232's hard-coded 1.85.

### 3. The push-apart cannot work — it is overwritten every frame

`update()` calls `advanceKid()` (which ends in `walkKid`) and *then*
`pushApart()`. But `walkKid` does `kid.root.position.set(...)` from the Bézier
**every frame**, so the previous frame's separation is discarded before it is
ever seen. The relaxation writes a correction that the next frame throws away:
**it is incapable of having an effect.** That is the "something downstream
re-synchronises them" — it is upstream, and it is total.

The stagger is also too small to save it. Routes fan the eleven `from` points
over 6.2 m — **0.62 m apart** — and the `corner` points over 3.4 m —
**0.34 m apart** — while a child is **1.53 m wide** (below). They are
interpenetrating before they take a step.

### 4. The bus is too small because nobody ever measured a child's width

**A child's bounding box is 1.53 × 2.12 × 1.54 m.** The widest part is the
**head**: `hair.shell.crop` 1.53 wide, `skull` 1.36 × 1.53. The torso is only
0.73 m. `KID_HEAD_SCALE` is 1.5 — these are chibi proportions and the head is
the whole footprint.

The bus was derived from `SEAT_WIDTH = 0.92` and `SEAT_PITCH = 1.0`, **both
hand-picked**, against a child assumed ~0.6 m across. Vertically the derivation
was honest (`TALLEST_CHILD_HEIGHT + RIDER_HEADROOM`) and vertically it fits.
Horizontally nothing was measured, because **`kid.ts` exports no width or
footprint constant at all** — there was nothing to derive from.

Measured, twelve children in the twelve built seats:

```
body shell interior: x -1.57..1.57  y 0.58..4.03  z -3.77..3.77
every one of the 12 sticks out: 0.10-0.11 m through the side walls,
                                0.24 m through the back
worst seated child-to-child overlap: 0.52 m (rows are 1.0 m apart,
                                     heads are 1.53 m deep)
```

So: **every child overlaps the child behind them by half a metre, and all
twelve poke through the bodywork.** The existing check counted seats and
occupancy and passed throughout.

### 5. The windows are transparent and it changes nothing

The glazing **did** land — `windowMaterial` is `transparent: true, opacity:
0.34, depthWrite: false`, confirmed on the built material. Jim is still right.
The bus body is **one closed opaque `RoundedBoxGeometry`**, and the window panes
are decals stuck on its *outer surface* at `x = ±(BODY_WIDTH/2 + 0.02)`.
**There is no opening cut in the wall behind them.** Looking through the glass
you see the cream body shell 2 cm behind it. Measured: pane at x = -1.55, shell
spans x = -1.57..1.57.

Making the pane more transparent can never work. The wall needs real holes.

### 6. The camera starts in the park because the boot order undoes the seating

`Game.ts` constructor, in this order:

1. `resolveSpawn()` -> `DEFAULT_SPAWN` = `(ENTRANCE_PLAYER_X, 0, ENTRANCE_PLAYER_Z)`
2. `world.attachPlayer(player)` -> `entrance.attachPlayer` ->
   `ArrivalSequence.attachPlayer` -> `beginRide()` + `poseSeated()`
   — she is now in the bus seat, ~17 m away at the kerb.
3. **`Game.ts:234` `this.player.teleportTo(spawn.x, ..., spawn.z, ...)`** —
   unconditional, and it drags her straight back to the park edge.
4. `Game.ts:796` `this.camera.snapTo(this.player.position)` — snaps to the
   **park edge**, because that is where step 3 left her.
5. Frame 1: `ArrivalSequence.update` -> `poseSeated()` puts her back in the bus,
   and the camera **damps** across the park to catch up.

`IsoCamera.snapTo` already exists and already skips the smoothing. The bug is
that it is handed the wrong position, by a `teleportTo` that should not run when
the arrival owns the player.

## Seeing it

Headless Chromium via Playwright, own throwaway profile, dev server on **5421**
(`--strictPort`, killed by PID). **5200 / 5210 / 5410 / 5412 are not ours.**
