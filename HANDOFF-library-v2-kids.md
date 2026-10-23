# HANDOFF — Library v2, track B: the library's three children (#718, plan Step 8)

Branch `feat/library-v2-kids`, cut from the integration head **33bcc361** (`feat/library-v2`),
worktree `.claude/worktrees/library-v2-kids`. Engineer, Claude Fable 5.1, 22–23 Oct 2026. The plan
is `docs/library-build/PLAN-parts-4-5.md` (Step 8, plus Ground rules, Seams, Numbers, Decisions);
the engine underneath is PR #722 (`HANDOFF-engine-solids.md`). Where the task text or the engine
differs from the plan, the task wins; every departure is under "Decisions" below. **Raise no PR**:
the Library v2 PR (#733) is one PR, moved by the join stage.

Scratch logs: `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/kids-step8/`
(gitignored): `library-kids-{1,2,3}.log` (the KIDS runs), `red-*.log` (the proofs), `npc-*.log`
and `ride-*.log` (the plan's other checks), `probe-*.mts` (the scratch instruments), `honest-5.json`
(the integration head's honest seed-5 park).

## Status

- [x] **Step 8 — the library's three children**: built, checked (`check:library` **124 ✓, 0 ✗**),
      every red proved (below), pushed. Commits: 611672b0 (game side), e62f4a39 (KIDS + the
      orientation fix), 5b9e82de (the furniture CONTROL), plus this file.
- The NPC seams the plan's Step 8 names (`residentLooks.ts`, `ResidentSpec.driver`,
  `PLAYER_SEPARATION` exported, `beginSeated`/`endSeated`/`seated`, the seated and riding rules in
  `separateFrom`/`separateFromPlayer`, height-aware push-apart via `separatedByHeight`) were all
  **verified present on the integration head** (read, not assumed) — nothing to build there.
  `HotelGuests.ts` already imports the lifted wardrobe.

## What was built

- **`src/world/library/layout.ts`** — `aisleNode(aisleId, index)` (throws naming both);
  `LibraryKidPlan` and **`LIBRARY_KID_PLANS`** exactly as the plan writes them (Juno on
  `west-aisle-1` `[3, 2, 1, 2]` → cushion-4 via `central[4]`, (0.5, −8.3), (1.0, −9.9); Lark on
  `north` `[2, 1, 0, 1]` → cushion-2 via `central[4]`, (3.0, −6.6); Fenn on `east-aisle-2`
  `[2, 1, 0, 1]` → cushion-5 via `east[1..4]`, (7.8, −7.3), (7.0, −10.0)); the one owner of every
  point a child walks: `libraryKidCircuit` (stroll order, exit node first), `libraryKidExitNode`,
  `libraryKidAisle` (distinct nodes, far end → exit), `libraryKidRugRoute` (exit node, `toSeat`,
  the cushion's middle). Module-load throws: a missing node, a non-cushion seat, a player's cushion,
  two children on one cushion, two children with one name, a circuit under two nodes, no `toSeat`.
- **`src/world/library/libraryKidDriver.ts`** (new) — `LibraryKidDriver implements
  CharacterDriver, ActivityHost`, `name 'library-kid'`. Modes `stroll | walking | arrived |
  seated | gaveUp | returning`. The stroll is a `WaypointDriver` of the circuit at `GUEST_PACE`
  (fresh on every dismissal: every circuit starts at its exit node). `summon()` builds the route
  on the next frame from where she stands: the aisle's nodes from the exit side of her nearest leg
  through the exit node (`libraryKidAisle` + `segmentDistance`), then `libraryKidRugRoute`'s
  declared way and the seat. Legs are `Errand`s (`KID_ROUTE_ARRIVE` 0.45; at the seat
  `libraryKidSeatArrive()`; `KID_LEG_TIMEOUT` 30 s; `NO_LIMIT`; unstick) at `KID_SUMMON_PACE`
  0.7 (the `ActivityHost.pace`). `markSeated()` (from `arrived` only). `dismiss()` walks
  `route.slice(exitIndex, reached)` reversed, then a fresh stroll; given up before the exit node,
  straight to the stroll. Arrived, given up or seated she looks at `LIBRARY_STORY_CHAIR` and is
  `happy`; walking, `neutral`; blink from her own `createBlinkClock(() => rng.unit())`. Every
  intent field written every frame; nothing allocated per frame. `standingSpot` keeps where her
  walk to the seat ended. Exports `KID_SUMMON_PACE`, `KID_ROUTE_ARRIVE`, `KID_SEAT_SLACK` (0.1),
  `KID_LEG_TIMEOUT`, `libraryKidSeatArrive()`.
- **`src/world/library/LibraryKids.ts`** (new) — `libraryResidents(parent)`: one `LibraryResident`
  per plan (`plan`, `model`, `spec`, `driver` set by the spec's factory). Seeds
  `LIBRARY_KID_SEED 0x0b00c5 + i · 997`; draws in the hotel's order (skin, hair, outfit, hair
  style, backpack, backpack colour) from `residentLooks.ts`; `CharacterModel` named
  `library.kid.<name>`, parented to `parent`; spec `{ name, avatar: characterModelAvatar, waypoints:
  the circuit in world metres, seed, pace: GUEST_PACE, floorY: LIBRARY_FLOOR_Y, driver }`. At module
  load: every pair of children's cushions ≥ `SEPARATION` (1.80; nearest 2.00, cushions 4 and 5) and
  every child's cushion ≥ `PLAYER_SEPARATION` (1.52; nearest 1.75, cushion-4 to cushion-1) — throws
  naming the pair.
- **`src/world/library/Library.ts`** — `readonly kidsRoot` (`'the-library-children'`, identity
  transform, in the scene beside `roomRoot`), shown and hidden with the room through one
  `showRoom(visible)` (the constructor, `adoptRestoredPlayer`, `enterRoom`, `releasePlayer`,
  `standOutside`); `get residents()` (the specs); `attachNpcs(all)` picks the crowd's bodies whose
  `driver` is one of its drivers (throws if a child has no body); `get children(): LibraryKid[]`
  (`plan`, `driver`, `body`, `model`) for story time and the checks.
- **`src/world/World.ts`** — `[...hotel.residents, ...library.residents]` into `NpcSystem`;
  `library.attachNpcs(npcs.all)` after `entrance.attachNpcs`; `library.kidsRoot` in `scene.add`.
- **`test/procgen/parkFacts.ts`** — `world.library.kidsRoot` in the drawn-reach `excluded` roots
  (without it every seed fails: three children 850 m from the park's middle).
- **`src/entities/npc/NpcCharacter.ts`** — one line in `animate`: `faceOnGround(rig.root,
  this.facing)` after `applyRidePose`. See "Found, not planted" below: it fixes a seated child
  drawn upside down **and a pre-existing bug in train riders**.
- **`scripts/check-library.mts`** — the **KIDS** clause (after SIT, track B's marker), 23 clauses,
  and `block-route` armed; the header lists it.

## KIDS (check:library), what it measures — all off the real crowd and the real collision world

1. Three children met in the crowd (`library.children`), each body driven by its own
   `LibraryKidDriver` (`'library-kid'`), every model under `kidsRoot` (in the scene, identity,
   visible exactly while she is inside).
2. The seats apart: nearest children's cushions 2.00 m (SEPARATION 1.80); nearest child's cushion
   to a player's 1.75 m (PLAYER_SEPARATION 1.52).
3. **40 legs** (12 circuit legs, wraps included; 14 to the rug — the last of each only to 1.05 m
   from the seat, where her walk ends; 14 back) swept every 0.1 m with a 0.55 m body
   (`NPC_RADIUS + 0.05`) against `collision.isClearCircle`: **1356 stations, 0 blocked**. Every leg
   ≥ 1.42 m from the player's cushions (nearest **1.59 m**: Juno's way back (0.5, −8.3) → (0.6,
   −5.6) at (0.5, −7.9), to cushion-1 — the plan's own 1.59) and ≥ 1.80 from the other children's
   seats (nearest 2.65 m).
4. At every one of **26 route nodes** `collision.resolve(probe, NPC_RADIUS, 0, Infinity, undefined,
   KID_HEIGHT)` pushes at most **0.0 mm** (10 allowed).
5. With the real child stood at the desk's front for **60 s**: Juno 46.0 m, Lark 51.2 m, Fenn
   46.9 m walked; feet within 0.000 m of the floor; no step over 0.019 m (bound `NPC_RADIUS · 2`);
   at most 0.01 m off her own circuit (0.60 allowed); none marked elsewhere; none left the room.
6. With her in the garden (through `requestEnterDoor`) for **5 s**: the children moved **exactly
   0 m**, 3 of 3 marked elsewhere, `kidsRoot` hidden; back inside, shown again.
7. **The story-time rehearsal**, as `storyTime.ts` will do it:
   - CONTROL (first, the children strolling far away — nearest 6.5 m the whole walk): from (1.40,
     −9.50) the real child walks east at Juno's **empty** cushion-4 at a 0.6 stick and steps onto
     it — feet rise to **0.352 m** (top 0.360; the damped height lags at a walk), 0.00 m from its
     middle.
   - `summon()` ×3: every child reaches her cushion's edge, **Juno 5.8 s, Lark 8.0 s, Fenn
     11.1 s** (40 allowed), none gave up, no step over 0.030 m; each stands 0.95–1.02 m from the
     middle (cushion 0.45 + NPC_RADIUS 0.50 ≤ d ≤ 1.15), feet on the floor; 1.5 s later each is
     turned to the storyteller's chair within 0.000 rad.
   - `beginSeated(seat, floor, seat, seatFacing, i·1.7)` + `markSeated()` ×3, 120 frames: lowest
     drawn point **3.5 mm** off the floor, worse sole **3.5 mm**, hip pivot **0.0 mm** off the
     cushion's top (`seatedPose.mts` tolerances 15 / 15 / 3); 0.000 mm of drift; seated held.
   - **A seated child is furniture:** the same walk at Juno on cushion-4 for 1.5 s moves her
     **0.00 mm**; the player is held at the cushion's side, **1.07 m** from its middle (0.45 +
     0.62), feet 0.000 m up: nobody climbs onto an occupied cushion (the CONTROL stepped onto the
     empty one to 0.352).
   - `endSeated()` + `dismiss()` ×3: every child a metre off her cushion within **0.1 s** (the
     resolver escorts her out of the cushion's disc at `NPC_RADIUS / 2` a frame), back to her
     stroll within **9.5 s** (Juno 4.5, Lark 4.3, Fenn 9.5), longest step 0.250 m; ten seconds on
     each is 0.00 m off her own circuit, feet on the floor.
8. stderr note: children, seeds, legs, the seat-arrive distance and its parts, the paces, the
   arrive radius, the timeout, frames stepped.

## Checks at 5b9e82de (exit codes read; counts off the screen)

Local parks: iteration runs hydrate the integration head's **honest seed 5** (digest
d6721090fb3f1d3a, `honest-5.json`) through `LGP_PARK_FILE`; the reading room is seed-independent
and every `src/` edit here changes the park-source hash (now 7188a399…). For the plan's other
checks, the engine's 16 CI parks were restamped under this tree's hash in `.parks/` (the engine
and integration handoffs' own shortcut; the Library moves nothing in the park — the integration
head's honest solve proved it). CI solves honestly on the PR head.

| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | |
| `pnpm run typecheck:test` | 0 | |
| scripts typecheck instrument (`kids-step8/tsconfig.scripts.kids.json`, the foundation's recipe pointed at this tree) | 2, as every tree | **56 messages, the engine/integration trees' own set** (`check-library.mts(…): Property 'exit' does not exist` is pre-existing); a first run had one more — an unused parameter in KIDS — fixed |
| `check:library` (honest seed 5) | 0 | **124 ✓, 0 ✗**, "All clauses passed." (101 before + 23 KIDS); every pre-existing line identical to the baseline (`baseline-library.log`: 101 ✓ at 33bcc361) |
| `pnpm run build` | 0 | 498 modules, built in 528 ms |

The plan's other checks for Step 8 (the 16 restamped parks in `.parks/`, each check picking its own
seed; logs `npc-*.log`, `ride-*.log`, `tap-spacing-1.log`):

| check | exit | off the screen |
|---|---|---|
| `check:hotel` | 0 | "34 children (7 of them hotel residents)" (31 before: the three are counted by the fall detector), worst 0.049 m below its own surface; 13 props solid, 3 beds; 41/41 panes; 230 doorway marches, 0 short; 2955 furniture-vs-wall pairs, 0 embedded; `check:hotel OK` |
| `check:npc-presence` | 0 | 18000 of 18000 frames with somebody marked elsewhere; **0 mark/world disagreements**; 0 park children spawned outside the garden; `npc presence OK` |
| **`check:jitter`** | **1** | **PRE-EXISTING, not Step 8's** — see "Findings outside this task": frame 2085, Theo (a park child), own step 2.743 m at (−20.94, 12.72) near Sunny Side; **the identical failure on the integration head 33bcc361** (`control-jitter-33bcc361.log`, 31 children) with the same parks |
| `check:npc-separation` | 0 | 900 frames, a real correction on 865 of them, worst single-frame correction 0.042 m; `npc separation OK` |
| `check:npc-perch` | 0 | 24 wandering children, 38 trees × 4 approaches; OK |
| `check:cat-bus` | 0 | 11 arrivals through the door over 10.5 s, tightest gap 0.73 s; 34 children in the park 30 s later; OK |
| `check:rail-race` | 0 | `rail race: OK` |
| `check:climb-wave` | 0 | 38 trees × 4 approaches; OK |
| `check:slide-rider` | 0 | 611 frames ridden, 0 with a vertex inside the trough; ok |
| `check:tap-spacing` | 0 | 10 spaces, **145 zones** (unchanged: Step 8 adds no zone), 27 portal bands; 245 zone-band and 20 close zone-zone pairs; 20 same-action overlaps (warnings); OK |
| `pnpm run test:procgen` | 0 | **48 files, 2166 tests passed** (the restamped parks: the canonical seed and the sweep seeds hydrate); the `kidsRoot` drawn-reach exclusion holds on every seed |
| `check:coplanar` | 0 | `check:coplanar OK — 186 same-facing coplanar seam(s) across 16 seed(s) and 10 space(s): 65 fighting at 0.1 mm, 121 more held apart by a stand-off under 1 cm`; **the control at 33bcc361 with the same parks reads the identical 186** (`control-coplanar-33bcc361.log`) — the sweep ignores `visible`, so the three children's models were swept on the first seed and added no seam |

## Red transcripts (each with the geometry it was proved against)

Geometry for all: the integration head's honest seed 5 (restart 1, digest d6721090fb3f1d3a)
hydrated with `LGP_PARK_FILE`; the reading room at (−600, 0, −600); cushions of radius 0.45 and
top 0.360 at room (2.1, −8) [1], (4, −7.6) [2], (5.9, −8) [3], (3, −9.5) [4], (5, −9.5) [5];
Lark's way to the rug `north[2]` (−4, −7.4) → `central[4]` (0.6, −5.6) → (3.0, −6.6) → cushion-2;
the real child at the desk's front (6, 8.7) facing 180 for the stroll and the rehearsal; frames of
1/60 s. The three mutation runs were made in a detached snapshot worktree at 5b9e82de
(`library-v2-kids-snap`, removed after), each by-hand edit reverted with `git checkout` (tree
clean after: 0 changed files).

- **`LIBRARY_CHECK_MUTATE=block-route`** (a 0.8 m disc on Lark's (3.0, −6.6)) → exit 1, **122 ✓,
  6 ✗** (`red-block-route.log`):
  ```
  ✗ Lark's way to the rug: the leg (0.6, -5.6) → (3.0, -6.6) is blocked at (1.80, -6.10) for a body of 0.55 m
  ✗ Lark's way back: the leg (3.0, -6.6) → (0.6, -5.6) is blocked at (3.00, -6.60) for a body of 0.55 m
  ✗ Lark's way to the rug: the leg (3.0, -6.6) → (4.0, -7.6) is blocked at (3.00, -6.60) for a body of 0.55 m
  ✗ Lark's way back: the leg (4.0, -7.6) → (3.0, -6.6) is blocked at (3.26, -6.86) for a body of 0.55 m
  ✗ 40 legs (…) swept every 0.1 m with a 0.55 m body: 1356 stations, 4 legs blocked
  ✗ at every one of 26 route nodes the resolver pushes a child-sized body at most 1304.3 mm (Lark's (3.0, -6.6); 10 mm allowed)
  ```
  The disc is taken out before the stroll and the rehearsal, so those stay green — the red is the
  sweep's and the node clause's, as the plan asks.
- **By hand — `KID_SUMMON_PACE = 0`** (`libraryKidDriver.ts` line 76; nobody walks to the rug) →
  exit 1, **119 ✓, 5 ✗** (`red-pace0.log`):
  ```
  ✗ summoned, every child reaches her cushion's edge in 30.0 s (Juno 30.0 s, Lark 30.0 s, Fenn 30.0 s; 40 allowed), gave up: Juno, Lark, Fenn; no step over 0.015 m on the way
  ✗ each stands at her cushion's edge, on the floor: Juno 9.03 m from the middle, Lark 14.41 m from the middle, Fenn 10.79 m from the middle (…)
  ✗ every child stayed seated on her cushion's middle with her root on the floor: 0.000 mm of drift at worst, seated held false
  ✗ dismissed, every child is a metre off her cushion within NaN s (…) and back to her stroll within 0.0 s (…)
  ✗ ten seconds on, each is back on her own aisle: Juno 6.39 m off her circuit, Lark 8.31 m off her circuit, Fenn 6.20 m off her circuit (0.60 allowed), feet on the floor
  ```
  (`KID_LEG_TIMEOUT` is 30 s: every first leg timed out at 30.0 s and every child gave up.)
- **By hand — the crowd no longer skips a child marked elsewhere** (`NpcSystem.update` line 956,
  `if (this.elsewhere.has(character)) continue;` commented out) → exit 1, **123 ✓, 1 ✗**
  (`red-no-freeze.log`):
  ```
  ✗ with her in the garden (through the door link: true, outside true) for 5 s, the children moved exactly 5.0721666666597685 m (marked elsewhere: 3 of 3) and their root is hidden (visible false)
  ```
- **Found, not planted — the seated child drawn upside down** (`library-kids-1.log`, the first
  KIDS run at e62f4a39's parent, exit 1, 121 ✓ 2 ✗):
  ```
  ✗ sat on their cushions as story time sits them, over 120 frames: lowest drawn point at worst 2390.8 mm off the floor, the worse sole 430.0 mm (15 allowed, each), hip pivot 720.0 mm off the cushion's top (3 allowed)
  ```
  Cause (measured with `probe-seated.mts` / `probe-carried.mts` and bare three.js,
  `probe-euler.mjs`): `faceOnGround` writes the root's **quaternion**; three.js re-derives the
  Euler as (±π, θ, ±π) for any yaw past a right angle (yaw 1.6 → (−3.142, 1.542, −3.142)); every
  posture in `ridePose.ts` then rights the rig with `root.rotation.x = 0`, which for that Euler is
  a roll of π — up.y 1.00 → −1.00. The player's posed root sits inside her oriented `group`, so SIT
  never saw it. **The same line flips a train rider**: a real park child `setCarriedPose` facing
  ±2.60 rad measured root up.y **−1.00** after one frame (facing 0.57: 1.00) — pre-existing on the
  engine branch and on main. After the fix (`NpcCharacter.animate` re-asserts
  `faceOnGround(rig.root, this.facing)` after the pose): up.y 1.00 for carried ±2.60 and seated
  2.60 alike, and the clause reads 3.5 / 3.5 / 0.0 mm.
- **Found, not planted — the furniture CONTROL in the wrong place** (`library-kids-2.log`, exit 1,
  124 ✓ 1 ✗): run after the summons, Juno stood at cushion-4's edge in the player's path and the
  control could not tell the sitter's hold from the cushion's side:
  ```
  ✗ CONTROL: from (1.40, -9.50) (clear floor: true) the real child walks at Juno's empty cushion-4 and steps up onto it: her feet reach 0.000 m (its top 0.360), 1.07 m from its middle at nearest
  ```
  `probe-step.mts` showed the real child steps onto the empty cushion at every stick amount
  (feet 0.316 at 1.0 … 0.359 at 0.35, closest 0.00–0.04); moved before the summons, with "nobody
  near" measured during the walk (6.5 m), the control reads 0.352 and the occupied case 0.000 /
  1.07 — the instrument can now say both yes and no.

## Decisions (with reasons) — Jim is away; each is for the PR body too

1. **The walk to a seat ends at the cushion's edge, and sitting is a snap of ~1 m.** The plan's
   "seat arrive 0.5, snap ≤ 0.5 m" predates the engine: a story cushion is a filled solid (PR #722)
   and the crowd never climbs a solid, so her feet can get no nearer than cushion radius +
   `NPC_RADIUS` (0.95). `libraryKidSeatArrive()` = that + `KID_SEAT_SLACK` 0.1 = **1.05 m**, read
   off the measured cushion and the game's radius, never typed; `beginSeated` then snaps her
   onto the middle. Measured: she stops at 0.95–1.02 m. Step 9 inherits the snap (see "For the
   join" for the levers).
2. **`summon()` takes no arguments** (the plan wrote `summon(seatWorld, facing)`): the plan already
   names her cushion, so the driver owns `seat` (world) and `seatFacing` (radians, from
   `libraryFacingStoryChair`, the cushions' one owner of a listener's bearing) and exposes them —
   a second copy of the seat handed in by story time would be the "two definitions" bug.
3. **The route is built on the first frame after a summons**, not in `summon()`: it needs her
   position, which a driver only has inside `update`. `summon()` from any mode but `stroll` is
   ignored; `markSeated()` only from `arrived`; `dismiss()` from `stroll` is a no-op.
4. **Arrived, given up or seated, she looks at `LIBRARY_STORY_CHAIR.at`** rather than at the owl's
   perch (`seatCentre` rotated by the chair's facing, Step 9's number): the chair is the one owner
   of where the storyteller sits and is 6 cm from the perch. Story time can pass nothing in.
5. **A child who gives up on her way stands and listens where she is** (`gaveUp`; the plan's
   "graceful by design"); given up on the way back she strolls from where she is — a fresh
   `WaypointDriver` walks her to the circuit's second node by itself.
6. **A seated child is furniture one way, and so is an occupied cushion.** The push-apart hands the
   whole correction to the player through `Player.nudge`, whose `resolveMovement` has no step in
   it, so an occupied cushion is a wall to her: she is held at its side, feet on the floor, and
   never climbs onto a seated child. Measured, with its control (an empty cushion is stepped
   onto). Nothing was added to make this so; the clause records it.
7. **The orientation fix lives in `NpcCharacter.animate`**, the one owner of an NPC's facing, not
   in `ridePose.ts`: the poses' `root.rotation.x = 0` is right for the player's inner root, and a
   pose cannot know whether the root it is handed is the oriented object. No NPC is ever reclined,
   so re-asserting the facing undoes nothing wanted.
8. **Three children, seeds disjoint from the hotel's (`0x6035 + i·977`)**, cushions 2, 4 and 5
   (plan Decision 13), looks drawn in the hotel's order — as the plan says.
9. **The `toSeat` points are not keep-outs.** A keep-out is `PLAYER_RADIUS + 0.28` (0.9 m) of clear
   floor and Juno's (0.5, −8.3) passes the west story armchair by a hand's breadth at a child's
   radius; the plan sweeps the routes at `NPC_RADIUS + 0.05` instead, and KIDS does.
10. **The rehearsal is beyond the plan's KIDS list** (an additive deviation): it exercises
    `summon` → `beginSeated`/`markSeated` → `endSeated`/`dismiss` end to end on the real crowd, so
    Step 9 wires a driver whose every transition has been measured, and the "seated child is
    furniture" rule has a measured control. The rehearsal's bounds (40 s gather, 40 s dismiss) are
    the check's own; Step 9 owns the game's `GATHER_TIMEOUT`.
11. **`block-route`'s disc is taken out before the stroll and the rehearsal**, so the red stays
    attributable to the sweep and the node clause the plan names; the rehearsal's own reds are
    proved by hand (pace 0).

## For the join (and for Step 9, story time)

1. **`Library.children`** gives story time each child's `plan`, `driver`, `body` and `model`.
   `driver.summon()`, then each frame: a driver with `arrived` →
   `body.beginSeated(driver.seat.x, LIBRARY_FLOOR_Y, driver.seat.z, driver.seatFacing, i · 1.7)` and
   `driver.markSeated()`; `gaveUp` listens standing. Dispersal: `body.endSeated()`,
   `driver.dismiss()`. Abort: the same two, from any mode.
2. **The sit is a snap of up to 1.05 m** (Decision 1) and the stand-up is a 0.95 m slide over four
   frames (the resolver escorting her out of the cushion's disc at `NPC_RADIUS / 2` a frame; the
   rehearsal measured "a metre off within 0.1 s"). If QA finds either reads as a pop, the levers,
   in order: (a) ease the snap in story time by writing `body.position` from
   `driver.standingSpot` to the seat over ~0.4 s **after** `beginSeated` (a seated body has no
   collision, so the writes stick; `body.syncTransform()` each frame), and stand her up with
   `body.stepThroughDoor(standingSpot.x, floor, standingSpot.z, facing)` before `dismiss()`;
   (b) a `glideSeated` on `NpcCharacter`. Neither is in Step 8.
3. **Step 9's STORY clause**: "no child's own XZ step in any frame exceeds `NPC_RADIUS · 2`" must
   exclude the sit frame (the snap) or measure it as its own number; "every child seated within
   0.05 of its own cushion" holds (`beginSeated` puts her on the middle; drift 0.000 mm measured);
   `seatedErrors(model, LIBRARY_FLOOR_Y, LIBRARY_FLOOR_Y + cushionTop)` with `soles` (the kids
   handoff's note) — the rehearsal measured 3.5 / 3.5 / 0.0 mm.
4. **`Library.update` order** (the Seams table): nothing of Step 8 runs in `update`; the children
   are stepped by `World`'s `npcs.update`, after `library.update`. `check-library`'s harness steps
   `library.update` then `world.npcs.update` for the same reason.
5. **Step 14's den avoidance** adds to KIDS: every leg vs `libraryDenContains` and the leaf's
   sweep quarter-disc at `NPC_RADIUS + 0.2`; the `legs` list in the clause is built once and is
   the place to add it (`resident-in-den` is already in `MUTATIONS`).
6. **`check-library.mts` imports** gained: `NPC_RADIUS` (constants), `KID_HEIGHT`
   (`kidHeight.ts`), `PLAYER_SEPARATION`/`SEPARATION` (`NpcSystem.ts`), `GUEST_PACE`
   (`residentLooks.ts`), the driver's constants, `LIBRARY_KID_SEED(_STRIDE)`, `segmentDistance`
   (props), and from layout `LIBRARY_KID_PLANS`, `LIBRARY_STORY_CHAIR`, `libraryKidCircuit`,
   `libraryKidRugRoute`, `type LibraryKidPlan`. Union them with the other tracks'.
7. **KIDS leaves the real child standing at the desk's front (6, 8.7), facing 180, not riding** —
   the harness contract; track C's clauses after it should `enter`/`stand` where they need her.
8. **`Library.ts`** gained imports (`CharacterModel` type, `NpcCharacter`/`ResidentSpec` types,
   `LibraryKids`, `libraryKidDriver` type, `LibraryKidPlan` type), the `LibraryKid` interface,
   `kidsRoot`, `kids`, `kidsAttached`, `residents`, `children`, `attachNpcs`, `showRoom`. The owl
   track's `screenLabels`/`interactZones`/`update` edits are elsewhere in the file; the merge is
   mechanical.

## Questions for Jim (no blocker added; decide when you are back)

- The sit onto a cushion is a ~1 m snap and the stand-up a four-frame slide (For the join 2).
  Fine for background children, or ease them? Either is a Step 9 change.

## Findings outside this task

- **`check:jitter` is red on the integration head** (not fixed here: it is the engine's
  `ParkTrain`/`NpcSystem` round-four work, PR #722's live branch). On this tree and, byte for
  byte, on 33bcc361 with the same restamped parks: *"frame 2085, Theo, own step 2.743 (bound 1)
  at (-20.94, 12.72) near Sunny Side"* — a park child, 600 m from the library, 34.75 s in. The
  check's own diagnosis: something other than the child writes her position. The one writer near
  a station that is not `setCarriedPose` is `NpcSystem.offTheLine` (lines 1173–1195: a crowd child
  on the line for `OFF_THE_LINE_SECONDS` is set down at `TrainService.wayOff`, `at.set(off.x,
  terrainHeight(…), off.z)` — one frame, 2.7 m). The fix is the engine track's: either escort her
  off over frames (as `boundEscape` does for a resolver's escape) or have `check:jitter`
  re-baseline a set-down the way it does `stepThroughDoor`. **Zero tolerance says this must be
  green before the Library v2 PR's CI can be** — the join should raise it with the engine track
  first thing.
- **Train riders facing past a right angle were drawn upside down** (fixed here, because Step 8
  owns `NpcCharacter.ts`) (`rideAlong` → `faceOnGround`,
  then `animate`'s `'seated'` posture's `root.rotation.x = 0`): measured root up.y −1.00 on a real
  park child carried facing ±2.60 rad, before the fix; 1.00 after. Pre-existing on main. The
  engine's `check:solids` ride clauses measure positions, not the rig's up, so nothing caught it;
  a clause on a rider's `root` up vector would be the regression test (not added here: the ride
  checks are another owner's; noted for the join).

## Visual QA needed (no browser was owned on this track)

- `/library?at=6,8.7&facing=180` (the desk's front): three children stroll the aisles — Juno
  between the west stacks (z −3.9), Lark along the north wall (z −7.4), Fenn in the east block
  (z −0.5); dressed from the hotel's wardrobe, blinking, pausing, turning to look when she is near.
  Judge that they read as library visitors and never clip a case. Story time itself (summons,
  sitting, dispersal) is Step 9's to show.

## Taking over at zero notice

`cd .claude/worktrees/library-v2-kids` (branch `feat/library-v2-kids`), `pnpm install
--frozen-lockfile`; `pnpm exec node -e "console.log(process.env.npm_config_user_agent)"` must say
pnpm/12.1.0. `.parks/` holds the engine's 16 parks restamped to this tree's hash; after any `src/`
edit, restamp again (`node scripts/lib/park-source-hash.mjs`, write it into
`.parks/manifest.json`'s `sourceHash`) or run `check:library` as
`LGP_PARK_FILE=/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/kids-step8/honest-5.json
pnpm run check:library`. Every red above is reproducible from its mutation name or its one-line
by-hand edit; the scratch probes are in `kids-step8/`.
