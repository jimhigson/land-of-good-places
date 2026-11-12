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
