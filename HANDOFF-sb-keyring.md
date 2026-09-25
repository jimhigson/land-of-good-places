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
- The check (86ee...) now asserts each zone lands on its keyring's screen image, and prints
  the stall's distance, lean and facing. With the fix reverted it goes red from ~45 m.

## Status
- All-16 run: scratchpad sb-keyring/after.sh -> after-summary.txt.
- Still to do: prove red on a real seed (pick the one whose stall is farthest out, on the
  compressing side), tsc both projects, remove the scratch probes (untracked).
