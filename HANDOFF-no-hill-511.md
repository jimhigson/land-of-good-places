# HANDOFF — issue #511, "the park is not on a hill"

## ⛔ COLD START — 6 September 2026, 23:20, browser pass, stopped part-way

**Model: Opus** (a replacement must also be Opus). Branch `feat/sphere-combined`,
worktree `.claude/worktrees/sphere-combined`, head at the time of writing
`2be47b83` plus this commit. **No source file was changed by this session** —
only this handoff. The whole fleet was stopped for budget mid-measurement, so
read every "open" below as genuinely open, not as shorthand for "nearly done".

My dev server was **5473** and is killed. The browser page I opened is closed
(it closed itself — see the crash note below).

### The three-times-asked questions: two answered, one still open

**1. Did the rebuilt camera get in front of a browser at Jim's shape? YES.**
First time on this feature. `http://127.0.0.1:5473/arrive`, viewport measured
from inside the page as `innerWidth 2000, innerHeight 1100, devicePixelRatio 2`
— his wide-and-short shape, not assumed. Three frames were captured and are
saved **outside git** (they are binaries and must not reach a feature branch) at:

```
/Users/jim/dev/landOfGoodPlaces/.claude/arrival-frames-20260906/
  01-title-2000x1100.png
  02-arrival-opening-inside-the-bus-2000x1100.png   <- the one that matters
  03-title-wide-scene-2000x1100.png
```

`.claude/` is gitignored, so these survive only on Jim's Mac. If they matter to
anyone, they go to the `qa-screenshots` orphan branch per CLAUDE.md — **that has
not been done.**

**2. The near plane — ANSWERED, read off the live camera object, not reasoned.**

```
camera.type = "OrthographicCamera"   near = 0.1   far = 270
```

So **the near plane is not clipping the ground.** It also means the opposite of
what a near plane is usually blamed for: at a 2 m stand-back with `near` at
0.1, *everything* between 0.1 m and 2 m in front of the eye is drawn, and
during `rolling-in` that volume is **the inside of the cat bus**. Delete "check
the near plane" from the list; it is done.

**3. What the grey region actually is — STILL OPEN. I did not pick under it.**

I had the raycast written and was one call from the answer when the page died.
Do not read my hypothesis below as the answer.

### What frame 02 shows, and the strongest lead on this branch

**The opening frame of the arrival is *inside the bus*.** Screenshot 02 is the
first frame after "Go to the park!": the whole viewport is the cat bus's
interior — Eleri and Elowen in their seats with name tags, and large pale
striped slabs (the bus's own body panels, seen edge-on from within) crossing the
foreground with sky and distant scenery visible past them. That is what a 2 m
stand-back at head height with zero pitch gives you while she is still *seated
on the bus*, and `rolling-in` is 3.0 s of the 9.3 s shot.

**My hypothesis, explicitly NOT verified:** "walls in the foreground sitting on
nothing" is the bus's own panels. It fits the picture, but *it is the fourth
reasoned explanation on this bug and it has not been measured*, which is exactly
the thing this file already says not to do. **Pick under the pixels before
telling Jim anything.** The raycast that was about to run:

```js
const THREE = await import('/node_modules/.vite/deps/three.js?v=<hash from perf entries>');
const rc = new THREE.Raycaster();
rc.setFromCamera(new THREE.Vector2(0, ndcY), g.camera.camera);
rc.intersectObjects(scene.children, true)   // report object.name of hits[0]
```

### The measured discrepancy nobody has explained — start here

Read off the live camera at `elapsed 0.459` (`phase: rolling-in`), all values
from the page, none derived:

| quantity | browser, 2000x1100 | `check:arrival-camera` says |
|---|---|---|
| frame height | **3.7662 m** | 3.5640 m |
| frame width | 6.8476 m | — |
| eye y | −0.081 | — |
| player feet y | −0.929 | — |
| eye-to-player | 2.159 m | 2.0000 m |
| frame below her feet | **1.035 m (27.5% of frame)** | 0.2656 m |

**The check and the browser disagree about the shot.** The check reports 0.2656 m
of frame under her feet; the browser at Jim's aspect has **1.035 m**, nearly four
times as much, and 27.5% of the frame is below the ground line. A quarter of the
picture being empty under her is a very good candidate for "sitting on nothing".

**Two honest caveats before anyone runs with that.** At `elapsed 0.459` she is
still *seated on the bus*, so "under her feet" is the bus floor, not the ground —
the check may be measuring a later beat where the two agree. And the 2.159 m vs
2.0000 m gap is consistent with the follow being *damped* rather than rigid
(`watchesTheDoor: false` hands tracking to the ordinary damped player-follow), so
that one may be honest lag rather than a fault. **Neither caveat has been
checked.** Sample the same quantities across the whole 9.3 s before concluding
anything — the harness for that is below and it works.

**The first question to settle: does frame height depend on aspect?** If
`focusHalfHeight` is fixed and width follows aspect, 3.7662 ≠ 3.5640 needs
another cause; if height moves with aspect, then `check:arrival-camera` is
green about a frame Jim never sees, which would be this file's own "a check
that passes without checking anything" in its purest form. `IsoCamera.ts`
around lines 269–276 is where `focusHalfHeight` and `aspect` meet.

### Keep this distinction — do not soften it

Unchanged and still true: the terrain measurement **rules out "the ground stops
short"** (the `terrain` mesh spans ±124.9 m in x and z and every z the arrival
looks across is inside it). **It is NOT a verified account of Jim's pixels.**
Nothing I did changes that either way. I did not disprove the fault and I did
not see it disproved — I saw an opening frame full of bus interior, which is a
different observation.

### The browser harness that works — reuse it, do not rediscover it

`window.game` is assigned **late** (after the park builds), so polling for it
from a script that clicks the button loses the opening. Beat that with an
`initScript` on `navigate_page` that defines a setter, which fires the instant
the game is assigned:

```js
let _g;
Object.defineProperty(window, 'game', {
  configurable: true,
  get() { return _g; },
  set(v) { _g = v; try { v.timeScale = 0.06; } catch (e) {} }
});
```

Then click "Go to the park!" and poll — it lands at `elapsed 0, phase
rolling-in` with the clock at 6%, so the 9.3 s shot takes ~155 s of wall clock
and every beat can be sampled and screenshotted calmly. This worked first time.
Useful paths: `g.world.entrance.arrival` (`.phase`, `.elapsed`, `.finished`),
`g.camera.camera`, `g.player.position`, `g.timeScale`.

