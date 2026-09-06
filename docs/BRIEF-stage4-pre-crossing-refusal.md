# Engineering brief — stage 4, brought forward: a path that crosses the railway off-site is refused at commit, never thrown at planting

**Status: READY — dispatch now to the #511 Engineer**, as its own PR based
on the sphere branch (reviewable alone; lands before or with #511).
Authority: `docs/DESIGN-round-robin-generation.md`, "Seed 288,
root-caused (6 Sep)" — read it first; the ruling there is the spec. One
engineer, one worktree, normal CLAUDE.md discipline. Invisible on every
seed where nothing was crossing off-site (all of `main`'s pool today);
**visible on seed 288 on the sphere branch** — say which seeds' parks
changed and why in the PR body.

## The rule a reviewer looks for first

**One predicate, exported once from `crossings.ts`, asked by two
callers.** The `pathGraph` task's commit-time screen and the
construction-time `computeCrossings` must be the same function on the
same geometry (drawn samples, `TOUCH_DISTANCE`, `SITE_SNAP_TOLERANCE`).
A second "does this cross off-site?" written in `paths.ts` is the
two-definitions disease and is a rejection even while green.

## What this is

- The screen runs inside the generator's `pathGraph` task on the built
  graph's **drawn** samples (post fillet + Catmull-Rom — the samples
  `recordSamples` produces, not the control polyline), **before**
  `offerPrewarmedPathGraph`. A foul names the edge and is refused.
- The refusal path, in order of cheapness, per the ruling's point 2:
  screen the unscreened appendages (spur `lead`/`past`, station approach
  points, connector leads, lattice-snap jogs) with the leg's own rail
  test; a routed leg takes its next site candidate / re-routes; the ring
  or a leg with no site in reach asks `bridgeCandidateAt(d)` for a site
  **on demand** at that rail distance and adds it if proven; otherwise
  the segment re-routes; otherwise a loud, named failure.
- The construction-time throw at `crossings.ts:432` stays and must
  become unreachable; `test:procgen` reports a park that cannot be built
  as a **failure** (#524 — land it here if it is not already merged, it
  is one harness change).
- Determinism: on-demand sites and re-routes take their order from the
  fixed candidate order and the seed, never from map iteration. Two
  builds per seed in separate processes, identical.

## What must not change

- `cruiserLowPoints()`'s 5.9 m. `SITE_SNAP_TOLERANCE`, `TOUCH_DISTANCE`,
  `SITE_SPACING`. The seed pool (288 stays). No new warp field.
- Parks on seeds where nothing crossed off-site: **byte-identical**,
  proved with `scripts/park-digest-sweep.sh` before/after on the base
  branch, hashes quoted. The digest exists for exactly this.

## Acceptance — measured

1. Seed 288 on the sphere branch builds; `seed-288.test.ts` runs its
   tests (not 90 skips) and passes. Say which edge was refused and what
   the next decision was, with coordinates.
2. Deliberate break on `main`'s geometry: move one canonical site by
   > 8 m along the loop in a scratch run; the router **refuses and
   re-routes** (transcript pasted with the edge and the site), and the
   build does not throw.
3. The predicate is one function: break it deliberately (make the task's
   screen use a stale copy with a different tolerance) → red run pasted.
4. Byte-identity on every seed that did not foul; change accounting for
   every seed that did, countersigned by the Architect.
5. Full gates green: `pnpm run check`, `pnpm run test:procgen`,
   `pnpm run check:coplanar`; exit codes captured directly; chain verified
   by parsing `scripts`.
6. Budget note on stderr: refusals per seed, on-demand sites proven per
   seed — the first crossing thrash number.

## Traps

- `bridgeKeepout.ts` memoises `footprints()` at module level; if the
  crossing set can change after a refusal, that cache is a stale read.
- `paths.ts` mutates module-level paving; never build twice in one
  process.
- `rerere` is on; rebuild any `check`-chain resolution from `main`'s
  parsed steps.
