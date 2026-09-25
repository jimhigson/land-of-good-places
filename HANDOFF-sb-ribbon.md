# HANDOFF — sb-ribbon (fix/sb-ribbon, off origin/wip/sb-merge)

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Engineer.
Task: bring origin/fix/path-ribbon's path-fold fix onto wip/sb-merge, finish it, measure holes.
Scratch: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/sb-ribbon/
 (runs.sh = park:attempt queue, probes.sh = hole probe queue, _probe-*.mts = probes, copied untracked into scripts/, never commit)
Base comparison worktree: .claude/worktrees/sb-ribbon-base (origin/wip/sb-merge + the new invariant only, uncommitted). Remove at end.

## Done
- Merged origin/fix/path-ribbon (conflicts: GeometryBuilder methods kept both; invariants import union). dbg removed. tsc both green.
- Red proof: base (wip/sb-merge + invariant) park:attempt at recorded restarts, only failure = new invariant:
  s0 181 surface (56.90 m2)/336 kerb; s5 159/285; s11 277/476; s15 192/297. Fix: all four accepted, 0 face-down.
- Hole probe (_probe-holes: points square-on a drawn run within halfWidth-5cm not covered by face-up paving):
  fold fix alone left body holes and made some worse (pinches): seed 15 (58,32) jog 0.37 m -> bow-tie 1.2 m2.
- paths.ts drawnPolyline: easeJogsAndStubs (jog < 1 m between parallel legs -> eased diagonal 10:1; end stub < 1 m -> corner dropped; junction corners never moved).
- pathGraph.ts junctionAprons: disc+annulus kerb at route ends where bearings leave a >180 deg gap (not all within 45 deg = dead end), and at hairpin tips.

- easeJogsAndStubs also merges an overshoot (short leg between non-parallel legs) into the legs' intersection (seed 0 spur-ballPit (37.87,44.99)).
- pathSurface: ribbonEdges(..., repaired) reports stations it drew in/pinched; addPathRibbon lays a half-width paving disc (world UV, no kerb) at each (deduped 10 cm).
- Invariant noLawnShowsThroughThePaving (invariants.ts, after the facing one) + ParkFacts.drawnPathSamples. Along-run holes (connected, 0.1 m grid) and notches round
  junction ends (lawn arc < 150 deg; dead ends = all bearings within 45 deg; lawn past a dead end excluded; end-cut sliver band tan10*hw excluded). Max 0.05 m2.
  Base (wip/sb-merge + test files): red on 0 (1.06 notch at (-34.48,16.06)), 5 (1.33 at (30.58,32.08)), 11 (3.54 at (34.70,-13.60)), 15 (1.98 at (14.37,20.76)).
  Fix: 0/5/11/15 green, largest none. Mutation (aprons off) on fix seed 11: red 0.55 m2 at (-42.57,-11.96).
- Facing invariant base red: s0 181 surface/336 kerb, s5 159/285, s11 277/476, s15 192/297; fix 0.

- Gate: aprons/repair discs kept off bridges (seed 0 (-2.45,16.50) broke the bridge 2:1 kerb/surface vertex count) and off the gateway cap
  (seeds 2 and 13: check:coplanar NEW entrance-gateway-path|path-surface).
- FINAL (628cabc8 on base 2498aa4b): park:attempt 0:2 5:12 11:2 15:0 all accepted (109 measures). tsc both 0.
  check:coplanar exit 1 with ONE finding, pre-existing on base (same run on wip/sb-merge): railRace kid hair.shell.crop|torso, seed 9, 8.5 mm.
- Before/after plan plots: scratch sb-ribbon/ba/seed{0,5,11,15}-before-top-after-bottom.png.

## Done / not done
- wip/sb-merge moved since (castle radius, 10 commits, disjoint files, merges cleanly) - not re-verified on top of it.
- Old worktrees path-ribbon, path-ribbon-base, path-ribbon-drapecheck belong to the paused agent: left in place.
- Known risk: paving discs/aprons overlap ribbon paving in one mesh with different UVs (same class as every junction overlap; check:coplanar ignores same-mesh pairs). Needs eyes in a browser.
