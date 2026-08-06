# Architecture review

A running health record. Each review appends a new dated section and states
what was fixed since the last one. Do not overwrite earlier sections.

Context for anyone reading cold: this codebase was built very fast by a large
fleet of parallel agents, most of which died mid-task and were resumed or
replaced. Many features merged **build-verified only**, with browser checks
deferred. Conflicts were often resolved under time pressure, and naive
"keep both sides" resolution has already been caught producing duplicated
logic and structural damage. Assume more of that remains.

---

## Review 1 — 27 July 2026 — `src/world/building`

Fifteen findings, severity ordered. Every one cites file and line.

### S1 (P0) Shop counter colliders cut invisible walls through three forecourts

`layout.ts:501` states the governing rule: collision is height-blind, so a
counter on deck two is an invisible wall on deck four, and no two counters
may overlap in plan. `SHOP_SCALE_XZ = 1.6` (`layout.ts:646`) widened every
counter and forecourt **without re-spacing `SHOP_UNITS`**, breaking it.

Three overlaps, each landing inside another shop's sunken standing area:
`stickerPet` counter into `candyFloss` forecourt, `candyFloss` counter into
`stickerPet` forecourt, and `balloon`+`candyFloss` counters into
`surpriseEgg` forecourt.

**Why it is worst-case:** the serving spots stay clear, so tap-to-shop works
and walking does not. A child hits a hard invisible wall a third of the way
across a pit whose entire purpose is standing in it.

### S2 (P0) The grown-up hangs in the sky for the whole ginormous slide

`Building.ts:500` reparents him to `gardenRoot` unconditionally, but
`advanceRide` only writes his transform when he was actually invited
(`Building.ts:546`), and `updateCutaway` shows him whenever any ride runs
(`Building.ts:457`). Ride the slide without pressing E and a cuddly adult
floats 14.4 m up beside the tower for the entire descent.

Same block contains a merge tell: `Building.ts:495-497` verbatim duplicates
`leaveInterior`'s first three lines (`Building.ts:429-431`). Two independent
exit paths; anything added to one silently skips the other.

### S3 (P1) Build-order contract broken — `NpcSystem` is not last

ARCHITECTURE.md:409 says `NpcSystem` is constructed last because it needs the
finished collision world. `World.ts:116` builds it; `World.ts:129` then builds
`FacePaintStall`, which registers four walls. `poiGraph.ts:149` validates
every waypoint edge at build time, so edges crossing the stall survive
validation that should have deleted them — and children walk through it.
Fix: move the stall construction above the NPC system.

### S4 (P1) Ball pit bypasses its owner and forks a constant

Four contract breaks, self-documented as merge avoidance:
`BALL_PIT_COUNT` exists twice (`constants.ts:188` = 190, now referenced by
nobody; `BallPit.ts:45` = 900); the player is found by scene-graph **name
search** (`BallPit.ts:231`) when `Building.attachPlayer` already holds the
reference; 900 instanced balls cast shadows inside a hole against
ARCHITECTURE.md:180; and the constructor runs **6 simulated seconds of
physics synchronously before first paint** (`BallPit.ts:172`).

### S5 (P0, safety) Escalator wells are 0.6 m wider than the escalators

`ESCALATOR_WELL` (`layout.ts:158`) vs the ramp footprint (`layout.ts:368`)
leaves two 0.6 × 5.4 m open slots through the slab down each side of every
escalator on decks 1–4, outside the balustrade. Nobody falls today only
because player radius holds them back by 0.22 m — and **NPC radius leaves
0.1 m**. `STAIRWELL` matches its flights exactly; the escalator is the odd
one out.

### S14 (P0, safety) Two shafts have no rails and no colliders

Measured against `DECK_HOLES`: `TRAMPOLINE_SHAFT` (r 2.5, decks 1–2) and
`HELTER_SHAFT` (7 × 7 m, decks 1–2) are permanently open with no guard of
any kind. `BUBBLE_SHAFT` leaves a 0.2 m annulus and is fully open whenever
the bubble is elsewhere. `layout.ts:36` states as an absolute invariant that
every hole is fully spanned — it is not, and the next builder who trusts it
will place a bench across a shaft.

### S6–S13, S15 (P2) Hygiene

Shadow-casting on interior fittings and objects inside holes, against
ARCHITECTURE.md:180 (`Toilets`, `Trampoline`, `Bubble`, `GlassLift`,
`BallPit`, and a floor **mat** casting onto the floor it lies on).
Per-frame allocations — `Escalators.placeSteps` allocates 16 objects per
frame forever, including while the player is 890 m away in the garden.
The interact edge is consumed twice (`Building.ts:340` and `:355`).
Class boundaries in the wrong place (`Escalators.carry` must be *told* where
its own building is; `Building.ts` owns other devices' player state; `Stairs`
is a class that should be a function). Dead exports, including one whose doc
comment names a consumer that went the other way. Seven shop placeholders
built and hidden forever, each baking its own canvas texture against the
~40-texture budget. `FloorArrows.ts` contradicts itself about which axis
rotates an arrow. Triplicated helpers (`receiveOnly` three times, `clamp01`
three times, rail builders twice).

### Action taken

P0 items delegated immediately. P1/P2 recorded here for scheduling.

---

## Review 2 — 27 July 2026 — core loop, collision, player, wanderDriver, docs

**Scope actually covered** (read line-by-line, on a fresh clone of origin/main
at `a660c64`): `src/Game.ts`, `src/world/World.ts`, `src/world/Collision.ts`,
`src/entities/Player.ts`, `src/entities/npc/wanderDriver.ts`,
`src/entities/npc/driver.ts`, targeted reads of `src/world/FacePaintStall.ts`,
`src/ui/CharacterCreation.ts`, `src/ui/characterCreationPreview.ts`, and all
six docs. `tsc --noEmit` is clean on main. **Cut short by the 1pm pause — see
"Not reached" at the end before trusting any silence about other files.**

**Fixed since review 1:** nothing verified yet — review 1's S1/S2/S5/S14 were
delegated the same hour and had not landed when this was written. Review 3
should check them off explicitly.

### 1. Correctness risks

**C1 (P1) — the face-paint walk has no timeout and no stuck detection.**
`wanderDriver.ts:809-827`: the `walking` phase of `driveFacePaintVisit`
steers straight at the stall with none of the protections the train walk
has (`WALK_TIMEOUT` at :558, `steerTowards` stuck-sidestep at :646-669).
There is no equivalent of `LEG_TIMEOUT` either — `legElapsed` is not ticked
in paint mode. A child wedged behind a bush en route pushes at it **forever**.
Worse, a stuck child holds one of the four `MAX_CONCURRENT_PAINTED` visit
slots forever (`paintedOrVisitingCount()` counts `paintVisit !== 'none'`,
:175-181), so one wedged child quietly throttles the whole feature. This is
exactly the bug class Decision 2's shared helpers would have prevented: the
block was copy-adapted from the train block and the safety rails were the
part that got dropped. In play: an NPC marching on the spot into scenery near
the stall, indefinitely. Confirm by watching the stall area for ~5 minutes,
or by temporarily logging `paintVisit` states.

