# HANDOFF — lazy-load interiors and minigames (fixes main's red build)

Branch `lazy-interiors`, worktree `.claude/worktrees/lazy-interiors`.

## Root cause
One `Game` chunk carried every interior + every GLB kit (base64 in JS). #739 + #745 pushed it to 4.2 MB > the 4 MiB
precache limit (`src/boot/precacheLimit.ts`, now the one owner). Do NOT raise it (Jim).

## Done
- Stall mini-games (dodgems, water fight, spooky house): `MiniGameFactory` is async; `MiniGameHost` fetches on `begin`
  (behind the closing curtain) and holds a `loading` phase if needed.
- Book reader: `LazyBookReader` facade in Game; real `BookReader` (+ storyProps.glb) fetched on first open.
- `check:boot-chunk` (shard 6): builds, asserts LAZY_MODULES not in boot set, budgets, every chunk in sw.js.
  `--report` lists the biggest boot modules. Proved red by a static import of BookReader in Game.ts.

## Measured (boot set = entry + static imports + main/Game/parkPlan/pathGraph closures)
- before: Game chunk 4197 KB (build refused)
- after step 1: boot set 5460 KB, Game 2191 KB

## Next
Remaining boot payload is GLB base64: hotel 929K, library 586K, reptile* ~1.16M, castle 172K, cart 134K, den 107K.

## Step 2 (pushed): Reptile House hall floor lazy
- `src/world/LazyPart.ts`, `src/world/interiors.ts` (REPTILE_HALL, LAZY_INTERIORS, interiorsToPreload).
- `reptileHouse/hall.ts` builds props/exhibits/planting/paths/stall/tortoise; ReptileHouse keeps shell, lights, pools, exhibit camera.
- Doors: `SpaceManager.changeToFurnished` → iris holds shut (`Transitions.irisWipe(…, ready)`).
- Saves/deep links inside: main.ts `finishLaunch` awaits `interiorsToPreload(...)` before `new Game`.
- Node: `scripts/lib/eagerInteriors.mts` provides every LazyPart (park-harness imports it; slideRider/petSlide/measure-procgen too).
- boot set 4735 KB.

## Why the rest is per-building work
castle/hotel/library colliders are *measured from their GLB kit at module load* (e.g. castleAssets CASTLE_TABLE_TOP =
surfaceTop(...)), so the kit is needed at boot unless that building's whole interior (colliders included) moves into its
lazy chunk the way the reptile hall did. Hotel/library kits also hold the exteriors (tower 100K of hotel.glb, shell 111K
of library.glb) → need a GLB split at pack time.