**The crash to expect.** The page died with `Error: No page found` /
`list_pages` returning nothing, part-way through a session at 2000x1100 —
**the same failure my predecessor hit** ("`Target closed` after resizing to his
2000x1100"). Twice now, so treat it as reproducible rather than bad luck.
Screenshot as you go and copy each frame out of the MCP temp directory
immediately; do not batch the copying to the end, or the crash takes the
evidence with it.

### Timeline, for whoever writes the deep links

`rolling-in` 0–3.0 · `doors-opening` 3.0–3.8 · `stepping-down` 3.8–4.8 ·
`walking-in` 4.8–9.3 · `ARRIVAL_CONTROL_AT` **9.3** · then `departing`.
Durations are `ROLLING_IN 3.0`, `DOORS_OPENING 0.8`, `STEPPING_DOWN 1.0`,
`WALKING_IN 4.5`, `BUS_PULLS_AWAY 3.0` in `ArrivalSequence.ts` ~line 173.

### The two deep links — NOT STARTED, mechanism settled

Neither was begun. Jim has asked twice and still has neither.

- one landing on **her getting off the bus** — `stepping-down`, so pump to
  **≈3.8 s**; this is the beat he is iterating on and will use most;
- one landing on **the end state in the park**, after the whole arrival — past
  `ARRIVAL_CONTROL_AT` **9.3 s**.

**The mechanism is settled and is not open to reinvention:** pump
`ArrivalSequence.update(context)` with real dt until the beat you want and
**stop**. **Never construct a pose that merely looks like the beat** — an
approximation Jim cannot distinguish from the real thing is worse than no link,
because it makes a wrong camera look right. A **parameter naming the beat** is
better than two separate code paths, so a future beat needs no further change.

### What I would do first, in order

1. Answer the frame-height discrepancy above — it is measured, it is unexplained,
   and it can make `check:arrival-camera` a check that cannot fail.
2. Pick under the grey pixels with the raycast, at several beats, and name the
   mesh. **No fifth reasoned explanation.**
3. Sweep the whole 9.3 s with the harness above and keep every frame.
4. The two deep links.
5. Only then the remaining gates (`check:cat-bus` was the one red step in
   `check`; `check:park-pool` still fails on seed 5 — both written up below).

---

## ⛔ READ THIS FIRST — the arrival camera, 6 September 2026, late

**Branch head `07f460d8`. Model: Opus** (a replacement must also be Opus).
Worktree `.claude/worktrees/sphere-combined`. Dev server on 5392 killed.
PR #600 is open against `main` and is **not ready for review**.

**Note the branch will move under you:** the five `check:coplanar` findings are
a *different* engineer's work on `fix/coplanar-sphere`, branched off this one.

### What is done and pushed

**The arrival camera is one rule now.** Jim, 6 September 2026, after four rounds
of choreography he did not ask for: *"the rule should be simple - camera fixed
on the player, about 2m from them, at head height, until they're in the park -
that's it."*

`arrivalShot` is a constant pose: square on to her, **zero pitch**,
`ARRIVAL_FOLLOW_DISTANCE` **2 m**, one frame height (`ARRIVAL_FOLLOW_ZOOM`,
derived from `TALLEST_CHILD_HEIGHT`), **`watchesTheDoor: false`** so the
ordinary damped player-follow is the whole of the tracking, and it returns
`null` at `ARRIVAL_CONTROL_AT` — *"until they're in the park"*.

**Deleted with the old shot**, because his rule does not ask what they answered:
the wide roll-in and `ARRIVAL_CAMERA_ZOOM`; the door beat that orbited the bus's
drop point; the walk beat; the arch pass with its dive, hold and
`ARRIVAL_ARCH_DISTANCE`; the stop-to-gate stand-back derivation;
`ARRIVAL_CLOSE_FRAMING_AIR`; `ARRIVAL_EYE_COMPOSITION_LIFT`; the swing/ride/lift
curves; `arrivalDiveSeconds`; `AT_STOPPED`.

**Two things kept, each for a stated reason.** The bearing still comes home over
0.6 s rather than snapping — that is GAME_DESIGN.md's **CONTROL rule**, not
composition: "up on the stick" is read through the camera's yaw, so a bearing
still moving under her hand sends her somewhere that is not up the screen, and a
snap on the frame she takes control is the worst instant for a cut. And the
**ground-clearance assertion**, because on a 1200 m sphere the ground rises
towards the park's middle and 2 m is not automatically clear of it.

**One place the rule does not map onto this rig, stated rather than hidden:**
the park camera is **orthographic**, so an eye's distance from its subject
changes nothing on screen. "About 2 m from them" lands as two separate facts — a
2 m stand-back, which here is purely an occlusion control, and a frame height,
which is what actually makes her that size.

**`check:arrival-camera` re-cut from 46 clauses to 13.** Forty-six clauses
testing a shot that no longer exists is worse than none — every one would have
gone on passing about geometry nobody renders. What is left is one clause per
clause of his sentence, plus the two carried over. Green today:

```
2.0000-2.0000 m held across 558 frames
worst tilt 0.0000 deg
0 of 558 frames orbit anything but her
frame 3.5640 m tall: 0.2656 m under her feet, 0.3284 m over the tallest hat
tightens by at most 0.0000 m in any frame
lens clears the ground by at least 1.3341 m
bearing 0.2779 deg off the rig at the hand-over
```

### ⚠️ What is UNVERIFIED — do not read any of this as settled

- **Nobody has looked at the new camera in a browser, at any aspect ratio.**
  Not once. Given the history below, a claim that it looks right without a frame
  in front of you is worth nothing.
- **The grey region in Jim's screenshots is still unidentified by picking.** A
  browser probe to read what is under those pixels died mid-run (`Target closed`
  after resizing to his 2000x1100) and was not restarted.
- **The near plane is still unanswered.** It was asked for twice and never
  checked. An orthographic camera has one, and geometry nearer than it is
  clipped.
- **The ground measurement rules something out; it does not explain the
  picture.** Measured on the built park: the `terrain` mesh spans
  **x -124.9..124.9, z -124.9..124.9** (a 250 m square, y -6.95..0.38), and
  **every z the arrival looks across is inside it** — z=55 at -1.45 m, z=75 at
  -2.45 m, z=100 at -4.27 m. **That rules out "the ground stops short". It is
  NOT a verified account of Jim's pixels.** Write that distinction on your hand
  before you start: a replacement who reads it as "the ground is fine" will
  waste the same day that has already gone.

### The history of this bug — the thing not to repeat

Three reports from Jim, three explanations, **two of them relayed to him as fact
and both wrong**:

1. *"the camera is still visually under the floor"* → explained as the empty
   band being a **composition consequence of the pitch-0 orthographic look**,
   and his to judge. Wrong. Reasoned, not measured.
2. Same report again → explained as **the dolly** (the zoom opening at a
   bus-wide framing and interpolating in). Fixing that genuinely changed the
   opening frame, which made it look like the answer. Wrong, or at least not
   the whole of it. Reasoned, not measured.
3. Jim on the screenshot offered as proof it was fixed: **"even your own
   screenshot shows this — walls in the foreground sitting on nothing."**
   Unexplained to this day.

**The lesson is procedural, not technical: every one of those was produced by
reasoning about geometry instead of measuring the built page.** The next
explanation must come from a pick under a pixel, a hidden group, or a depth
read — not from arithmetic about `terrainHeight`.

### Not started

- **Two beat deep links Jim asked for**, both queued and neither begun:
  - straight to **her getting off the bus**, skipping the intro that shows the
    bus — the beat he is iterating on and will use most;
  - straight to the **end state in the park**, after the whole arrival.
  A parameter naming the beat is likely better than separate paths, so a future
  beat needs no further change. **The mechanism is established and must be
  followed:** `ArrivalSequence.update(context)` drives the timeline off `dt` and
  `finish()` does the hand-over, so **pump `update` with real dt until the beat
  you want and stop**. Do NOT construct a pose that looks like the beat — an
  approximation Jim cannot tell from the real thing is worse than no link.
- **`entranceRoadBrow()` is 1.0 m**, so the cat bus drives 2 m of a 142 m road
  and `check:swept-bus` sweeps only that 2 m. Written up further down. Its
  "0 posts on 14 seeds" is correspondingly narrow.


## Where this is, 6 September 2026, evening (read this before the rest)

**Model: Opus** (chosen by the Overseer; a replacement must also be Opus).
Branch `feat/sphere-combined`, worktree
`.claude/worktrees/sphere-combined`, dev server **5392** (mine, restarted
after the merge). Browser owned.

**The two-roads merge is done, and proved.** `origin/main`'s `e080b753`
(stage 3 step 1, `roadCorridor.ts`) merged into this branch, resolved per Jim's
6 September ruling in `docs/DESIGN-round-robin-generation.md` — one road,
`roadCorridor`'s shape with `roadRoute`'s geometry. Acceptance:

- **Fourteen-seed park digest byte-identical across the merge.** Measured with
  `scripts/park-digest-sweep.sh` at `f7ebf4f7` (pre-merge tip) and at the merge
  commit; all fourteen `.txt` files diff clean. The road did not move.
- **`check:swept-bus` green**, 0 intruding posts on all 14 seeds, 77 s.
- **`check:ground-claims` green**: 143 corridor runs, 3095 ribbon vertices
  tested, worst 4.08e-6 m outside the nearest claim (float32 noise).
  **Proved red first**, on the canonical seed with `entranceRoadClaims()`'s
  `halfWidth` reduced by 0.5 m: 4 fouls, each reporting 0.5000 m. That is the
  geometry the red run was taken against — restore it to reproduce.

### Gate status at the end of this session, all run locally with exit codes read

| gate | result |
|---|---|
| `pnpm run check` | **RED** at `check:cat-bus` only — the doorway-gap clause below. Reached that step at 696 s. |
| `pnpm run test:procgen` | **green**, 694 tests in 20 files, 98 s |
| `pnpm run build` | **green** |
| `pnpm run check:swept-bus` | **green**, 0 intruding posts on 14 seeds, 77 s |
| `pnpm run check:ground-claims` | **green** |
| `pnpm run check:coplanar` | **RED**, 5 findings — see below |
| `pnpm run check:park-pool` | not run this session |

**Chain wall-clock (issue 3 of the brief).** The branch adds **exactly one step**
to the `check` chain — `check:arrival-camera` — and it runs in **1 second**.
Step sets compared by parsing `package.json`'s `scripts` object rather than
grepping it: `main` has 64 chain steps, this branch 65, nothing dropped and
nothing swapped. Every other step's *name* is unchanged; the ones that build a
park build a sphere park, which costs the same (terrain height is a formula,
and the 14-seed digest sweep took the same wall-clock before and after the
merge). So there is **no wall-clock case for this branch pushing `checks.yml`
past its cap** — but note that a full green local run has not been timed end to
end yet, because the chain has stopped at a failure on all three runs.

### The one substantive thing I changed beyond finishing the merge

**Both measurement sites stopped comparing bounding boxes.** The old clause 2
(and probe 5) compared the ribbon's min/max in x and z against the capsule
swept by its half-width. That is exact for an axis-aligned run and *measures a
different shape* on an arc — the bounding box of a curve is mostly ground the
curve does not hold — so it would have gone on passing while saying so.

`scripts/road-ribbon-measure.mts` is now the one owner of "is the claim the
road?", imported by `scripts/check-ground-claims.mts` (canonical seed) and
`test/procgen/invariants.ts` (every pool seed). `groundClaims.ts` exports
`distanceOutside` so neither re-derives point-to-capsule distance. Exactly one
of the two directions is an equality, and the module header says why: nothing
drawn may be unclaimed, while the gateway approach's claim is honestly the
envelope round a staircase of individually trimmed columns — that overshoot is
**reported as a number on every run**, never thresholded.

### Two arrival-camera findings, both for Jim rather than for an engineer

Verified in a real browser on 5392, `/arrive`, not assumed:

1. **Both of Jim's reports are satisfied.** It opens *on* the bus on the first
   frame (no transition down to it), and the door beat sits at eye height
   clear of the floor.
2. **But the bottom ~45% of the frame is empty sky during the door and walk
   beats.** `ARRIVAL_DOOR_PITCH_DEGREES` is 0, which is what "square on"
   requires, and a horizontal *orthographic* look draws the ground as a line
   with nothing under it. Not a sphere regression — flat ground looks the same.
   This is a composition call, so it is Jim's.
3. **`?projection=perspective` breaks the arrival shot.** The stand-back is
   derived for ortho, where sliding the eye along its own axis is purely
   occlusion control and does nothing for framing (this file says so already,
   under "The stand-back bug"). Under perspective the same number puts the
   camera behind the boundary wall with the pet filling the frame. The
   *ordinary in-park* perspective camera looks good; the arrival is ortho-only
   today.


## `check:park-pool` — root-caused, three seeds retired, seed 5 is the work

**Was** 4 of 14 seeds failing (5, 115, 225, 346). 115, 225 and 346 are retired
in their own commit — they are outside 0..15 and Jim's ruling covers them. **The
pool is 11 and `check:park-pool` still fails on seed 5**, which is inside 0..15
and cannot be retired.

### The root cause, located

Measured on seed 5 with the real park built:

- 236 waypoints placed, **208 in the main component, 28 in one pocket** spanning
  radii 30.8 to 67.1 m — a long arc through the park's south-west.
- The closest stranded/main pair is **2.48 m apart**, both in the garden, at
  (4.3, −48.6) and (5.9, −50.5), and the straight line between them is blocked
  the whole way, peaking at **0.678 m of push**.
- It is **not the railway**: the block is 12.33 m from the rail centreline.
- What is there is a chain of `topIsAbsolute` walls with **absolute tops
  climbing 0.367, 1.243, 2.085, 2.894 m** along consecutive 2 m segments —
  a **bridge's side wall (spandrel + parapet) going up its ramp**, which
  `bridges.ts` pins to *"the local road surface plus the parapet"*.
- At the blocked point the wall's absolute top is **1.24 m** and the terrain is
  **−0.93 m**. On the old flat ground that wall stood 0.37 m over the grass at
  the ramp foot; the sphere dropped the ground out from under it and it now
  stands **1.30 m** over the ground beside it, walling off the path that runs
  alongside.

**The shared-cause test, run rather than argued:** with `GROUND_SPHERE_RADIUS`
raised to 1200000 (flat) and nothing else changed, seeds 5, 115 and 225 all pass
`check:park`. (Seed 346 throws in `ParkTrain` at that radius, so the probe says
nothing about it — do not read its result.) So one cause, three seeds, and it
survives the retirements in seed 5.

**Where it belongs:** `src/world/train/bridges.ts` — `parapetHeightFor` already
deletes the wall at ramp feet below `PARAPET_GONE_HUMP`, and that hump is
measured against a terrain that has moved. This is the same subsystem and the
same shape as three of the five `check:coplanar` findings, so it wants the same
engineer.

### A theory that was wrong, so nobody spends the hour again

`poiGraph.ts`'s `isClear` stands its probe at `bridgeHeightAt(x, z) ?? 0` — a
literal zero — and its own comment calls that *"exactly the old ground-level
probe"*, which stopped being true the day the sphere landed. It is a real
mismatch and it looks exactly like the cause. **It is not.** Standing the probe
on `terrainHeight` in the garden (and keeping 0 for the interior spaces, whose
own floors are hundreds of metres out) left seed 5 unchanged at 28 stranded and
made **seed 225 worse, 73 to 84**. Reverted, unpushed. If someone fixes the
probe height on principle later, that is fine — but it is not this bug, and it
needs its own justification and its own measurement.

## `check:entrance-road` is RED in CI, and it is the brow bug wearing a different hat

`Entrance road` (`entrance-road.yml`) fails on the PR. **It is this branch's own
check** — neither the workflow nor `scripts/check-entrance-road.mts` exists on
`origin/main`, so there is nothing to compare against and nothing pre-existing
to blame.

It is red for the best possible reason: **its control caught it.**

```
control: with the corridor off the ride puts 0 legs back in the bus's path
across 10 seeds (worst 0.00 m inside a bus) — the sweep can see a collision
covered: ... bus swept from the brow at +1 m to -1 m

FAIL: the control found NO collision on 10 seed(s) — with the road's corridor
switched off the Rail Race puts its legs back through the road, so the bus is
supposed to sweep through them. Reading zero there means this sweep cannot see
a collision at all, and its verdict on the real road is void
```

**Same root cause as the section below.** The bus is swept from `+brow` to
`-brow`, the brow has collapsed to 1.0 m, so the sweep covers 2 m of a 142 m
road and never reaches a trestle even with the corridor deliberately switched
off. The check is refusing to certify a result it knows it cannot see, which is
exactly what CLAUDE.md asks of a control — and it means **`check:swept-bus`'s
green "0 posts on 14 seeds" is narrow in precisely the same way**, without
saying so.

So this is one bug with three faces: a visible arrival defect, a void
`check:entrance-road`, and a `check:swept-bus` covering 1.4% of the road it
names. Fixing `browAt()` fixes all three, and the fix belongs with whoever takes
the brow.

## ⛔ `entranceRoadBrow()` is 1.0 m, and this is worse than a coverage gap

Raised by the step-2 engineer at `b6b1a983`, confirmed here by measurement:

```
brow 1.000 m; bus runs -1.00 .. 1.00
stations 143, arc spans roughly 142 m of road
```

**The cat bus drives two metres of a 142 m road.** `entranceBusArriveAt()` and
`entranceBusVanishAt()` are both `±entranceRoadBrow()`, which replaced two
hand-measured x coordinates with "the point at which the road goes over the
hill". On the old hill that point was far out. **The sphere falls away from the
park's centre in every direction, so the road is descending from the very first
metre and the brow collapses to nothing.**

Two consequences, and the second is the serious one:

1. **`check:swept-bus` sweeps the bus over 2 m of arc**, about one bus length
   either side of the stop. Its headline — 0 intruding posts on 14 seeds, which
   this file and the PR body both quote as acceptance — is therefore covering
   far less than its name suggests. **Discount that evidence accordingly**; it
   is not wrong, it is narrow, and nothing in its output says so.
2. **It is a live visible defect, not only an instrument one.** The whole point
   of the brow was that *"the bus drives on from out of sight and leaves the
   same way, instead of appearing on a kerb"*. At a 1 m brow it appears on the
   kerb. `check:cat-bus` has been printing the evidence all along — `bus
   travelled x 0.8 to -1.1` — and I read past it.

Not fixed tonight, by the Overseer's instruction, and it is mine to own. The
fix is in `roadRoute.ts`'s `browAt()`: "over the hill" needs a definition that
survives a ground with no hill on it — most likely the road's own grade against
`BUS_MAX_GRADE`, or a plain distance, rather than a search for a crest that no
longer exists.

## The split: attempted, and it does not decompose the way the seams suggested

The Overseer asked for four pieces to go to `main` as their own PRs — the
`check:park-map` framing, `funnelCorner`, the ribbon-measurement owner with
`distanceOutside`, and `check:ground-claims`. **None of the four is separable,
and the reason is the same one each time: they are all downstream of modules
that exist only on this branch.** Checked rather than assumed:

- **`roadRoute.ts` is not on `main`** (`git ls-tree origin/main src/world/entrance/`).
  `busStopOnMap()` reads `entranceRoadAt` from it, so the park-map fix cannot
  compile there — and the bug it fixes does not exist there either, because a
  straight road pressed against the wall leaves the bus inside
  `PARK_BOUNDARY.extent`. `check:park-map` is green on `main`.
- **`funnelCorner` fixes a wall-walk the arc causes.** `check:cat-bus`'s
  boundary clause is green on `main`, so the change would land there with no bug
  behind it and no red proof obtainable.
- **`RoadSegment` is `across`/`along`/`centre` on `main`** and `from`/`to` here,
  so `road-ribbon-measure.mts` does not typecheck against `main`'s owner.
- **The doorway clause looked like the one clean candidate and is not.** It was
  cherry-picked onto a real branch off `main` and *`tsc` passed* — then the
  check died at runtime on `SyntaxError: does not provide an export named
  'CAT_BUS_DOOR_DROP'`. That constant is this branch's hoist. Worth keeping the
  lesson: `tsc -p tsconfig.json` covers `src` only, so a green typecheck says
  **nothing** about whether a script's imports resolve.

`distanceOutside` alone would apply, and would be a dead export with no caller.
The only genuinely separable pair is `CAT_BUS_DOOR_DROP`'s hoist (91 lines in
`catBus.ts`, with its 1e-9 drift assertion) carried together with the doorway
clause — that is a real, invisible, self-proving PR if someone wants it, but it
is a piece of the arrival-camera work being pulled out ahead of the rest.

