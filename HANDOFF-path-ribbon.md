# HANDOFF — path-ribbon (fix/path-ribbon, off feat/procgen-on-sphere @ 407825ef)

Model: Opus 5.5, Engineer, spawned by the Overseer. STOPPED on request mid-task.
Logs/tools: scratchpad/path-ribbon/ (sweep.sh <worktree> <script> <out>, frames.mjs, *.png).
Extra worktrees: .claude/worktrees/path-ribbon-base (407825ef), path-ribbon-drapecheck (paving-drape head).

## Part 1 (folds) — state
- Causes: fillet radius ~1 m < half-width 1.3-1.6 (swallowtail); control-point jogs flip the
  Catmull-Rom tangent (edges swap); hairpin spurs that double back on themselves (canon route 17).
- Fix (src/world/pathSurface.ts): ribbonStations (across from +-0.5 m chord), ribbonEdges over the
  whole cross-section pathCrossSection(width) [kerb, paving, paving, kerb]: pass 1 cuts each edge's
  swallowtail at its crossing (search limited to 2*offset+0.5 m); pass 2 repairs any face-down
  triangle by drawing the inside half in towards the centreline (bisected), folding the inside kerb
  onto the paving edge, then the outside half; last resort pinches a station to its centreline point.
  GeometryBuilder.triangle drops plan slivers < 1 mm wide. Kerb bands (pathGraph addRibbonKerb) use
  the same edges. HEAD still has `dbg`/RIBBON_DEBUG console.log lines in ribbonEdges — REMOVE.
- Invariant noDrawnPavingFacesTheGround (test/procgen/invariants.ts): upAt-relative, sets aside
  triangles steeper than 60 deg (sheets from the drape; paving-drape's invariant owns those).
  Base red: canonical 189 surface/451 kerb face-down; seed 24 243/566. Branch: canonical+24 green.
- Ten-seed probe (branch, before the 60-deg set-aside): only sheet triangles left (24, 128, 274).
- Paved-area holes probe (_probe-holes): canonical 46.28 m2 uncovered vs base 46.71 (residue is
  route-end capsules, same on base). Not yet swept on the other nine seeds with the final code.
- Frames: fold-before/after.png (29.3,7.8 canon) show a smeared texture corner fixed; hole23/hole16
  before/after captured, not yet reviewed.

## Part 2 (kerb|surface on bridge ramps) — findings, no code yet
- Base kerbpair (sweepCoplanar, pair filter): canon 0.1997, 24 0.8724, 131 0.0001, rest 0.
- On fix/paving-drape head: 0 on all ten seeds. All base sites are other routes' paving straddling
  bridge stone (sheets) + one terrain chord-sag overlap (seed 24 -7.4,-23.5). Drape-level fix not
  started; likely moot once paving-drape lands — ask the Overseer.

## Not yet run
test:procgen full (base vs branch diff), check:coplanar, check:park 0..15, entrance-road, swept-bus,
determinism, pnpm run check. No PR opened.
