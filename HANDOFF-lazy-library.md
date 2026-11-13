# HANDOFF — lazy library (reading room + den, dragon, cat)

Branch `lazy-library`, worktree `.claude/worktrees/lazy-library`, off origin/main f3e0b6b8 (#749).

## Goal
Library interior (586 KB libraryGlb) + den (107 KB libraryDenGlb) out of the boot set,
into one lazy chunk, the way #749 did the reptile hall. Exterior stays in boot.

## Baseline (check:boot-chunk --report on f3e0b6b8)
boot set 4723 KB; libraryGlb.ts 586 KB and libraryDenGlb.ts 107 KB in boot.

## Plan (status in [ ])
1. [x] Pack-time split of library.glb (scripts/lib/splitGlb.mts): boot piece = shell-* +
   shelf-carcass, shelf-shelves, cushion-body (measured at boot: LIBRARY_SHELF_FOOTPRINT,
   libraryBookcaseSize for libraryDenGap/doorBands, libraryCushionSize for kid driver);
   room piece = the rest + LIBRARY_FACES -> libraryRoomGlb.ts. Node list owner:
   src/art/models/libraryKitSplit.ts. check:library-glb re-splits and compares.
2. [x] libraryKit.ts registry; libraryRoomKit.ts (lazy) registers room parts.
   libraryAssets.ts keeps exterior/bookcase/cushion; room pieces -> libraryRoomAssets.ts.
3. [x] shell.ts: room + den shell builders -> roomShell.ts (lazy).
4. [x] src/world/library/room.ts: furnishLibraryRoom() (lazy entry). Library.ts holds
   `room | null`; door uses SpaceManager.changeToFurnished; prefetch on approach; refused line.
5. [x] Game: OwlLensFade/BookGlance/StoryCamera tolerate unfurnished. Owl bubble owned by Library.
6. [x] interiors.ts LIBRARY_ROOM; interiorsToPreload: SPACE_LIBRARY save, /library, /library-den, /book.
   eagerInteriors provides it. BookReader: pagePictures gets library art injected
   (it must not static-import room modules — shared lazy chunk breaks retry).
7. [x] check:boot-chunk LAZY_MODULES; prove red.
8. [ ] verify: tsc, check:library, check:boot-chunk, book-reader, labels, tap-spacing, test:procgen; headless browser.

## Results so far
- check:boot-chunk after: boot set 4179 KB (was 4723), room chunk `room-*.js` 574 KB.
- Guard proved red (real, not staged): storyCamera/bookGlance value-imported owlPerch/glowBeaconBase
  from LibraryOwl -> FAIL LibraryOwl, libraryRoomAssets, libraryRoomKit, libraryCreatures,
  libraryFaces, libraryRoomGlb "in the boot set". Fixed by asking the owl instance (owl.perch etc.).
- tsc, typecheck:test green. check:library-glb green.
- Owl bubble now made in Library.ts (createOwlBubble) and passed to LibraryOwl.
- pagePictures gets library art via LIBRARY_ROOM.loaded.LIBRARY_PICTURE_ART; LazyBookReader loads room+reader.

## Status (13 Nov)
- PR #760 open. Local `pnpm run check` exit 0. check:library green. Browser play-through (dev server 5392, seed 5,
  desktop+phone) all good incl. failure path and save-restore; preview pr-760-675d972 loads room only on entry.
- local test:procgen: 40 files pass, 10 seeds hit the 1 h hook timeout in the acceptance loop (source hash changed,
  Mac loaded) — environmental; CI Procgen invariants all green.
- CI red: shard 9 check:book-reader paint timeout = known #749 flake, fix in flight as #761 (reader-flake).
  shard 4 check:tap-dash seed 13 "door-sized band ... never fired" on a 95 m route. tap-dash picks routes with a
  seeded Math.random replaced BEFORE the park is built, so my refactor shifted the stream (seed 5 longest route
  243.3 -> 241.5; seed 13 237.0 -> 220.7 on CI). Surfaced a latent miss; reproducing with
  LGP_SEEDS=5,13 build:parks then `LGP_TAP_DASH_CHILD=1 LGP_SEED=13 LGP_TAP_DASH_BAND=1 node ... check-tap-dash.mts`.
