# HANDOFF — sb-keyring (check:keyring-view on all 16 seeds)

Model: Claude Opus 5.5, chosen by the structural-backtrack engineer.
Branch `fix/sb-keyring` (from origin/wip/sb-merge), worktree `.claude/worktrees/sb-keyring`. No PR.

## Task
`check:keyring-view` red on some seeds (sweep: 4, 8 landscape gap 0.274/0.269 < 0.280 finger;
5, 12 portrait ring "0.000 m into margin"). Fix at cause, never loosen 0.280 / margin.

## Findings so far
- Zoom is already derived (`KeychainShop.viewZoom`: min(max(wanted, floor), ceiling)).
  When floor (finger) > ceiling (all fit), ceiling wins -> the zoom *cannot* satisfy both.
  Feasibility is zoom-independent: need gap >= 2*40px*halfExtent*(1+m)/viewportPx on each axis.
- Seeds 5/12 "0.000 m into margin" = ceiling binding exactly; float tie at the edge.
- Suspect: framed subjects are world-AABBs of each rotated ring (Box3.setFromObject),
  inflated by the stall's per-seed facing. Probe: scripts/probe-keyring-sb.mts (scratch, not committed).
- NB: on this branch LGP_SEED=4 passes (gap 0.380); the sweep ran an older park.
