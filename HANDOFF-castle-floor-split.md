# HANDOFF — castle floor split (#377)

**Branch:** `feat/castle-floor-split-377`, worktree
`.claude/worktrees/castle-floor-split`, off `origin/main` @ `95832181`.
**Port 5383** if a dev server is needed. No chrome-devtools MCP.

**State: S1 built, verified and green. Ready for PR. S2 not started.**

## The task

Jim, 29 Aug: *"there are too many ways between the floors right now. Let's
reduce it to just the lift"* and *"the floors of the castle should be like the
hotel — disjoint spaces without overlap … an elevator only to get between
them"*.

Design already ruled: **ARCHITECTURE-DECISIONS.md Decision 3** (~line 529),
27 July. Sequence: **PR-S1** pure `SpaceManager` extraction → **PR-S2** the
split → S3.. per-floor fan-out.

## The finding that changes Decision 3: the hotel already did this

Decision 3 was written on 27 July. **The hotel landed afterwards and
independently grew the whole mechanism**, in better shape than the memo
specifies. It is the reference implementation Jim is pointing at, literally.

In `src/world/hotel/`:

| Piece | Where | Notes |
| --- | --- | --- |
| Per-space plan record | `layout.ts` `interface HotelRoom` (line 623) | `space: SpaceId`, `originX/originZ`, `halfX/halfZ`, `wallHeight`, `gaps`, `windows`, `liftZ`. This is Decision 3 §5's per-floor plan module, already existing. |
| The iris dance | `Hotel.ts` `changeSpace()` (2331) | Identical to `Building.changeSpace` (888) minus the StairMenu/StairRide lines. |
| Bind play bounds | `Hotel.ts` `boundTo(room)` (2460) | `circleBoundary(HOTEL_PLAY_RADIUS, room.originX, room.originZ)`. |
| Door portal | `Hotel.ts` `stepThroughDoor(room, localX, localZ, facing)` (2437) | |
| **Lift portal** | `Hotel.ts` `travelTo(room)` (2443) + `HotelLift.ts` | *"The lift's portal hop — same shape as a door, wrapped in its own iris."* Nothing physically travels. **This is exactly what Decision 3 §4 specifies for the castle lift, already written and shipped.** |
| Trigger | `Hotel.ts` `checkDoorways()` (2273) via `bandCrossed` (`world/tapSpacing.ts`) | **Better than Decision 3's `trigger: Region`.** Asks what she *crossed* between `previousPosition` and `position`, so a sprint stride cannot step over a doorway. Decision 3 predates it and specifies the tunnellable version. |
| Space table | `world/spaces.ts` | Already carries six hotel room ids (`hotel.lobby`, `.breakfast`, `.corridor`, `.suite`, `.garden`, `.ocean`) resolved by z-band, plus `SPACE_CASTLE`. Adding castle floors is an entry each. |
| Boot validator | `scripts/check-hotel.mts` | 29+ probes incl. marching a player-sized body at the shell from many bearings. The model for the castle's connectivity validator. |
| Prop placement | `hotel/place.ts` `HotelProps.place()` | One footprint → collider + guest keep-out + walkable plate. Relevant below. |

**Consequence:** S1 is not "invent a `SpaceManager`". It is **make the one that
already exists in `Hotel.ts` explicit and shared**, and delete the castle's
divergent second copy. That is squarely CLAUDE.md's "one owner; everyone else
asks", applied to the exact machinery the repo names as its commonest bug.

## Corrections to Decision 3, to be recorded in the memo itself

1. **"The scattered stairs are the game"** (§4, Glass lift row) — **superseded
   by Jim, 29 Aug 2026.** The lift is the only route between floors. Must be
   marked superseded with a dated note, not silently contradicted.
2. **"The floor fader is deleted"** (§2) — **only half true.** `FloorFader`
   has a second live consumer: `hotel/Hotel.ts:1018`'s `overhangFader`
   (`OVERHANG_GHOST_ALPHA`). `floorFade.ts` survives; the *castle's* use of it
   goes. The file should move out of `building/` since it is no longer the
   castle's.
3. **`spaces.ts` location** — Decision 3 says the new manager goes at
   `src/world/building/spaces.ts`. Wrong now: it is not castle-only. It
   belongs at `src/world/` beside the existing `spaces.ts`.
