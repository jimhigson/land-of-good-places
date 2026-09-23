# HANDOFF — path-ribbon (fix/path-ribbon, off feat/procgen-on-sphere @ 407825ef)

Model: Opus 5.5, Engineer, spawned by the Overseer. Logs: scratchpad/path-ribbon/.

## Findings
- Folds: canonical 189 face-down path-surface tris (64.5 m2), 451 face-down kerb tris. Two causes:
  (a) fillet radius ~0.7-1.2 m < half-width 1.3-1.6 -> inner offset swallowtail;
  (b) route control points with 6-16 cm jogs make the uniform Catmull-Rom (tension 0.4) flip its
      tangent (T.T' = -0.999), so the per-station normal flips and left/right edges swap.
- kerb|surface coplanar, base: canonical 0.1997, seed 24 0.8724 (two sites), seed 131 0.0001; others 0.
  Sites are cross-route: another route's paving straddling bridge stone (sheets, 4 m tall) — which
  fix/paving-drape removes by re-routing — plus terrain chord-sag on steep ground (seed 24 -7.4,-23.5,
  both unlifted, kerb 1 mm above other route's paving).
- fix/paving-drape does not touch pathGraph.ts/pathSurface.ts: no textual overlap.

## Plan
1. Ribbon: normals from an arc-length chord (robust to jogs); each edge polyline trimmed of
   swallowtails at its self-intersection (fallback: hold); shared by paving and kerb bands.
2. Invariant: no paving triangle faces into the ground (upAt).
3. Drape: TBD after measuring paving-drape head (scratch worktree path-ribbon-drapecheck).

Probe scripts (untracked): scripts/_probe-*.mts. sweep.sh in scratchpad.
