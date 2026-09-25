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

## Next
- sweep holes seeds 0,5,11,15 fix vs base; add invariant (ParkFacts drawn samples) + red proof; park:attempt 0,5,11,15; check:coplanar; tsc both.
