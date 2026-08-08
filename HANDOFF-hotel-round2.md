# HANDOFF — hotel round 2, Jim's eight features (#236)

Branch: `feat/hotel-236` · Worktree: `.claude/worktrees/hotel-236`
Jim has a dev server on **5643** serving this tree live. **Keep `npx tsc
--noEmit` green at every save.** Not committed (as asked).

Role: **features/behaviour.** The artist agent owns `art/` and
`src/art/models/hotelAssets.ts` — do not edit them. Its nine round-2 factories
have all landed and are integrated from here.

## State: everything verified green

`npx tsc --noEmit` · `npm run typecheck:test` · `npx vitest run
test/procgen/seed-canonical.test.ts` **48/48** · `npm run check:park`
**16/16 attractions, 0 rail crossings, 172/172 waypoints, six invariants** ·
`npm run check:hotel` **OK** (13 props solid, 3 beds soft and standable,
41/41 declared window panes) · `check:text` · `check:brevity` ·
`check:waypoints` 172 · `check:assets` 95 · `check:crowd`
**trace=639ad23c, byte-identical to the hash in that script's own header**,
so nothing here moved a single park child.

Not run: the full `npm run build` battery (long). Nothing outside the hotel,
`Game.ts`'s two wiring lines and `ui/LiftPanel.ts` was touched.

| # | Feature (coordinator's numbering) | State |
| - | ------- | ----- |
| — | Two new themed floors (12 garden, 33 ocean) | **done** |
| — | Double-height lobby + mezzanine + sweeping arc stair | **done** |
| 1 | Key gating moves from the lift to the suite door | **done** |
| 2 | "Hop down" → "Leave breakfast" | **done** |
| 3 | Residents seated at breakfast tables | **done** |
| 4 | Check-in dialog, clock greeting, shorter on return | **done** |
| 5 | Auto doors, lift doors/frame/car, dial, arrival ding | **done** |
| 6 | Food moment (camera ease, pet, pet bowl) | **done** |
| 7 | Suite split into four sub-rooms | **done** |
| 8 | Disco sparkle (instanced glints + motes) | **done** |
| 9 | Real art pictures with "Look!" zones | **done** |
| 10 | Window views ("Look outside!") | **done** |

## One camera mechanism, three features

`world/hotel/cinematic.ts`. All three of the last items are *move the camera
somewhere, hold it, put it back*, and the only differences are how long,
whether it fades and whether it drifts — so there is one `Shot` type and one
state machine, and the features are three call sites.

