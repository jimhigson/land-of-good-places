# HANDOFF — rebasing #216 onto main, and the honest state of the rim invariant

Engineer `e-ring-rebase`, 5 Aug 2026. Worktree
`.claude/worktrees/e-ring-rebase`, local branch `e-ring-rebase-work`, pushed to
`feat/railrace-ring-boundary`. `npm ci` run inside it. No dev server, no
browser.

`.claude/worktrees/e9-ring` holds the same branch and belongs to the previous
engineer — **left exactly as found**, which is why this worktree uses a
differently-named local branch and pushes to the shared remote one.

## State: #216 is mergeable. Build 0, procgen 127/127.

## 1. The rebase — done, one conflict

Was `CONFLICTING`/`DIRTY`. Rebased 20 commits onto `origin/main` @ `ff17910`.
**Merge base now equals main's tip.**

Exactly one conflict, `src/world/coaster/route.ts`: main added imports
(`RouteInfluence`, `BUILDING_CENTRE_*`) to the same block where this branch
re-pointed `circleBoundary` at the unified `world/boundary.ts`. Both sides kept.

One follow-on the conflict did not surface: `scripts/measure-solver-budget.mts`
is **new on main today** and imported `src/world/rail/boundary.ts`, which this
branch deletes. Re-pointed it at `src/world/boundary.ts` (compatible signature —
the extra centre args default). Without this the branch would have been a
dangling import that `tsc` catches only once scripts are typechecked.

### How survival was verified (do it this way, not per-commit)

Per-file `git diff origin/main HEAD -- <file>`, then compared the whole
diffstat against a pre-rebase snapshot of `git diff <old-base> <old-tip>`:

- **Every file's insertion/deletion counts are identical pre- and
  post-rebase.** The only delta in the entire diffstat is
  `scripts/measure-solver-budget.mts | 2 +-`, the intentional fix above.
- That is what proves the merge was *additive*: if main's work had been
  clobbered, the diff against main would have grown to include undoing it.

Snapshots kept in the session scratchpad (`branch-total.stat`,
`post-rebase.stat`).

### package.json

**This branch does not touch `package.json` at all** — it is byte-identical to
main's, so none of today's build gates could have been dropped. Verified
mechanically anyway: every `npm run <x>` referenced from any script is defined
(0 dangling), and `build` still chains today's new gates —
`check:cruiser-clearance`, `check:castle-window`, `check:statue-occlusion`,
`check:baked-face`, `check:cart-shape`. All of them run and pass here.

## 2. The rim invariant — narrowed, and exactly how

`railRaceStallStandsAtTheRim` failed 5 seeds of 5. **Do not try to close it with
a pin** — that was measured exhaustively by the previous engineer and is a dead
end; see `HANDOFF-railrace-ring.md`. Confirmed again from this rebase's own run:

| seed | booth gap | nearest rival |
|---|---|---|
| canonical | 43.1 m | `waterFight` 34.0 m |
| 2 | 38.8 m | `dodgems` 34.2 m |
| 5 | 39.1 m | `ferrisWheel` 35.2 m |
| 11 | 50.0 m | `ferrisWheel` 33.6 m |
| 18 | 50.2 m | `ferrisWheel` 33.3 m |

The rivals are mostly **anchors** — `ferrisWheel`, `dodgems`, `building`,
`ballPit` — which the layout solver re-places every seed. That is the whole
argument: **a fixed pin cannot satisfy a relational invariant when the ring and
its rivals move per seed and the pin does not.**

### What was done

Split it, renamed it `railRaceStallDoormatIsUsable`, test name *"the rail-race
stall's doormat is standable and reachable"*.

- **Stopped claiming:** the booth's gap to the ring is the smallest of every
  plot in the park. Handed to **#117**, which places a stall by relation to its
  ride and so satisfies it *by construction* on every seed. #117 waits on **#222**
  (scenery RNG decoupling) in turn.
- **Still claims, green on all five seeds:** the doormat has standable ground,
  and it is reachable from the park entrance on the real nav lattice.

The kept half is not filler — those are the two properties *this* PR can break
(it moves the ride exit and rewrites spur branching via `bestBranchPoint`), and
**reachability is checked for no other entrance anywhere in the file**, so
deleting the whole invariant would have lost real coverage.

This is not "weakening an assertion to make a seed pass": there is no good seed
to swap to (5 of 5 fail), and the dropped claim is not about the booth being at
the rim any more — with the ring at 60–108 m and plots capped at
`PLOT_EXTENT_LIMIT` 52, it is a statement about global plot *ordering*.

Also removed in the same commit: the `ENTRANCE_WALL_RADIUS` import this branch
made dead, and a stale doc bullet on `railRaceRingsStandOutsideThePark` that
still described the old radius check instead of the outset one.

**Do not run `npx prettier` in this repo.** Prettier is not a dependency and
there is no config, so it reformats whole files to its own 80-col defaults. Cost
me one revert; the file was restored and the edits redone by hand.

## 3. Spin-offs

- **`ferrisKiosk()` — filed as #233, not fixed here.** Measured: the wheel's
  entrance is 12.40 m from its centre, already inside its `boundingRadius` of 13,
  so the stand derived 3.1 m along the kiosk's facing lands at **10.61 m — 2.39 m
  inside the exclusion disc**, and 0.39 m inside the wheel's own 11 m footprint.
  That stand is `(20.89, 20.24)`: the exact `poi.stranded` waypoint that failed
  all 344 enumerated booth positions. **Flipping the kiosk to the other side does
  not fix it** (2.49 m inside — marginally worse); the kiosk must move out to
  `boundingRadius + reach` = 16.10 m, which moves a plot, moves a spur, and hits
  the #222 cascade. Not cheap, so filed.
- **`rail.exclusion` tension** — the rim claim and `rail.exclusion` pull against
  each other: best case leaves 22 against a budget of 21, about 1 m in 362 m.
  Stated in the PR so whoever takes #117 knows.

## 4. Verification (exit codes read directly, never piped through head/tail)

- `npm run build` → **0**
- `npm run test:procgen` → **0**, `Test Files 8 passed (8)`, `Tests 127 passed (127)`

**Read the counts, not the colour.** 127 is the same total as the failing run
before the change (`5 failed | 122 passed (127)`), which is what proves the
narrowing removed a *claim* and not a *test*. Zero skipped — a seed-dependent
module-load failure shows up as skips, and there are none. Confirmed the renamed
invariant actually executes with a verbose run on the canonical seed.

## Not done, deliberately

Not merged — Jim merges. QA still owes the phone check: **18.6 px/m in portrait,
down from 27.6** (floor 15, the family's "too zoomed out" complaint was 10.4).
That is a real visible change on a child's device and a number passing is not the
same as it looking right.
