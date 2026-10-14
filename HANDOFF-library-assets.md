# HANDOFF — The Library, foundation second half (epic #714; plan Steps 3, 4 + the real-child harness)

Branch `feat/library-714-assets` (from 009dea3e, the foundation head), worktree
`.claude/worktrees/library-714-assets`. Engineer, Claude Opus 5.5. The orchestrator merges this
branch into `feat/library-714`; **never push to `feat/library-714` or `feat/library` from here.**
Plan: `library-plan-parts-4-5.md` in the orchestrator scratchpad (Steps 3, 4, Step 6's "Checks").
Stayed off the first half's files: props.ts, layout.ts, libraryLines.ts, check-copy-brevity.mts,
HANDOFF-library-714.md.

## Status — DONE (see "Checks at the head" for the final runs)
- [x] Step 3: `LIBRARY_GLB_STYLES` exported + `libraryKitMesh` (c6ec7f5c); `libraryFaces.ts`,
      `libraryCreatures.ts`, storybook dragon colours (77c1044c); check:assets x5 (4a6eca48);
      PAINTED FACES + `LIBRARY_CHECK_MUTATE` allow-list (d6486af8)
- [x] Step 4: the `/library?at=6,8.7&facing=180` case with a facing read (6ec484d7)
- [x] WITH A REAL CHILD harness + its own clause + red (d6486af8)

## What each file now gives the tracks
- `src/art/models/libraryAssets.ts`: `LIBRARY_GLB_STYLES` (the one table, exported; the building's
  STYLES renamed), `PartStyle` (type), `libraryKitMesh(name, material?)` (the one dresser; an own
  material for a part that must own one).
- `src/art/models/libraryFaces.ts`: `owlFaceTextures()` (neutral, blink, happy, shush),
  `dragonFaceTextures()` (neutral, blink, happy, puff), `catFaceTextures()` (asleep, happy),
  `LIBRARY_FACE_ROWS`, `LIBRARY_FACED_HEADS`, `libraryFaceCanvasSize(head)`. 10 canvases.
- `src/art/models/libraryCreatures.ts`: `createLibraryOwl()` → `OwlHandle` {root, height, body,
  head, wingL, wingR, headMaterial, face, setFace, setExpression}; `createLibraryDragon()` →
  `DragonHandle` (a CreatureHandle: limbs null, setWalkPhase no-op) + {tail, belly, mouth,
  mouthInHead, headMaterial, face, setFace}; `createLibraryDragonNest()` → {root, height, padTop,
  radius}; `createLibraryCat()` → {root, height, body, head, earL, earR, tail, headMaterial, face,
  setFace, setExpression}; `createLibraryBookPile()` → {root, height, plan}; `DRAGON_BELLY_REST_GLOW`.
- `scripts/check-library.mts`: `MUTATIONS` / `mutating(name)`, `slope()`, PAINTED FACES, and the
  harness `child: RealChild` with one marker per track below its own clause.
- `scripts/check-deep-links.mts`: `libraryCheck(path, spot, what, facing?)` reads her facing back.

## Measured (seed 5 park at source 94225e98, and the bare handles)
| creature | height (outline incl.) | bottom | plan reach | notes |
|---|---|---|---|---|
| owl | 1.619 | -0.012 | 0.6548 at rest; **0.6674** with breathing (1+0.6·0.02) and head yaw ±1 rad | head pivot (0, 0.7352, 0.0200); wings ±0.34 at y 0.6975 |
| dragon | 0.910 | -0.016 | 0.6927 | head pivot (-0.044, 0.4336, 0.060), horns on it; tail pivot (-0.070, 0.1281, -0.3389); mouth (root) (-0.044, 0.4336, 0.5461), in head (0, 0, 0.4861) |
| nest | 0.200 | -0.012 | 0.8340 | padTop 0.145 |
| cat | 0.359 | -0.010 | 0.3483 | head pivot (-0.0508, 0.1242, 0.040); ears under it at (0.0324, 0.1472, 0.06) / (-0.1474, 0.1472, 0.06) |
| pile | 0.911 | -0.011 | 0.5357 | plan (outline incl.) x -0.454..0.455, z -0.320..0.357 |
Every glb creature node has identity rotation and scale (read off the file), so hanging by
translation subtraction is exact. Face canvases 512 x 412 / 346 / 408; parked back faces at glTF
(0.020, 0.980): owl 184, dragon 146, cat 155; front-mapped 164 / 130 / 139.

## Decisions (with reasons)
- **One table, one decode, one dresser.** `libraryKit.ts` already decodes the glb once and
  libraryAssets.ts already dressed all 65 nodes from a private STYLES. So the plan's
  `libraryKit()`/`loadReptileKit` is NOT added (a second decode); STYLES is renamed and exported as
  `LIBRARY_GLB_STYLES`, and the dresser exported as `libraryKitMesh`. Existing callers build the
  same meshes (kitMesh unchanged in behaviour).
- **Outlines: the building's table is kept**, not the plan's parenthesised figures. The plan's
  `cat-* (0.016)` breaks ART_DIRECTION §2 (small creatures 0.010–0.014; she is 0.35 m), and the
  owl's 0.02 vs the plan's 0.016 are both inside the kid/prop range. The only colour change is the
  plan's: `dragon-wings` → `ART.miniLilac` (the storybook dragon's wings).
