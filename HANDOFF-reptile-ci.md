# HANDOFF — reptile-ci (PR #708, branch feat/reptile-house, worktree .claude/worktrees/reptile-ci)

Model: Claude Opus 5.5 (Engineer, dispatched by the Overseer).
Push: `git push origin reptile-ci:feat/reptile-house`. Base: feat/procgen-on-sphere (b699c39d).
`timeout` does not exist on this Mac: use `perl -e 'alarm N; exec @ARGV' cmd`.

## Done
- Rebased onto b699c39d (41 commits, no conflicts; 3-dot stat identical before/after; package.json script set = base + reptile scripts + check:reptile-house in shard-4).
- Coplanar rh-head/rh-mouth: lining clipped to head grown LIP_PROUD=0.05 (art/blend/reptile_house_build.py), re-exported.
- check:flat-primitives (shard 1 red): 19 reptile sites marked `// flat-ok:` with reasons (hall is its own flat space at x 600, y 0).
- Castle hat shop displayed the Snake Hat (HAT_KINDS iteration) — now only hats sold at 'hat' (fitouts.ts).

## Findings
- Seed 5 traces (layout/plan/world) identical base vs branch. Outside the reptile roots, the only scene change is hotel pet beds grown by petBedFit (snakes are the largest sleepers) — intended.
- CI Park 1 red = seed 1 restart-1 SOLVE probe > 1800 s (PROBE_TIMEOUT_MS). Locally the same solve is 727 s base vs 728 s branch (51 internal layout restarts). Base passed only because its parks were reused from run 37041179411. Marginal CI timing, not a branch regression.

## Now (Overseer, new scope)
Place the reptile house as a normal anchor building on every seed 0..15, enlarge park boundary slightly (one constant), /spawn link to its doormat on seed 5, CI green, preview screenshot.

## Placement work (commits 09af53fb..0d27c269)
- anchors.ts 'reptileHouse'; parkManifest entry (footprint 10.5, bounding 12, band 24..90, door reach = DOOR_BAND_OUTER+DOORMAT_STANDOFF, pavedTo = DRAWN_DOOR_ALONG, cameraFacing).
- ReptileHouse: with a plot the exterior stands in anchor:reptileHouse via standInPlot (parkRoot); `doormat` getter is the one owner; standAtDoor uses it in the park.
- World passes placedEntry('reptileHouse') + anchorPlots, ownedBy('reptile house'); BUILT_SOLIDS includes it.
- Park growth: PARK_GROWTH = 1.0416 in core/constants.ts (linear; garden half-size, play radius, manifest bands via PARK_EXTENT_SCALE). PARK_AREA_MULTIPLIER 2.17 was tried first: pinned gate -> solveBoundaryRadii threw on seed 5 restart 4.
- Checks updated: check-reptile-house (park doormat, exterior in plot), check-tap-spacing (exterior zones + entry band in the park), check-deep-links (/reptile-house-door on ReptileHouse.doormat), invariants (rh-mouth as a door front; reptile band in tap clearance).
- Next: seed 5 acceptance locally (running), CI Parks for all 16, /spawn?pos= on the seed-5 doormat from the park file, preview screenshot.
