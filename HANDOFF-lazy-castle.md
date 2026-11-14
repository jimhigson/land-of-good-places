# HANDOFF — lazy castle interior (PR #759, draft)

Branch `lazy-castle`, worktree `.claude/worktrees/lazy-castle`. Ports: **6061** branch preview, 6062 main
baseline preview (worktree `.claude/worktrees/lazy-castle-main`, detached at origin/main), 6063 scratch
(dev server / profiling build / combo). All started by `$SP/serve.sh` / `$SP/dev.sh`, killed by their own PIDs.
`$SP` = `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/63860b08-4a9b-4597-b7cf-7b1677887a9f/scratchpad/lazy-castle`
(harness: `door.mjs` + `probe.js`, `ab-door.sh`, `ab-lift.sh`, `sum-door.mjs`, `sum-lift.mjs`, `shots.mjs`,
`subtree.mjs` for cpuprofiles). No PR to open: a later stage does that.

## Brief (13 Nov, resumed 14 Nov)
1. WebKit: no iris on first castle entry — interior built in the frame that asks the iris to close.
2. NavGrid `ensureLattice → rebuild` freeze ~505 ms after entry.
3. Adopt `DrawnSpaces` (`src/world/DrawnSpaces.ts`).
4. Prefetch from `castleEntranceBand()`; a castle lazy-load test; kidCrowd `toDataURL` fix.
Measure first entry + deck changes before/after; boot time + `check:boot-chunk`.

## Done (pushed)
- 13 Nov: build behind the iris (24b998ed: `changeToInterior` hands `changeToFurnished` only the fetch,
  builds first thing in the midpoint, a build throw refuses the door); `test/lazy/castleDoor.test.ts`;
  kidCrowd `cloneMaterial` (c72e6e7f); prefetch + refusal bubble from `castleEntranceBand()` (5579a745).
- 14 Nov: merged origin/main bb7e9c99 (#777, #778) as b57cbc16 — clean.
- 14 Nov **af71b6c3: crowd far levels shared by content** (`src/core/instancedLod.ts`). Profile of the
  door's build (unminified production build, Chromium): `furnishCastle` 104.8 ms, of which
  `lowDetailGeometry` 58.9 ms — the banquet's `KidCrowd` builds its own prototype, 30 of 44 parts separate
  objects with byte-identical arrays (`$SP/twins.mjs`, real page), so the identity-keyed cache missed.
  Now matched by content (exact comparison). After: `furnishCastle` **49.1 ms**. Test
  `test/lazy/crowdLodTwins.test.ts` (shard 5): red on main's file `2 failed | 2 passed (4)`, green 4/4.

## Findings
- **Painted shut** (13 Nov): main's `Transitions.irisWipe` runs the midpoint on its close timer while the
  eye is still ~0.25 diag (Cr) / 0.3–0.6 (WK) open, so the build is a visible freeze behind a nearly
  closed iris. perf/first-entry-warmup's `whenShut` (841e05ee) is the owner's fix; left to it.
- **Merges**: lazy-castle merges cleanly with perf/undrawn-indoors and perf/nav-resumable
  (`git merge-tree`). first-entry-warmup and rides-static-merge conflict in `src/Game.ts` with **main
  alone** (#777's `noteView`/checkClock) — theirs, not this branch's (this branch does not touch Game.ts).
- nav-resumable's answer to (2): the 505 ms was the park's pinned grid rebuilt whole by the castle's
  colliders; gone since #764. "Nothing needs calling"; never call findRoute/canStandAt/… from the furnish
  (checked: the furnish path has none).

## Next
- [ ] door A/B (Cr+WK, interleaved) — running; lift A/B; boot + check:boot-chunk both sides
- [ ] combo worktree `.claude/worktrees/lazy-castle-combo` (lazy-castle + first-entry-warmup +
      undrawn-indoors, scratch, never pushed): measure the hole during the build with `whenShut`
- [ ] screenshots main vs branch at `?clock=5` (`shots.mjs`), nav rebuild count (dev)
- [ ] checks: validate:parks seed 5 (running), boot-chunk, castle, hall-solid, benches, render-budget,
      nav-spaces, test:procgen, check
- [ ] merge origin/main again before handing over; remove combo + main worktrees when done
