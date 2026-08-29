# HANDOFF — castle floor split (#377)

**Branch:** `feat/castle-floor-split-377`, worktree
`.claude/worktrees/castle-floor-split`, off `origin/main` @ `95832181`.
**Port 5383** if a dev server is needed. No chrome-devtools MCP.

**State: research complete, nothing built. Reported to the Overseer and
waiting on two answers (see "Open questions").** Do not start S2.

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
