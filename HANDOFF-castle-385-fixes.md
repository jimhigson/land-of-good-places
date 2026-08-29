# HANDOFF — PR #385 review fixes

Taking over `feat/castle-interior-376` after its author's session was lost.
PR is **approved**; these are small fixes only. Worktree:
`.claude/worktrees/castle-interior-376` (the original author's — clean and at
the pushed head when found, so reused rather than making a second one).

## Done and pushed

Commit "castle #376: the check asks castleFabric for the beam width instead of
copying it" — all three review fixes.

1. **`BEAM_WIDTH` exported** from `castleFabric.ts`. `check-castle.mts`'s
   `PLATE_BAND` and `castleDecor.ts`'s `PORTCULLIS_INSET` both imported it
   instead of hand-copying `0.4`. The near-wall ceiling failure message prints
   `PLATE_BAND` rather than a literal "0.40 m".
2. **`nearWall` vs `reachFromWall`** — *not* an inconsistency, and now says so.
   `Shell.ts` extrudes each wall run from `halfX - HALF_WALL` to
   `halfX + HALF_WALL`, so `INTERIOR_HALF_X` is the wall **centreline** and
   `WALL_FACE_X` is its room-side surface. `reachFromWall` (how far a prop
   sticks into the room) correctly uses the surface. `nearWall` (is a prop
   under the timber) correctly uses the centreline, because
   `castleFabric.ts:249` places the plate at `INTERIOR_HALF_X - PLATE_INSET`.
   Renamed to `PLATE_ROOM_EDGE_X/Z`, comment explains. **No value changed.**
3. **Negative `reachFromWall` now fails loudly** rather than being clamped —
   a box entirely past a wall face scored < 0 and passed the `<= 0.45`
   wall-furniture exemption. Zero instances hit it today.

## Findings worth keeping

- **`PLATE_BAND` was the only hand-copy of a live source constant in
  `check-castle.mts`.** The others are all legitimate: `WALL_FURNITURE_REACH`
  (0.45) and `FLOOR_TREATMENT_MAX_HEIGHT` (0.1) come from
  `HANDOFF-castle-interior-363.md` §5 and have no code owner to import;
  `FOOTPRINT_SAMPLES` and the 0.1 m soot-drift tolerance are the check's own
  thresholds; `EXTERIOR_MASONRY_PATTERN` is a documented, deliberate copy of an
  inline literal in a test-only module.
- **`PORTCULLIS_INSET`'s old comment was wrong twice over**: it claimed 0.1 m
  of margin past a 0.4 m band while the value was 0.7 (real margin ~0.255 m to
  the bar's near face), and claimed the plate's width could not be imported.
  Value unchanged at `BEAM_WIDTH + 0.3`; comment corrected.
- **The wall-plate is not actually flush with the wall**, despite
  `castleFabric.ts`'s comment saying so. Its centre is `BEAM_WIDTH / 2` in from
  the *centreline*, so 0.225 m of it is buried in the masonry and only 0.175 m
  stands proud. Harmless — and assertion 4 measures its edge distance off
  `INTERIOR_HALF_Z`, which over-states the sightline shadow, so it errs safe.
  Not touched: it is geometry, and this PR is approved for fixes only.

## Binding proof for fix 1

`BEAM_WIDTH` 0.4 → 1.6 in `castleFabric.ts` gave `check:castle` exit **1**,
29 failures, including the sightline assertion moving with it:
`sightline: the wall-plate stands 1.600 m off the wall, so at 38° it hides the
wall above 1.830 m.` Reverted; back to exit 0 with the reviewed baseline
numbers (416 beam segments, 989 instances, 537 wall-exempt).

## Gates

See the PR comment / final report. `check:castle` exit 0, `tsc --noEmit`
exit 0 after the fixes.

## Not done

Art notes (hotter flame, denser roof garden) — see below/PR. Do not merge;
the Overseer merges. Two branches are stacked on this one.