- **The render script's regex** reads every `name: { ... colour: PALETTE|ART.key` in
  libraryAssets.ts's TEXT, so no example row may appear in a comment there (one written that way
  would make `library_render.py` assert on `PALETTE.key`). Verified 77 rows before and after, only
  dragon-wings changed.
- **Head and wings hang under `body`** (the CreatureHandle convention "everything above the ground
  lives in body"), so breathing on `body.scale` moves them too; the head turns on `head.rotation.y`.
- **Faced heads and the dragon's belly own their materials** (`libraryKitMesh(name, material)`):
  the cat's parts share one ginger paint, so a face map on the shared paint would have painted her
  face on her tail.
- **Expression maps**: owl surprised→shush, sad/frown→neutral; dragon surprised→puff, sad/frown→
  neutral; cat happy/surprised→happy, everything else→asleep (a blink on a sleeping cat stays asleep).
- **The cat's asleep mouth** is her 'cat' mouth at 0.7 of its width (the plan's "small mouth").
- **`DRAGON_BELLY_REST_GLOW = 0.2`** lives in libraryCreatures.ts (the factory sets it), so the
  plan's LibraryDen rest value has one owner: import it.
- **The harness world is built with no cat bus pending** (`saveFlags.markArrived()` before
  `buildHeadlessPark`). A fresh store makes `World.attachPlayer` seat her in the bus (riding), and
  `Library.requestEnter` rightly refuses a riding child. A `/library` deep link boots with
  `arriveByBus: false`, so this is the world the link builds. Every check-library line before the
  harness is byte-identical with and without (89 lines, `diff` empty).
- **`block-walk` added to the allow-list** for the harness's own red (the plan's list predates the
  harness clause); an allowed mutation that no clause arms fails the run ("ASSERTS NOTHING") rather
  than passing, so the plan's later mutations cannot pass by accident before their clauses land.
- **Step 4 was already built** by the building branch (parsed `library` DeepLink with at/facing,
  `parseLibraryLink`, loud finishLaunch case, `Game.enterLibrarySpawn`, no `/library` stall id,
  `/library-door` kept). Added only the plan's check case and a facing read (`FACING_TOLERANCE`
  0.05 rad), proved red twice. `story=now` is Step 9's.

## Red proofs (each reverted; geometry: seed 5, restart 1, source 94225e98, digest 9acd3a626f55d35c)
- **check:assets**, the owl's height typed `1.5` in createLibraryOwl → exit 1:
  `library.owl: declares height 1.500 m but measures 1.619 m (+0.119 m)`.
- **PAINTED FACES**, `LIBRARY_CHECK_MUTATE=faces-upside-down` → exit 1, `3 clause(s) FAILED`:
  ```
  note: FLIPPED all 10 painted faces the other way up on purpose ...
  ✗ owl-head: 164 front vertices (184 parked), the canvas row RISES 1.01/m as the head rises (flipY false); the eye row lands at y 1.169, over the beak's top at 0.948
  ✗ dragon-head: 130 front vertices (146 parked), the canvas row RISES 1.95/m as the head rises (flipY false); the eye row lands at y 0.552 and the mouth row at y 0.667
  ✗ cat-head: 139 front vertices (155 parked), the canvas row RISES 3.27/m as the head rises (flipY false); the eye row lands at y 0.136 and the mouth row at y 0.199
  ```
  Green: owl eye y 1.058 over beak top 0.948, slope -1.013; dragon eye 0.552 / mouth 0.437, slope
  -1.951; cat eye 0.157 / mouth 0.115, slope -3.273. **Note:** on the owl the eye-above-beak half
  alone cannot see a flip (her eye row is mid-head: flipped it lands at 1.169, still over the
  beak); the falling-row half is what goes red there.
