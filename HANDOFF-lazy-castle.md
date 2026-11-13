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

## Done (pushed)
- 660add97 merge origin/main 34f20970 (banquet posed only while `isDrawn` and only once built).
- 24b998ed **castle builds behind its iris**: `Building.changeToInterior` hands
  `changeToFurnished` only the fetch (`furnished` = chunk here), builds first thing in the
  midpoint; a build throw is caught there and refuses the door. Works with main's
  `SpaceManager` **and** perf/first-entry-warmup's (which calls `furnish()` once shut).
  An earlier commit (e4b0f67f) changed SpaceManager for all four rooms; reverted, because
  perf/first-entry-warmup owns that generic change and its HANDOFF asks us to drop ours.
- `test/lazy/castleDoor.test.ts` (shard 5): real `Building` over the checked-in park (~4 s;
  must import the park dynamically after offering the park file, else it solves: 178 s).
  Proved red against the first wiring: "built in the frame that asked the iris to close — in
  front of it: expected true to be false".
- c72e6e7f kidCrowd: `cloneMaterial` (materials.ts) — clone without JSON-ing `ownTextures`.
  Castle build 242–303 → 112–122 ms (Chromium).
- 5579a745 prefetch distance + refusal bubble from `castleEntranceBand()`.

## Findings (production build, `vite preview --port 6061`, seed 5, 1280×800, M4 Pro, loaded machine)
Harness: scratchpad `harness/door.mjs` + `probe.js`. Castle door:
`/spawn?pos=24.52,-18.17&facing=180&seed=5&perf=1`, hold W+D. Metric that matters for "covered":
the iris hole in the **first frame drawn after the swap** (flag `data-closed=false`).
- main: door frame 8–10 ms (Cr) / 12–18 (WK); first new-world frame hole 0.
- branch before fixes: door frame 223–256 (Cr) / 297–303 (WK); WK first new-world frame hole
  **2.205** (no iris).
- branch now: door frame 8–10 (Cr) / 17–21 (WK); first new-world frame hole 0–0.021 (6/6).
  The build (~120 ms) runs in the close timer's task with the iris 90–95 % of the way closed:
  the old world shows through a hole of 0.25 (Cr) / 0.57–0.64 (WK) diag, frozen ~120 ms.
  **Fully hiding it needs the iris to wait for a painted-shut frame before the midpoint**
  (`Transitions.irisWipe`; the close easing is steep: at 95 % of its time the hole is still 0.6
  diag). That file is perf/first-entry-warmup's now — told them here.
- NavGrid freeze (2) gone after the merge: worst frame 1.5–9 s after entry 17–27 ms (Cr),
  23–40 ms (WK). #764's `NavGrid.patch` treats colliders off the park's lattice as a no-op.
- Hotel and library have the same door-frame build on main (134–196 ms, WK hole up to
  0.70) — perf/first-entry-warmup fixes them generically.
- Boot (Cr, `/spawn`, 5 loads each): main first frame 2012–2230 ms (median 2143), longest task
  1828–2002 (1891); branch 1484–1635 (1499), 1348–1369 (1361). Heap 121–151 → 102–113 MB.
- `check:boot-chunk`: main boot set 49 chunks 3803 KB, 11 lazy 2681 KB; branch 52 chunks
  3607 KB (−196 KB), 12 lazy 2881 KB, 47 lazy modules asserted.

## Next
- [ ] deck changes (lift) before/after
- [ ] (3) verify with check:render-budget
- [ ] checks: boot-chunk, castle, hall-solid, benches, render-budget, nav-spaces, test:procgen, check
- [ ] merge origin/main again before handing over