4. **Trigger shape** — use `bandCrossed`/`PortalBand`, not `trigger: Region`
   sampled once a frame.
5. **NPCs** — §4 says *"no NPC can reach the interior today … the split
   migrates zero NPC behaviour."* **False as of #355/#362.** Children now walk
   into the castle (`npc/portals.ts` `castlePortals`, `npc/attractions.ts`
   `castleAttractions` — shops on decks 0, 1 and 2), route on a castle
   `NavGrid` lattice (`npc/journey.ts`), and `check:npc-presence` asserts a
   child in another space is frozen and later returns. **The split therefore
   does migrate NPC behaviour**, and it is the #377 non-negotiable: a child
   sent to a floor-2 shop must be able to leave it. NPC floor changes become
   lift portal hops, the same way `castlePortals` already handles
   garden↔castle.

## Verified: what the split really deletes

| Decision 3 claims deleted | Verdict |
| --- | --- |
| `DECK_HOLES` / `deckIsSolid` | **Live** — `layout.ts`, `ShopUnits.ts`, `castleFabric.ts`, `Shell.ts`, `dressing.ts`, `surfaces.ts`, `scripts/check-castle.mts`. All castle-only. Genuinely deletable. |
| `FloorFader` | **NOT deletable** — hotel consumer, see correction 2. |
| `StairRide` | Castle-only (`StairRide.ts` + `Building.ts`). Deletable. |
| `ui/StairMenu.ts` | `Game.ts`, `Building.ts`, `StairRide.ts`, and **three scripts**: `check-slide-rider.mts`, `park-harness.mts`, `measure-procgen.mts`. Deletable, but the script call sites must go with it. |
| `ShaftGuards` | Castle-only. Deletable. |
| Collision height-blindness (`inInteriorSpace`, `surfaces.ts:79`) | Real, and the payoff: **#376 records that castle props deliberately get no colliders at all** because a collider on deck 0 blocks that XZ on every storey. After the split each floor is its own plan, so **castle props can have real colliders** — `hotel/place.ts`'s `HotelProps` is the ready-made way to give them one, with keep-outs and jump-on plates for free. This is a genuine gain for #376, not tidying. |

## Ways between floors today (Building.ts) — six

Tap stairs (`StairMenu` + `StairRide`), escalator per storey, glass lift,
trampoline (skill bounce up a shaft), floating bubble, helter-skelter (2→0).
Plus the ginormous slide (roof→garden, not a floor change). Jim wants **one**.

## Plan

### PR-S1 — pure refactor, no behaviour change

New `src/world/SpaceManager.ts` owning the change-of-space dance:
current space, per-space root visibility, `setPlayBounds`, iris + teleport +
`snapCamera` + `SPACE_COOLDOWN`, and `bandCrossed` trigger evaluation.

1. Extract it from `Building.ts`'s three transitions — `checkDoorways`
   door-in (871), `leaveInterior` door-out (972), `startGiantSlide` (1062) —
   which keep their exact behaviour, `StairMenu`/`StairRide` teardown hooks
   included (they die in S2, not S1).
2. Adopt it in `Hotel.ts`'s `changeSpace`/`boundTo`/`travelTo`. **Only if it
   is a mechanical swap** — if Hotel's 6788 lines resist, this drops to a
   follow-up PR rather than smuggling a rewrite into a refactor.
3. Nothing else. No portal table, no floor spaces, no deletions.

#### The parity baseline — taken before any edit

```
commit    2c8593042a357fe49e2bc839f87c81dcb339e2c0   (src/ identical to origin/main 95832181)
command   npm run check:crowd   (scripts/trace-npc-driver.mts)
result    frames=90000 children=12
          covered climbs=12 trips=85 chats=292 paints=4 waves=63845 hops=362
          trace=2cdba2c3
          wedged-visitor painted=4/4 fourth-painted t=100.7s
```

