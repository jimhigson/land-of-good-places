# HANDOFF — crowd LOD (branch `perf/crowd-lod-2`)

Stopped on Jim's order, 13 Nov 2026 ~11:05, mid-work. Written by the Overseer from the
stopped engineer's actions; the engineer left no notes of its own.

## What this is

Plan item 6 / step 16 of `docs/perf/FRAME-DROPS-2026-11.md`: each crowd child is ~70 k
triangles and ~23 CSS px tall at the ordinary camera; the crowd is ~45 % of a park frame's
3.7 M triangles. Jim, 13 Nov: *"I want LOD rendering"*, then, choosing how to land it:
**"Land 11 now, LOD next"**.

## Why it is not on main

It was merged into the landing branch and then reverted out before the merge to main
(revert commit `de95777f`, which is on main):

1. **It never switched on.** `check:crowd-cull`, run for the first time, found 63,366 of
   63,366 on-screen crowd parts at FULL detail on park poses at zoom 1 (viewport 2700 px
   tall, device pixel ratio 3). The switch thresholds were in device pixels, so on a retina
   or phone screen every child counts as big.
2. **The low-detail child was never confirmed to look right.** The first version turned
   spiky hair (about a dozen spikes) into three blunt horns, speckled the sandals white and
   left a sliver by a bag strap. A fixer exempted parts and moved thresholds; nothing was
   re-shot.

## State of this branch

- `3e684a6c` = `origin/main` at `c25969b2` + `git revert de95777f` (re-applies the package;
  a plain re-merge of `perf-step16-crowd-lod` would be a no-op).
- The commit after it is **WORK IN PROGRESS, UNTESTED, MAY NOT TYPECHECK**: the stopped
  engineer's uncommitted rewrite of `src/core/instancedLod.ts` (+494 −228), committed here
  only so it is not lost. From its actions: the vertex-clustering simplifier is being
  replaced by an error-bounded edge collapse, and the LOD module head rewritten with
  CSS-pixel thresholds and a mode switch. It was measuring triangle counts per part at
  several tolerances when stopped. Read the diff before trusting any of it.
- Nothing has been run on this branch: no typecheck, no check, no browser.

## What "done" means

1. Level chosen by on-screen size in **CSS pixels** (same result at device pixel ratio 1, 2
   and 3): low level at the ordinary play camera on every display; full detail when a ride,
   first-person or zoomed camera brings her close; hysteresis; no per-frame allocation; the
   shadow pass always uses the low level; #756's behaviour intact (hidden indoors, live
   bounds, culling).
2. The low level is indistinguishable wherever it is used — proved in the REAL GAME with 4x
   crops of the same children, LOD forced off vs on, covering every hairstyle. A low level
   of 15–20 k triangles that is right beats 8 k that is wrong.
3. Triangles from `renderer.info`, LOD off vs auto, at the park gate and from `/rail-race`,
   at device pixel ratio 1, 2 and 3.
4. `check:crowd` / `check:crowd-cull` green unmutated, its far-level clause stated in CSS
   pixels, proved red both ways.
5. Independent browser QA before merge. Jim's merge policy today: no waiting on PR CI
   (`gh pr merge --admin`), but QA in a real browser first.

## Things that will save you time

- **Never wait for a park solve.** Checks take `LGP_PARK_FILE=<solved 5.json>`; the dev
  server reads `.parks/dev/<first 16 hex of node scripts/lib/park-source-hash.mjs>/5/5.json`
  (+ `manifest.json`). A solved seed-5 pair is in
  `.claude/worktrees/lazy-hotel/.parks/dev/48413028a1c89c10/5/`. (Branch
  `tooling/parks-checked-in` is making this unnecessary.)
- The original engineer's, reviewer's and fixer's reports: keys `build:crowdlod`,
  `review:crowdlod`, `fix:crowdlod` in
  `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/63860b08-4a9b-4597-b7cf-7b1677887a9f/scratchpad/perf/packages.json`.
- The stopped engineer's action log:
  `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/63860b08-4a9b-4597-b7cf-7b1677887a9f/scratchpad/handover-13-nov/crowd--crowdlod-fix.txt`.
- Its dev server (port 5951) was killed. This worktree is `.claude/worktrees/crowd-lod-2`.
