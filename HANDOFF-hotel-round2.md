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
41/41 declared window panes).

| # | Feature (coordinator's numbering) | State |
| - | ------- | ----- |
| — | Two new themed floors (12 garden, 33 ocean) | **done** |
| — | Double-height lobby + mezzanine + sweeping arc stair | **done** |
| 1 | Key gating moves from the lift to the suite door | **done** |
| 2 | "Hop down" → "Leave breakfast" | **done** |
| 3 | Residents seated at breakfast tables | **done** |
| 4 | Check-in dialog, clock greeting, shorter on return | **done** |
| 5 | Auto doors, lift doors/frame/car, dial, arrival ding | **done** |
| 6 | Food moment (camera ease, pet, pet bowl) | **NOT STARTED** |
| 7 | Suite split into four sub-rooms | **done** |
| 8 | Disco sparkle (instanced glints + motes) | **done** |
| 9 | Real art pictures with "Look!" zones | **NOT STARTED** |
| 10 | Window views ("Look outside!") | **NOT STARTED** |

## What 6, 9 and 10 need, and the seam that is already there

All three want the same thing: **a camera that is not the iso camera, for a
few seconds, cleanly restored.** That seam exists — `Game.ts`'s
`cameraOverride`, which every ride already drives through the `rideCamera`
helper at `Game.ts:609`. Rides go through `transitions.irisWipe`, which is a
blink; a *gentle push-in* (item 6) wants the override set with **no** wipe and
the hotel's own camera starting exactly at the iso camera's current transform,
which is what `onRideCameraCut` (`Game.ts:645`) already does for the slide's
mid-ride cuts. So:

- add `Hotel.onCinematic?: (camera: PerspectiveCamera | null) => void`, wired
  in `Game.ts` beside the other `onRideChange` lines but assigning
  `this.cameraOverride` directly;
- the hotel owns a `PerspectiveCamera`, seeds it from the iso camera on the
  first frame so the cut is invisible, then eases;
- item 10 wants the *soft fade* instead, which is `InteriorControls.iris` —
  the hotel already holds one (`this.controls.iris`) and uses it for every
  space change.

Item 10's hard part is not the camera, it is that the hotel's rooms are 600 m
from the tower: "look out of the window" means putting the camera at the
**tower's real park position** at that storey's height on the 28 m spire. The
tower's coordinates are `placedEntry('hotel')`, already held as
`this.facadeX/facadeZ`. Check the ferris wheel's far-fog handling before
flying to 50 storeys up, and restore `FOG_NEAR`/`FOG_FAR` if you touch them.

Item 9 needs a canvas budget check first: ART_DIRECTION §7 caps distinct
textures at 40, and this round already added three (the dial face, the TV, the
Game Boy). Share one picture texture across rooms rather than one per frame.

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
  `lilyPond`, `fishShape`, `porthole`, `seaweed`.
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
red; gallery front face not solid → red; a bed moved into a partition → red.

## Routing

Resolved: the coordinator had crossed the two agent ids, and confirmed it on
7 August. The artist is finished; all nine of its factories are integrated
here (`createEntranceDoors`, `createLiftDoors`/`Frame`/`Car`/`Dial`,
`createPetBed`, `createPetBowl`, `createHotelTv`, `createGameBoy`).
`createPetBowl` is the only one **not yet used** — it belongs to item 6, the
food moment.

## One thing fixed that was nobody's feature

`test/procgen/invariants.ts` was **committed broken** — the rebase left
`skyCruiserStandsOnItsOwnSupports` without its closing brace, so the entire
procgen suite failed to parse and `npm run test:procgen` could not run at all.
CI runs that on every PR and blocks the merge. One line; fixed here.