## ⛔ Also RED, found by running the chain: `check:cat-bus`'s doorway gap

**One clause, and it is a marginal failure of a proxy.** `pnpm run check:cat-bus`
prints `tightest gap 0.63 s (needs 0.64)` — 0.633 against a `REQUIRED_GAP` of
0.635, a 0.3% miss. **It is this branch's, measured**: `origin/main` at
`dd5b3b6b`, run in a scratch worktree, prints `tightest gap 0.68 s`.

**Do not fix it by widening the schedule until it passes** — that is a
stand-off, and the numbers below say it would be fixing the wrong quantity.
What the clause measures is when a child leaves the **bus's bounding box**
(5.37 x 12.90 m). What its message claims is that two children "overlap in the
doorway". Those were near enough the same thing on the straight road and are
not on the arc. Measured, per child, on the canonical seed:

```
i   delay   aisle   at the door   door gap   speed
0   0.000   1.368   1.368            -       2.603
1   0.820   1.684   2.504         1.136      2.570
2   1.578   1.698   3.276         0.772      2.486
3   2.512   2.211   4.723         1.447      2.532
4   3.271   2.363   5.634         0.911      2.692
5   4.035   2.366   6.401         0.767      2.614
6   4.872   2.562   7.434         1.033      2.517
7   5.709   2.571   8.280         0.846      2.684
8   6.589   2.810   9.399         1.119      2.497
9   7.494   2.936  10.430         1.031      2.511
10  8.462   3.409  11.871         1.441      2.581
```