**`trace=2cdba2c3` is the S1 pass/fail, not supporting evidence.** A seeded
25-minute trace of the whole crowd; if the hash moves, S1 changed behaviour and
is not a refactor. Recorded here *with the commit it was taken at* because this
project has twice had a proof transcript go stale when the thing underneath it
moved — a hash with no commit beside it cannot be re-derived honestly. If you
are picking this up and the tree has moved, re-take the baseline at the merge
base rather than trusting this number.

**Proof it changed nothing:** full unpiped `npm run build` (the chain runs
`check:castle`, `check:hotel`, `check:npc-presence`, `check:waypoints`,
`check:park`), `npm run test:procgen` separately (**not in the build chain**),
and — the real parity gate — **`check:crowd`, which hashes a seeded 25-minute
crowd trace; the hash must be byte-identical before and after**, the same gate
that proved the `wanderDriver` extraction. Plus screenshots of all three
transitions before and after.

### PR-S2 — the split

One owner, whole `building/` folder + `ui/StairMenu.ts` removal from
`Game.ts`. Five floor spaces from today's plans; lift as the only portal;
`WalkSurfaces` rewrite; the deletions above; boot validator (portal-graph
connectivity from floor 0 + arrivals on walkable ground outside trigger
bands); NPC lift portals; `ParkMap`, `interactZones.ts`, `constants.ts`.

**The lift-disabled invariant, proven red:** an assertion that with the lift
portal removed the portal graph does *not* connect, so the green case is
proved to mean something. Paste the geometry it was proved against with the
transcript (CLAUDE.md: a red-run transcript goes stale).

### S1 result — all green

| Gate | Baseline (`95832181`) | Branch | |
| --- | --- | --- | --- |
| `check:crowd` trace | `2cdba2c3` | `2cdba2c3` | identical |
| `check:ride-camera` trace | `6dc5cff1` | `6dc5cff1` | identical |
| `npm run build` | — | exit **0** | own marker, unpiped |
| `npm run test:procgen` | — | exit **0**, 453 tests / 14 files | not in build chain |
| Three transitions | 3/3 PASS | 3/3 PASS | `scripts/qa-space-transitions.mjs` |

**On the second hash.** The build chain prints *two* `trace=` lines and I had
only baselined one. `check:ride-camera`'s `6dc5cff1` **is printed, not
asserted** — nothing in `trace-ride-camera.mts` compares it to a stored value,
so it could have drifted silently, and the giant-slide launch is one of the
three transitions this PR touches. Baselined it against a detached
`origin/main` worktree rather than assume. It matches. *(Worth a follow-up
ticket: a reported-only trace hash in a check script is a check that cannot
fail.)*

**On the screenshots.** `scripts/qa-space-transitions.mjs` both photographs and
**asserts** each transition — `playerIsInside` must actually flip. Its first
run went red on door-out on *both* trees, with one console error; the cause was
my harness reading `band.minZ` off a `PortalBand`, which has `centreX/centreZ/
halfAlong/halfAcross/yaw` and no min/max at all, so it teleported the player to
`NaN`. Fixed to use the real fields; 3/3 on both trees and the console error
went with it. Recorded because "the check was wrong, not the code" is the
claim most worth being able to re-check.

## Ruled since this file was written

- **Attractions (Overseer, 29 Aug):** keep all three, demoted to rides that
  return you where you started. Delete the pure transport — escalators, tap
  stairs, `StairRide`, `StairMenu`. **The bubble stays where it is**: moving it
  to the roof is a design change, not a demotion, and is Jim's call. Still
  unanswered.
- **#380 — the castle is three floors, not five (Jim, 29 Aug).** Ground = the
  mall (the shops, today scattered over decks 0, 1 and 2, gathered onto one
  floor); middle = the great hall (#368's furniture, which currently has
  nowhere of its own); roof = a roof garden, still the ginormous slide's
  launch point. *"The simplification would make it feel less empty."*
  **S2 targets three spaces, three lift stops, three panel destinations.**
  The teeth are in consolidating the shops: #355 joins children's castle
  destinations to `Shops.stands` by id and #362 marks them present indoors, so
  consolidation must not strand a child or orphan a destination — that is what
  the connectivity invariant is for. S1 is unaffected; it is a pure refactor.

## Open questions — asked, not yet answered

