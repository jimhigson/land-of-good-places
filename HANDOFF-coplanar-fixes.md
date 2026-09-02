# HANDOFF — fixing the coplanar seams (#472 / #467)

Branch `fix/coplanar-all`, worktree `.claude/worktrees/coplanar-fixes`, based on
`feat/coplanar-sweep` (PR #473) — **not** `main`, because `pnpm run
check:coplanar` only exists on that branch and is how this work is measured.

A second, detached worktree `.claude/worktrees/coplanar-before` sits at
`origin/feat/coplanar-sweep` purely for before/after screenshots. **Remove it
when done** — it is not part of the branch.

## Where it stands

**281 seams → 270.** Six causes fixed, and one of them turned out to be a
placement bug rather than a rendering one.

| # | cause | seams | m² killed | commit |
|---|---|---|---|---|
| 1 | entrance road spur laid across the kerb, and again under the plaza paving | 1 + 1 shrunk | 48.43 + 22.05 | "The entrance road stops where the road it meets already is" |
| 2 | the deck roundel's inner disc under the mall rug | 1 | 30.39 | "The mall's roundel, the platform stripes…" |
| 3 | station deck's trackside face flush under its edge stripe | 2 | 4.90 | same |
| 4 | **two stations built in the same place on seeds 3 and 23** | 1 | 23.71 | same |
| 5 | seven shop unit placeholders hidden but never removed | 7 | 17.56 | "Seven dead shop placeholders…" |
| 6 | paddling pool water in the flat lawn slab's plane | 1 | 16.48 | same |

`check:coplanar` is green against a regenerated baseline at every commit. The
baseline was regenerated **per commit**, so the ratchet tightened as the count
fell rather than tolerating the improvement.

## The number nobody knew: how many causes the 281 collapse into

**216.** Not seven forecourts and a staircase kit — a genuine long tail.
Grouping the baseline keys by normalising the varying indices
(`bridge-N`, `shop:X`, `floor-N`, `-N`) gives:

- **18** `bridge-N/shell` ↔ `bridge-N/wallTop` — one cause, one builder
- **18** `bridge-N/deck` ↔ `bridge-N/shell` — one cause, and a **false
  positive** (see below)
- **7** shop forecourts — fixed
- 6 stall `<Group>` self-pairs, 6 train carriages, 4 wooden walls, 4+4 terrain
  vs bridge, 3 stations, 3 stall dressing, 3 terrain vs stall
- …and then **205 groups of exactly one**, most of them one prop's two parts.

So: **~11 groups cover 76 seams; the remaining ~205 are individual props.**
That is the fact that decides how to plan the rest of this, and it is why "fix
all 281 in one PR" is a much larger job than the forecourt example suggests.

## Proved on screen, not only in the sweep

`/private/tmp/.../scratchpad/shots/` — `before-gateway-down.png` versus
`after-gateway-down.png` is the decisive pair: the before frame's whole lower
half is torn into ragged hatched wedges where the two road slabs fight, and the
after frame is clean paving with an unbroken kerb line. `*-gateway-eye.png` is
the same thing from a child's eye height on arrival.

Captured with own headless Chromium (`playwright-core`, `channel: 'chromium'`),
dev server on **5623** `--strictPort`, killed by PID, port confirmed free.
`/view?camPos=0,9,69&camDir=0,-1,-0.25&timeOfDay=12:00` is the shot.

## Decisions worth not re-deriving

- **The gateway spur's stopping line is asked for, not written down.** It reads
  `paving.ts`'s `forEachPavedDisc`, **not** `pathGraph`'s `distanceToPath`,
  because importing `pathGraph` runs the whole path solve — that is the reason
  `paving.ts` exists at all. `Garden` (World.ts:99) builds the paths long
  before `Entrance` (World.ts:268), so it is live.
- **`visible` is the biggest source of "seams" that are not seams.** The sweep
  deliberately ignores it, and must — two-thirds of the game's meshes are
  hidden at build time because interiors are. But that makes a *permanently*
  hidden mesh indistinguishable from a temporarily hidden one. Two groups here
  are that: the shop placeholders (**fixed by deleting them**, which is the
  right answer and saves the draw calls too) and the bridges' `deck` marker
  (**not fixable** — see below).
- **A new seam is a real cost.** Lifting *all* the water-fight props onto the
  lawn killed the 16.48 m² pool seam and created a 0.19 m² hedge-vs-terrain
  seam on seed 115. The ratchet caught it and the fix was scoped to the pools.
  Do not skip re-running the sweep after a "surely harmless" widening.
- **The station overlap was found by a rendering check.** Worth remembering
  when triaging the rest: some of these are not modelling defects at all.

## Reasoned skips — seams that should NOT be "fixed"

**The 18 `bridge-N/deck` ↔ `bridge-N/shell` pairs (0.29 m² total).**
`bridges.ts:648` sets `deckMesh.visible = false` on purpose: it is a clearance
*marker*, kept only because `test/procgen/invariants.ts` needs an object
literally named `deck` to measure built tunnel clearance off, and
`Box3.setFromObject`/`getObjectByName` walk the graph regardless of `.visible`.
It costs no draw call and is never rendered. Deleting it would break the
clearance invariants; moving it would make them measure the wrong thing. These
are false positives and should stay in the baseline with this note against
them. All 18 rank ≤ 0.01 on the sweep's own visibility score.

## The next thing to do, and what I found out about it

**The 18 `shell`/`wallTop` pairs (4.00 m², visible, 0.5–1.3 m reach) are the
biggest remaining group and the one worth doing next.** Diagnosis, not yet
fixed:

`buildShellGeometry` (bridges.ts ~1055–1195) builds the outer flank as coursed
stone, alternating `COURSE_RECESS` by course index, and emits a **horizontal
reveal quad** between each course and the recessed one under it. Each course's
extent is clamped with `yTop = min(topY, max(bottomY, levelTop))`. Where the
parapet tapers out — `parapetHeightFor`, on the stretches where the hump is
barely above the ground — the top courses **collapse onto `parapetTop`**, and
their reveal becomes a horizontal quad lying exactly in the plane of the
`wallTop` coping strip (`shell.coping`, emitted flush at `parapetTop`). Same
root cause for the 4 `terrain`↔`wallTop` and 4 `terrain`↔`shell` pairs, where
the parapet has tapered to nothing and the strip lands in the terrain's plane.

The obvious fix — skipping the reveal for a collapsed course — **opens a real
slot**, because the coping runs from `halfAcross` inward while a recessed
course's top edge is inboard of that; the reveal is what closes it. So the fix
wants to be either "the course that meets the coping is never recessed" or "the
coping's outer edge follows the top course's own recess". Neither is a
five-minute change and both want measuring before and after.

## Gates, all confirmed on this branch

- `pnpm run check:coplanar` — exit 0, 270 seams, none new.
- `pnpm run test:procgen` — **17 files, 515 tests, exit 0.** Up from `main`'s
  510 by the five seeds of the new "no two stations stand in each other"
  invariant, which was **proved red** (forced `needed` to 500 m: "Sunny Side at
  (39.8, -22.1) and Bluebell Halt at (-34.6, -3.6) stand 76.7 m apart") and
  restored.
- `pnpm exec tsc --noEmit` and `-p tsconfig.test.json` — both exit 0.
- `pnpm run check` — see the last commit's own note; re-run it, it is 16 min.
- `pnpm run build` — run before the PR.