**Every gap at the doorway itself is >= 0.767 s**, comfortably over the 0.635
the clause asks for; the tightest is between children 5 and 6, not the pair the
check names. The failure is between 7 and 8, and it is entirely in the leg
*after* the door: child 7 takes 2.637 s to clear the bounding box and child 8
takes 2.151 s. Half a second of difference in how long it takes to walk out of
a 12.9 m box.

**That is the finding, and it is a look problem as much as a check one**:
because the bus now stands on a curve, some children's fan routes set off
*along* the bus rather than away from it, and walk five or more metres beside
it before turning in. Two candidate fixes, and the choice is a judgement about
choreography that Jim should see rather than one to make silently:

- **Make the first stride out of the door head away from the bus** for every
  child, and fan afterwards. Uniform box-exit times, the schedule's gap
  survives to where the check measures it, and it looks like a bus emptying
  rather than children filing along its flank. Visible; needs eyes.
- **Change the clause to measure the doorway it talks about** rather than the
  bounding box. Defensible — the message and the measurement genuinely
  disagree now — but changing a gating check on a 0.3% miss is exactly the
  move this repo distrusts, so it wants a second opinion, not an engineer
  acting alone at the end of a session.

## ⛔ BLOCKING BEFORE ANY PR: `check:coplanar` is RED — but not for the reason
this file used to say

Do not open a PR from this branch until `pnpm run check:coplanar` exits 0.

**Re-measured 6 September, after the two-roads merge. The finding this section
named is GONE, and five different ones are there instead.** The entrance
gateway path's 0.006 m² residue against `path-surface` no longer appears at
all — the merge, which put the drawn approach and its claimed reach behind one
call, closed it. Everything below replaces it; the old text is kept at the end
of this section only because its *reasoning* about baselines is still right.

The five, exactly as the check prints them (seed pool of 14, run at the merge
commit):

```
MORE:  garden|park-train/railway-bridges/bridge/deck|park-train/railway-bridges/bridge/shell
       2 separate seam(s) between these two on one seed, recorded at 1
WORSE: garden|garden/boundary-wall/boundary-blocks|park-train/rail-fence/<Mesh:BoxGeometry>
       0.280 m², recorded at 0.051 m²
MORE:  garden|garden/boundary-wall/boundary-blocks|park-train/rail-fence/<Mesh:BoxGeometry>
       2 separate seam(s) between these two on one seed, recorded at 1
WORSE: garden|garden/path-surface|park-train/train-track/track-ballast
       5.993 m², recorded at 3.032 m²
NEW:   garden|park-train/railway-bridges/bridge/shell|park-train/railway-bridges/bridge/wallTop
       0.052 m² of shared plane, a maintained stand-off at 5.3e-3 m, seen on seed 326
```

**They are one root cause with four faces: the sphere moved the terrain under
geometry whose seam-avoidance thresholds were measured against the old hill.**
None of them is the entrance road, the arrival camera or the gate arch. Note
what that means for whoever picks this up — it is not five small fixes in this
branch's own new code, it is a re-measurement in three subsystems that already
have careful, heavily-reasoned seam logic:

- **`src/world/train/bridges.ts`** owns the `shell`/`wallTop`/`deck` seams, and
  its comments (around the `artefact = COURSE_HEIGHT / 100` test) explain that
  the reveal-deletion thresholds were calibrated by measuring the *distribution*
  across all pool seeds — "the strays sat 16–77 mm below the wall top, while a
  reveal actually fighting the cap sits 1.5 mm under it". Those two populations
  were separated on the old terrain. The sphere moves which ring lands on the
  coincidence, exactly as #489 did, and the same measurement has to be redone
  rather than the threshold widened by feel.
- **`garden/path-surface` vs `train-track/track-ballast`**, the biggest at
  5.99 m², is a *pre-existing* baselined seam (3.03 m²) that roughly doubled.
  The path network does not keep clear of the ballast the way the entrance's
  gateway path does — `BALLAST_HALF_WIDTH` is exported from `track.ts` for that
  one caller only. The obstacle to fixing it the same way is ordering:
  `buildPaths()` runs inside `Garden` **before the train exists**, so it cannot
  ask the track where it is. A post-pass, in the shape of the existing
  `drapePathsOverBridges`, is the likely answer.
- **`boundary-blocks` vs `rail-fence`** is the wall and the fence meeting where
  the railway leaves the park.

**Do NOT add baseline entries for any of these.** An entry means "already wrong
before the gate existed"; four of these five *have* entries and are worse than
them, which is the ratchet doing its job. `ART_DIRECTION.md` §7: delete the
hidden face, never nudge a surface apart.

Also printed on that run: **seven `BASELINE LOOSE` lines** — entries whose seam
is gone (hotel tower and door jamb against terrain, the water-fight plot, three
stall cylinders against terrain, the face-paint stall). Those are seams the
sphere *fixed*, and their entries should be deleted in the same change, because
a baseline entry for a seam that no longer exists is a licence for it to come
back unnoticed.

### The original text of this section, kept for its reasoning about baselines


**Root-caused, with a stated fix and a stated moment to apply it** — which is
why deferring it is legitimate rather than brushing it aside. The road branch
renamed the mesh `entrance-road-gateway` → `entrance-gateway-path` and reduced
the fault from **2.4910 m² to 0.006 m²**, but `main`'s baseline entry is keyed
on the *old* name, so the 400×-smaller residue reads as brand new. Deleting
that stale entry (which this branch does) is correct; it is what exposed the
residue.

**Fix it after the sphere lands, because the sphere changes the terrain under
this exact geometry** and a fix applied now is likely wasted or invalidated.

**Do NOT add a baseline entry to make it pass.** That is the forbidden move —
an entry means "already wrong before the gate existed", and re-keying this one
would be silencing a live finding. Fix the residue by deleting the hidden face,
per ART_DIRECTION.md §7.

Not this branch's regression: `HANDOFF-road-487-488.md` states plainly that
`check:coplanar` was **never run at that branch's final geometry**, which is how
the residue survived to be found here.

### A finding for its own issue — do not fix it on this branch

**`check:coplanar`'s ratchet is keyed on mesh names, so renaming a mesh
silently loses that finding's baseline entry.** The finding then either
disappears (if fixed) or reappears as NEW (if not), and neither tells you a
rename happened. That is a structural weakness, not a one-off, and it is the
same family as this repo's "two definitions of one thing kept in step by hand":
the baseline and the meshes are kept in step by nobody. Reported to the
Overseer to raise separately.

- **Model: Opus** (chosen by the Overseer for this task; a replacement must also be Opus).
- **Branch:** `feat/sphere-combined` (built off `feat/no-hill-511`; carries the
  sphere ground, perspective, the arrival camera, the road, and the FOV fix —
  Jim asked for **one branch he can try**).