1. **The three attractions.** Proposal sent: **delete none.** Demote all three
   from transport to rides that return you to the floor you started on —
   helter-skelter's helix in floor 0's Great Hall boarding at its own top;
   bubble moved to the **roof** as an up-and-back view ride over the parapet;
   trampoline stripped of its shaft and left as a plain trampoline (which is
   what a six-year-old thinks a trampoline is). The things that should
   actually die are the pure-transport ones with no ride value: **escalators,
   tap stairs, `StairRide`, `StairMenu`** — and the escalator is the mall look
   the family complained about.
2. **Sequencing against #376.** See below.

## Coordination

- **PR #368** (batch-1 castle furniture, `art/castle-interior-assets`) —
  touches `art/`, `src/art/`, `scripts/pack-castle-asset.mts`, `package.json`.
  **Does not touch `src/world/building/`.** Only overlap is the `build` chain
  line in `package.json`; resolve that by rebuilding the step list from
  `main` and parsing, never `--ours` and never grep.
- **#376** (many more castle features) — **will** touch `building/`
  (`castleFabric.ts`, `dressing.ts`, `Shell.ts`, `layout.ts`). Direct
  collision with S2, which owns the folder. Also: its props get no colliders
  *because of the height-blindness S2 removes*, so furniture placed now needs
  a colliders pass after S2 anyway. Suggested to the Overseer that #376's
  batch lands **before** S2 opens, then S2, then one collider pass through
  `HotelProps`-style placement. S1 does not collide with either.

## Working notes

- Shared checkout `/Users/jim/dev/landOfGoodPlaces` is on `fix/overhang-ghost`
  and is **many commits behind** `origin/main` — its `package.json` has no
  `check:castle` and its CLAUDE.md is an old, much shorter version. Read
  nothing from it. (Left exactly as found.)
- `rerere.enabled` is on. After any rebase touching `build`, rebuild the
  resolution from `main`'s step list and verify by
  `node -e "console.log(Object.keys(require('./package.json').scripts))"`.
- Diffs with three dots: `git diff --stat origin/main...HEAD`.

---

# S2 — THE SPLIT. Plan of record, 30 Aug 2026.

**Branch changed.** S2 is being built on **`feat/castle-floors-half-area`**
(worktree `.claude/worktrees/castle-shrink`), not on a branch of its own. Jim,
30 Aug: *"fold this requirement into that work, make it the top priority, above
all else"* and *"all its work is important so don't drop any, but also don't
delay this split for one second more"*. So the halved plate, the market and the
rewritten `check:shop-spacing` all ship; the split simply goes first, and where
it forces the market to move, the market moves.

Dev server port **5413**, `--strictPort`, killed by PID.

## The shape: three spaces, one world

| floor | space id | purpose |
| --- | --- | --- |
| 0 | `castle.mall` | **The mall.** All seven market stalls, the toilets, the front door, the lift alcove. |
| 1 | `castle.hall` | **The great hall.** Throne, dais, feast table, benches, hearth, knights — #368/#388's furniture, which today shares deck 0 with the market and has nowhere of its own. |
| 2 | `castle.roof` | **The roof garden.** Open sky, parapet, pavilion, planters, benches, the trampoline, the grown-up, and the **ginormous slide's launch pad** — non-negotiable. #410's wild pets and long grass land here. |

Floor *k* lives at `(INTERIOR_ORIGIN_X + FLOOR_SPACE_SPACING * k, INTERIOR_ORIGIN_Z)`
with `FLOOR_SPACE_SPACING = 300`. The mall keeps `(600, 600)`, so the front
door's numbers barely move. Per-space radius 120 m — comfortably containing a
21.2 x 15.6 m half-plate and its 46 m play bounds, and 300 apart so two can
never be confused. `spaceAt` resolves the castle by x-band exactly as it
already resolves the six hotel rooms by z-band.

**Not a new architecture — the hotel's, applied to the castle**, which is
literally what Jim asked for. `Building` grows the same four methods `Hotel`
already has: `currentFloor()` (from `spaceAt`), `boundTo(floor)`,
`stepThroughDoor(...)`, `travelTo(floor)`. `SpaceManager.changeTo`/`hop` get
unified, as that file's own docblock asks S2 to do.

