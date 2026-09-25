# HANDOFF — sb-keyring (check:keyring-view on all 16 seeds)

Model: Claude Opus 5.5, chosen by the structural-backtrack engineer.
Branch `fix/sb-keyring` (from origin/wip/sb-merge), worktree `.claude/worktrees/sb-keyring`. No PR.

## Task
`check:keyring-view` red on some seeds (sweep: 4, 8 landscape gap 0.274/0.269 < 0.280 finger;
5, 12 portrait ring "0.000 m into margin"). Fix at cause, never loosen 0.280 / margin.

## Root cause (measured, committed 728b508e)
- The cart is leaned onto the sphere (standOnSphere, lean = dist/220 m), but the rack's tap
  zones and the positions viewZoom frames were a flat toWorld(x,z)+groundY+0.885. The camera
  leans with the sphere, so the drawn rack looks the same everywhere, but the flat points
  compress or spread with where the seed puts the stall.
- Sweep probe (scripts/probe-keyring-sweep-sb.mts, scratch, not committed; mutates
  STALL_PLACEMENTS.keychain and rebuilds the shop). Before: 128/648 placements fail, closest gap
  0.193 m (60 m out, bearing 0/90) to 0.436 m (bearing 180/270). After: 0/648, gap 0.333 m at every
  position, worst landscape margin 0.044 m at zoom 5.32 (< 5.5 cap), portrait slack 0.213 m.
- Second, smaller fix: framed subjects are now each charm's own box through its world
  matrix, not a world-axis AABB (it was inflated 18%/37% at a 45 deg facing).
- The check (7238af28) now asserts each zone lands on its keyring's screen image, and prints
  the stall's distance, lean and facing. With the fix reverted it goes red from ~45 m.

## Status: DONE (no PR, per brief)
- All 16 seeds, fixed code: check:keyring-view exit 0 on every one. Every seed now reports the
  same numbers: closest gap 0.341 m, landscape 0.044 m to spare, zones 0.088 m inside their images.
  Stalls are 13.9-25.3 m out, all facing 45 deg.
- Red proof (KeychainShop.ts reverted to 728b508e^, new check kept): LGP_SEED=5 (stall (6.8, 22.6),
  23.6 m out, lean 6.1 deg) exit 1, 7 problems: gap 0.278 m vs 0.279/0.280 m finger in portrait and
  landscape (landscape wanted zoom 6.362, clamped to 5.5), and ripika touching the portrait margin.
  LGP_SEED=4 (stall (-24.4, 5.1)) passes even reverted on this head (gap 0.380 m, the spreading
  side). The sweep's seed-4 red came from an older park.
- tsc (main) 0, typecheck:test 0; check:tap-spacing seed 5 exit 0.
- Scratch probes moved to scratchpad/sb-keyring/ (not committed).
