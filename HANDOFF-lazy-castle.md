# HANDOFF — lazy castle interior (PR #759, draft)

Branch `lazy-castle`, worktree `.claude/worktrees/lazy-castle`. Dev/preview port **6061**.
Follows #749 (`src/world/LazyPart.ts`, `src/world/interiors.ts`, `scripts/lib/eagerInteriors.mts`,
`check:boot-chunk`). No PR to open: a later stage does that.

## Round 2 brief (13 Nov 2026)
1. WebKit: no iris on first castle entry — the interior was built in the frame that asks the iris to close.
2. NavGrid `ensureLattice → rebuild` freeze ~505 ms after entry.
3. Adopt `DrawnSpaces` (`src/world/DrawnSpaces.ts`) as the one owner of which spaces are drawn.
4. Prefetch centre from `castleEntranceBand()`; a castle lazy-load test; the kidCrowd `toDataURL` fix.
Measure first entry + deck changes before/after; boot time + `check:boot-chunk`.

## Done
- Merged origin/main 34f20970 (660add97). Conflicts: interiors.ts, eagerInteriors.mts,
  check-boot-chunk.mts (both lists kept), Building.ts update(): banquet posed only while
  `isDrawn` **and** only once built (`this.castle?.banquet`).

## Findings (measured, production build via `vite preview --port 6061`, seed 5, 1280×800)
Harness: scratchpad `harness/door.mjs` + `probe.js` (rAF gaps, iris MutationObserver, `.iris-eye`
width / screen diagonal). Castle door: `/spawn?pos=24.52,-18.17&facing=180&seed=5&perf=1`, hold W+D.
- **Main (eager castle), Chromium**: door frame 8.4 ms, hole at swap 0, worst after entry 18.5 ms.
- **Branch after merge, before fixes**: Chromium door frame 223/229/256 ms, hole at swap 0/0/0.31;
  WebKit door frame 297/303/302 ms, **hole at swap 2.205 in 3/3** (QA's defect reproduced).
- **NavGrid freeze (2) is gone after the merge**: worst frame 1.5–9 s after entry 17–19 ms (Chromium),
  25–27 ms (WebKit). #764's patch treats colliders off the park's lattice as a no-op
  (`NavGrid.patch`, "Every change was off this lattice altogether").
- **The hotel and library have the same defect on main** (identical code on this branch):
  hotel door frame 134–166 ms, hole at swap up to 0.70 (WebKit); library 116–196 ms, hole up to
  0.54 (WebKit). Cause is the one owner: `SpaceManager.changeToFurnished` calls `furnish()`
  (fetch **and** build) at once, and a prefetched chunk's `load()` is already resolved, so the
  build runs as a microtask in the door frame. Fix goes in the owner, not the castle.
- kidCrowd: `base.clone()` → `Material.copy` → `JSON.stringify(userData)` → the face textures
  `ownTextures` put in `userData` → `Texture.toJSON` → `canvas.toDataURL` (park-harness already
  filters the "Unable to serialize Texture" warnings this causes).
- Boot (check:boot-chunk): main boot set 49 chunks 3803 KB, 11 lazy 2681 KB; branch 52 chunks
  3607 KB (−196 KB), 12 lazy 2881 KB, 47 lazy modules asserted.

## Next
- [ ] SpaceManager: fetch at once, build behind the shut iris (all four rooms); unit test + red proof
- [ ] kidCrowd clone without the JSON round-trip
- [ ] prefetch/refuse anchor from `castleEntranceBand()`
- [ ] castle lazy-load test
- [ ] re-measure: castle/hotel/library doors both engines, deck changes, boot
- [ ] checks: tsc, typecheck:test, boot-chunk, castle, hall-solid, benches, render-budget, test:procgen