`layout.ts` grows a `CastleFloor` record — `space`, `originX/originZ`,
`halfX/halfZ`, `clearHeight`, `liftZ` — the direct analogue of `HotelRoom`.
Three of them, and `BUILDING_FLOOR_COUNT` becomes 3.

## Device by device — what I agree with in Decision 3 §4, and what I do not

| device | Decision 3 §4 | my ruling | why |
| --- | --- | --- | --- |
| Tap stairs, `StairRide`, `ui/StairMenu` | delete | **agree, delete** | Pure transport plus a menu. Decision 3's replacement (walk up real steps, iris, walk off the top) is itself dead now: the lift is the only route, so there is no stair portal to build. |
| Escalators | **keep** as a portal flavour | **disagree — delete** | Decision 3 kept them as a *route*, and a route that is not the lift is exactly what Jim removed. An escalator that returns you where you started is nonsense, and it is the mall look the family complained about. `Escalators.ts`, `ESCALATOR_WELL`, `escalatorRamp`, `handleEscalator` all go. |
| Glass lift | keep; car/shaft deleted, `floors()`/`go(n)` seam kept | **agree** — and it is now the whole of inter-floor travel | `HotelLift.ts` is the shipped reference for exactly this: press N, iris, doors open in N's own space, no car ever travels. `ui/LiftPanel.ts` is untouched — it was written against the seam for this. Every floor's alcove at the same local spot. |
| Trampoline | tap-and-go portal *up a floor* | **disagree — keep it, as a toy, not a route** | Strip `TRAMPOLINE_SHAFT` and leave a plain trampoline that bounces you and puts you back down on the same floor. That is what a six-year-old thinks a trampoline is, and it costs no fun. Proposed home: the **roof garden** (open sky, nothing to bang your head on). Say if you would rather it stood in the mall. |
| Bubble | keep as the way onto the roof | **moot** | Already deleted by #401; Decision 3 correction 5 says it is not coming back. Nothing to do. |
| Helter-skelter | ride portal, floor 2 → ground | **delete — and this is the one that loses real fun, so I am flagging it rather than doing it quietly** | With three floors the only helter that makes sense is roof→mall, which is a second inter-floor route: the thing Jim removed. Making it return you to the roof means a helix that goes down and puts you back up, which reads as broken. And the roof *already* has the ginormous slide as its down-and-out ride — one great slide off the roof beats two competing ones. **If Jim wants it kept, the honest option is a stand-alone same-floor helix in the great hall with its own steps inside it — but that reintroduces climbing geometry and is a design job, not part of the split.** My recommendation: delete now, file an issue for a same-floor slide in the hall. |
| Ginormous slide | unchanged | **agree, and preserved** | Already a cross-space ride. Its launch simply lives in the roof-garden space. |
| Toilets | move with a floor | **the mall** | They belong beside the shops; a child in a market needs them. |
| Shaft guards | delete wholesale | **agree** | There are no shafts left at all. |
| Floor fader | "deleted" | **only the castle's use of it** | Correction 2: `FloorFader` has a live hotel consumer (`overhangFader`). The file survives; the castle's layers and `Shops.setVisibleDeck` go, replaced by per-space root visibility. |
| `DECK_HOLES`, `deckIsSolid`, `BUILDING_SHAFTS` | delete | **agree** | And this dissolves the brief's `keepOutsFor`-does-not-include-`BUILDING_SHAFTS` bug — five occurrences across four agents this week — by removing the concept of a shaft entirely. A real win, not tidying. |

## Why this is worth doing beyond tidiness — the PR's strongest argument

**Indoor collision is height-blind.** A shop counter on one deck is an
invisible wall on every other deck, and `check:castle` cannot see it: it tests
props against keep-outs, not colliders against another deck's furniture. The
branch's previous engineer hit exactly this — a stall over the great hall's
feast table would wall off the hall below, verifiable only by hand. **After the
split no two floors share a plan, so that entire bug class is impossible by
construction.** It also unblocks #376: castle props can finally have real
colliders, which they were denied for precisely this reason.

## What the split makes easier, not harder — NPCs

