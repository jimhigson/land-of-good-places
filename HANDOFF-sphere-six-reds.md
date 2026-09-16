# HANDOFF — the six undiagnosed sphere reds (#630)

- Branch: `eng/sphere-six-reds`, rebased onto `origin/feat/sphere-combined` @ `4dc7a73b`
- Worktree: `.claude/worktrees/sphere-six-reds`
- Model: **Opus 5 (1M context)**, Engineer. No browser.
- **Every measurement below was taken by invoking the check directly**, never
  read off CI — the `check` chain aborts at step 19 (`check:npc-perch`) and
  none of these six is reached.

## Verdicts

| check | verdict | deciding measurement |
|---|---|---|
| `tie-frame` | **check** (+ small game bug) — **FIXED, green** | check read `railFrameAt(coaster.route, …)`, the **flat** route, against ties built on `drawnOnSphere(route)`; the two diverge by up to **10.07 m** at s=127. Worst deviation was **10419.0 mm**, now **0.0 mm**. `Coaster.ts` also dropped the tie `setY(mid.y - 0.12)` — world −Y — now `addScaledVector(frame.up, -0.12)`. |
| `rail-race` | **check** for 10 clauses (**FIXED**) + **game** for the rest | `onLane` hand-copied `RaceCamera.ringPoint` reading `route.base`, deleted when `baseAt(d, lane)` replaced it → `NaN`, and `NaN >= 1` is false, so **10 assertions printed `NaN%` and passed**. Now asks `rig.riderPoint`; **9 of the 10 are honestly green**. What remains is game — see below. |
| `cruiser-clearance` | **game** (check also mixes frames) | flat route vs drawn route diverge by 10.07 m; fixing the frame still leaves **6 strikes**. The loop's castle span is held at a **level** y = −37.37 while the ground falls away radially — the route is **5.22 m under the terrain at d=88** — and the castle's courtyard floor now spans y **−52.37…−33.94** across its own footprint. |
| `castle-window` | **game, same root as `cruiser-clearance`** | identical 6 strikes: `plinth`, `castle-courtyard-floor`, `castle-wall-lower` ×2, `castle-roof-deck`, `tower-roofs`. `WINDOW_SILL_Y`/`WINDOW_HEAD_Y` are fixed world `y` in a wall that now leans ~34°. |
| `keyring-view` | **game** — caught by the check's own control | `screenBasis3D` disagrees with `IsoCamera`'s rendered axes by **1.81e-1**. `IsoCamera.place()` does `camera.up.copy(this.frameUp)`; `screenBasis3D` is a pure function of yaw+pitch about world `+Y`, and `KeychainShop.ts:508` caches it as a **module constant**. The rack is framed about a camera angle the game does not render. |
| `climb-wave` | **check** for the crash, **game** underneath — check now honest, still red | `foliageFor` matched `climbableTrees` to `foliageOccluders` by (x,z) within 0.05 m; the occluders are the **drawn** canopy centres, the seeds the **flat** feet — **1.67 m apart at r=80, 2.94 m at r=176**. Fixing only that made it green at **100.0% on all 46 trees with no blocker at all** — a check that had stopped touching any foliage. Posed through the game's own `climbPose` it reads **0.0–100.0%**, and fails honestly. |

## Fixed so far (pushed)

