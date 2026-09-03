# HANDOFF — 3D Artist, issue #489 (bridge parapet hole above the arch)

Branch `art/bridge-stones-489`, worktree
`.claude/worktrees/art-bridge-489`. Paired with an Engineer on
`fix/bridge-parapet-489`.

## Verdict, reached before any modelling: THE KIT IS NOT AT FAULT

The authored kit (`art/blend/bridge_stones_build.py` → `coping`, `voussoir`,
`keystone`) contains **no wall piece at all**. The parapet's outer face is not
kit geometry — it is swept procedurally by `buildShellGeometry` in
`src/world/train/bridges.ts`. Nothing in `art/blend/` can produce or cure this
hole. **This is the Engineer's half.** No change to `art/blend/*` is needed or
proposed.

The kit was also checked for the drift this repo has been bitten by before
(build script reading constants, render script hand-copying them):
`bridge_stones_build.py` reads every number through `ts_const()` from
`src/art/models/bridgeStones.ts` and `src/world/train/bridgeFootprint.ts`. No
copied numbers. Not the cause.

## Root cause (measured, not read)

`src/world/train/bridges.ts`, in `buildShellGeometry`, the course ladder:

```ts
for (let y = crownY; y > lowestBottom - COURSE_HEIGHT; y -= COURSE_HEIGHT) {
  if (y <= highestTop + COURSE_HEIGHT) courseLevels.push(y);
}
```

`crownY` is **the road surface at the crown**, not the top of the wall. The
loop starts there and only ever descends, so **no course level is ever
generated above the roadway**. `buildCourses` then clamps every column with
`yTop = Math.min(topY, Math.max(bottomY, levelTop))`, so the coursed outer
face tops out at `crownY` everywhere along the bridge — while the parapet
itself stands at `parapetTopFor(...) = surface + PARAPET_HEIGHT +
PARAPET_CROWN_LIFT·arc`, which at the crown is `crownY + ~1.23 m`.

That band — road level up to the coping, at its tallest exactly over the
arch, tapering to nothing towards the ramp feet — is drawn by nothing. It is
the hole Jim photographed.

The guard on the next line is the tell: `if (y <= highestTop + COURSE_HEIGHT)`
is a filter for levels *above* `highestTop`, and it can never fire, because
the loop begins below `highestTop`. The intent was clearly to start the ladder
above the wall top and skip down into it.

**Proposed one-line fix (Engineer's file, not mine):** start the ladder at the
first crown-anchored level at or above `highestTop`, keeping the existing
crown anchoring so courses stay level across both flanks —

```ts
const firstLevel = crownY + Math.ceil((highestTop - crownY) / COURSE_HEIGHT) * COURSE_HEIGHT;
for (let y = firstLevel; y > lowestBottom - COURSE_HEIGHT; y -= COURSE_HEIGHT) {
```

The existing `if (y <= highestTop + COURSE_HEIGHT)` guard then does the job it
was written for, and the degenerate-course clamping already in `buildCourses`
handles the rings where the parapet is lower.

## Measurement (seed 1, canonical; `probe-parapet2.mts` on this branch)

Horizontal rays cast at the near parapet across a ladder of heights, against
the `shell` mesh alone. `#` = wall present, `.` = daylight, from road−0.2 m
upward in 0.1 m steps:

```
bridge-72.0
  along   0  roadY 4.40  parapetTop 5.63 (=road+1.23)  .##....................
  along  -1  roadY 4.38  parapetTop 5.61 (=road+1.23)  ###....................
  along  -2  roadY 4.31  parapetTop 5.54 (=road+1.23)  ####...................
  along  -3  roadY 4.12  parapetTop 5.35 (=road+1.23)  ######.................
  along  -4  roadY 3.86  parapetTop 5.06 (=road+1.20)  ########...............
  along  -6  roadY 3.24  parapetTop 4.37 (=road+1.13)  ##############.........
  along  -8  roadY 2.63  parapetTop 3.68 (=road+1.06)  #############..........
```

Every run of `#` ends at **y = 4.40 = `crownY`**, whatever the local road
height. Missing wall: **1.23 m at the crown**, 0.83 m at 3 m out, 0.60 m at
4 m out, closing by about 6 m out. Both flanks, every bridge.

## Collision

The collision walls are built from `parapetTopFor` directly
(`bridges.ts` ~line 756), i.e. from the parapet's true top, not from the
drawn courses. So the **collider is correct and the mesh is the thing that is
wrong**: a child can see through the parapet above the arch but cannot walk
or fall through it. The fix restores geometry to match a collider that
already covers it; no collider change is required.

## Status

- [x] Kit inspected, cleared, drift check clean
- [x] Root cause measured on seed 1
- [ ] Per-seed confirmation (seeds 2, 3, 4 running)
- [ ] Before/after render for Jim
- [x] Reported to Overseer

`probe-parapet.mts` and `probe-parapet2.mts` at the worktree root are
diagnostics for this issue; delete or promote to `scripts/` before any PR.