**C2 (P2) — painted-face decals detach during train trips and climbs.**
The decal position registry (`faceX`/`faceZ`, `wanderDriver.ts:779-780`) is
only updated inside `driveFacePaintVisit`, which never runs while a climb
owns the frame (early return at :324-327) or while the train block owns it
(return at :334). A painted child who boards the train leaves their floating
paint decal hovering at the platform for the whole ride; same while up a
tree. Fix is one line: move the `faceX/faceZ` bookkeeping to the top of
`update()`.

**C3 (P2, cosmetic) — cross-block state leaks between activities.**
`reactToPlayer` (:329) still runs during train trips, so a copied hop sets
`hopRequest = true` (:407) — but the consumer (:385-389) is skipped while the
trip owns the frame, so the hop fires *after* the child leaves the train,
long after the player hopped. Similarly the `waveAmount` blend (:379) freezes
mid-wave when a trip starts (arm snaps down because the body clears the
intent) and snaps briefly back up on rejoin. Two agents' assumptions
colliding: the social block assumes it always runs; the trip block assumes it
owns everything.

**C4 (P1) — FacePaintStall breaks the NpcSystem-last build rule**
(= review 1's S3, independently confirmed with one addition). The stall
registers four walls (`FacePaintStall.ts:598-601`) but is constructed after
`NpcSystem` (`World.ts:129` vs :116), so waypoint edges crossing it survived
validation. The addition: the comment at `World.ts:123-128` **actively
asserts the order doesn't matter** — it reasons only about the module-level
target registry and misses the collision consequence entirely. When fixing,
fix the comment too, or the next agent will "simplify" it back.

**C5 (P2) — `World.dispose()` is incomplete.** `World.ts:237-246` disposes
fountain, fairyLights, lampPosts, stalls, facePaintStall, train, flowers,
dodgems — but not garden, scenery, building, anchorPlots, npcs or dayNight.
Harmless today (the game is never torn down in production) but a trap for
anything that ever rebuilds a World (tests, a future "new game").

**C6 (P2) — the intent contract documents the opposite of what happens.**
`driver.ts:76-77`: "Implementations must write **every** field … stale values
would leak". In fact `NpcCharacter.ts:147` calls `clearIntent()` before every
`driver.update()`, so drivers only need to write what they own. Both were
written by different agents; the doc is the wrong one. Correct the doc — a
future driver author following it will write dead code (and the train block's
`intent.wave = 0` at :602 already is dead).

**C7 (watch, not a bug) — skin tone / eye colour is doc-only on main.**
Commit `f258c92` ("Record skin tone, eye colour…") changed **GAME_DESIGN.md
only**. On main, `CharacterCreation.ts:376` and `Player.ts:173` still
hardcode `PALETTE.skin`, and `PlayerState` has no skin/eye fields. The
in-flight skintone branch must touch `Player.ts:171-183`,
`CharacterCreation.ts`, `state/types.ts` and `characterCreationPreview.ts`
together — a classic multi-file merge-collision candidate. Whoever merges it:
verify the chosen tone actually reaches the in-park model, not just the
preview.

Also noted, nano: `Game.ts:425-426` double-handles the paused case
(`scaled` already equals `tick.dt` when paused); redundant, not wrong.

### 2. Architectural drift

- **ARCHITECTURE.md's module map is fiction now.** "entities/ — things that
  move — currently just the Player" (line 32) predates NPCs, the parade, worn
  items; the world table omits train, stalls, flowers, lamp posts, the face
  paint stall; ui/ is ~20 files, not "HUD and the name label". Either update
  it or cut it down to folder-level pointers that can't rot.
- **The frame-order doc omits three real steps.** ARCHITECTURE.md:38-47 vs
  `Game.tick()` (:363-448): mini-games update *before* the player on the
  loop's real dt (:415), `tapNavigator.update` runs between input and player
  and must (:432-437), and the whole park render is skipped when
  `hidesPark` (:472). All three are load-bearing and all three are
  undocumented outside code comments.
- **The draw-call budget paragraph is stale.** ARCHITECTURE.md:184-187 claims
  355–430 at default zoom; QA measured 517 under contention. The paragraph
  now misleads anyone budgeting a new feature. Re-baseline it (full
  performance census was still in flight when this review was cut off).
- **The two docs disagree about the scale reference.** ARCHITECTURE.md:264
  and ASSET_MANIFEST.md both say the kid is **1.86 m** and call it *the*
  scale reference; ART_DIRECTION.md:132 says the cartoon pass made her
  **2.12 m**. Pick one number and fix the other two files.
- **Player.ts:82-84** still says movement is camera-relative "whichever of
  the four isometric views is active" — the four views died with the camera
  rotation (GAME_DESIGN #16).
- **ARCHITECTURE-DECISIONS.md Decision 2 has rotted in a dangerous way**: its
  "correction" boldly states there is no tree-climbing block. There is now
  (`wanderDriver.ts:61-96, 686-760`), and an NPC-chat block is landing. Add a
  dated addendum to the decision rather than leaving a confident false claim
  in the file that wins conflicts.
- ARCHITECTURE.md's known follow-up "the children stay in the garden…
  letting an NPC ride [a ride] means generalising those hooks" is half-stale:
  NPCs ride the train now, via `TrainService`, which is itself the
  generalisation the note asked for. Update it to point at the pattern.

### 3. The wanderDriver question — Decision 2 restated, now urgent

The file is 896 lines: a ~470-line wander core plus **three** bolted
activity blocks (train :476-684, tree-climb :61-96/:224-233/:686-760,
face-paint :98-181/:235-248/:763-849), with NPC chat about to be the fourth.
Decision 2 recommended extracting a minimal `Activity` abstraction when it
believed there were only two blocks. **With fresh eyes: the call was right,
and the file now contains the evidence.** Every block re-implements the same
four things — an eligibility gate (cooldown + seeded chance), an off-graph
walk, a hold-the-frame state machine, and a rejoin-the-graph exit — and they
have already diverged where they should be identical:

- the train's rejoin (:613-620) resets `current`, `previous` **and**
  `target`; the paint rejoin (:842-847) resets only `current`/`previous`;
  the climb's (`endClimb`, :752-760) resets nothing because position didn't
  change. Three exit dances, two of them subtly different for no reason.
- the train walk has timeout + stuck-sidestep; the paint walk has neither —
  that is finding C1, and it is a *consequence* of copy-adaption.
- the climb block is the odd shape: it claims the frame at the top of
  `update()` (:324) *and* claims the arrival moment inside `arrive()`
  (:450), which the other two don't need.

**Restated ruling:** extract `Activity` now, with one refinement over
Decision 2's shape to accommodate what the climb block proved:

```ts
interface Activity {
  /** True = I own this frame; core skips wandering AND the social tail. */
  update(context: DriverContext, intent: CharacterIntent): boolean;
  /** Optional: claim the moment of arriving at a waypoint (the climb). */
  onArrive?(context: DriverContext): boolean;
}
```

Activities tried in fixed order (climb, train, chat, paint); first taker
wins; shared helpers extracted **once**: `steerTowards` + stuck-sidestep,
`rejoinGraph` (the train's version, with the `target` reset, as canonical),
and an `offGraphErrand` walk that bakes the timeout in so it cannot be
forgotten again. Module-level registries (`trainService`,
`facePaintStallTarget`, `wanderDrivers`) move with their blocks unchanged.

**Migration cost at four blocks:** ~500 lines moved (train ~200, climb ~150,
paint ~150) into `src/entities/npc/activities/`, zero intended behaviour
change, verifiable by seeded-determinism trace as Decision 2 said. Cost has
roughly doubled since the two-block estimate and will grow with every block
added — the queue system (Decision 2 §3) is next and **must not** be a fifth
hand-bolted block. **Sequencing matters:** the NPC-chat PR is in flight in
this same file. Land chat first as a fifth… fourth bolted block (cheaper
than rebasing it mid-refactor), then extract all four in one move, then fix
C1/C2/C3 as a follow-up inside the new structure. Two PRs, one owner, no
parallelism inside `wanderDriver.ts`.

### 4. Performance (partial — full census was still in flight)

From the files actually read:

- `paintedNpcFaces()` (`wanderDriver.ts:153-161`) allocates a fresh array and
  objects; if `FacePaintStall.update` calls it per frame that is per-frame
  garbage scaling with painted NPCs. Confirm caller frequency.
- `World.interactZones()` (:189-197) spreads five arrays into a new one on
  every call, and `ActionButton` rebuilds the zone list **every frame** by
  design (`Game.ts:219-231`), with `TapNavigator` doing the same on every
  tap through a second, duplicated closure (`Game.ts:124-127`). Cheap-ish
  today; worth one shared, mostly-cached provider when anyone is in there.
- `CollisionWorld.resolve` is O(all colliders) × 2 passes × every mover ×
  every frame, no spatial partition (`Collision.ts:246-317`). Fine at current
  counts, but Decision 2 plans NPC_COUNT 12 → 18 and the collider count is
  climbing (see the debug HUD). Watch item, not action item.
- The stale 355–430 draw-call budget vs QA's 517 is in §2; do not re-tune
  against the doc number.

### 4a. Performance census (audit landed just before the pause)

The dispatched performance audit returned in full. Highlights, severity first:

**Texture budget is blown ~2× at boot, ~4× in play.** Estimate: **~73
distinct canvas textures at boot, 120–160 after normal play**, against the
40 budget (ART_DIRECTION.md:282). The driver is `paintExpressions`
(`faces.ts:359-367`) unconditionally painting **five** canvases per call:
player kid (5×512²), the crowd prototype kid (5×512², only 3 used —
`kidCrowd.ts:78`), a **second throwaway blue-eyed prototype kid**
(`kidCrowd.ts:170`, another 5×512²), pet blobs per-instance
(`petBlob.ts:95` — the one face not routed through `sharedFacePatch`, which
`sharedFace.ts` exists to prevent), the locomotive, the stall painter. Plus
15 sign textures and **13 uncached name-label canvases**. Cheapest wins:
lazy expression painting (≈14 canvases), `petBlob` → `sharedFacePatch` (−5),
reuse one prototype for the blue-eye capture (−5).

**Two concrete leaks:**
- `characterCreationPreview.ts:118-134` rebuilds the kid on every chooser
  click and `disposeTree` (`materials.ts:192-200`) **never disposes
  `material.map`** — 5 × 512² canvases leaked per click, ~100 MB in twenty
  clicks on a phone.
- `Entrance.ts:197` keys the welcome sign texture by park name
  (`textures.ts:252`), so every rename permanently adds a 512×288 entry.

**Draw calls: ~250 of the growth past the old 430 budget is accounted for**
(train +89, face-paint stall +100, stations/track +40, lamps +18), and QA's
517 is consistent with a stall or two plus the train in shot. **Roughly
350–400 calls are removable**, mostly by two mechanical passes:
- `castShadow = false` on decoration: `stallProp.ts` has **~34 decoration
  casters per stall ×5** (`:116,:164,:170,:241`…), plus `FacePaintStall.ts`
  pots/dabs/scallops, `Scenery.ts:596/:603` fence posts/caps,
  `track.ts:139` (two 325 m rail tubes in the shadow pass for a 5 cm rail!),
  and `FoliageFade.ts:115` — a *transparent* fade-ghost tree casting a solid
  shadow. Root cause: `solid()` (`materials.ts:172`) defaults casting ON, so
  every decorative `solid(...)` opts in by accident.
- Instancing the obvious repeats: stall props (74 → ~25 meshes each), train
  body merge + wheel instancing (78 → ~20), FairyLights poles/knobs/cables
  (51 → ~5 calls; `FairyLights.ts:51-103`), wooden-wall posts/caps the way
  the stone walls already do (`Scenery.ts:591-604` vs the pattern at :698).

**Per-frame allocation confirmed** (my §4 suspicion): `paintedNpcFaces()`
is called every frame unconditionally from `FacePaintStall.ts:323` — 60
arrays + up to 240 object literals/sec for a fixed pool of 4 decals. Fill a
preallocated 4-slot array or iterate the driver set directly. Also
`LampPosts.ts:212-213` allocates two small arrays per frame. Otherwise the
frame path is genuinely clean — 88 update methods, zero THREE-object
allocations — and worth saying so.

**Dead code:** `createCatBus()` (`catBus.ts:70`, ~50 meshes + its own face
canvas) is never called — only `buildPawPrint` is imported. GAME_DESIGN #30b
(arrive by cat bus) presumably still wants it; either wire it (instanced,
per the numbers above) or note it as parked.

Also flagged: the crowd face part carries 6 material variants of which 3
exist solely for Ethan's blue eyes and draw every frame
(`kidCrowd.ts:90`), and all 27 crowd meshes are `frustumCulled = false`
(`InstancedCrowd.ts:128` — deliberate per ARCHITECTURE.md:432, but it is
why the crowd is a constant 30 calls).

### 5. What the docs should say and don't

Concrete additions for ARCHITECTURE.md (one small PR):

1. **A "merge hazards" section**, verbatim suggestion: *"Most damage in this
   tree has come from conflict resolution, not from first-draft code. Naive
   'keep both sides' resolution has produced duplicated logic blocks, a class
   boundary in the wrong place, and a @keyframes nested inside a rule. When
   resolving: use a genuine three-way merge against the common ancestor
   (`git merge-file` / your tool's base pane), never concatenation. After
   resolving any conflict in a class file, re-read the class for duplicate
   members and doubled blocks; after CSS conflicts, lint the file. Build
   passing is not evidence the merge is right — duplicated logic type-checks."*
2. **The build-order invariant, named**: anything that registers collision
   must be constructed before `NpcSystem`; the graph validator only sees
   colliders that exist. (C4/S3 is what happens otherwise.)
3. **The off-graph errand rule**: any NPC walk that leaves the waypoint graph
   MUST carry a timeout and stuck detection; name the shared helper once the
   Activity extraction lands, and forbid new bolted blocks in
   `wanderDriver.ts` outright.
4. **The sanctioned decoupling pattern**: module-level singleton registries
   (`trainService()`, `registerFacePaintStall`) are the house style for
   "world feature talks to NPC behaviour without threading fields through
   NpcSystem" — document it *with* its caveat (registry order is flexible;
   collision order is not).
5. **Correct the intent contract** in `driver.ts` (C6) and reflect it here:
   the body clears the intent; drivers fill what they own.
6. **Fix the frame-order list and the module map** (§2), and reconcile the
   1.86 m / 2.12 m scale reference across the three docs.

### 6. Prioritised actions (PR-sized, parallel-safe)

Group A — `wanderDriver.ts` and satellites (ONE owner, serial):
- **A1 (P1)** Land the in-flight NPC-chat block; then extract `Activity` +
  shared helpers per §3. Owns `src/entities/npc/wanderDriver.ts`,
  `src/entities/npc/activities/*` (new). No behaviour change.
- **A2 (P1)** Fix C1 (paint walk timeout/stuck via the shared helper), C2
  (head-tracking to top of `update()`), C3 (social state vs activities).
  Same files, immediately after A1.

Group B — `World.ts` only:
- **B1 (P1)** Move `FacePaintStall` construction above `NpcSystem`; rewrite
  the misleading comment (C4/S3). One-file PR, safe alongside Group A.
- **B2 (P2)** Complete `World.dispose()` (C5). Can ride with B1.

Group C — docs only, fully parallel with A and B:
- **C1d (P1)** ARCHITECTURE.md additions per §5 + Decision 2 dated addendum
  + budget/scale-reference corrections. Owns the four .md files, no code.

Group D — small code hygiene, parallel with all above (disjoint files):
- **D1 (P2)** `driver.ts` doc fix + delete dead `intent.wave = 0`
  (:602). Owns `src/entities/npc/driver.ts` + one line of `wanderDriver.ts`
  — fold into A2 if contention appears.
- **D2 (P2)** Shared interact-zone provider for `Game.ts`'s two duplicated
  closures. Owns `src/Game.ts`. Low value; do last.

Group E — performance (from §4a; each parallel-safe, disjoint files):
- **E1 (P0)** Fix the character-creation texture leak: `disposeTree` must
  dispose `material.map` (`src/art/style/materials.ts:192-200`), and the
  preview should restyle in place rather than rebuild per click
  (`src/ui/characterCreationPreview.ts:118-134`). Phones OOM on this one.
- **E2 (P1)** Shadow-caster pass: decoration to `castShadow = false` in
  `src/minigames/stallProp.ts`, `src/world/FacePaintStall.ts`,
  `src/world/Scenery.ts` (fence posts/caps), `src/world/train/track.ts:139`,
  `src/world/FoliageFade.ts:115`; consider flipping `solid()`'s default or
  adding a `solidNoCast()`. Biggest single draw-call win, ~150+ calls.
- **E3 (P1)** Texture budget: lazy `paintExpressions`, `petBlob` →
  `sharedFacePatch`, single prototype in `kidCrowd.ts:170`, cache name-label
  canvases, un-key the welcome sign from the park name
  (`src/world/entrance/Entrance.ts:197`). Owns `src/art/style/*`,
  `src/entities/npc/petBlob.ts`, `src/entities/npc/kidCrowd.ts`,
  `src/ui/NameLabel.ts`, `src/world/entrance/Entrance.ts`.
- **E4 (P2)** Instancing: stall props, train wheels, FairyLights poles,
  wooden-wall posts (match the stone-wall pattern already in `Scenery.ts`).
- **E5 (P2)** `paintedNpcFaces()` allocation-free (`wanderDriver.ts:153` +
  `FacePaintStall.ts:323`) — fold into Group A to avoid file contention.

### Not reached — the next review MUST start here

Cut off by the 1pm pause. **No conclusions — not even "probably fine" — should
be inferred about:**

- `src/minigames/**` (audit was dispatched, results not yet returned)
- `src/style.css` — the whole 2,442 lines (known prior CSS merge damage
  makes this a priority; an audit was dispatched, results not yet returned)
- `src/ui/**`, `src/entities/parade/**`, and the NPC support files
  (`NpcSystem`, `InstancedCrowd`, `kidCrowd`, `poiGraph`, `petBlob`) beyond
  the targeted greps noted above (audit dispatched, not returned)
- `src/world/` non-building files: `train/*`, `TreeClimbing.ts`,
  `FacePaintStall.ts` (full read), `entrance/*`, `Flowers.ts`, `Sky.ts`,
  `DayNight.ts`, `Scenery.ts`
- Runtime verification of anything — this review is static reading only.

Four audit subagents were in flight when this was written; if their reports
surface after the pause, fold them into Review 3 rather than trusting this
section's silence.

---

## Queued investigation — GC pauses (27 July 2026, recorded during the pause)

**Reported by the family from play: the game has fairly frequent GC pauses.**
That is a felt, user-visible problem — a stutter in a game a six-year-old is
walking around in — not a theoretical one.

**Assign to a Fable-level agent** for the investigation, because finding
*which* allocations matter needs judgement: profile a real play-through with
the browser's performance and memory tools (allocation sampling, allocation
timeline, GC markers on the timeline), covering the garden, the castle
interior, the parade, the NPC crowd, and at least one mini-game. Static
analysis is a legitimate shortcut wherever a per-frame allocation is obvious
from the code — take it where it is easy and profile where it is not. Then
**hand the individual fixes to cheaper agents**, one PR-sized chunk each.

Known suspects already found by earlier audits — start here, they are free:

- `Escalators.placeSteps` allocates a `Matrix4`, a `Quaternion` and two
  `Vector3`s **per escalator per frame** — 16 objects/frame, ~960/second,
  and it runs even while the player is 890 m away in the garden because
  `Building.update` never gates the interior machinery on `inside`.
- `ballPhysics` returns a fresh stats object every frame, consumed by a
  field nothing reads.
- `BallPit` allocates a fresh `PlayerContact` literal every frame the player
  is near the pit.
- `fitouts.ts` allocates a closure per frame per visible shop (two
  `forEach`es).
- ~~`BalloonString.rebuildGeometry` allocates a fresh `CatmullRomCurve3` **and**
  a fresh `TubeGeometry` per held balloon per frame — twelve geometry objects a
  frame plus their vertex buffers for a bouquet of six, and a `dispose()` on
  each discarded one.~~ **Fixed** (28 July): it now draws pre-built capsules and
  writes a `position`/`quaternion`/scale onto each, which is what
  `art/models/ponytail.ts` already did for the identical problem. Worth noting
  *how* it was found: not by profiling, but by an agent reading the file while
  building the ponytail, and then writing the divergence down in a comment
  rather than fixing it. The comment is what made this a one-line search.
- The character-creation preview's `disposeTree` never disposes
  `material.map` — a genuine leak, already flagged P0 in Review 2.

Do not assume that list is complete; it came from auditing one folder plus a
partial core-loop read. `src/minigames/**`, `src/ui/**`,
`src/entities/parade/**` and the non-building world files have never been
audited at all.

**Deferred until 19:00**, and no time is lost by that: runtime profiling
needs a working browser, and the shared browser profile has been locked all
session. A Claude Code restart clears it.

---

## Review 3 — the control/camera churn (27 July 2026, 21:50)

Reviewed the hour's highest-churn area: `screenBasis` and the three systems
that adopted it, plus the highlight system that landed alongside.

**What is genuinely good, and worth not undoing.** The asset contract holds:
`Highlights` never touches `root.scale` or `body.scale` — outline shells are
separate meshes carrying a copy of the target's world matrix. No per-frame
allocation: scratch `Matrix4`/`Vector3` are fields, three outline slots are
allocated at construction. The TEXT/UI-SCALE rule is now machine-enforced —
`scripts/check-text-sizes.mjs` runs as the first build step and passes on
main. The HIGHLIGHT rule is enforced *by construction*: a zone that supplies
no highlight target still gets a ring sized from its own `pickRadius`, so
registering a tap target is registering a highlight and no call site can
forget. That is the right shape for an absolute rule.

**F1 — `WaterFight` hard-codes the park's camera pitch and claims it matches
(actionable).** `src/minigames/waterFight/WaterFight.ts:108` reads:

    /** Camera pitch, matching the park's `CAMERA_PITCH_DEGREES`. */
    const CAMERA_PITCH = 38 * DEG;

The file imports nothing from `core/constants.ts`. `CAMERA_PITCH_DEGREES` is
38 today, so the comment is true *today* — and stays written down as true
after someone changes the constant, at which point the water fight silently
keeps a pitch the rest of the game has left behind. Import the constant.

This is the **same defect class** the peer review caught in `screenBasis.ts`
an hour ago (a comment asserting an invariant the code does not guarantee),
which suggests it is a habit in this codebase rather than one slip. A comment
that says "matching X" without importing X is a claim with no mechanism.

**F2 — the eye-offset formula is duplicated (actionable, small).**
`IsoCamera`'s constructor and `WaterFight.applyCamera` both compute
`(sin(yaw)·h, sin(pitch)·d, cos(yaw)·h)` with `h = cos(pitch)·d`. The
`screenBasis` extraction unified the *ground basis* derivation but left the
*camera placement* in two places. The water fight is the one camera in the
game whose yaw moves, so it cannot simply use `IsoCamera` — but the offset
formula itself should be one exported function taking a yaw.

**Not a finding:** `railRacer` and `spookyHouse` do not import `screenBasis`.
Verified they have no lateral or directional control, so there is nothing for
a basis to interpret. `Dodgems` deliberately uses its own pitch (0.74 rad)
and distance — a different camera on purpose, not drift.

---

## Review 4 — the navigation lattice (27 July 2026, 22:40)

Reviewed `src/world/NavGrid.ts`, the one substantial file added this hour.

**Every architectural claim in the PR verifies.** Checked rather than taken on
trust:

- **No per-frame allocation.** Zero `new` outside construction and rebuild;
  all working sets are typed-array fields, and the rebuild's reallocation is
  guarded by `if (this.blocked.length !== total)`, so a same-sized space
  reuses its arrays.
- **No assumption of one continuous interior.** It reads
  `collision.playBoundsX/Z/Radius` rather than any interior origin, so
  Decision 3's far-apart per-floor origins are just "the bounds moved".
- **`autoHopClears` is a real consolidation, not a fourth copy.** One
  definition in `Collision.ts:74`, consumed by `resolve` (3 sites) and by the
  lattice builder (2 sites), fed by the single `JUMP_APEX_HEIGHT`.
- **The staleness invariant is enforced, not asserted.** `revisionCounter` is
  private behind a getter and bumped by the mutators; `ensureLattice` compares
  against it. This is the correct answer to Review 3's complaint about
  comments claiming what code does not guarantee — and notably it was written
  *in response* to that complaint, so the habit is correctable.

**F3 — one lattice is cached, and Decision 3 will thrash it (actionable, not
yet a bug).** `ensureLattice` keeps exactly one lattice, keyed on centre,
radius, revision and reference height. Today the park is one space, so it is
built once and reused — hence the measured 3.3 ms first route and 1.13 ms
after.

Under Decision 3 each castle floor becomes its own space at its own origin,
so **every floor transition invalidates the cache and re-pays the full
stamp** — the PR measured 6.8–10.1 ms for that. Every stairway, every lift
ride, in both directions. It is hidden behind the 0.42 s iris so it will not
be seen, but it is a guaranteed hitch on a device with less headroom than
this one, and floors of differing size also churn roughly 1.3 MB of typed
arrays each way, against a project with a standing GC-pause complaint.

Fix is small and belongs to whoever implements Decision 3, not to this PR:
key a small cache by space id and keep one lattice per floor. Five spaces at
~1.3 MB is affordable; rebuilding on every staircase is not.

---

## Review 5 — the save/UI hour (27 July 2026, 23:40)

Ten files landed this hour across save/continue, the update gate, the wording
switch and the HUD menu. Checked, and clean:

- **The TEXT/UI-SCALE rule is machine-enforced and passing.**
  `scripts/check-text-sizes.mjs` runs first in the build; main is green.
- **The HIGHLIGHT rule held with no code.** Grepped the new UI modules
  (`UpdateGate`, `LiftPanel`, `ContinueOrRestart`, `ShopPanel`,
  `InventoryDrawer`) for hand-rolled outlines: none. Every new control is a
  plain `<button>` and inherits the rainbow, cursor and tap flash from the one
  global rule. That is the design working — three separate agents built UI
  tonight and none of them had to think about it.
- **`wording.ts` is keyed on `moneyIsFinite`, not on a mode name.** The right
  axis: Mayhem is the reason, but affordability is the fact the copy depends
  on, and a future mode with infinite money gets correct wording free.

**F4 — two modules will be called `spaces.ts` (actionable, naming only).**
`src/world/spaces.ts` landed this hour, owning the save file's *vocabulary of
places*: a `SpaceId` and `localToWorld`, so a saved position is a space id plus
a local offset rather than a raw world coordinate that Decision 3 would
silently invalidate. That reasoning is correct and the file documents its own
intended failure mode.

But Decision 3 specifies **`src/world/building/spaces.ts`** holding a
`SpaceManager` — the *runtime authority* on which space the player is in.
Both will exist at once, in adjacent directories, sharing the word "space" for
two different jobs: one is a persistence-facing name table, the other is live
state. An `import ... from './spaces'` in `world/building/` will resolve to the
wrong one silently, and the S1 implementer is being asked to write the second
while the first already exists.

Cheap fixes, either is fine, but pick one **before S1 starts**: rename the
save-facing module to something that says what it is (`savedPlaces.ts`), or
name Decision 3's authority `SpaceManager.ts` after its export. When
`SpaceManager` lands, the save table should also **derive its origins from it**
rather than keeping a second copy of the same coordinates — that is the
duplication that would actually bite, as opposed to the filename, which merely
confuses.

---

## Review 6 — the pet sizer, and a contract that was never enforced (28 July, 00:40)

**F5 — `sizeToStandard` measured the wrong thing, for weeks (fixed in #72).**
Every recipe pet passed the same hand-written `0.52` as its natural height —
but `0.52` was the top of the **skull**, not the top of the creature. Ears sat
above it, were excluded from the sum, and were then scaled up along with
everything else. Measured: bunny **2.12 m** (as tall as the player), mouse
1.80, kitten 1.71, against a `PET_RENDER_HEIGHT` of 1.46.

This matters beyond the bug. The family asked in plain words for pets to be
normalised — *"ripika is the correct size, make them all match that size"* —
and the code contained a function called `sizeToStandard` that appeared to do
exactly that. It reported success and delivered a rabbit a third taller than
the target. Nobody caught it because **nothing measured the finished object**;
the natural height was an author-supplied number, trusted.

The fix closes it from a `Box3` of the finished creature. All four now measure
exactly 1.460.

**The lesson generalises, and it is the third time tonight.** Review 3 found a
comment asserting a camera pitch it did not import. Review 4 found an
invariant enforced by a revision counter *because* Review 3 complained. This
is the same family: **a number an author writes down is a claim; a number
derived from the built object is a fact.** The asset contract in
ARCHITECTURE.md says "1 unit = 1 m, origin at feet" — but nothing checks it.
Any model whose author mistypes its height is silently wrong, and the failure
is visual, gradual, and easy to explain away as art.

Queued: a boot-time (or test-time) assertion that every asset's declared
`height` matches its measured bounds. Cheap, and it retires the class.

**F6 — the portrait strip was ~60 canvases against a ~40 budget** (fixed in
#77). Five expressions *per character* plus five composited canvases *per
character*, for a six-child water fight, with the dodgems about to want their
own set. Now painted once, cached, shared as data URLs, with skin and hair as
a CSS gradient — five canvases total. Worth recording because the budget in
ART_DIRECTION.md is a guideline nothing enforces, and this was found only
because someone went looking while doing unrelated work.

---

## Review 7 — the verification scripts (28 July, 01:40)

The night produced an unusual amount of *checking* code, and it is worth
reviewing that as an area in its own right, because it is now load-bearing:
three of tonight's bugs were found by measurement rather than by reading, and
two fixes were only trusted because a script proved them.

**Clean, and working.** `npm run build` runs `check:text` then `tsc` then
`check:assets`. Both pass on main: no text below the minimum, 81 assets
measured, 32 carrying recorded drift with the worst at +0.077 m. The
`KNOWN_DRIFT` ratchet is doing its job — the pet entries were *removed* rather
than relaxed when they stopped drifting, which is the behaviour that keeps a
table like this honest.

**Genuine reuse, not copy-adaptation.** `ts-extension-resolver`,
`headless-canvas.mjs` and `playerSim.mts` are each shared by more than one
script. `playerSim.mts` in particular is one faithful copy of `Player.update`'s
integration used by both the hop-clearance and wall-tunnelling harnesses, and
the refactor to share it was verified byte-identical against the pre-refactor
output. That is the right instinct: two independent copies of the integration
would have drifted and quietly invalidated each other's numbers.

**F7 — four of the seven checks are orphaned, and orphaned checks rot
(actionable).** Only `check-text-sizes` and `check-asset-contract` are
referenced from `package.json`. These are not:

- `checkShopSpacing.mjs`
- `checkGondolaSightline.mjs`
- `measure-hop-clearance.mts`
- `measure-wall-tunnelling.mts`

The last two matter most. `MAX_AUTO_HOP_HEIGHT = 1.0` is justified by
measurements from `measure-hop-clearance.mts`, and the sub-step cap by
`measure-wall-tunnelling.mts` — and **both of those numbers depend on values
that change**: jump apex, sprint speed, acceleration, collider thicknesses,
`MAX_FRAME_DELTA`. There are boot asserts (`checkHoppableColliders`,
`checkSubstepBudget`) covering the specific invariants, which is good — but
nothing re-derives the underlying measurements, so the day someone retunes the
jump, the asserts still pass against a ceiling that is no longer true.

Fix is cheap: give each a `check:` script entry, and decide deliberately which
belong in `build` (fast, deterministic) versus a slower `check:all` a human or
a nightly job runs. A 350k-run sweep does not belong in every build; a
sightline check does.

*Related, and the reason this is worth doing now rather than later: the
codebase has been bitten four times tonight by a claim nobody re-derived.
An unrun script is exactly that — a measurement frozen at the moment someone
last happened to run it.*

---

## Review 8 — the merged fleet's park, as a system (5 August 2026)

Scope: **what is now on `main`** (`ff17910`) after the 4–5 August run, reviewed
as a system rather than PR by PR. Method: measured, not read — every hollowness
claim below was **proven by breaking the thing the check guards and watching it
stay green**, in a clean worktree of `origin/main` with `npm ci`. Claims I
could not test are marked as such.

### Fixed since Review 7 (28 July, 01:40) — and it is a lot

- **Decision 5 landed end to end.** `parkManifest.ts` → `parkLayout.ts` (L1
  solver) → solved train, coaster and rail-race plans → `check:park` in the
  build → `test/procgen/invariants.ts` (21 invariants × 5 seeds) blocking
  merges in CI. The generated park is real, seeded, and machine-checked.
- **Review 7's F7 is closed**: `checkShopSpacing`, `checkGondolaSightline` and
  `measure-hop-clearance` are wired into `build` (but see below — wiring them
  in did not give two of them a failure path).
- **Review 1/2's S3/C4 build-order break is fixed** — `FacePaintStall` is
  constructed before `NpcSystem` (`World.ts:161–167`), with the comment
  corrected rather than deleted.
- **Wave 3 happened**: `wanderDriver`'s bolted blocks are now
  `src/entities/npc/activities/` (`activity.ts`, `errand.ts`, `trainTrip.ts`,
  `treeClimb.ts`, `facePaintVisit.ts`, `chatToPlayer.ts`, `budget.ts`).
- **The invariants suite has institutionalised the failure lessons**: the
  `Invariant` type returns complaints so a hollow assert is a compile shape
  error; each seed file asserts the seed it actually got back (the fix for the
  silent-76-test skip); anti-vacuity floors (trees > 24, lamps/plots/exits
  > 0) guard against a park that passes by being empty; thresholds come from
  the game, not the generator; the doctrine "prove it can fail" is written at
  the top of the file. This is the best checking code in the repo.
- **The headless matrixWorld trap is fixed where it bit** —
  `coaster/clearance.ts:147–152` climbs to the topmost ancestor and refreshes
  before raycasting, and documents the bug it closes. (A latent edge remains:
  if the coaster group were ever built detached, `cruiserStrikes` would sweep
  zero targets and report a clear park. A `targets.length === 0` guard is one
  line.)
- **Two `ParkBoundary` types / two `circleBoundary`s → one of each**
  (`rail/boundary.ts`). **Two stall stand points → one**
  (`stallPlacement.ts:49`). **`BRIDGE_RISE`** is now derived and documented as
  having no counterpart (`check-park.mts:354`).
- **The dev-mode service worker is off by default** — the class of "my edits
  vanished" hours is closed at the root.

### 1. The rail generator — one coherent thing, but the three-rides story is not true on `main`

`rail/generate.ts` is genuinely one thing: brief in, curve out, pure,
synchronous, exhaustively documented, with `RouteInfluence` (Decision 7) and
the `satisfies` backstop cleanly separated. Its **only consumer is the Sky
Cruiser** (`coaster/route.ts`). The Rail Race deliberately does not use it —
its plan shape is the park perimeter by the family's 31 July brief, height
only — and the ginormous slide is still **twelve hand-authored world
coordinates** in `Building.ts` (`buildGinormousSlide`), the exact #118 failure
mode Decision 6 §1 describes as the thing that was fixed. Issues #118 and #229
(open) are the honest state.

**Decision 7 §5 states "generate.ts is shared with the ginormous slide." That
is false on `main`** — the byte-identical-when-unweighted guarantee it argues
from is real and verified across the CI seeds, but the slide sharing it is
aspiration written as fact, in the file that wins conflicts. Correct the
sentence or land #118; do not leave it.

**Plan-view-only solving is a sound boundary, with one silent chain behind
it.** The 2D search + carve-responds-to-solve pattern (Decision 6 §3) is
argued correctly and measured (20/24 crossings within 1.1 m of panel midpoint;
1/24 at window height vertically — the vertical *cannot* be searched for).
What keeps it sound is that vertical requirements stay *carves*, and carves
are few. Today there are exactly two pinned-height features (station flat,
castle window), both unliftable by the vertical repair loop, and their
interaction is already delicate (the carve order comment in `route.ts` is
load-bearing). The latent bug factory is not the 2D boundary itself but this
chain: **the repair loop exhausts its 10 passes silently** (no complaint if
deficit remains), → the boot assert that would notice can only
`console.warn` (#208), → the invariant that can fail only catches physical
*strikes* (`cruiserStrikes`), not a sagging cruise floor. A third
pinned-height feature (the slide rebuild is the obvious candidate) could make
repair unsatisfiable on some seed and nothing that can fail a build would say
so. Two cheap closures: make residual deficit after pass 10 a complaint the
procgen suite asserts, and resolve #208.

Also noted: Decision 6 §2 says budgets should be "bounded by wall clock rather
than by optimism" — `generate.ts`'s budgets are all counts (`perJoint`,
`restarts`, `STEPS_PER_START`); no wall-clock bound exists. Doc ahead of code.

### 2. Pattern sweep: checks that cannot fail — the build's green light is part theatre

The procgen suite is healthy. The **older check scripts gating `npm run
build` are not**, and I proved four hollow by experiment in this worktree:

- **`check:hop-clearance` cannot fail, structurally.** It imports
  `MAX_AUTO_HOP_HEIGHT` and `MEASURED_HOP_APEX`, prints a table, and contains
  **zero comparisons against them and zero `process.exit`/`exitCode` sites**
  (grep count: 0). It has been "wired into the build" (Review 7's ask) without
  being given a failure path — it is a printout with a green tick. Bonus: its
  `highest()` can return `NaN`, which would poison `worstClean` unnoticed —
  the exact NaN flavour this fleet keeps finding.
- **`check:shop-spacing` validates a hand-typed copy of the shop table against
  itself.** Proven: moved `HAT_X` from −22.44 to −12.44 in
  `building/layout.ts` — on top of the surprise-egg unit — and it printed
  `PASS: no counter overlaps` with exit 0. It would also silently skip any
  shop *added* to `SHOP_UNITS`. This is the S1 (P0) bug class from Review 1
  with its guard pointing at a photograph of the park instead of the park.
- **`check:statue-occlusion` measures its own copies of the four `FoliageFade`
  constants.** Proven: narrowed the game's real `SIGHTLINE_MARGIN` by 0.9 m —
  a change that genuinely alters which trees fade in play — and the check
  printed the byte-identical result and passed. The `foliageFadeTuning.ts`
  extraction that fixes this is on **unmerged PR #219**; on `main` the copies
  are live. (#226 explains *why* the copies exist: the script runs under
  `--experimental-strip-types`, which cannot import from a file whose
  constructor uses parameter properties.)
- **`check:tie-frame` compares `railFrameAt` with itself.** Its own output
  says so: "worst deviation **0.0 mm** … epsilon 50 mm". `Coaster.ts` builds
  tie matrices from `railFrameAt(route, d)`; the check recomputes
  `railFrameAt(route, d)` and measures the float round-trip. It had teeth
  against the pre-fix mutation bug it was written for; post-fix it can only
  fail if three.js breaks.
- **`check:baked-face`'s placement half measures a phantom.** It reads
  `canvas.ops` — a property the no-op headless canvas **never records**
  (single grep hit in the repo: the read itself) — so it compares zero points
  and prints "all 6 designs land within **0.0000 mm**". The half that
  raycasts real geometry is fine; the placement half is the successor of the
  tautology its own doc-comment says it replaced.
- **`check:gondola-sightline`**: same self-copy shape as shop-spacing,
  including frozen per-model `top/width/depth` — the ears-regrow bug it cites
  as its reason for existing would pass it today. (Not proven live; by
  reading.)

Supporting rot, all verified by reading: `scripts/` and `test/` are outside
`tsc --noEmit` (#197/#192 — still open), and the proof it matters is that
**`check-park.mts:485` references `LEVEL_CROSSING_REACH`, which is defined
nowhere in the repo** — a latent `ReferenceError` sitting in the
rail-crossing complaint branch, which is therefore also proof that branch has
never once fired. `check:park`'s `rail.exclusion` invariant accepts **any**
collider within 2.3 m as "the fence" (its own ratchet prose admits trestle
legs once counted); the `poi.split` hard key exists in `HARD_KEYS` and **no
code ever reports it**, so invariant 3's connected-component claim is not
actually measured. `checkCoasterClearances` (cruise floor, coaster-over-train
5.5 m, station/castle-flat separation) can only `console.warn` (#208), and in
headless runs the harness swallows even that unless `--verbose`. Minor:
its per-obstacle sweep files both obstacles under the key `'the ferris
wheel'`, so a statue clip would be reported with the wrong name.

**Verdict.** The new checking layer (invariants, `check:park`,
`check:cruiser-clearance`, `check:castle-window`) is genuinely good and is
where the lessons live. The build is also gated on four-plus scripts whose
green means nothing, and a green light that cannot go red is worse than no
light: #113 and #198 both shipped behind green builds for weeks. The
correction is small and mechanical per script: give it the comparison and the
exit code it is pretending to have, or demote it out of `build` so the green
tick stops vouching for it.

### 3. Pattern sweep: two definitions of one thing — three live drifts, and the trap still set

**Drifted now:**

- **`check:crowd` simulates the wrong child.** `trace-npc-driver.mts:63` has
  `WALK_SPEED = 1.85`; `NpcCharacter.ts:39` ships `NPC_WALK_SPEED = 2.55`.
  The build-gating trace runs 90 000 frames of leg-timeout and stuck
  behaviour on a child 27% slower than the one in the game — timeouts and
  stuck-detection are exactly the things walk speed changes. No comment marks
  it as a copy. (Cause: strip-types again — `NpcCharacter` has constructor
  parameter properties, so the import genuinely fails.)
- **The trestle-count formula is copied with a clamp difference.**
  `railRace/hazards.ts:183` clamps to ≥ 1; `railRace/track.ts:1088` does not
  — and both carry comments swearing they are the same formula. They disagree
  only for loops under 12 m, so it is latent, but the comments' guarantee is
  false as written.
- `spookyHouse/candyShower.ts:42`'s `FLOOR_Y = 0.02` "matches room.ts's floor
  top" — it matches the *rug*; the floor top is 0.0. Two centimetres,
  cosmetic, but the claim names the wrong object.

**Same today, unguarded, worth one owner each:** `GATE_RADIUS`/`GATE_ANGLE`
in `parkLayout.ts:81–82` (hand-copies of importable exports, comments
asserting the match — no cycle prevents the import; this exact instance was
on the fleet's found list and is still on `main`); `floorName` ×3
(`liftRide.ts` exports it; `Game.ts` and `ParkMap.ts` re-type it);
`CASTLE_WALL_HEIGHT` ×2 (`cruiserWindow.ts` admits "nothing asserts the two
are equal"); `playerSim.mts` restating four `Player.ts` numbers with
`AUTO_HOP_LOOKAHEAD` unguarded in both directions; `invariants.ts` re-typing
`SHORTFALL_TOLERANCE` and `TRACK_CLEARANCE` that `check-park.mts` imports
properly one directory over; the `MAX_SUBSTEPS` three-file derivation chain
(`constants.ts` → `ballPhysics.ts` → `BallPit.ts`), hand-computed at every
hop; `CuteODex.PARADEABLE` mirroring the store's rule as an untyped set; the
four character-option unions duplicated `art/` ↔ `state/` with a guard that
only fires in one direction.

**The mechanical cause has an in-repo cure nobody has standardised.** #226 is
right that strip-types is why constants get copied — but 13 of the 28 check
scripts already run `--experimental-transform-types`, which compiles
parameter properties fine. The five armed trap files (`Player.ts`,
`FoliageFade.ts`, `TapNavigator.ts`, `NpcCharacter.ts`, `NavGrid.ts` — param
properties *and* wanted constants) are only unreachable from the **strip**
half. Standardise every `check:*` on transform-types and the trap disappears
as a class; the tuning-module extraction (#219's pattern) then remains for
genuine layering reasons, not as a workaround.

### 4. `ParkBoundary` — one definition, one consumer, thirteen files of circle

The duplicate types are consolidated and the interface is well-designed
(signed distance, shape-agnostic). But it has exactly **one consumer** (the
generator), while the park's circle-ness is broadcast through ~13 files as
radius constants: `train/route.ts` bakes `WALL_INNER_RADIUS` in three places
(the exact anti-pattern `boundary.ts`'s own header names), `Scenery`,
`Garden`, `Collision` (play bounds), `railRace` (ring radii), `entrance`,
`ParkMap`, `terrain`, and the invariants. Two coaster signatures also type
their parameter as `ReturnType<typeof circleBoundary>` instead of
`ParkBoundary`, quietly re-coupling to the circle. **Nothing on `main`
regressed here — but when #115 (spline boundary, ~2× area) lands, it is a
park-wide project, not a plug-in.** Anyone scoping it from `boundary.ts`'s
optimistic header will under-estimate it by an order of magnitude.

### 5. `parkManifest.ts` — the procgen park is frozen by its own pins

Eleven of twelve entries are pinned, with 15-decimal coordinates that are
pasted solver output (the 28 July family-approved park). Only
`stall.skyCruiser` is actually solved. The stated reason is honest and real:
*"without pins, any addition re-rolled the whole arrangement, which broke
'adding an attraction is adding a line'."* The cause is structural: **one
shared `Rng` stream threads through placement in solve order**, so any
manifest edit shifts every draw after it. (The `MAX_TRIES` comment already
speaks of "per-entry streams" — a fix that was evidently considered or
partially made and is not in the code. `Scenery`'s single stream has the same
disease — the manifest's own `stall.railRacer` note documents a garden wall
moving because a *path spur got longer*.)

Distance from Jim's stated direction: on `main`, "everything is procgen and
every park unique" is true of the *machinery* and false of the *park* — it is
an authored layout with a solver attached, and pins are the new hand-tuned
coordinates. **Shortest honest path:** give each entry (and each scatter
pass) its own stream keyed by id — `new Rng(hash(PARK_SEED, entry.id))` — so
placement is stable under insertion and deletion by construction. Then the
pins can come out (a deliberate, family-approved re-roll, per Decision 5),
and "adding an attraction is adding a line" is true without freezing the
park. Until the streams are per-entry, every new attraction will be pinned in
self-defence and the manifest will quietly revert to `anchors.ts` with extra
steps. The slide (#118/#229) belongs in the manifest as a solved entry the
same way.

### 6. Boot: generation at module load — keep the purity, budget the wall

Measured in this worktree (M-series, Node, transform-types):

| seed | L1 layout | train plan | coaster plan | full headless world |
| --- | --- | --- | --- | --- |
| canonical | 14 ms | 68 ms | 35 ms | 1.24 s |
| 2 / 5 / 11 / 18 | ~13 ms | ~68 ms | 402 / 404 / 707 / 257 ms | ~1.2 s |

Across seeds 1–20 the full plan chain (layout + train + coaster + rail race +
paths) ranges 115 ms–1.49 s. **I could not reproduce the ~16 s worst-seed
figure on any CI seed or seeds 1–20**; if it was observed it belongs to a
wider sweep, a pathological seed, or a phone-class device (whose multiplier
over this laptop is plausibly 5–10×, which would put the *world build*, not
the solve, at 6–12 s). Mark that figure unverified until someone reproduces
it with a seed number.

Structurally: module-load solving is the right call *today* — it is what
makes plans importable as plain objects, keeps the Node harness byte-identical
with the browser, and the docs defend it well (`generate.ts` header). Its
real costs are: it runs before first paint with no way to show progress; it
compounds linearly as rides are added; and budget raises (the cruiser's
`restarts: 2000` was a 10× raise) push worst-case cost up with no wall-clock
cap anywhere (§1). Two proportionate moves, neither urgent: hold the line
that per-ride solve stays in the tens-to-hundreds of ms and put a wall-clock
budget in the brief (Decision 6 asks for exactly this); and if phone boot
ever hurts, the canonical park is *one committed seed* — its solved layout
can be baked at build time by the same code (`vite` already runs the solver
in `check:park`) and verified byte-identical in CI, with the runtime solver
kept for seed bumps. That is not a second definition of the park; it is the
same generator, cached, with a machine check that the cache is honest.

### 7. Docs vs code, and hygiene

- **Decision 7 §5's slide-sharing claim is false** (§1 above) — the sharpest
  doc-vs-code conflict because ARCHITECTURE-DECISIONS.md wins conflicts by
  charter.
- GAME_DESIGN §"TWO coasters" still calls the Rail Race "a second, separate
  **solver-grown** coaster"; the shipped ride is deliberately a perimeter
  ring (31 July family brief, quoted in `railRace/route.ts`). Add the dated
  correction where the older paragraph stands.
- ARCHITECTURE.md still opens with "the whole park is generated in code …
  which is why it **boots instantly**" — 1.2 s of world build on a fast
  laptop is not instant, and Review 2's stale-module-map complaint still
  stands (the file still says "entities/ — currently just the Player").
- **93 `HANDOFF-*.md` files are tracked on `main`'s root.** CLAUDE.md says
  handoffs live on the task branch. They are now permanent repo furniture —
  decide: a `handoffs/` directory, or delete on merge as policy.
- `check:wall-tunnelling` runs in no CI path (`check:all` is not run by any
  workflow) and has no failure path either — the P1 tunnelling bug it
  measures is guarded by nothing that can go red.

### Priorities

1. **Give the theatre checks their teeth or take them out of `build`**
   (§2: hop-clearance, shop-spacing, gondola-sightline, tie-frame,
   baked-face placement) and land `tsc` over `scripts/` + `test/`
   (#197/#192) — which would have caught `LEVEL_CROSSING_REACH` and the
   invariants' own claimed-but-unenforced compile guard.
2. **Fix `check:crowd`'s walk speed** (§3) and standardise `check:*` on
   `--experimental-transform-types`, closing #226's trap as a class.
3. **Per-entry RNG streams in `parkLayout`/`Scenery`** (§5), so the pins can
   come out and Decision 5 means what it says.

*Worktree used for all measurements has been removed; nothing in the shared
checkout was touched.*
