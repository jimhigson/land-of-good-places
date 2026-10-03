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
