# HANDOFF — park layout + bridges as one joint solve (issues #269/#116, PRs #286/#330)

Branch: `park-and-bridges` (worktree `.claude/worktrees/park-and-bridges`),
based on `origin/grid-aligned-park` with `origin/bridge-backtrack` and
`origin/main` merged in. Jim's ruling: design the park around the bridge
constraints — streets, plots AND railway crossings are one joint solve, not
bridges squeezed in afterwards.

## Settled design decisions (Jim's, do not re-litigate)

1. Grid pitch 12 m.
2. Route-on-grid with loop-closing, HIGH connectivity (no 259 m path for a
   15 m crow-flight pair).
3. Rounded corners, 1.5–2 m fillets; square junctions otherwise.
4. Buildings and streets solved JOINTLY (round-robin with rollback) — and
   bridges are part of that same joint solve now.
5. Statue circle: exactly 4 connections at compass points, true circle.
6. Diagonals: genuine minority exception only.
7. One entrance/exit node per attraction, strictly in front.
8. Pavement reaches attraction doors with 0 m gap.
Plus: riders sit; `BRIDGE_RISE` = 4.25 m (real commits on bridge-backtrack,
`src/world/train/clearance.ts`) — reuse, don't redo.

## State (updated every commit)

- Merged `origin/bridge-backtrack` + `origin/main` into this branch;
  cross-branch `FENCE_OFFSET` import fixed; tsc clean throughout.
- **The joint solve is wired in and working on canonical** (commit
  6616d56):
  - `src/world/train/crossingPlan.ts` — NEW. At module load (rail + plots
    solved, before any path drawn) it finds every loop point where a real
    bridge provably fits (deck + walkable ramp BOTH sides at the real
    acceptance floor + 1 m slack, vs boundary/plots/rail-corridor/station
    windows). Tier 2 = deliberate square level-crossing sites where a whole
    stretch is unbridgeable. Exports `CROSSING_SITES`,
    `LEVEL_CROSSING_SITES`, `railSideOf`, `LEVEL_CROSSING_PENALTY`.
  - `paths.ts` `routeLeg()` — any leg straddling the railway routes via the
    best site (bridge sites preferred by a 45 m penalty on level ones);
    crossing axis pinned at deck edges + centre; sub-legs and same-side
    legs clamped to their side (`clampToRailSide`) because the routers are
    not rail-aware (corners hopped the rail and back — measured 3
    crossings on one spur, and one connector crossed INSIDE a station
    window). Cross-rail interconnect pairs skipped.
  - `crossings.ts` — a crossing is now a side FLIP within one drawn run
    (per-run detection, RUN_BREAK=3), not a cloud of near-rail touches
    (touch-clouds smeared halfGap to the 14 m cap and minted a phantom
    crossing from two different paths hugging opposite fence sides).
    Measured crossings SNAP to the planned site's exact frame
    (SITE_SNAP_TOLERANCE=8) — frame jitter alone flipped feasible sites
    into fallbacks via the rail-corridor margin test.
  - `bridgeFootprint.ts` — conservative reservation reserves the FULL
    ideal ramp run (truncation only ever removed protection; a lamp stood
    8 m down a ramp the real pass needed — the old handoff's open
    question, closed). `REAL_PROBE_RADIUS` exported; `LGP_DEBUG_BRIDGE=1`
    narrates every rejected candidate. `LampPosts.ts`
    `LAMP_BRIDGE_MARGIN` now derives from it (was 0.2 m short).
- **Canonical measured: 4 real bridges + 2 level crossings** (hotel strip
  genuinely unbridgeable — boundary hugs the rail; gate walk's +ramp
  blocked by entrance furniture at ~(-4.1,44.7) — worth a later look).
  Was 0 bridges / 7 levels. **check:park EXIT 0, 19/19 attractions,
  267/267 waypoints — poi.stranded (was 35/29) FIXED.** Root causes of
  stranding: (a) a crossing landed inside a station's stationRun-sealed
  window, (b) the touch-smear swallowed the gate crossing's fence gap.
- Debug helpers (uncommitted): scripts/debug-{park,stranded,crossings,
  fence,cutedges,route-crossings,sites,site-why,site-vs-real,bridge-why,
  wall-owner}.mts. `quietly()` swallows console.warn — use
  process.stdout.write in debug scripts.

## Next

1. Measure seeds 2 and 18: bridge counts + check:park. Tune if needed.
2. test:procgen all 5 seeds; extend invariants (red-then-green):
   crossings-at-sites-only + station-clear; majority-bridges; keep
   pathsRunOnGridAxes happy with the (legitimately diagonal) crossing
   axes — may need a measured exemption for runs over a bridge deck/ramp.
3. Full npm run build (unpiped). 4. Browser QA + screenshots (top-down
   grid, walk two bridges). 5. Update PR #286.

## Numbers to beat / reproduce

- `scripts/with-node npm run check:park` — canonical: `poi.stranded: 35`.
- Bridges: 0/7 canonical, 0/7 seed 2 (`LGP_SEED=2`), 0/5 seed 18.
- `scripts/with-node node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/debug-crossings.mts`
  prints crossings/bridges/fallbacks from the real built ParkTrain.
