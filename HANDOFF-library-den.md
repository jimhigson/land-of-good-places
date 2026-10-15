# HANDOFF — The Library, track C: the den's walls, the secret shelf, the dragon and the cat (plan Steps 11-13)

Branch `feat/library-714-den`, cut from the foundation head **bb4eb46f**
(`feat/library-714`); worktree `.claude/worktrees/library-714-den`. Engineer, Claude Opus 5.5.
The plan is `docs/library-build/PLAN-parts-4-5.md` (on this branch). This track is plan
Steps 11, 12, 13; **this task is Step 11 only** (the den's walls: a gap in the west wall, a
lintel, a walled pocket, west-2 still seals it), including the LIGHT sweep over den cells.

Scratch logs: `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/den/`.

## Status (Step 11)
- [x] Worktree from bb4eb46f, `pnpm install --frozen-lockfile` (pnpm/12.1.0, node v26.5.0), pushed.
- [x] Baseline on the untouched foundation code, seed 5 restart 1 hydrated from a copy of
      `library-714/.parks` (source d283ffaa…, the same hash): `check:library` **exit 0, 60 ✓,
      0 ✗**, 12 s (`baseline-library.log`).
- [x] src — **9eddc691**: `layout.ts` (den constants, `libraryDenContains`, the two den stands
      tagged `den`, nest, pull-book slot, sconce-west-1 to z −8), `shell.ts` (`libraryDenGap`,
      the west wall as two spans + lintel in one group with a cloned material, the lintel's
      banded collider, `buildLibraryDenShell`), `Library.ts` (`denRoot` under `roomRoot`,
      hidden; `denWalls`, `lintel`, `westWall`, `westMaterial`). `tsc --noEmit` exit 0.
      - The unchanged check run against it (`oldcheck-newsrc.log`, park file d283ffaa): exit 1,
        exactly the two den keep-outs unreachable (`64 of 66`) and **no pocket reported** —
        because the old fill's domain was the plate only and could not see the den at all. That
        is the vacuity the Step 11 fill-domain control exists for.
- [ ] `check-library.mts`: fill domain, CONTROL 1, REACHABILITY (closed), DEN WALLS, LINTEL,
      LIGHT den cells, HOUSEKEEPING.
- [ ] Reds (plan: `REMOVE='den wall (west)'`, `MUTATE=no-lintel`, `REMOVE='bookcase west-2'`).
- [ ] Parks at the new source hash **a04bfcb4…** (`LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run
      build:parks`, running).

## Parks, on this branch
Every src file here is in the park source closure, so each src commit has a new hash. The den
changes nothing the park plan reads (`parkManifest.ts` takes only `LIBRARY_FOOTPRINT_RADIUS`,
`LIBRARY_BOUNDING_RADIUS`, `LIBRARY_STEPS_FRONT_Z` from `layout.ts`), so seed 5's layout cannot
move; only acceptance could. For iterating on `check-library.mts` (outside the closure):
`LGP_PARK_FILE=<park file> pnpm run check:library` hydrates the world from that file whatever the
source hash (`scripts/ts-extension-resolver-register.mjs`) — the foundation's seed-5 file is kept
at `library-build-scratch/den/park-d283ffaa/5.json`. Final evidence is from a park built at this
branch's own hash.

## Decisions (with reasons)
- **The den shell takes the room's paint as a fourth argument**
  (`buildLibraryDenShell(denRoot, props, surfaces, fabric)`; the plan's signature has three).
  The plan wants the den floor "in the room floor's material": `buildReadingRoomShell` returns
  its floor and wall materials as `fabric`, and the den borrows them, so one material is the
  floor in both — and `check:library`'s LIGHT reads that one material's albedo and lift for the
  den cells too. A second, equal material would be two owners of one paint.
- **The den's walls are the room's wall green** (`fabric.wall`, shared with the north, south and
  east walls — never the west wall's cloned material, which fades in Step 12). The plan does not
  say; one room, one paint.
- **The floor slab's apron and thickness are named** (`FLOOR_APRON` = 2 × `LIBRARY_WALL_HALF`,
  `FLOOR_THICKNESS` 0.5) in `shell.ts`, because the den floor must abut the room floor's edge
  exactly: the room floor's numbers are the same values as before (1.2 = 2 × 0.6, ±0.6, −0.25).
- **`LINTEL_OVERLAP` (0.05)** names the plan's "− 0.05" in the lintel's base.
- **Den spots are held to `libraryDenContains` at module load** (`layout.ts` throws if a den
  stand or the nest is moved outside the den's walls).

## For the join
- (filled in as found)