- **WITH A REAL CHILD**, `LIBRARY_CHECK_MUTATE=block-walk` (a wall x -3..3 at room z 9.6,
  half-thickness 0.2, a metre ahead of the arrival (0, 10.6)) → exit 1:
  `✗ steered up the central aisle for 2 s (the stick pushed on 120 of 120 frames), she travelled 0.18 m (at least 1.5) to (0.00, 10.42), ...`
  Green: 14.26 m to (0.00, -3.66), feet 0.000 m off the floor.
- **The allow-list**: `LIBRARY_CHECK_MUTATE=shift-books` (no clause arms it yet) → exit 1,
  `✗ LIBRARY_CHECK_MUTATE=shift-books was asked for, but no clause in this build arms it — this run ASSERTS NOTHING about it`;
  `=bogus` → throws `... is not one of this check's mutations: ...`.
- **check:deep-links**, `Game.enterLibrarySpawn` calling `requestEnter()` without `at` → exit 1:
  `/library?at=6,8.7&facing=180 (startFresh): asked for the desk's front, room (6, 8.7) = world (-594, -591.3); she is in 'library' at (-600.0, -589.4), 6.3 m off`
  (and continueGame the same; the secret-shelf case 21.7 m off).
- **check:deep-links**, `parseLibraryLink` dropping `facing` → exit 1:
  `/library?at=-16.1,-4&facing=270 (startFresh): on in front of the secret shelf, 0.00 m off, but facing 3.142 rad where the link asked 4.712 (270°): 1.571 rad round`.
  The desk case stays green there, as its own read says: 180° is the arrival's facing too.

## Parks, locally
Only libraryAssets.ts is a park-closure edit here (measured with `parkSourceClosure`: libraryAssets.ts
IN; readerAssets.ts, the three check scripts, main.ts, Game.ts OUT; the new libraryFaces.ts and
libraryCreatures.ts are imported by no closure file). Source hash at the head:
`94225e989746ab584747672e0385ff5671dadf3ac0386c5865f61872a54882bf`.
`LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run build:parks` → seed 5 restart 0 rejected by
check:coplanar, **restart 1 accepted** (134 measures), digest 9acd3a626f55d35c, 506 s; `.parks/` in
this worktree. A merge with the first half's closure edits makes a new hash.

## For the join
- **Track A (Step 6), the owl's capsule:** `visibleReachXZ(owl.root)` at rest is 0.6548, but her
  live pose reaches 0.6674 (breathing + a ±1 rad head turn). Size OWL_RADIUS over that envelope,
  or accept 1.3 cm of face past her capsule knowingly (the plan's aisle clearance is 3-5 cm).
- **Track C (Step 13):** import `DRAGON_BELLY_REST_GLOW` for the belly's rest glow (do not retype
  0.2); puffs that follow a turned head use `head.localToWorld(mouthInHead.clone())`.
- **Every track:** add clauses after your marker in check-library's WITH A REAL CHILD; arm your
  mutation with `mutating('<name>')` inside the clause it breaks (an unarmed one fails the run);
  leave her standing in the room, not riding. The harness world has no cat bus.
- **Step 9:** `story=now` goes into the building's `parseLibraryLink` (main.ts); new `/library`
  deep-link cases go through `libraryCheck(path, spot, what, facing?)`.
- **Step 14 (ASSET_MANIFEST):** the measured table above, the face sets (owl 4, dragon 4, cat 2;
  512 x 412 / 346 / 408), and `dragon-wings` = ART.miniLilac (one dragon with the storybook).

## Findings outside this task (reported, not changed)
- **check-reptile-house's PAINTED FACES skips the wrong corner.** It skips parked UVs with
  `u < 0.05 && v < 0.05`, but the kits park at Blender (0.02, 0.02) = glTF (0.020, 0.980) once
  exported: measured on `rr-snake-head`, 0 vertices match its skip and 155 sit at (0.020, 0.980). So
  its slope and nearest-row search include 155 back-face vertices. It still passes; the instrument
  is weaker than it reads. check-library's PAINTED FACES skips `u < 0.05 && v > 0.95`.
- **check:deep-links' reachability probe loads the bare root** (no `?seed=`), so on a source with no
  built parks the dev middleware starts solving a pooled seed in the background (seed 6 and 10
  here). Under `with-dev-server` the process group dies with the server; on a hand-started server,
  killing vite's PID leaves those builds orphaned — I killed mine by PID (5 processes).

## Checks at the head
See the final structured output (and the logs in the orchestrator scratchpad `assets714/`).