- **Worktree:** `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/sphere-combined`
- **Role:** Engineer. Reports to the Overseer, not to Jim. Does not merge.
- **Browser:** **OWNED as of 5 Sep 2026** (granted by the Overseer). Dev server on
  port **5391** (`vite --port 5391 --strictPort`), left running for Jim, who is at
  the Mac. Kill it by PID when the workstream ends.

## Where this is, 5 Sep 2026 (read this first)

**Jim's instruction changed the priority:** asked whether the arrival camera should
blend perspective→ortho, he said **"try perspective everywhere to see how it looks"**.
So `?projection=perspective` is no longer a side experiment; it is the thing to show.

Done this session:

- Rebased onto `origin/main` (`61e95fe5`, #515). Clean, 3 files, no silent revert.
- **Looked at it in a real browser** — matched ortho/perspective pairs at park
  centre, at default zoom and at max zoom-out, clock pinned to 12:00 so the pair is
  comparable. Screenshots in the scratchpad, `01-`…`06-`.
- **Found and corrected a 2.38× error in this file's own FOV table** — see the
  CORRECTION section near the end. The horizon needs zoom **0.107**, not 0.254.
- **Measured frame time at full zoom-out** (the flagged unmeasured risk): 9.3 ms
  median with the whole park in frame. Not a blocker on desktop.

- **Built `?zoomMin=`** so Jim can find the far end of the zoom himself, live,
  rather than choosing between the three numbers offered. Any positive value
  under `CAMERA_ZOOM_MAX`; absent, the shipped 0.42 applies and a real player is
  unaffected. **Not the permanent change** — Jim has not decided the value yet.
- **Fixed a two-definitions bug** in the camera framing formula (below).

Not started: curving the ground, measuring the sky on extended ground.
**#498 (entrance road) is still blocked on the ground shape** — nothing this
session settled it, because the session went to Jim's re-prioritisation.

## Two names that exist only on the stale road line — contamination warning

`fix/road-487-488` was force-pushed over with a 71-commit-stale rebase and then
recovered; the stale line survives at `salvage/road-487-488-stale-rebase`
(`18d82c9a`). **Anything you read from it may not exist on the true tip**
(`0814e359`), and reaching for a name from memory afterwards is how it spreads.

Caught here, both by `tsc` rather than by care:

- **`BUS_SILHOUETTE_OVERHANG`** — stale line only. I used it deriving the road's
  outset because I had read its reasoning ("the road's outset also had to carry
  the bus's silhouette, 1.24 m of tail, whiskers and swung door").
- **`ENTRANCE_ROAD_MINIMUM_OUTSET`** — stale line only.

Neither is on the true tip. The road now claims only the carriageway's own
half-width, and **how far the bus overhangs its lane as it turns is left to
`check:swept-bus`** — which measures the drawn vehicle against the drawn posts
at the bus's own height, across all sixteen seeds, and is merged. A constant
invented in `roadRoute.ts` would be a second opinion about the bus's shape,
held by the road, which is this repo's most expensive habit.

**If you find yourself confident about a road constant you cannot see in the
file, check which line you read it on.**

## Seed 288's bridge throw — root-caused to the Sky Cruiser's low corridor

**The sphere does not break bridge siting directly. It breaks it four steps
upstream, through a height threshold that reads the ground.**

`test/procgen/seed-288.test.ts` throws during park *construction* (not an
assertion) with:

```
rail crossings: the drawn paths cross the railway at railD 35.1 (-36.2, 2.8),
which snaps to no proven bridge site.
```

**It does not throw on `main`** — measured at `61e95fe5`, exit 0, 88 passed. So
it is this branch's, and it is worth knowing exactly why.

### Two hypotheses, one killed by experiment

The obvious suspect was **module initialisation order**: this branch removed
`terrain.ts`'s import of `PARK_BOUNDARY`, and losing an import edge can change
when modules evaluate and therefore the seeded RNG sequence. Tested directly by
restoring the edge as a side-effect `import './boundary';` while keeping the
sphere maths. **Identical failure, same coordinate** — so it is not init order,
it is genuinely geometric. (The import is not needed and was not kept.)

### The actual chain

`plan.ts:256`, inside `cruiserLowPoints()`:

```ts
if (probe.y - terrainHeight(probe.x, probe.z) >= 5.9) continue;
```

That collects the Sky Cruiser's **low-flying** sample points — the places it
flies under 5.9 m above the ground — and `clearStationDistance` asks them for
every candidate offset of every station. So:

1. The sphere lowers the ground away from the park's centre (−3.25 m where the
   bus drives, −5.73 m at the road's reach).
2. `probe.y - terrainHeight` therefore gets **larger** for the same cruiser.
3. Fewer points fall under 5.9 m, so the low corridor **shrinks**.
4. Station placement changes, so the **train route** changes.
5. `TRAIN_PLAN` feeds `crossingPlanSolve`, so **`CROSSING_SITES` change**.
6. On seed 288 the path router draws a crossing where the solver proved no
   site, and `crossings.ts:432` throws.

**Nothing in that chain is wrong on its own.** The cruiser really *is* higher
above the ground once the ground falls away; the 5.9 m test is doing its job.

### What it exposes, which is the part that matters

`crossings.ts`'s own comment says this case is *"always a bug upstream — find
the router that drew this leg"*. So the path router and the site solver can
disagree, and the only thing that kept them agreeing was the particular
geometry the hill happened to produce. **A generator that throws rather than
backtracking is not doing what CLAUDE.md requires of every generator here**,
and that brittleness is pre-existing; the sphere is what exercised it.

Do **not** fix this by widening 5.9, which is a real clearance number owned by
the cruiser, nor by dropping seed 288 from the pool before the disagreement
itself is understood — the seed is the messenger.

## Unreachable-so-copied is a distinct smell from varies-so-copied

Worth naming, because the repo has more of the first than anyone has written
down and they need different fixes.

`CAT_BUS_DOOR_DROP`'s values were **never variable** — every input is a module
constant, so "where the bus door puts a child down" was a fixed pair of numbers
from the day it was written. It was merely **unreachable**: obtainable only
from a *built* bus, because it was computed inside `buildCatBus`. The arrival
camera needed it at module scope, and a value that is deterministic but
unreachable is exactly what gets hand-copied into a second definition — the
copy looks harmless, because the number really never changes.

The fix for *varies-so-copied* is to pass the live value around. The fix for
**unreachable-so-copied is to make the real value reachable** — hoist it,
export it, and have the original site consume it — never to write down a
constant that "should match". `buildCatBus` now returns that same object and
**asserts the built mesh agrees with it to 1e-9**; the assertion is what makes
it an owner rather than a promise, since a comment claiming two numbers agree
is not a mechanism.

## The stand-back bug — a live visible defect no check would have caught

Found by re-deriving the arrival shot against the arc rather than porting it.

`ARRIVAL_DOOR_DISTANCE` was `ENTRANCE_BUS_STOP_Z - ENTRANCE_GATE_Z` — a
**difference of z**. On the straight road that happened to equal the ground-plan
distance from the stop to the gate, so it was right, so nothing said otherwise.
The curved road separates the two and it silently stops being right.

Why it matters on screen rather than only in arithmetic: **in an orthographic
rig the stand-back does nothing for framing — it is purely an occlusion
control** (sliding an ortho eye along its own view axis changes nothing). So a
wrong stand-back does not look like a wrong size; it puts the park's furniture
between the lens and the child. It is now the real planar distance,
`hypot(gate - stop)`.

No check on either branch could have caught this: it is a composition fault in
a cutscene, and it only appears once the road curves.

## The ordering finding: the ground work is not optional alongside perspective

**Do not treat "perspective camera" and "fix the hill" as two independent
tickets that can be taken in either order.** They are one thing taken in an
order, and the order is forced:

- Orthographic **hides** the hill. There is no convergence, so the rim drop is
  drawn as a band of dark green at the frame edge and reads as scenery.
- Perspective **exposes** it. At a wide enough FOV the park is unmistakably a
  dome — the land crests and falls away on every bearing (`06-persp-fov76-horizon.png`,
  `07-zoommin-0107-live.png`).

So a perspective camera does not merely *permit* the #511 ground work, it
**requires** it: shipping perspective without it makes Jim's original complaint
more visible than it is today, not less. Anyone picking this up who is tempted
to land the projection change first and do the ground "later" should read that
as shipping a regression against the very ticket this branch is named for.

The converse also holds and is the reason the sphere stalled for a session:
the ground work alone, under ortho, buys nothing visible, because ortho draws a
870 m horizon at 870 m. **Neither half is worth landing without the other.**

## Two definitions of the camera framing formula — fixed

`IsoCamera.frustumBase()` and `world/tapSpacing.ts` both spelled out
`Math.max(CAMERA_VIEW_HEIGHT / 2, CAMERA_MIN_VIEW_WIDTH / 2 / aspect)`.
`tapSpacing`'s comment claimed the tap radius "follows automatically" when the
camera framing changes; it did not — the two happened to still agree.

Now `constants.ts`'s **`cameraViewHalfHeight(aspect)`** is the single owner and
both ask it. Numerically identical (phone half-height 11.902564102564103 either
way), so nothing on screen moves.

Worth knowing why it mattered: `tapSpacing` sizes the world-space radius by
which a child's tap is allowed to miss what she aimed at. A drift between the
copies would have mis-sized every interact zone on a phone, and no check in the
repo would have gone red — the copy is only ever found wrong by a child.

This is also *how* the FOV table error was found: writing the derivation out
forced a look at where the base actually comes from, and there turned out to be
two answers to that question.

## The task

Jim, 4 September 2026, verbatim and it is the specification:

> "I think the answer there is to just not make the park on a hill. Let the land
> spread out in all directions for a long way but low poly"

The Overseer's explicit instruction: **do not start by editing constants.** Produce
the dependency inventory first, report it up with a proposed approach, and only then
change behaviour.

## Status

- [x] Worktree off current `origin/main` (`10fb7c2d`), `pnpm install --frozen-lockfile` clean.
- [x] Dependency inventory — below.
- [x] Sky measurement — the finding that changes the ticket. See "The sky" below.
- [ ] **BLOCKED: reported to the Overseer, waiting on a decision about the sky.**
- [ ] Implementation.

---

# The finding that has to be settled before any code changes

## The sky, measured

The instrument is at `scratchpad/skyfrac.mts` (not committed; it ray-marches the
real `terrainHeight` under the real camera constants and counts screen rows that
see no ground). **The control discriminates**: today's hill gives 19.8% sky at the
park edge at max zoom-out and 0% at the park centre, so the instrument can see sky
and can tell the two apart. I also derived the 19.8% analytically before believing
it — the disc's cut edge lands 39 m up-screen, which projects to screen-up
`39·cos38° − 17·sin38°... ` = 10.6 against a frame half-height of 17.86, leaving
20.3% of the frame above it. Measurement and algebra agree.

```
sky % of frame                             z1.00   z0.80   z0.60   z0.42
CONTROL: today, the hill (drop at 12 m outset)
  park centre                               0.0%    0.0%    0.0%    0.0%
  park edge (far side, up-screen)           0.0%    0.0%    6.8%   19.8%
flat, land simply ends at 40 m outset        0.0%    0.0%    0.0%    0.0%
flat, land simply ends at 300 m outset       0.0%    0.0%    0.0%    0.0%
flat to 40 m outset, then the drop           0.0%    0.0%    0.0%    0.0%
flat to 100 m outset, then the drop          0.0%    0.0%    0.0%    0.0%
flat to 200 m outset, then the drop          0.0%    0.0%    0.0%    0.0%

CONTROL: around the whole park edge at zoom 0.42 —
  3/24 bearings show any sky (225°, 240°, 255°); the most is 18.5%
```

### What this means

**Under an orthographic camera pitched down 38°, every view ray hits flat ground.**
There is no horizon in an ortho projection of a plane. Sky can therefore only
appear where the ground *runs out* — a cut edge, or a fall steep enough to carry
the ground below the bottom of the frame. That is a geometric fact, not a tuning
problem, and it is why `constants.ts:17-26` already says in as many words: *"With
an orthographic camera an endless ground plane would fill the frame forever and
the sky would never be seen."*

So **"land spreading out a long way in all directions" and "sky visible at ground
level" cannot both be true** with this camera. The middle option I expected to
work — keep the drop but move it far out — **does not work either**, and the
measurement is why I am not proposing it: at max zoom-out the frame only reaches
~29 m up-screen from the player, so a drop at 40 m or beyond is simply off-frame
and the visible land is flat to the frame edge. 0% sky in all three variants.

### Why this is much less alarming than it sounds

The comments defending the hill overstate what it currently buys:

- **At default zoom (1.0) the sky is already 0% at ground level, everywhere** —
  including standing at the park edge. `IsoCamera.ts:69` sets `zoomValue = 1`.
- Sky only appears below zoom 0.6, and only on **3 of 24** edge bearings, topping
  out at 18.5% of frame.
- The day/night cycle is *not* mainly seen through visible sky. It is carried by
  the light colour, the ambient, and the fog tint, all of which paint the ground
  and every prop — `DayNight.ts:79-180`'s `SKY_KEYS` each carry their own `fog`,
  applied at `:796-801`. The sky quad itself is a full-screen pass
  (`Sky.ts:226-248`) drawn *behind* everything.
- The genuinely sky-filled views are the ones that raise the camera or free it:
  the ferris wheel's climb via `setSpaceFactor`, the sky cruiser, and `/view`.
  None of those are affected by ground extent.

So the real cost of Jim's instruction is: **the 3-bearings-at-max-zoom-out sliver
of sky at the park edge goes away.** That is a much smaller loss than
`constants.ts` implies, and it is a loss Jim may well accept — losing the diorama
look is arguably the point of the ticket. But it is his call, not mine, and it is
visible, so per CLAUDE.md it waits for him.

## The three routes, honestly

- **A — Do what Jim said.** Flat land spreading far, low-poly. Sky at ground level
  goes to zero on all bearings and all zooms. `Sky.ts`'s `HORIZON_Y_LEVEL = 0.5`
  and its comment about the crest become dead. Simplest code: `terrain.ts:36`
  loses its `smoothstep`, the disc grows, an outer low-poly annulus is added.
- **B — Flat land, and give the sky back another way.** Same as A, but earn the
  sky by raising the camera pitch or adding a distance fade-to-sky on the ground
  material. Raising the pitch breaks ARCHITECTURE.md's "One camera angle,
  forever". A fog/alpha fade to the sky colour at the frame's far edge is the
  honest version and is not expensive — but it is a new look, and a real
  art-direction decision rather than an engineering one.
- **C — Flat *apron*, hill kept far out.** Keep a drop but push it to ~40 m. This
  fixes #498 completely (the road at 11.94 m outset is then on dead-flat ground)
  and is by far the smallest change. It does **not** keep the sky (measured), so
  it buys nothing over A on that axis — but it keeps the world bounded, which
  keeps the treeline's job, the budget, and every rim-relative thing simple.

My recommendation is **B**, with **C as the fallback** if the fade is judged too
big a look change to take on this ticket. A is B without the thing that stops the
frame being solid green at the top edge.

## The low-poly budget, if we do extend

Today's ground: **18,432 triangles, 9,417 verts, 1 draw call** (`Garden.ts:88-150`,
72 rings x 128 segments, radius `pow(ring/rings,1.35) * TERRAIN_EDGE_RADIUS`,
124.9 m today). Proposed outer annulus from 125 m to ~400 m at 8 rings x 64
segments = **1,024 triangles, 585 verts, 1 extra draw call** — a 5.6% increase in
ground triangles for 10x the radius. That is the measurable budget the issue asks
for. Two cautions:
- `boundary.ts:652` requires an even polar grid for the grass UV tiling; the
  annulus must share the same polar parameterisation or the grass seams.
- The annulus must be `receiveShadow` only, never a shadow **caster** — the shadow
  camera is a fixed 52 m box that follows the player (`DayNight.ts:359-379`,
  `SHADOW_AREA = 26`), so a 400 m caster is pure cost.
- Camera `far = 270` (`IsoCamera.ts:150`) hard-clips ground at ~228 m. Land
  authored past that is invisible *and* clipped mid-plane. Either stop the annulus
  near 200 m or raise `far`.

---

# The inventory

## The hill is one expression

`src/world/terrain.ts:36` is the entire hill:

```ts
const beyondEdge = -PARK_BOUNDARY.distanceToEdge(x, z);
return base - smoothstep(RIM_OUTSET_START, RIM_OUTSET_END, beyondEdge) * RIM_DROP;
```

`base` is three sine waves scaled by `TERRAIN_HEIGHT_SCALE` (0.55) — the gentle
rolling hills *inside* the park, which stay. Everything hill-shaped comes out of
that one `smoothstep`. That is the good news: the drop can be removed in one place.

The bad news is what the drop is currently *doing*, which is not "being a hill" —
it is **hiding the cut edge of the terrain disc and letting the sky be seen.**
`constants.ts:17-26` and `terrain.ts:24-28` both say so outright. Remove the drop
and you do not get flat land; you get a flat disc of radius ~`TERRAIN_EDGE_RADIUS`
ending in a cliff-less cut edge at eye level, with the skybox below the horizon
line. So the drop cannot simply be zeroed — the land has to be *extended*, which
is exactly what Jim asked for.

## The terrain mesh today

`src/world/Garden.ts:88` `buildTerrain()`, called from the `Garden` ctor at `:70`.

- Polar disc: `TERRAIN_SEGMENTS` (72) rings x 128 radial segments, hard-coded at
  `Garden.ts:90`.
- **73 x 129 = 9,417 vertices, 18,432 triangles.** One indexed `BufferGeometry`,
  one draw call.
- Radius `Math.pow(ring/rings, 1.35) * TERRAIN_EDGE_RADIUS` (`Garden.ts:106`) — a
  plain circle, **not** boundary-following, despite what `boundary.ts:719` claims.
- Per-vertex Y from `terrainHeight` (`Garden.ts:112`). This is the only place the
  rim becomes geometry.
- Vertex colour ramp keyed on `height / (TERRAIN_HEIGHT_SCALE * 1.3)`
  (`Garden.ts:124`) — the rim's -17 m clamps to full `grassDark`, so the slope is
  currently coloured "off the bottom of the ramp". A flat extension will be
  mid-ramp instead, i.e. **the colour of the land beyond the wall changes even
  if nothing else does.**
- Material `MeshStandardMaterial { map: grassTexture(1), vertexColors: true }`,
  name `'terrain'`, `receiveShadow = true`. UVs are world XZ / `GRASS_TILE_METRES`.

**Budget baseline for #511's "low poly must be measured": 18,432 tris / 1 draw
call / 9,417 verts is what the ground costs today.**

## The five constants, and which are actually live

| Constant | Where | Live? |
|---|---|---|
| `RIM_DROP = 17` | `constants.ts:47` | Live, one consumer: `terrain.ts:36` |
| `RIM_OUTSET_START = 12` | `constants.ts:66` | Live: `terrain.ts:36`, **plus two assertions** (below) |
| `RIM_OUTSET_END = 22` | `constants.ts:67` | Live: `terrain.ts:36` and `TERRAIN_APRON` |
| `TERRAIN_APRON = RIM_OUTSET_END + 1.5` | `boundary.ts:679` | Live: `boundary.ts:681,720`, `Scenery.ts:1135` |
| `TERRAIN_EDGE_RADIUS = maxRadius + APRON` | `boundary.ts:681` | Live: `Garden.ts:106` (the disc radius) |
| `TERRAIN_RADIUS = 83.5` | `constants.ts:26` | **DEAD.** Imported `Garden.ts:17`, never referenced. Doc-only at `constants.ts:215,268`, `Garden.ts:84`. |
| `TREELINE_INNER_RADIUS = 71.5` | `constants.ts:78` | **DEAD as a value.** Doc-only. The treeline really uses the local `TREELINE_OUTSET_INNER = 11.5` at `Scenery.ts:19`. |
| `terrainEdgeRadiusAt()` | `boundary.ts:719` | **DEAD — no callers**, and its docstring asserts a boundary-following disc that `buildTerrain` does not build. |

Two orphan constants and one orphan function that all read as live tuning knobs.
Per CLAUDE.md ("a constant kept in case is one a reader has to prove is dead")
these should go in this PR rather than be left looking load-bearing next to a
rewritten hill.

## What is positioned off the rim — the things that must move

### Hard blockers (assert on the rim, will fail the moment it changes)

1. **`test/procgen/invariants.ts:2834`** — asserts both Rail Race rings stay inside
   `RIM_OUTSET_START` (12 m outset), message at `:2837`: *"past the 12 m where the
   hill starts falling away — there is no flat ground out there to stand a trestle
   on."* Once the land is flat this premise is **false**, and the assertion is
   asserting a thing that has stopped being true. This is not a "weaken it to pass"
   case — the *reason* dies, so the invariant is replaced, not relaxed.
2. **`scripts/check-rail-race.mts:344`** — the same clause as a check script:
   `outermost < RIM_OUTSET_START`, message at `:346`.
3. **`src/world/railRace/route.ts:142`** — derives the ring's 6.92 m outer limit
   from `RIM_OUTSET_START` in its docs.

### Geometry that leans on the slope existing

4. **The treeline, `src/world/Scenery.ts:1134-1144`.** 540 trees in a band
   `edgeRadiusAt + 11.5 .. TERRAIN_APRON - 1.5`, i.e. straddling the whole crest.
   Its *only* stated job is hiding the disc's cut edge. When the land runs on, the
   cut edge is far away — so the treeline either moves out to the new edge, or
   changes job (becomes ordinary woodland just outside the wall) and something else
   handles the far edge. **This is the single biggest visible decision in the ticket.**
5. **`src/world/railRace/track.ts:1591`** — rainbow-arch legs, sunk by a tube radius
   because the outer feet land "past `RIM_OUTSET_END`, where the terrain has already
   fallen the full `RIM_DROP`". On flat ground that sinking is wrong.
6. **`src/world/railRace/track.ts:829`** — trestle post heights are `beamY - ground`;
   outer posts currently stand on falling apron. They get shorter and even.
7. **`src/world/railRace/route.ts:420`** — samples terrain at +/-`WIDEST_HALF_SPAN`
   to choose `this.base`. The spread it is compensating for largely vanishes.
8. **`src/world/entrance/arrivalSightline.ts:151`** — `BUS_GROUND_Y`. Doc cites
   -1.35 m at z=74 and **-14 m at z=80**. The most rim-sensitive single sample in
   the repo.
9. **`src/world/entrance/Entrance.ts:797`** — road/pavement ribbon vertices draped
   at `terrainHeight + 0.06`. **This is #498's blocker**: at 11.94 m outset the
   carriageway sits on a 5.57 m cross-fall over 7.78 m of width. Flat land is the
   fix, and #498 unblocks the moment this lands.
10. **`src/world/entrance/Entrance.ts:349`** (bus-stop shelter, ~gate+4.5),
    **`:318`** (gate-arch feet, on the outline where the rim function starts), and
    **`ArrivalSequence.ts:760,794,838,997,1029,1075`** (bus body, step-down, the
    crowd of kids) — all on ground outside the gate.
11. **`src/world/railRace/exitCrowd.ts:153,231`** and **`RailRace.ts:1157`** — the
    exit crowd spawns and walks on the apron.
12. **`test/procgen/parkFacts.ts:2191-2194`** — an arch-leg daylight check that
    samples 16 points around each leg *specifically because* "these legs land on the
    rim, the steepest ground in the park". Its stated reason dies too.
13. **`src/world/entrance/BusJourney.ts:96`** — documents that the bus ride is its
    own scene precisely because there is no ground outside the park.

### Everything inside the park — unaffected, and this is the point

~120 call sites of `terrainHeight`/`terrainNormal` place the player, NPCs, the
parade, paths, the wall, trees, bushes, flowers, lamps, fountain, fairy lights,
the slide, the ball pit, the coaster, the ferris wheel, the train, its bridges and
fences, and the minigame plots. **Every one of these is strictly inside the park
edge, where `distanceToEdge > 0` makes the smoothstep return 0.** They read the
`base` sine waves only and are therefore **untouched, bit for bit, by removing the
rim.** That is what makes "a child standing in the park sees the same park"
mechanically true rather than a hope — and it is worth asserting, not assuming.

## Things to be careful of

- `test/procgen/invariants.ts:5871,8604,8608` — `terrain.ts` **must not** be
  statically imported into the invariants; it pins the seed via
  `boundary.ts -> parkManifest`. Use dynamic import, per the existing note. This is
  the "76 silent skips" trap from CLAUDE.md.
- `boundary.ts:652` says the disc must stay an even polar grid because the grass
  tiling depends on it. Any LOD scheme has to respect that or the grass texture
  seams.
- `src/world/paths.ts:1246` records that a `terrainHeight` boundary walk was removed
  as a **25.7 ms hot spot**. `terrainHeight` is cheap but not free; a much larger
  ground must not multiply calls to it.

---

# Continuation — perspective prototype (Opus 5, 1M context)

Jim, 4 Sep, after being shown that a bus-safe sphere's horizon sits at 870 m and
ortho cannot compress it: *"Maybe we just use a perspective camera then"* — and
*"Ok try it and give me preview link when ready"*.

## Built

`?projection=perspective` on any route (`src/core/perspectiveFlag.ts`). Same
position, same pitch, same yaw — **projection only**, so ARCHITECTURE.md's fixed
angle is untouched. FOV is derived from the existing zoom
(`2·atan(halfHeight / CAMERA_DISTANCE)`), so every framing still frames what it
asked for at the player's distance. At default zoom that is **~22°** — a long
lens, which is why the look is preserved rather than transformed.

`viewHalfWidth/Height` now go through one owner (`focusHalfHeight`) that answers
for both projections **at the focus**, and says in its own doc that it is
approximate off-focus rather than being silently wrong.

`tsc` exit 0. Committed, pushed. **Prototype, not a migration.**

## Measured: perspective alone gives NO sky back

Screenshots, canonical park, park centre and park edge (`/tmp/persp/`):

| frame | sky |
|---|---|
| ortho centre | 0% |
| perspective centre | 0% |
| ortho edge (240° bearing) | 0% |
| perspective edge | 0% |

(A pixel count reports 0.5–4.9%, but that is the pale Menu pill, the fountain
water and the blue rail line — not sky.)

**Why:** there is nothing distant to see. Today's ground is a 125 m disc ending
in a cliff, with a treeline in front of it. Perspective compresses distance, but
only if there is distance. At the park edge the **treeline fills the up-screen
area in both projections**.

## The conclusion that matters

**Neither half works alone, and together they should.**

- The **sphere alone** fails because ortho draws its 870 m horizon at 870 m,
  against a ~29 m frame.
- **Perspective alone** fails because today's land stops at 125 m and the
  treeline covers what is left.
- **Perspective + far-spreading gentle ground** is the combination that puts a
  horizon on screen: perspective supplies the compression, the extended ground
  supplies something to compress. The treeline would then also need to stop
  being a wall at the frame's top edge.

So the sphere is not superseded by perspective — it is **unblocked** by it. That
is the opposite of how it looked before this was measured.

## Cost/consequence list for the projection swap — reported, not fixed

Anything assuming a world object has a fixed screen size becomes suspect:

- **Name pills and speech bubbles** — `clampToFrustum` and `screenOffset` are
  exact only at the focus now. Pills on distant NPCs will drift.
- **`check:pet-slide`'s frame-share clauses** (`PET_FRAME_FLOOR/CEILING`) measure
  a raster, so they still measure truly — but the *numbers* would move, and
  `chaseEye`'s `estimatedFrameShare` assumes a fixed angular frame.
- **The slide chase camera and arrival camera** are separate rigs and unaffected
  by this flag, but they would need their own answer in a real migration.
- **Occlusion is new**: buildings will hide what is behind them, the castle will
  cover the park. Nothing in the layout has ever had to avoid that.
- **`worldUnitsPerPixel`** is now depth-dependent; anything sizing UI from it is
  approximate.

## Status

Prototype pushed, both frames captured, sky measured. **Do not merge.** Next
question for Jim is whether to try perspective **with** extended ground, which is
the only combination the measurements say can work.

## The frame does not reach the horizon — checked BEFORE building the sphere

A perspective camera pitched down 38° with vertical half-FOV θ has its frame
top at depression `38° − θ`. **The horizon is at 0° depression.** So the horizon
is in frame only when **θ ≥ 38°, i.e. FOV ≥ 76°**. This is independent of the
ground: no radius, no extension and no treeline work changes it.

The 38° threshold above is correct and stands. **The table that used to sit here
was not, and it is corrected below.**

### CORRECTION, 5 Sep 2026 — the old zoom→FOV table was wrong by 2.38×

The superseded table claimed the default zoom gives a 17.9 m half-height and a
22.4° FOV, and that the horizon first appears at zoom **0.254**. Every row was
wrong, from one mistake: it used **17.86 m as `frustumBase`**, when 17.86 m is
the half-height at zoom **0.42**, not the base.

The base is one line, `IsoCamera.ts:602`:

```ts
private frustumBase(): number {
  return Math.max(CAMERA_VIEW_HEIGHT / 2, CAMERA_MIN_VIEW_WIDTH / 2 / this.aspect);
}
```

`CAMERA_VIEW_HEIGHT = 15`, `CAMERA_MIN_VIEW_WIDTH = 11`, so on any screen wider
than 11/15 the base is **7.5 m**, and `halfHeight = 7.5 / zoom`.

**Measured off the live camera** (`window.game`, 2400×1524, aspect 1.575),
not derived — both projections, same load:

| what | reading |
|---|---|
| perspective, zoom 1.00 (default) | `fov` **9.53°** |
| perspective, zoom 0.42 (`CAMERA_ZOOM_MIN`) | `fov` **22.34°** |
| orthographic, zoom 0.42 | `camera.top` **17.77 m** |

The 22.34° the old table put against zoom 1.00 is in fact zoom 0.42, and the
17.86 m it used as the base is that same row's half-height. One row's numbers
were read as the base, so the whole table was shifted and scaled.

The corrected table, `FOV(zoom) = 2·atan((7.5/zoom) / CAMERA_DISTANCE)`,
`CAMERA_DISTANCE = 90`:

| zoom | half-height | FOV | horizon in frame? |
|---|---|---|---|
| 1.00 (default) | 7.5 m | **9.5°** | no |
| 0.42 (`CAMERA_ZOOM_MIN` today) | 17.9 m | **22.3°** | no |
| 0.30 | 25.0 m | 30.8° | no |
| 0.20 | 37.5 m | 45.2° | no |
| **0.107** | **70.3 m** | **76.0°** | **first appears** |

**So today's zoom-out is a factor of 3.9 short of the horizon, not 1.65.**
`CAMERA_ZOOM_MIN` would have to go 0.42 → **0.107** — the frame is then 140 m
tall and ~220 m wide, which is most of the park at once. That is a far bigger
ask than "0.25" made it look, and option (b) below has to be re-judged against
0.107 rather than against 0.254.

### Confirmed by eye at FOV 76°, and it changes the ticket

Holding `camera.fov = 76` on the live perspective rig (screenshot
`06-persp-fov76-horizon.png`) gives, at once:

- **Sky, a lot of it** — roughly the top third of the frame, with the sun disc
  in it. So perspective + a wide enough FOV *does* restore the sky, on today's
  ground, with no sphere and no ground extension at all. That is the first
  non-zero sky reading anywhere in this workstream.
- **The hill, unmistakably.** The park is visibly domed: the land crests and
  falls away on every bearing, exactly the "park on a hill" look #511 exists to
  remove. Ortho was *hiding* it. **Perspective makes Jim's complaint worse
  before it makes it better**, and it is the projection that finally shows what
  the ground is actually shaped like.

The second point is the useful one: the ground work in #511 is not optional
alongside a perspective camera, it is what a perspective camera exposes.

### Frame time at full zoom-out — measured, was the open risk

`requestAnimationFrame` deltas, medians over ~450 frames, Jim's Mac, 2400×1524:

| framing | median | p95 | worst | fps |
|---|---|---|---|---|
| perspective, FOV 76° (whole park in frame) | **9.3 ms** | 10.1 | 11.5 | 107 |
| perspective, FOV 22.3° (zoom 0.42, today's max) | **8.7 ms** | 9.7 | 10.7 | 115 |

**0.6 ms for the whole park in frame.** This was flagged as the one unmeasured
load-bearing risk; on this machine it is not a blocker. Caveats worth keeping:
it is a desktop GPU, and the wide frame drives ~1759 draw calls, so a phone
needs its own reading before any of this ships. Nothing here has been measured
on a phone.

### Three ways out, for Jim to choose between

- **(b) Extend zoom-out to 0.107** (`CAMERA_ZOOM_MIN` 0.42 → 0.107). **The
  default view is completely unchanged**; the horizon appears only when a child
  zooms fully out. Still the smallest change and still the recommendation — but
  it is a **3.9× extension of the zoom range**, not the 1.65× the old number
  implied, and at the far end the frame holds most of the park, which is closer
  to a map than to a play camera. Whether that is still "the same behaviour the
  ortho hill gave" is now a real question rather than an obvious yes.
- (a) Widen the base FOV to ≥76°: the horizon is always visible, but the park
  appears ~8× smaller at default zoom (not 4× — same 2.38× error). A different
  game.
- (c) Fix the FOV and zoom by moving the camera instead: horizon always in frame,
  strong perspective everywhere. The largest change.

**Do not build the sphere until this is settled** — the radius argument is
downstream of it.

### The lesson, since it nearly shipped as fact

The old table was internally consistent, carried real decimals, and agreed with
a hand-derivation done in the same wrong units — the "analytically derived the
19.8% before believing it" note earlier in this file leans on the same 17.86 m.
It was caught only by asking the running camera what its `fov` actually was.
**Read the number off the live object, not off the algebra you just wrote.**

---

# Splitting this branch: where the seams are

Jim asked for **one branch he can try**, so it is being built as one. But the
diff is already larger than one reviewer should hold, and CLAUDE.md says that
is a sign to split the PR rather than add reviewers. The cheapest time to name
the seams is while the reasons are still fresh, so:

**Invisible to a player — mergeable on review + QA without troubling Jim:**

| seam | what it is | why invisible |
|---|---|---|
| `entrance-road.yml` + chain removal | `check:entrance-road` moves beside the chain | CI only; nothing on screen |
| `cameraViewHalfHeight` | one owner for the camera framing formula, replacing a hand-copy in `tapSpacing.ts` | numerically identical, proved (phone half-height 11.902564102564103 both ways) |
| `CAT_BUS_DOOR_DROP` | one owner + 1e-9 drift assertion | same geometry, now reachable |
| `GATE_POST_PROBE_INSET` rename | resolves a real name collision the merge created | test-only symbol |
| `?zoomMin=` | prototype URL parameter | a developer types it; absent, the shipped floor applies |

**Visible — Jim's call, and they depend on each other:**

- The sphere ground (#511) and perspective everywhere. **Do not land either
  alone**: ortho hides the hill, perspective exposes it, so perspective without
  the ground work ships a regression against the very ticket. See "The ordering
  finding" above.
- The arrival camera's re-derivation against the arc. Depends on the road
  branch; carries the stand-back fix.

**Ordering constraint for whoever splits:** `cameraViewHalfHeight` and
`CAT_BUS_DOOR_DROP` are both *underneath* visible work that reads from them, so
they land first or travel with it.
