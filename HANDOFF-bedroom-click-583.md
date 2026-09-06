# HANDOFF — bedroom click-to-move does nothing (#583)

**Branch** `fix/bedroom-click-583`, worktree `.claude/worktrees/bedroom-click-583`,
based on `d7da0408`.

## The ask
Jim, 6 Sep 2026: *"some of the bedroom isn't reachable by clicking on the floor — the
near sub-room fails. The player simply does nothing in response to the click."*

Done = the click works there, **and** a click that genuinely cannot be honoured is
visible to a six-year-old rather than silent. Snapping her to the nearest reachable
point without saying so is explicitly **not acceptable** (ticket).

## Status
- [x] Worktree + `pnpm install --frozen-lockfile` (pnpm 12.1.0 confirmed running)
- [x] Read #583, CLAUDE.md, GAME_DESIGN.md CONTROL/HIGHLIGHT, HANDOFF-pet-beds-582
- [x] Map the click pipeline
- [x] Instrument the click + **control run first** (4/4 hall probes reached)
- [x] Identify the cause — **cause 3**, and the room is the lounge, not a bedroom
- [x] Fix (`Hotel.ts` lounge sofa) + `check:hotel` probe 31, **proved red then green**
- [ ] Gates: `check`, `test:procgen`, `build`, `check:coplanar`, `check:swept-bus`,
      `check:park-pool`
- [ ] Browser slot (must ask the Overseer — I do not own it). **Short test, ready:**
      `/hotel-suite`, walk south through the lounge door, confirm she gets in and
      that the sofa still reads well from the fixed camera.
- [ ] PR + `/hotel…` deep link and one sentence for Jim
- **Model: Opus (Opus 5, 1M context), chosen by the Overseer's brief.**

## The three candidate causes (from the ticket — they look identical from outside)
1. **No pick target** — raycast hits nothing, no destination produced.
2. **Destination produced but rejected** — play bounds, `keepOutsFor`, or inside a
   collider.
3. **Destination accepted but no path** — walk graph has no route; move computed then
   abandoned. If so this is an instance of **#577** (nothing guarantees spatially-near
   destinations are near on the path network), not a one-off.

## Geometry inherited from #582 (measured by that engineer, not typed by me)
- Bedroom is **three sub-rooms**, clear floor: **0 (west) 6.35 × 5.85 m**,
  **1 (middle) 14.80 × 5.85 m**, **2 (east) 7.15 × 5.85 m**.
- **`Hotel.enterSuite` drops her at local (−13.2, 0)**; the first bedroom door she
  reaches is **x = −10.4 → bedroom 0, the west/side one**.
- So **"the near sub-room" is almost certainly bedroom 0 (west)** — the small one she
  walks into first. Confirm before believing it.

## Design rules that bind this fix
- **CONTROL (absolute)**: press a direction = go that way. Tap-to-move is a listed
  control (GAME_DESIGN.md:232-235), incl. double-tap to run.
- **HIGHLIGHT (absolute)**, GAME_DESIGN.md:49-56: *"When something is actually used —
  tapped, clicked or activated — it flashes the same outline for about half a second…
  On a phone there is no hover at all, so this is what tells a child her tap
  registered."* **The "does nothing" half of this bug is already a rule violation**,
  independent of whichever of the three causes is at fault. A refused click must be
  distinguishable from a missed one.

## Coordination
- **#582 (`feat/pet-beds-582`) is live in this same room.** Coordinate through the
  Overseer, never directly. Do not edit files that branch is editing —
  it is in `src/world/hotel/Hotel.ts` (`dressPetBeds`, ~4982) and
  `src/world/hotel/layout.ts` (`petBedSlots`, ~1834). Avoid both if at all possible.

## Traps that apply (CLAUDE.md)
- **Run a control on the instrument first.** Two agents last night got clean, decisive,
  entirely wrong answers from uncontrolled probes. A silent instrument and a silent
  click look identical.