Correction 5 stands: children *do* reach castle shops now (`npc/portals.ts`,
`npc/attractions.ts`, `check:npc-presence`). But consolidating all seven shops
onto the mall means **every castle attraction is in one space**, reachable
through the existing garden↔castle portal, with no NPC lift-riding at all. The
"child stranded on a floor she cannot leave" risk goes away rather than being
managed.

## What is at risk, stated rather than traded away

- **The helter-skelter** — above. Needs a ruling.
- **`MARKET_BEAM_INSET = 1.8` and `MARKET_SOUTH_Z`'s `+1.6`** — both were
  *measured* to clear the hearth's fire and the stairwell's 4.2 m pick radius,
  **on the same deck**. With the hall on its own floor and the stairwell gone,
  both constraints vanish. So the market is re-laid as the **three rows x four
  columns** block this branch already measured as fitting seven stalls
  (21.72 x 15.68 m at a 3.6 m stall) — two aisles with stalls down both sides, a
  market proper. That is the market *moving*, which was always the plan, not
  the market being dropped.

## The boot validator — `scripts/check-castle-floors.mts`

Into the `build` chain (currently **47** steps, parsed from `package.json`, not
grepped; it becomes 48), after `check:castle`. It asserts, on the **built**
world:

1. the portal graph connects the garden to all three floors **and back**, using
   only the portals actually registered;
2. every arrival point samples to walkable ground in its own space, within
   `BUILDING_STEP_UP`;
3. no arrival sits inside any trigger band, with `PLAYER_RADIUS` of margin;
4. the three floors do not overlap — no two plates-plus-`INTERIOR_PLAY_RADIUS`
   intersect, and `spaceAt` round-trips every plate corner to its own floor;
5. the ginormous slide's entry is in the roof space and its stand point is
   walkable.

**Proved red by four deliberate mutations**, each recorded with the geometry it
was proved against (CLAUDE.md: a red-run transcript goes stale): remove the lift
portal (1 fails); push an arrival 1 m into a wall (2); move an arrival inside
its own trigger (3); set `FLOOR_SPACE_SPACING` to 40 (4).

## Commit order — so nothing is lost on the way

1. three-floor table (`spaces.ts`, `layout.ts`, `CastleFloor`), no behaviour change;
2. `Shell` + `surfaces` build three disjoint plates; door portal to the mall; lift portal the only inter-floor route;
3. the deletions (stairs, escalator, `StairRide`, `StairMenu`, `ShaftGuards`, holes, shafts);
4. contents move: market to the mall, hall furniture to floor 1, roof dressing to floor 2;
5. the boot validator, proved red;
6. `check:castle` / `check:shop-spacing` / `check:tap-spacing` / `ParkMap` / `interactZones` re-shaped for three floors; screenshots at player height of each floor and of the lift moving.

---

## S2 STATUS — built, green, and **not yet walked in a browser**

Branch `feat/castle-floors-half-area`, worktree `.claude/worktrees/castle-shrink`.

### Gates, all run unpiped, exit codes read

| gate | exit | note |
| --- | --- | --- |
| `pnpm exec tsc --noEmit` | **0** | |
| `pnpm exec tsc --noEmit -p tsconfig.test.json` | **0** | |
| `pnpm run build` | **0** | 49 steps, parsed from `package.json`, never grepped |
| `pnpm run test:procgen` | **0** | 465 passed, 15 files, **0 skipped** |
| `pnpm run check:castle` | **0** | |
| `pnpm run check:castle-floors` | **0** | new; see below |
| `pnpm run check:shop-spacing` | **0** | re-shaped for one aisle on the mall |
| `pnpm run check:tap-spacing` | **0** | |
| `pnpm run check:park`, `check:park-boot` | **0** | in the build chain |

`check:park-boot` went red once **under load** (a build running beside it) and
passed alone and in the clean build — the #324 flake, exactly as briefed.

### The boot validator, proved red four ways

`scripts/check-castle-floors.mts`, inserted after `check:castle`; the chain went
48 → **49** steps. Geometry it was proved against, from its own green line:

> 3 floors 300 m apart (The mall, The great hall, The roof garden), 8 portals.

1. **lift portals removed** → 4 failures: both upper floors unreachable *and*
   unable to get back. *"That is a child stranded on a floor she cannot leave."*
