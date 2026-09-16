# The rides ride the sphere — adopted and made measurable

**Model: Opus** (`claude-opus-5[1m]`), chosen by the Overseer. A replacement runs the same model.

**Branch:** `eng/rides-sphere-lean`, cut fresh from `origin/feat/sphere-combined` at
667e743e (after #620, scale 1). **Worktree:** `.claude/worktrees/rides-sphere-lean`.
Supersedes `eng/rides-sphere` (idle, left as it was).

## What was carried from `eng/rides-sphere`, and what was not

Cherry-picked: the coaster cart on its rails (b4aedd35), the race tub leaning
(06c109a2), train/ferris/race camera leaning (ebd78a33, 5cda9ed3), and the race
camera + check work (cf0851f6, 72064820, bc1fb848).

**Not carried**: the castle carve (166bb210, 232421eb) — it is what silenced 93
procgen tests on the old branch; the #620 lane commits (already squashed into the
base); slide instruments; handoff-only commits; binary screenshots.

## Done here

- `src/world/railRace/seat.ts` — one owner for `placeRaceCart` / `seatRaceRider`.
  `RailRace` and `check-rail-race.mts` both call it.
- `check-rail-race.mts` pose clauses place/seat through it and measure in the
  cart's own frame; face view uses a real `Player` in a real leant cart.
- `FACE_TURN_MAX` 50 -> 55 deg, `FACE_TURN_HEAD_SHARE` 0.42 -> 0.47 (shoulder
  turn unchanged at 29 deg). Visible.
- Took `eng/sphere-six-reds`' `riderPoint` + lane-climb clause verbatim.

`check:rail-race`: 6 FAIL -> **exit 0**. Mutation controls in the commit messages.

## Open findings, not fixed here

- **Sad rider's arms through the tub.** The arm sweep seats her with no body turn.
  With the real sad shoulder turn (29 deg) the worst arm goes **0.50–0.52 m**
  through the tub side (10 deg: 0.18 m). Pre-existing; the check does not cover it.
- `check:cruiser-clearance` red, identical with and without this branch (castle
  window/wall strikes at 313 and 337 m).
- `check:flat-primitives` red on the base (diag-*.mts, train/bridges.ts:929, two
  loose invariants.ts entries).
- `test:procgen`: 83 failed / 577 passed / 0 skipped — the **same 83 names** with
  this branch's ride sources reverted.
- Merging with `eng/sphere-six-reds` still conflicts in `railRace/camera.ts`
  (adjacent docblocks only) and `check-npc-perch.mts` (not this branch's file).