1. **`check:tie-frame`** — drawn route + `frame.up` drop. Green at 0.0 mm.
   **Proved red both ways on this geometry** (287 ties, 286.3 m loop, flat/drawn
   divergence to 10.07 m): plumb drop → **184.5 mm** at s=77.0; reverting the
   basis to `setFromUnitVectors` (#112) → **1099.9 mm** at s=189.0.
2. **`Scenery`: a tree knows its own foot.** `FoliageOccluder` gains
   `footX`/`footZ`. This fixed **two live game bugs**: `clearTreesNear` matched a
   felled tree against `climbableTrees` by the canopy's drawn centre and so
   **never matched** — a felled tree stayed climbable — and the fell search
   probed that same slid centre against the trunk's own radius.
3. **`TreeClimbing.climbPose` leans onto the sphere**, through the same
   `placeOnSphere` `Scenery` maps every canopy with, so a child is in her own
   leaves rather than metres beside them; the wave's hoist rides in the lift
   instead of being added to world `y` afterwards.
4. **`up.ts` gains `yawForBearing`** — a flat-frame bearing turned into the yaw
   `faceOnGround` wants. `TreeClimbing` was handing `CAMERA_YAW_DEGREES`
   straight over, so the camera-facing wave turn pointed her somewhere that was
   not the camera.
5. **`check:rail-race`'s `onLane`** asks `RaceCamera.riderPoint`.

## Still open, with what each needs

- **`climb-wave`, the game half.** With the facing corrected the hand is still
  0.0% visible on the worst trees, blamed on her own `skull`/`hair.shell.crop`.
  Root: the wave was posed against a plumb child under a camera pitched 38°, and
  she now leans **34–40°** radially. This is an **art retune and therefore
  Jim's call**, not an engineering fix.
- **`rail-race`, the game half.** **The ring runs off the edge of the planet.**
  Flat ring radius **145.0–238.9 m** on a **220 m** sphere; **1590 of 8000** lane
  samples at or past r=220, where `terrainHeight` clamps to −220 — which is why
  "lowest rail is **0.00** m over the ground" saturates exactly. Also: climb by
  world `y` is 362 m (spread 7.82) against 12.8 m by altitude (spread 0.26), and
  the duck-bar/tub-floor cluster compares absolute world `y` at a cart sitting
  at y ≈ −152.
- **The castle on a sphere** — `cruiser-clearance` + `castle-window`, one root.
- **`keyring-view`** — `screenBasis3D` needs the local up; `KeychainShop`'s
  `VIEW_BASIS` must stop being a module constant.

## Re-measured at `PARK_SURFACE_SCALE = 1` (#620's `constants.ts` change)

**`src/core/constants.ts` carries an uncommitted one-line TEMP change in this
worktree** — `PARK_REFERENCE_SPHERE_RADIUS = GROUND_SPHERE_RADIUS`, which is the
only behavioural line in #620's `constants.ts` diff. It is deliberately **not
committed**: it belongs to #620 and arrives on this branch when that merges.
Re-apply it if you pick this up before #620 lands, or the figures below will not
reproduce.

The geometry, both ways:

| | scale 2.3355 | **scale 1** |
|---|---|---|
| garden play radius | 135.5 m | **58.0 m** |
| rail race ring, flat radius | 145.0–238.9 m | **62.1–112.0 m** |
| ring samples at or past the 220 m horizon | **1590 of 8000** | **0 of 8000** |
| castle radius / lean | 123 m / 34° | **47.5 m / 12.5°** |
| castle courtyard floor, world-y span across its own footprint | 18.43 m | **6.44 m** |
| coaster's worst plumb clearance over the terrain | **−5.22 m** | **+1.10 m** |
| climbable trees, lean | to 40° | **2.4–25.5°** |

Check by check at scale 1:

- **`tie-frame`** — **green**, 351 ties, worst 0.0 mm. Unchanged verdict.
- **`rail-race`** — **16 FAILs → 6**. Everything the horizon was manufacturing is
  gone: `ground` now reads an honest **7.68 m** (was a saturated `0.00`), the
  duck bar earns itself back (head top **7.33 m** standing against a 6.38 m
  underside, *strikes by 0.94*), and the whole 200.8 s / legs / AHEAD cluster
  passes. What survives is small and real: **climb spread 13.758 m** (measured in
  world `y`; 0.26 m in altitude), **ducked lowest −2.35 against a tub floor at
  −1.82**, **arm 0.027 m through the cart** (was 1.396 m), and two eye clauses
  that now miss by a hair (**0.323 against 0.35**, **−0.176 against 0.03**).
- **`cruiser-clearance` / `castle-window`** — **still red, 6 strikes**, now on
  `cruiser-window-stones`, `castle-wall-lintel`, `crenellations`,
  `castle-roof-deck`, `castle-roof-planters`, `castle-wall-lower/upper`. **The
  castle defect is not a scale artefact.** Root confirmed: `cruiserWindow.ts`
  describes the castle in a **flat axis-aligned local frame** (`world y =
  BUILDING_BASE_Y + localY`, `lx = x − BUILDING_CENTRE_X`) and the route is
  solved and the window cut in it, while the *mesh* is leant by
  `placeOnSphere` — hence a courtyard floor spanning 6.44 m of world `y`.
- **`keyring-view`** — **still red**, drift **1.81e-1 → 6.07e-2**. Not a scale
  artefact either: a flat screen basis against a camera whose `up` is the local
  up. Verdict unchanged.
- **`climb-wave`** — **still red, but far less so**: worst hand visibility
  **0.0% → 29.6%**, and **7 of 42 trees** under the 50% bar rather than most of
  46. Blame is still her own `skull`/`hair.shell.crop`, at a worst lean of 25.5°.

## Routing — do not fix twice

- **`check:npc-perch` (another agent's)** has the *same* root as `climb-wave`'s
  crash and its cure is said to be "the bearing-based matcher already merged on
  `eng/sphere-ground-claims`". My `footX`/`footZ` is a **different** cure to the
  same disease, in `Scenery.ts`. **One of the two must be dropped** — flag before
  either merges.
- **The 220 m radius is upstream of at least three of these.** `constants.ts`
  says so itself: *"Past some point the boundary wall falls below the horizon
  seen from the middle of the park."* With `GARDEN_PLAY_RADIUS = 58 × 2.3355 =
  135.5 m` and the race ring out to 238.9 m, that point is past. This is #620
  territory, not mine to settle.

## Second agent (replacement), 16 Sep — verified at scale 1

Scratch scripts `scripts/_castle.mts`, `scripts/_drawnsweep.mts`, `scripts/_cartoff.mts`
are **untracked, never commit**. `constants.ts` TEMP still uncommitted.

- **Castle (ruling 2) — done and verified.** At `8048e181`: `check:castle-window`
  exit 0 (east 3.20 m at z −0.70, west 3.28 m at z 0.60, sill 3.94, head 7.65),
  `check:cruiser-clearance` exit 0. **Controls:** castle files from `e7eb815f` →
  both red, 6 strikes each; only `route.ts` from `51c81d14` (constant window y) →
  both red, `inside castle masonry at castle-local (12.20, 9.76, −0.17)`.
  Drawn-frame sweep (each flat envelope corner through `placeOnSphere`): HEAD 0 hits,
  worst margins sill 1.586 / head 0.299 / side 0.367 m; pre-fix 12 hits.
- **Found, not fixed, not in any lane:** `Coaster.placeCart` puts the cart at the
  **flat** route point while the rails are drawn through `drawnOnSphere` — the cart
  flies up to **3.039 m** off its own rails (d=295, r=76.0, clearance 8.65).
- **npc-perch (ruling 3)** — exit 0 at scale 1, heads −0.198…0.010 (allowed
  −0.25…0.08). Control: matcher on drawn `x/z` → `tree 0 has no foliage`, exit 1.
  `check:climb-wave` already matched on `footX/footZ`.

### rail-race (ruling 4) — settled, 6 FAIL -> 5, the 5 routed to eng/rides-sphere

- **NaN**: the old copied `onLane` re-applied gives **17 FAIL, 11 NaN** — exactly the
  `eng/sphere-ground-claims` count. With `riderPoint`: 6 FAIL, 0 NaN, 0 Infinity. Whole-output
  diff = those 11 + the six-shape table + `ahead 140.0 m` (saturated) + `30/240 Hz 0.0000 m`
  (two clauses that failed OPEN). One undefined input.
- **climb spread** — check frame error, FIXED (committed): rise above `baseAt`, 0.0000 m;
  red at 0.377 m under a per-lane amplitude mutation.
- **duck through floor ×2, arm through cart** — **game**, the rider leans (`setRidePose` →
  `faceOnGround`) in a **plumb** cart (`RailRace.placeCarts` sets rotation.y/x only). Proof:
  suppress the lean in `faceOnGround` → duck 0.29 m clear, arms 0.017 m clear, all three green.
- **eye facing 0.323 / on-screen −0.176** — sphere-caused: `GROUND_SPHERE_RADIUS = 1e5` →
  whole check exit 0 (facing 0.382/0.454). Leaning only the check's kid as the game leans the
  player makes it *worse* (0.157 / −0.358) — needs the rig leant too.
- **All five are the cure already written on `eng/rides-sphere`** (unmerged, no PR, idle 2 days):
  `rideFrame` leans both carts (Coaster + RailRace) and the race rig; its own handoff lists the
  same six remaining. **Do not fix twice** — Overseer to route.

### climb-wave (ruling 5) — the 29.6% was the instrument

- The check viewed a leant child down a **plumb** camera (`VIEW_DIR = −cameraOffset`, world
  constant). The game's `IsoCamera` rotates the offset by the local up (`eyeForFocus`). Committed:
  view per pose from `eyeForFocus`. Result: **hand 100.0% on 41/41**. Instrument control at
  `GROUND_SPHERE_RADIUS = 1e5`: hand 100% 42/42, body 13–60 px, exit 0.
- **No arm swing-out was needed or tried** — the population split (≥50%: 36, <50%: 5 at
  29.6–35.3%) was a plumb-camera artefact.
- **Consequence for the game:** in the frame she and the rig share, the camera sits at local yaw
  `CAMERA_FACING`. `yawForBearing` (predecessor's `TreeClimbing` change) was validated against the
  plumb camera. A (yawForBearing) and B (CAMERA_FACING) give identical hand/body numbers at scale 1,
  so it is not decided by this check; the aim clause measures a plumb kid at the origin. **Open.**
- **New red:** body 0 px at tree 0 @270°, 1 px tree 13 @90°, 8 px tree 34 @0° (needs 12), in both A
  and B. Suspect: `canopyMeshes` stands in each blob with `position`/`scale` only; drawn instances
  may carry the sphere lean in their matrix (`makeInstanced`) — compare against `getMatrixAt`.
  Undiagnosed.

### Round 3 (Overseer rulings) — done
- **Wave facing decided by measurement:** aim clause poses real child on 41 trees x 4 under
  `eyeForFocus`. CAMERA_FACING 0.00°/7.52°; yawForBearing 1.43°/9.03°. `waveFacingYaw` in
  TreeClimbing owns it; `yawForBearing` deleted (no callers). Aim bar 1.5° → 0.5°, proved red.
- **Body clause:** two causes. (a) check's canopy stand-ins at flat `part.position` (1.959 m off
  drawn; fixed). (b) **game**: `climbPose` perch height referenced to ground at her edge column,
  not the tree foot — sank 0.37 m uphill. Fixed. climb-wave exit 0 (body 14 px).
  Pre-existing blind spot: body at 225–240° reads 10 px on flat control too; check samples 4 approaches.
- **npc-perch #642 converted here** (my perch fix made the world-y clause red): both sides along
  the tree's up. Exit 0; red both ways with --mutate.
- Next: keyring-view, then full check + test:procgen, then PR.

### Round 4
- keyring-view FIXED: `screenBasis3DAt` in up.ts beside eyeForFocus; shop `viewBasis` per stall.
  analytic 1.1e-16, shop 4.3e-4 (allowed 5.4e-3), flat 6.1e-2. Red both ways.
- Castle drawn car (from 166bb210, drawn-car parts only) + pre-filters on drawn loop +
  `castleDeckClearanceAt` (window solved for the DRAWN car) + openings/check on drawn route.
  Both castle checks green; margins sill 1.443 head 0.442 side 0.789. Probe control proves drawn vs flat.
- **Rebase plan:** #620 merged into base (drop TEMP line). **#647 owns railRace/camera.ts and
  check-rail-race.mts** — on rebase take base's side of both entirely (drop a4d957b3's and
  0c031a07's hunks there). npc-perch conflicts with #620's bearing matcher: ruling is footX/footZ
  is the one owner; keep #620's claimedBy guard, keep my along-tree-up height conversion.
- Needs a browser (not owned): the frames of the cruiser under the window / column in path.

### Round 5 — PR #650 open, RED on seed 24 (router bug, routed by Overseer)
- Rebased onto 585d7709; npc-perch conflict resolved (footX + #620 claim guard + #620 drop-along-head-up).
- seed 24 build fails: bisect → "castle window height is a plane"; sites 3→2, route 11 seg (25.0,−26.7)→(24.3,−27.7) crosses rail near railD 34. Router lane owns it. Do NOT dig.
- procgen by name vs base 80: 4 new (seed 24 load; s11 path stops; s131 tree on railway; s326 detour) — undiagnosed, likely same cascade.
- Direct checks all exit 0: castle-window, cruiser-clearance, npc-perch, keyring-view, tie-frame, climb-wave.
- Next: when router fix lands (and when #647 lands: take its camera.ts + check-rail-race.mts), rebase, re-run rail-race + castle checks directly.

### Round 6 — rebased onto 13d85084 (#647 + #651)
- Took base side of railRace/camera.ts and check-rail-race.mts (now identical to base).
- Seed 24 builds (#651). Direct: fountain-hop seed 24, rail-race, castle-window, cruiser-clearance, tie-frame all exit 0.
- PR #650 body updated; CI to run the full chain and procgen.
- procgen on 13d85084: 67 fail vs base 80 by name. New: s131 tree-on-rail (#653), s326 detour (PR #656) — not ours. 15 fixed.

### Round 7 — review fix (one castle owner)
- CASTLE_FRAME = Geo.fromWorld(CX, ground, CZ).lift(BASE_Y − ground); Building places shell via standFrameInPlot(CASTLE_FRAME).
- check:castle-window asserts drawn shell == CASTLE_FRAME (1.8e-15 m); red with old formula: 6.82 cm canonical, 8.73 cm seed 24.
- Nits: waveFacingYaw() argless; rigTiltAt shared by eyeForFocus/screenBasis3DAt.
- CI procgen f1e9f677: 68 fail vs base 80; only new = s131 tree-on-rail (#653). PR body + QA /view link updated.
- Base has since moved (#656 merged); not rebased.