- `check` + `test:procgen` can both be green while a pool park is broken (**#579**) —
  run the three standalone checks too.
- Read exit codes **unpiped**; never `| tail`.
- Three-dot diff (`origin/main...HEAD`) before every push.
- Never `git stash`; commit and push after every meaningful edit.

## ROOT CAUSE — found, measured, and it is **cause 3** (no path), for a real reason

**The lounge sofa physically seals the only doorway into the whole south half of the
suite.** The lounge *and* the bathroom behind it are unreachable by any body of
`PLAYER_RADIUS`. Not a router bug — the router correctly reports no route, because
there is none.

### The arithmetic, all read off the built collision world (`scripts/gap-583.mts`)

```
lounge doorway opening: local x 3.45 .. 5.35 (1.90 m; SUITE_DOOR_WIDTH = 2.4 is
                        centre-to-centre, the clear opening is 2.4 - 2*0.25)
  a body of radius 0.62 must have its centre in x 4.07 .. 4.73 to pass the jambs
  sofa north face at local z=3.33, spans x 3.90 .. 7.30, top=0.5
  to walk round its west end a body's centre must be at x <= 3.28
  => needs x >= 4.07 (doorway) AND x <= 3.28 (past the sofa):
     IMPOSSIBLE — short by 0.79 m
```

The offender is `Hotel.dressSuite`'s lounge sofa, `src/world/hotel/Hotel.ts:5340`:
`this.props.place(shell, SUITE, sofa(3.2, ...), { x: 5.6, z: 4.8, spin: -0.9,
halfX: 1.1, halfZ: 1.3, top: SOFA_SEAT_TOP })`. Its `spin: -0.9` rotated footprint
is 3.40 × 3.34 m, registered as a **three-walled rectangle open to the south**
(CLAUDE.md's own hazard) at local x 3.90..7.30, z 3.33..6.27.

### Why the existing guard did not catch it

`Hotel.buildAll` already calls `this.props.assertDoorwaysClear()`
(`Hotel.ts:1283`), and it **passes**. It checks the doorway *band* is clear — it
does not ask whether the room behind the doorway is still reachable. This sofa has
been moved three times chasing that band (#273/#278; the comment at `Hotel.ts:5320`
records z = 4.4 as "the third miss") and clears it "by 0.19 m", while the room it
stands in has no way in. A check passing without checking the thing that matters.

### "The player simply does nothing" — reproduced exactly

```
stood in the doorway pocket (4.4, 2.0), tap the lounge floor (6.0, 5.5)
  -> reached=false, route ends (4.75, 2.25), she moves 0.43 m
     — under ARRIVE_RADIUS (0.55): SHE DOES NOTHING
```

`TapNavigator.planRoute:447` silently relocates the target to the nearest reachable
point; when that point is where she already stands, the walk completes instantly and
nothing happens on screen. From further off it is worse than nothing — tapping the
**bathroom** from the pocket sends her 14.21 m to `(-9.75, 0.75)`, a different room.

### Which sub-room is "near"

The iso camera backs out along **+X/+Z** (`check-nav-routes.mts`'s `isoRayAt`), so
the **+Z half is the near half on screen** — that is the lounge/bathroom, and it is
the half that fails. The three bedrooms (−Z, the far half) all route correctly.
So "the bedroom" is Jim's name for the suite, and "the near sub-room" is the lounge.
**Confirm in the browser before shipping the claim** — it is an inference from the
camera basis, not something I have seen.

## Measured evidence (control-first, per CLAUDE.md)

`scripts/instrument-583.mts` — CONTROL is 4/4 `reached=YES` on hall spots before any
bedroom result is read. `scripts/sweep-583.mts` — dense 0.5 m sweep of the whole
suite floor: `#=927 not standable, .=614 works, R=346 standable but no route, P=1`.
Every one of the 346 `R` cells is in the south half. Causes 1 and 2 are
**exonerated**: the pick lands within 0.75 m of the aimed point everywhere except one
cell, and every failing cell is standable.

## The second defect, which outlives the sofa fix
Even once the lounge is reachable, a tap that genuinely cannot be honoured is
**silent** — `TapNavigator.handleTap` has four bare `return false`s and `planRoute`
relocates without saying so. Its own doc admits it: *"a 'nope' sound will want to
know one day"* (`TapNavigator.ts:216`). GAME_DESIGN.md's HIGHLIGHT rule already
requires a tap to visibly register. Needs a decision on scope — see the Overseer.

## THE FIX, and why it is in z rather than x

First attempt moved the sofa **east** of the doorway. That only moved the sealed
room: it then cut off the lounge's east end instead (**85 cells / 21.3 m²**,
measured). The constraint is not the door, it is **depth** — the sofa's turned box
sweeps **3.34 m** through a sub-room whose clear floor is ~5.75 m deep, so mid-room
it leaves ~1.2 m either side against a child **1.24 m** wide. It was never one bad
number; the piece nearly spans the room, which is why four positions in a row
"cleared the doorway" and sealed the lounge anyway.

So it is pushed **south**, gathering the clearance into one usable walkway along its
north side, and the position is now **derived** — from the lounge's own
`clearFloorAround`, the sofa's own turn, and `PLAYER_RADIUS` — rather than nudged
past whatever last complained. Everything QA chose about how it looks is kept:
mid-room, off both walls, still turned −0.9 rad between "facing the telly" and
"facing the lens".

  `hotel.suite`: 347 cells unreachable → **all 961 standable cells reachable**

## The check: `check:hotel` probe 31

Floods every hotel room's floor from where the player is actually dropped, using
`NavGrid.canStandAt` and NavGrid's own neighbour rule, then **confirms every doubted
cell with a real `findRoute`** so a failure is always the game's router refusing. It
**controls on the entry cell first** and refuses to report on a room whose control
fails. A cell inside a prop's own keep-out disc is discounted — a `CollisionWorld`
rectangle is four walls round a hollow middle, so the lattice reads the space under
a sofa as free floor and the flood correctly finds it cut off; that is the outcome
this repo wants, not a defect.

**Proved red then green** on the geometry named in the commit (sofa at local
(5.6, 4.8), spin −0.9, halfX 1.1, halfZ 1.3; SUITE halfX 14.8 halfZ 8; lounge door
x 4.4 on the partition at z 1.7; `SUITE_DOOR_WIDTH` 2.4, `SUITE_PARTITION_HALF` 0.2,
`PLAYER_RADIUS` 0.62):

    fix reverted -> hotel.suite: 338 cells UNREACHABLE, check:hotel FAILED, exit 1
    fix in place -> hotel.suite: all 961 standable cells reachable, OK, exit 0

## Still open, for the Overseer — NOT mine to decide

1. **Two pre-existing pockets in other rooms**, found by probe 31 and declared in
   `KNOWN_UNREACHABLE_CELLS` (the ratchet `check:coplanar` and `check:swept-bus`
   already use): `hotel.lobby` 22 cells (5.5 m²) and `hotel.garden` 12 cells
   (3.0 m²). Same disease as #583, smaller. Left declared rather than fixed because
   each is a **visible** furniture move in a room this ticket was not about. They
   print on every run and a worse one fails. **Worth its own issue.**
2. **The silent click itself.** Even with the lounge reachable, a tap that cannot be
   honoured is still silent, and `planRoute` still relocates the destination without
   saying so. GAME_DESIGN.md's HIGHLIGHT rule already requires a tap to register
   visibly. Not fixed here — it is a design change touching every tap in the game,
   not just this room. **Worth its own issue.**
3. **File overlap with #582.** Both branches edit `src/world/hotel/Hotel.ts`;
   different methods (`dressSuite` ~5340 here vs `dressPetBeds` ~4982 there), so a
   rebase should be clean, but whoever merges second should re-run `check:hotel`.

## Log
- Worktree created off `d7da0408`, deps installed, context read.
- Pipeline mapped; instruments written and **controlled**; root cause found and
  proved by arithmetic on the built collision world.
- Fixed, checked, rebased onto `b581462d`. Gates running.
