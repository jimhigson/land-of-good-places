# HANDOFF — unbridged rail crossing, seed 451, coplanar child truncation

Branch `eng/sphere-crossing-and-coping`, off `origin/eng/sphere-ground-claims` (PR #620).
PR target: **`eng/sphere-ground-claims`**, not `main`.

**Model: Opus 5 (1M context).** Chosen by the Overseer's dispatch (Engineer
default), and carried forward unchanged through two agent deaths — third agent
on this lane. Per CLAUDE.md, a replacement runs the same model; do not re-apply
a default here.

**Worktree:** `.claude/worktrees/sphere-crossings` (adopted from the second
agent, found clean and exactly at `origin` HEAD).

## Scope, as it ended up

Originally three of PR #620's five red checks. (2) bridge ramp grade and (3)
coping seating turned out to be **fixed on `eng/bridge-bend` and absent from
this base** — proved by `merge-base --is-ancestor` on `0c37d151` and
`9c3fc274`, neither an ancestor of `eng/sphere-ground-claims`. They are not
this branch's work and are not in this branch's diff; #628/#636 own them.

What this branch actually carries is (1) plus two things found on the way.

## (1) The station lead — VERIFIED, with one figure corrected

Root cause, unchanged and re-confirmed: the station spur's lead was
`standX + parkX * 6`, a bare 6 m step resting on `crossingPlan.ts`'s stated
premise that "the loop is simple (never self-crossing), so the sign is stable
park-wide". On seed 451 the loop runs back within **3.95 m of itself** beside
station 0, so the step landed across the far limb, 0.76 m from a rail centre
line, and the spur drew `lead -> approach` over live rails at railD 133.6
where no bridge site exists.

Two fixes, both kept:

- `planStationLead` (`plan.ts`) — keeps the 6 m reach and **turns the
  bearing** into the platform's empty half until both drawn legs clear every
  foreign limb by `FENCE_OFFSET + STATION_SPUR_WIDTH / 2`.
- `clearStationDistance` (`plan.ts`) — its park-side approach probe knew only
  about `clearOfPlots`, the hand-picked obstacle list CLAUDE.md's procgen rule
  warns about, and was blind to the loop's own other limb. It now also demands
  `distanceToForeignRail >= STATION_LEAD_RAIL_MARGIN`.
- `STATION_SPUR_WIDTH` moved to `clearance.ts` so `paths.ts` (which paves) and
  `plan.ts` (which sizes against half of it) cannot drift.

### !! The "18 of 20 stations keep their lead" control was STALE

Re-measured on the branch as it stands, over eleven seeds (the ten in
`PARK_SEED_POOL` plus `CANONICAL_PARK_SEED`), two stations each:

**22 of 22 stations keep exactly the lead they had — swing 0 deg, reach
6.000 m. The swing never fires on any seed in the pool.**

The 18-of-20 figure was honest when written and describes an intermediate
state: it was measured when `planStationLead` existed but
`clearStationDistance` had not yet gained its rail probe. Once the station
itself is sited off the pinch, its park-ward lead clears unaided. Proved both
ways on the same builds:

| state | seed 24 st0 | seed 451 st0 | all other stations |
|---|---|---|---|
| branch as it stands | 0 deg | 0 deg | 0 deg |
| `clearStationDistance` rail probe suppressed | **35 deg** | **50 deg** | 0 deg |
| `STATION_LEAD_RAIL_MARGIN` forced to 999 (instrument control) | 80 deg | 75 deg | 0 deg |

Row 2 reproduces the old note's numbers exactly, which is what identifies it
as a measurement of the earlier state rather than a disagreement. Row 3 is the
control on the instrument, run before trusting row 1: it proves the swing
*can* be reported non-zero, so the zeros are a measurement and not a mechanism
incapable of moving.

**Consequence for review:** `planStationLead`'s swing is **armed and
unexercised**. It asserts nothing about any seed shipping today; the station
siting fix is what carries the pool. That is now written into `plan.ts`'s own
doc comments rather than left for the next agent to discover — the old
comments claimed the 18-of-20 split and were corrected in place.

Instrument used: `scripts/zz-lead-control.mts`, scratch, **deleted** before the
PR. It read `TRAIN_PLAN`, recomputed the old bare formula from
`route.pointAt(distance)`, and printed moved-distance / swing / reach per
station. Re-create it from this table if you need it again.

## (2) Seed 451 retired — reason recorded where it will be read

`parkSeedPool.ts` carries the full account: `SELF_CLEARANCE = 3` in
`train/route.ts` is the upstream cause; the honest game-derived value ~8.2
(`FENCE_OFFSET*2 + FENCE_HALF_THICKNESS*2 + STATION_SPUR_WIDTH +
PLAYER_RADIUS*2`) fixes 451 and leaves **seed 24 with no bridge site anywhere**;
and `scripts/warp-search.mts 451` came back **UNSOLVED after 35 candidates /
2220 s with three oracle rejections**. Retirement under the standing ruling
(a seed the *old* generator cannot build is retired while the round-robin
rewrite is in flight), not an assertion weakened.

## (3) `check:coplanar` lost every finding past 64 KiB

`e72133f2` moves the child's `process.exit(0)` into the write's own callback.
`process.stdout` to a pipe is async and `process.exit` does not flush it.

**Numbers:** the previously reported backlog (~53–54 new-or-worse seams) was
measured **with the truncating child**, so it is a floor, not the backlog. Per
that commit's own note the baseline must be **re-derived, never topped up**.

## Gate status

See the PR description — it states every red plainly, including the base
branch's own known reds (#630 owns those on `eng/sphere-six-reds`).

## Measurement traps hit, for whoever follows

- `mv scripts/diag-*.mts` swept up **9 pre-existing tracked** diag scripts.
  Remove scratch by exact filename.
- A warp sweep wrapped in `timeout 240` reported 0 unbridged on every vector;
  the builds were being killed and `grep -c` read the empty output as a pass.
  Assert the build completed, not just that the bad string is absent.
- `nohup ... &` inside a backgrounded tool call dies with its wrapper shell.
- Scripts here need `--import ./scripts/ts-extension-resolver-register.mjs`;
  plain `node scripts/foo.mts` dies on `src`'s extensionless imports.
- **`git stash` is banned in this repo** (shared across worktrees). To set a
  measurement mutation aside, `cp` the file and `cp` it back, then confirm
  `git status` is clean before believing the next reading.