- **The seam is `Game.cameraOverride`**, set with **no iris wipe** (the
  `onRideCameraCut` path, not `rideCamera`'s). A push-in must not blink. The
  cut is hidden instead by starting every shot at the iso camera's own
  position and aim, so the frame control changes hands on is identical.
- **`onCinematic` is called only when the answer changes**, not per frame:
  sixty assignments a second for one decision would make the one that matters
  (the hand-back) indistinguishable from the fifty-nine that do not.
- **A perspective camera** even though the game is orthographic, because all
  three shots are about depth and an orthographic camera cannot express any of
  them — moving it closer does not make anything bigger. Same reason
  `RideCamera` is perspective.
- **Any-press exit** is one `pointerdown`/`keydown` pair on `window`,
  registered once and guarded on `cine.dismissible`, rather than three input
  systems being taught about it.

### The fog question, answered: nothing to touch

The ferris wheel pushes fog out via `DayNight.setSpaceFactor`, which is a whole
*space look* — flat indigo sky, stars out, sun and moon gone. Using it for a
window view would have brought the stars out over an afternoon. It is also
unnecessary: `FOG_NEAR` is 132 m and the park is ~110 m across, so a vantage
28 m up looking at the fountain never reaches the fog at all. Fog is untouched
and nothing needs restoring.

### What a window view *does* have to do

- **Hide `hotelRoot`.** The rooms sit 600 m out, past `FOG_FAR` (258 m), so
  they would be fogged to invisibility anyway — but that is the exact accident
  the ferris wheel relied on until it pushed the fog out and the castle's
  insides appeared floating in the middle distance. Hidden outright is a fact;
  fogged is a coincidence.
- **Report `playerIsInside === false`** for the duration. That getter has one
  consumer, `World.playerInAnyInterior` → `DayNight.setIndoors`, so it is
  really "should the sky's lights be off" — and a view of the park taken while
  indoors is a view of an *unlit* park. Answering the question actually being
  asked beat adding a second flag to keep in step.
- `Hotel.windowVantage(room)` is **public** because `check:hotel` asserts on
  it. A check that recomputed the formula would be agreeing with a copy of the
  code rather than with the code.

## The three engine facts this round turned up

1. **A balcony's balustrade cannot be a collider.** `clearsTop` is fed the
   player's height above *the sampler's* ground, so a child on the lobby floor
   and a child on a balcony 3.2 m up both read as clearance 0. The collider
   that stops her walking off the balcony is the *same* collider that
   invisibly walls off the floor beneath it at head height. The castle takes
   the other way out (no collider, you fall through). The mezzanine is
   therefore a gallery on a **solid mass** — nothing overhangs, so the
   balustrade stands where a full-height wall already is and needs no collider
   at all. See `layout.ts`'s `Mezzanine` header.
2. **A stair's treads must not be colliders; its flanks must be.** A solid
   tread is a wall to the child standing on the tread below it. Treads are
   `WalkSurfaces`-only; the inner and outer radii are wall chains, honest at
   both heights because the side of a masonry stair *is* solid floor-to-tread.
3. **Overlapping rectangular plates let you walk up a curved stair and never
   back down** — `sample` returns the highest surface within a step, so the
   tread you are on keeps winning. `ArcTread` (a polar wedge) tiles the arc
   exactly: adjacent, no overlap, no gaps.

Plus one that is not the engine: at the fixed 38° camera pitch a wall of
height H hides 1.28·H metres of floor behind it. 6.4 m of *near* wall hides
eight metres. Hence `HotelRoom.nearWallHeight` — the two walls the camera
looks through stay at 3.4 while the two it looks at go to 6.4.

## Where things are

- `src/core/constants.ts` — `HOTEL_GARDEN_Z` 1640, `HOTEL_OCEAN_Z` 1900 (the
  established 260 m step; the spacing is what keeps a room's 34 m light pool
  and 70 m `spaceAt` radius off its neighbour).
- `src/world/spaces.ts` — `SPACE_HOTEL_GARDEN`/`_OCEAN`. **Bug fixed here:**
  the room→Z list existed twice (in `ORIGINS` and again inside `spaceAt`).
  Editing only one gives a room that builds, lights and furnishes perfectly
  but which `spaceAt` calls `garden` — the lift lands you nowhere and the
  floor pill goes blank. One `HOTEL_ROOM_Z` table now feeds both.
- `src/world/hotel/layout.ts` — `GARDEN_FLOOR` / `OCEAN_FLOOR`, both themes,
  `Mezzanine`, `nearWallHeight`, `LOBBY_MEZZANINE_Y`. `HOTEL_FLOORS` is five
  buttons now (`G 1 12 33 ★`); **`liftFloor` on a room is an index into it**,
  so `CORRIDOR`/`SUITE` moved 2 → 4.
- `src/world/hotel/Hotel.ts` — `dressGarden`, `dressOcean`, `buildMezzanine`,
  `dressMezzanine`, `stairMouth`, `ArcTread`, `seatGuests`, `say`/
  `updateSpeech`/`celebrate`, `refuseSuite`, `hangDiscoBall(…, {scale, lit})`.
- `src/world/hotel/dressing.ts` — `flowerTuft`, `hedge`, `trellisArch`,
  `lilyPond`, `fishShape`, `porthole`, `seaweed`, `createDiscoSparkle`,
  `paintedPicture` + the five shared `artworkTexture`s.
- `src/world/hotel/cinematic.ts` — **new.** The one camera mechanism; see above.
- `src/world/hotel/Hotel.ts` — also `partitionRoom`, `dressLounge`,
  `dressPetBed`, `paradePetKind`, `eat`/`updateFeast`, `lookAtArt`,
  `lookOutside`, `windowVantage`, `fitLiftAlcove`, `fitAutoDoors`.
- `src/world/hotel/HotelLift.ts` — key gate **removed** (both from `floors()`
  and `go()`); `HotelLiftDeps.hasKey` deleted with it.
- `src/world/World.ts:101` — `Hotel` takes a 5th arg, `HotelDeps`
  (`{ camera, clock }`). The clock is a **closure** because `dayNight` is built
  further down that constructor and an eager read would be dawn for ever.

## Three checks that were green and could not have failed

Worth reading before trusting anything here, because all three are the disease
CLAUDE.md names:

1. **The sweeping stair's landing.** The first assertion checked the flight
   *reached* 3.2 m. A stair swept about the wrong centre climbs its full
   height perfectly and tops out in mid-air a metre from the deck — so
   mutating the centre back to its first-draft value left the check green.
   Now it asserts the top tread is **inside the deck rectangle**, and the
   mutation fails with the actual coordinates.
2. **The reception probe.** It measured (5, −7.2), which after the mezzanine
   landed is inside the gallery's solid mass — so it would have passed whether
   the desk existed or not. Moved to the desk's real position.
3. **The suite's beds.** `check:hotel` kept its own copy of the three bed
   positions; the day the suite became four rooms all three went stale at once.
   They now live in `layout.ts` (`SUITE_BED_SPOTS`) with two readers.

Every new assertion in this round was **proven red by mutation** before being
trusted: stair centre wrong → red; Floor 12 dropped from `spaceAt`'s table →
red; gallery front face not solid → red; a bed moved into a partition → red;
a painting hung across the lift doorway → red; every storey looking out from
the same height → red (four floors named, with their heights).

**One of them went red on its own first.** The artwork assertion failed the
first time it was ever run: the garden floor's painting was hung at `along: 0`
on the west wall, which is the lift alcove's own doorway — so the spot a child
stands on to look at it was inside the architrave, and "Look!" would have
walked her into the lift frame and never arrived. Nothing else in the check
would have noticed, because the picture itself was hung perfectly.

## Routing

Resolved: the coordinator had crossed the two agent ids, and confirmed it on
7 August. The artist is finished; all nine of its factories are integrated
here (`createEntranceDoors`, `createLiftDoors`/`Frame`/`Car`/`Dial`,
`createPetBed`, `createPetBowl`, `createHotelTv`, `createGameBoy`).
All nine are now used: `createPetBowl` went in with the food moment.

## One thing fixed that was nobody's feature

`test/procgen/invariants.ts` was **committed broken** — the rebase left
`skyCruiserStandsOnItsOwnSupports` without its closing brace, so the entire
procgen suite failed to parse and `npm run test:procgen` could not run at all.
CI runs that on every PR and blocks the merge. One line; fixed here.
