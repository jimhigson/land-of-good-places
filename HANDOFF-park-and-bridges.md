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

## FINAL STATE — everything verified fresh at a160e8f

- `npm run build`: **EXIT 0**, unpiped — the entire check chain (all
  check:* scripts incl. check:park, check:solve-cost, check:park-boot,
  check:cat-bus) plus vite build.
- `test:procgen`: **418/418, 14/14 files, all five seeds** (fresh at the
  final commit).
- `check:park`: EXIT 0 on canonical (220/220), seed 2 (255/255), seed 18
  (215/215) — poi.stranded (29→35 at dispatch) is gone.
- Bridges (real, built, walkable): canonical **2 of 3** crossings, seed 2
  **2 of 3**, seed 18 **2 of 2** — was **0 everywhere**. The remaining
  level crossings are the gate walk's own fixed corridor (entrance
  furniture stands on its ramp ground) and planned level sites where the
  loop passes within ~6 m of itself.
- Real-browser QA: both canonical bridges crossed on foot by the real
  player via tap-to-move (peakY == deckY, far foot reached); screenshots
  on `qa-screenshots` branch under `park-and-bridges/` (commit 3bfe5d8).
- The statue ring is one true circle (measured drawn spread 0.01 m)
  with exactly 4 compass junctions; plots keep out of its annulus via the
  layout solver (Decision 5 delivered).
- Boot: the crossing plan solves in slices through SolveScheduler +
  a prewarm letterbox, like the train/cruiser/slide.

Follow-ups worth filing (not blockers): bridge decks carry no lamps at
night (everyPathIsLit exempts reservation ground; guard-rail lanterns
would be the real fix); rail/generate.ts gained an optional
boundaryMargin brief field, currently unused, kept as capability.

### This round landed (commit b66b66e)

- True-circle statue ring (spread 0.01 m), radius owned by
  `parkLayout.RING_RADIUS`; plots keep out of the ring annulus via
  `validate()`; exactly 4 compass junctions (`RING_COMPASS_POINTS`).
- `stall.keychain` manifest band moved outside the ring (old band's only
  remaining ground was inside the fountain basin).
- `enforceRailSide` enforces corridor clearance, not just side;
  `fenceFollowRoute` picks the boundary-viable direction;
  `doubleCrossingLeg` serves pockets whose own side pinches out by
  crossing the railway twice through planned sites.
- `STATION_GAP` moved to `train/clearance` (leaf);
  `crossingsArePlannedAndMostlyBridged` invariant added (station-clear
  gaps; >=1 bridge when crossings exist; bridges >= level crossings).
- Rail-solver boundary-margin experiment tried and REVERTED (seed 2's
  rail stops solving even at 113 m with a 7.5 m rim margin — the layout
  is too dense; the double-crossing router is the working answer).
- check:park EXIT 0 on all three required seeds; bridges 2/3, 2/3, 2/2.

## Numbers to beat / reproduce

- `scripts/with-node npm run check:park` — canonical: `poi.stranded: 35`.
- Bridges: 0/7 canonical, 0/7 seed 2 (`LGP_SEED=2`), 0/5 seed 18.
- `scripts/with-node node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/debug-crossings.mts`
  prints crossings/bridges/fallbacks from the real built ParkTrain.