2. **lift arrival moved off the plate** → 6 failures, each naming the surface it
   found (−0.472 m) against the floor it wanted (0.728 m).
3. **door arrival landed on its own exit band** → the ping-pong clause fires by
   name, plus the arrival clause.
4. **`FLOOR_SPACE_SPACING` 300 → 40** → the overlap clause fires for all three
   pairs, every plate corner resolves to the wrong floor, and arrivals report
   landing in `castle.mall` while claiming `castle.hall`.

**One honest note.** The first attempt at mutation 2 moved the arrival 4 m east
and produced **no failure**. That was the mutation being wrong, not the check:
`LIFT_STAND_X + 4 = 24.11` is still inside `LIFT_SHAFT` (21.21–24.61), which
`LIFT_PIT` floors, so she was standing on the alcove floor and the check was
right to pass her. Re-chosen to move off the plate. A mutation that fails to go
red is a claim about the check that has to be run down.

### The bug `test:procgen` caught that the build could not

`slide/solve.ts` had `START_Y = deckY(TOP_DECK)`. That was never about the
interior — it was a proxy for "as high as the castle is", working only because a
five-storey interior happened to out-top the facade's battlements. `TOP_DECK`
fell 4 → 2 and took **7.2 m** off the launch height: the chute crossed the
castle's south wall **3.76 m inside solid battlements, on every seed**, with
nothing cutting a hole. `pnpm run build` stayed green throughout, because
`test:procgen` is not in the chain.

Fixed at the root: `CASTLE_WALL_HEIGHT`/`CASTLE_MERLON_HEIGHT` moved from
`Shell.ts` to `layout.ts` (the move `CASTLE_TOWERS` already made, for the same
cycle reason), and `START_Y = BUILDING_BASE_Y + CASTLE_MASONRY_TOP +
BATTLEMENT_AIR`. GAME_DESIGN 30c: the inside never has to agree with the
outside's shape, so a figure about the outside must not derive from the inside's
floor count.

### WHAT IS NOT DONE — read this before merging

**Nobody has watched this run.** I have not been granted the chrome-devtools
MCP, and CLAUDE.md is explicit that an agent who has not been told it owns the
browser must not drive it. So the three required screenshots — each floor at
player height, and the lift moving between them — **do not exist**, and the
three things only a rendered frame can answer are unverified:

1. every floor reachable by lift, nothing stranded (asserted by the validator on
   the portal graph; *not* observed);
2. the great hall still reads as a hall now it has a floor to itself;
3. **the ginormous slide still launches from the roof garden** — the validator
   asserts the pad is in the roof space, on the plate and on walkable ground,
   and `test:procgen` asserts the chute clears the battlements, but nobody has
   ridden it.

This is a gate, not a formality: the branch is pre-approved for merge and must
still not be merged until somebody has looked.

### CI, on the real head commit

Rebased onto `main` @ `faf6d044`; head is `d10865c`, which is also the sha in
the preview URL. All four checks **SUCCESS**: Build and checks, Procgen
invariants, Deploy PR preview, A reload gets the new build.

Preview: `https://pr-407-d10865c-land-of-good-places.blockstack.workers.dev`
with `/castle?deck=0`, `?deck=1`, `?deck=2` and `/slide`.

**Egress note, contradicting CLAUDE.md:** that host returned **HTTP 200** to
`curl` from this sandbox. CLAUDE.md's PR section says `*.workers.dev` gives 403
here and that an agent therefore cannot verify a preview it hands over. That was
not true today. Worth re-checking before the next agent repeats the caveat.

### The one gate still open: nobody has looked

The branch is pre-approved for merge, and it must still not be merged. I was
not granted the chrome-devtools MCP, and CLAUDE.md forbids driving it
unasked. Outstanding, and only a rendered frame can answer them:

1. every floor reachable by lift, nothing stranded;
2. the great hall reading as a hall now it has a floor to itself;
3. **the ginormous slide launching from the roof garden.**

Screenshots required: each floor at player height, and the lift moving between
them. `scripts/qa-castle-shrink.mjs <port> <outDir> <halfX> <halfZ>` is on this
branch and takes standing points as fractions of the half-extent; it will need a
small edit for three floors reached by `/castle?deck=N` rather than five by
height.
