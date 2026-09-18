# Handoff — plan-time refusals for the `check:park` residue

**Model: Opus 5 (1M context)**, spawned by the Overseer as an Engineer on a
slice of the procgen-backtracking rework.

> **Flag for the Overseer, raised at the start:** `HANDOFF-backtracking.md` on
> the base branch says *"Model: Fable (`claude-fable-5-1`), Jim's standing
> ruling for the procgen rework; a replacement runs Fable."* I am Opus and was
> dispatched as a new engineer on a slice rather than as that agent's
> replacement. Reported, not acted on.

Branch `feat/plan-time-refusals`, off `origin/feat/procgen-on-sphere`
(ae20b9fc). Worktree `.claude/worktrees/plan-time-refusals`. PR against
`feat/procgen-on-sphere`. Do not merge.

Read `HANDOFF-backtracking.md` first — driver, `FeatureBuilder`, refusals,
the two import-order traps.

## The task

Turn the post-build `check:park` residue (`poi.nospot`, `rail.walkable`,
`anchor.reach:waterFight`) into **plan-time refusals**, so the round-robin
backtracks away from the bad decision rather than shipping a park that
happens to come out right.

## Where the residue lives, if you have to find it again

- `poi.nospot` — `scripts/check-park.mts` ~line 536. `PoiGraph` drops a
  waypoint seed with nowhere within `NUDGE_REACH` a child can stand.
  No `RATCHET` entry, so any count > 0 fails.
- `rail.walkable` — `scripts/check-park.mts` ~line 749. A track centre-line
  sample that `isStandable` **and** `walkReachable`, not on a bridge. No
  `RATCHET` entry (deleted 7 Aug 2026, issue #241), so any count > 0 fails.
- `anchor.reach:waterFight` — `scripts/check-park.mts` ~line 905. Built lumps
  beyond `anchor.boundingRadius`. `RATCHET` entry exists at **worst 0**, so
  any overrun > 0 fails.

The precedent to copy: `pathGraphBuilder.solve` in `src/world/parkPlan.ts`
(the `outside` boundary screen, `screenDrawnPathsForOffSiteCrossings`, and
`pinchedSample`). The trap recorded there: a screen that asks a *different*
question from the build-time check is worse than no screen.

## Two at-source fixes already on the base that may have closed residue

Found by reading, before the sweep landed — both postdate the handoff table
they would invalidate, which is why step 1 is "measure, don't quote":

- **`rail.walkable`** — `src/world/train/fence.ts` ~line 118 records the exact
  fault: `deckSpanAt`'s offset probes were allowed to vote from *off* the
  deck's end, reading ground level beside the deck and pinning the seam's top
  there, leaving "a half-metre of bare rail a child could stand on,
  `check:park`'s `rail.walkable: 1` on seeds 4, 6 and 9 (one sample each,
  always the sample just before a deck begins)". The fix — only a probe the
  bridge actually covers may vote — is in the file.
- **`anchor.reach:waterFight`** — `src/world/parkManifest.ts` ~line 170 now
  declares `boundingRadius: 19`, raised from 16.3 because "the worst of seeds
  0–15 built out to 18.8 (seed 12; 18.6 on seed 6), so the declaration follows
  what is built". That closes the finding by **declaring what is built**, not
  by refusing anything.

So the live question for both is whether the class is genuinely dead or
merely absent from 0..15 — hence the planned wider sweep.

## Screenability, per class (analysis, before data)

- `poi.nospot` — **screenable**. A waypoint seed with nowhere to stand is a
  seed inside a *planned solid*; the claims registry holds those at plan
  time. Both recorded root causes (a spur routed outside the boundary; a seed
  inside castle turret stone) are plan-visible.
- `rail.walkable` — **not honestly screenable as written**. The build-time
  asker is `isStandable`/`walkReachable` against the `CollisionWorld`, and the
  fence that answers it (`buildRailFence`) needs a `CollisionWorld` and
  `Bridge[]` — both World-time. A plan-time screen would ask a *different*
  question (fence-segment coverage), which is exactly the `computeCrossings`
  trap the brief warns about.
- `anchor.reach:waterFight` — **screenable after all, and this corrects my
  own first reading above.** `src/minigames/waterFight/plot.ts` dresses the
  plot from `new Rng(0x77a7e5)` — a **fixed** stream, not the park seed — so
  the dressing is geometrically *identical in plot-local metres on every
  seed*. What varies is the world-space reach, because the plot group "leans
  to the local up" on the sphere, so how far the dressing throws out depends
  on **where the layout put the plot**. That makes the measured reach a
  function of a plan decision (`layout`), which is precisely what a plan-time
  refusal can consume. The ratchet note in `parkManifest.ts` saying "the pools
  and hedges are seeded per park" is **stale** — correct it if this lands.

  Traced the whole chain to be sure: `AnchorPlots`' constructor puts each plot
  group at `(x, terrainHeight(x,z), z)` and leans it with `standOnSphere`, and
  `groundInPlot` derives every prop's local `y` from the plot centre. So an
  anchor's world-space reach is a **pure function of its plot centre plus a
  fixed local model** — no World state in it, which is why a plan-time asker
  is possible at all. The one-owner shape, if it is needed: the dressing
  publishes its local lumps once, and one function projects them through the
  plot transform for a candidate centre; `check:park` and the plan screen both
  call it, the way `crossingPredicate.ts` is one predicate with three askers.
  A second hand-written reach formula beside it would be the exact fault this
  repo keeps paying for.

## Status

- [x] Worktree, `pnpm install --frozen-lockfile`, Node 26.5.0.
- [ ] **Step 1 — measure.** Baseline sweep `LGP_SEED=0..15 pnpm run check:park`,
      one process at a time, running now into
      `<scratchpad>/sweep-base/`. Handoff numbers are from an earlier commit
      and are treated as stale.
- [ ] Step 2 — screens for whatever residue is still there.
- [ ] Step 3 — proofs: trace evidence each screen fires; control-first honesty
      proof; two-process determinism; `test:procgen` name-diff; `check:park-boot`.

## The timings in the table below are CONTAMINATED — read this first

Caught with `ps` while seed 7 was running: **three other `check-park.mts`
processes** (PIDs 1248/1249/1250, another agent's worktree, started together)
were running at the same time as mine. So the wall-clock seconds per seed
below are four-way-contended numbers, not clean ones, and seed 7 overrunning
the 1003 s the previous sweep recorded is at least partly that rather than a
regression.

**Do not quote these seconds as a solve-time baseline**, and do not compare
them against the sibling engineer's 574 s / 846 s figures — those were taken
under different load. The pass/fail column is unaffected (the park a seed
builds is deterministic; only how long it takes is not), so the residue
answer this slice exists to give still stands. If a clean timing baseline is
wanted, it has to be re-taken with the machine to itself.

I did **not** kill those processes: they are another agent's live work.

**Proof that the slowdown is load and not a regression**, which is worth
more than the caveat: seed 7's driver counts came out **42 refusals, 31
unwinds, 2 decision zeros** — *exactly* the numbers `HANDOFF-backtracking.md`
records for it. Same park, same search, same decisions; only the wall clock
moved (1334 s here against 1003 s there). The driver's own counts are the
load-independent measure of solve cost, and they are unchanged. Use those,
not seconds, when comparing solve cost across agents.

## Measurements (re-taken at this head)

Baseline sweep, `ae20b9fc` + nothing: **in progress**, table below filled as
it lands.

| seed | rc | secs | residue |
|---|---|---|---|
**COMPLETE. 16/16 green, ratchet enforced, one process per seed.** Quoted off
the screen: every seed `rc=0`, and grepping all sixteen logs for
`no allowance — this is new` / `it has got worse` / `invariant regression`
returns **nothing**. Not one of the three residue classes appears on any seed.

| seed | rc | secs | notes |
|---|---|---|---|
| 0 | 0 | 11 | 6 refusals, 1 unwind, decision-zero 1 |
| 1 | 0 | 11 | 0 refusals |
| 2 | 0 | 27 | 0 refusals |
| 3 | 0 | 116 | 3 refusals, 6 unwinds, train attempt 3 |
| 4 | 0 | 231 | 14 refusals, 5 unwinds, decision-zero 1 — **was `poi.nospot` 2 + `rail.walkable` 1** |
| 5 | 0 | 11 | 0 refusals |
| 6 | 0 | 27 | 0 refusals — **was `rail.walkable` 1 + `anchor.reach:waterFight`** |
| 7 | 0 | 1334 | 42 refusals, 31 unwinds, decision-zero 2 — identical to the base handoff |
| 8 | 0 | 13 | **was a World throw at `buildBridges` after a 330 s plan** |
| 9 | 0 | 10 | **was `rail.walkable` 1** |
| 10 | 0 | 17 | |
| 11 | 0 | 9 | |
| 12 | 0 | 12 | **was `anchor.reach:waterFight` 0.3** |
| 13 | 0 | 6 | |
| 14 | 0 | 44 | |
| 15 | 0 | 44 | |

(The seconds are contended — see the warning above. The verdicts are not.)

## CONTROL 1 DID NOT FIRE — read before trusting the green sweep

`control.sh on fence` was applied (the run's own transcript shows
`src/world/train/fence.ts | 2 +-` before the sweep started, so the mutation
was really in the tree), and **seed 9 still passed, `rc=0`, in 11 s**.

Reverting the `deckSpanAt` guard does **not** reproduce `rail.walkable` at
this head. That is CLAUDE.md's "a red-run transcript is a measurement, and
measurements go stale" happening in front of us: the note in `fence.ts` was
written against a different park (pre-sphere geometry), and the mutation no
longer reaches the case on the parks these seeds now build.

**Consequence: a green sweep plus a control that did not fire proves
nothing.** The `rail.walkable` finding has not been shown to be armed, so
"the class is closed" is not yet a claim this branch may make. An
independent arming proof is needed — the obvious one is to stop
`buildRailFence` placing any collider at all, which should make a large
number of centre-line points standable; if *that* does not go red, the
finding itself is broken and that is the bug to fix.

Do not delete this section if a later control succeeds. The fact that the
documented reproduction rotted is itself the finding.

**Confirmed on all three of its documented seeds.** With the mutation in the
tree: seed 9 `rc=0` 11 s, seed 6 `rc=0` 31 s, seed 4 `rc=0` 253 s. The
reproduction is dead, not merely unlucky on one seed.

## The findings ARE armed — proved independently

Having established that the *documented* mutation no longer reaches the case,
each finding was armed by a mutation chosen to reach it directly.

**`rail.walkable` — armed.** `control.sh on nofence` makes `addFenceWall` and
`linkCentre` return before adding any collider (i.e. the railway gets no
exclusion fence at all). Seed 13, which passes in 6 s normally:

```
rail: 383 m of loop, 323 m unflanked, 338/383 centre-line points standable
check:park: 3 invariant regression(s):
  route.crossesRail: 16 (no allowance — this is new)
  rail.exclusion: 323.4 (no allowance — this is new)
  rail.walkable: 338 (no allowance — this is new)
```

`rc=1`. Real numbers, no `NaN`, no `Infinity`. Geometry it was proved
against: seed 13's park at `ae20b9fc`, 383 m loop.

**`anchor.reach:waterFight` — armed.** `control.sh on manifest` puts the
declaration back to the pre-sphere 16.3 m. Seed 6:

```
check:park: 1 invariant regression(s):
  anchor.reach:waterFight: 2.3, recorded at 0 — it has got worse
```

`rc=1`. Geometry: seed 6's park at `ae20b9fc`, waterFight built out to 18.6 m
against a 16.3 m declaration.

**A second thing that control turned up, and it matters.** On **seed 12** the
same 16.3 m declaration produced an overrun of **0** — *"declares a bounding
radius of 16.3 m but has built out to 16.3 m"*. The base handoff records seed
12 as the **worst** seed at 18.8 m, which is the number `parkManifest.ts`'s
comment cites to justify declaring 19. Seed 12 now builds out to 16.3.

## That second control was measuring a park it had itself changed

Worth reading before anyone reuses it. `boundingRadius` is **not a yardstick,
it is an input**: `parkLayout.ts` consumes it in the plot-admissibility test
(edge gap, gate corridor, ring clearance, plot-to-plot gap, lines 1028–1055),
and `LampPosts`, `Flowers`, `TreeLights` and `Scenery` all keep out of it.

So lowering it to 16.3 m builds a **different park**, and the 18.6 m it
measured is that other park's reach, not this one's. Proved rather than
assumed — same seed 6, same commit, `--verbose` both ways:

```
control (16.3):  anchor:waterFight  routed in 4 waypoint(s) ... built out to 18.6 m
normal  (19):    anchor:waterFight  routed in 6 waypoint(s) ... built out to 16.4 m
```

Different waypoint counts: the park moved. (The plan trace is identical —
`increments=7 refusals=0` both ways — so a plan-trace comparison would have
missed this entirely. That is worth remembering: equal driver counts do not
mean equal parks.)

**What that control does and does not prove.** It proves the
`anchor.reach:waterFight` finding is armed and reports real numbers. It
proves **nothing** about how much margin the real 19 m declaration has. For
that, measure the unmutated park — below.

## The real margin: `anchor:waterFight` built-out reach, 13 seeds

`LGP_SEED=n pnpm run check:park -- --verbose`, unmutated, read off the
check's own anchor table:

| built out to | seeds |
|---|---|
| 16.2 m | 10 |
| 16.3 m | 1 |
| 16.4 m | 2, 6, 8, 9, 11, 12, 13, 14, 15 |
| 16.6 m | 0 |
| 17.4 m | 5 |

Against a declared **19 m**: the worst seed measured leaves **1.6 m** of
margin and the typical one **2.6 m**. Not 0.2 m. The class is closed with
real room, not by luck.

**Seeds 3, 4 and 7 are not in this table** — they cost ~230 s, ~250 s and
~1330 s each and the sweep was already long. They passed the ordinary
enforced-ratchet sweep, so their reach is under 19 m; their exact figure is
simply unmeasured. Say that rather than implying sixteen.

**The stale numbers to correct in `parkManifest.ts` if this lands.** Its
comment says *"the pools and hedges are seeded per park"* (they are not — a
fixed `Rng(0x77a7e5)`), and *"the worst of seeds 0–15 built out to 18.8 (seed
12; 18.6 on seed 6)"*. Seed 12 now builds out to **16.4** and seed 6 to
**16.4**. Both cited figures are stale, in the same way `fence.ts`'s
reproduction was.

## The three controls this slice owes (planned before running)

If the residue is gone, the claim "gone" is worth nothing until the
instrument is shown able to fire, and shown to be closed **at source** rather
than by a differently-drawn park. So, one control per class — restore the old
input, watch the finding come back, then restore:

1. `rail.walkable` — revert `fence.ts`'s `deckSpanAt` guard (*"Only a probe
   the bridge actually covers may vote"*), re-run seeds 4, 6, 9.
2. `anchor.reach:waterFight` — put `parkManifest.ts`'s `boundingRadius` back
   to 16.3, re-run seed 12 (and 6).
3. `poi.nospot` — disable `parkPlan.ts`'s `outside` boundary refusal in
   `pathGraphBuilder`, re-run seed 4. This one doubles as proof that an
   existing plan-time screen is load-bearing.
4. `poi.nospot`, fallback — `control.sh on nudge` sets `NUDGE_REACH` to
   0.01 m so no waypoint seed can find a spot. Control 3 proves the *screen*
   is load-bearing; if it comes back silent (the park may simply no longer
   route a spur outside on seed 4) that proves nothing about the **finding**
   being armed, and this one does. Run it only if 3 is silent, and say which
   of the two the evidence came from.

Paste the geometry each was proved against alongside the transcript — a
red-run transcript goes stale (CLAUDE.md).

**The control harness itself has been controlled.** It is
`<scratchpad>/control.sh <on|off> <fence|manifest|outside>`, and all three
were applied and reverted with `git diff --stat` empty afterwards — an
instrument that leaves residue in the tree would poison every run after it.
The `manifest` one was additionally checked to hit **waterFight**'s
`boundingRadius: 19` and not **dodgems**', which carries the identical
number six lines later; anchored on the following `id: 'dodgems'`, and the
diff confirms dodgems' 19 is untouched.

## `poi.nospot` is armed too

`control.sh on nudge` sets `NUDGE_REACH` to 0.01 m, so no waypoint seed can
find a spot. Seed 13, which passes in 6 s normally:

```
check:park: 1 invariant regression(s):
  poi.nospot: 246 (no allowance — this is new)
```

`rc=1`. Geometry: seed 13's park at `ae20b9fc`, 246 waypoint seeds.

Control 3 (disabling the `outside` boundary screen) was **not** run: the
trace evidence below shows that screen firing on real seeds, which is a
stronger and cheaper demonstration that it is load-bearing than mutating it
would have been.

## The existing plan-time screens DO fire — trace evidence

Pulled from the sixteen sweep logs (the driver prints its whole trace to
stderr on every headless build), so this is the ordinary run, not a
contrivance. Refusals by screen:

| screen | firings | seeds |
|---|---|---|
| `screenDrawnPathsForOffSiteCrossings` | 15 | 3 (×3), 4 (×1), 7 (×10), 15 (×1) |
| ...of which the **esplanade march** (drawn run −2) | 12 | mostly 7 |
| `parkPlan.pinchedSample` (the lane pinch) | 4 | 7 (×3), 15 (×1) |
| the `outside` boundary screen | 2 | 4 (×1), 7 (×1) |

Two verbatim excerpts, each showing the screen refusing and the driver
unwinding to the decision it consumed:

```
refused pathGraph#0 attempt=0 blockers=- consumed=train,layout: paths: drawn run 4 is
  pinched shut at (9.1, -41.2): nearest lane point is 30.27 m from the boundary edge
  (needs 1.07) and 2.77 m from the rail centreline (needs 2.80, in a band 0.50 m wide)
unwind to train#0 attempt=1 popped=3 for pathGraph: ...
```

```
refused pathGraph#0 attempt=0 blockers=- consumed=layout: paths: a drawn path leaves
  the park at (77.9, -14.8), 1.62 m outside the boundary wall
unwind to layout#0 attempt=1 popped=5 DECISION-ZERO for pathGraph: ...
```

Both consume the right decision and unwind to it — the lane pinch to the
`train`, the boundary escape to the `layout` (a decision zero, correctly:
nothing short of a different park fixes a plot whose spur cannot stay
inside the wall).

The coarse solvers refuse far more often than the screens do: 40 `train`
refusals and 12 `cruiser` refusals across the sweep, against 21 screen
refusals. The backtracking is doing real work on these seeds, not idling.

## The shape of the deliverable if the residue is gone

The brief anticipates this case. Then the work is:

1. The sweep table above, taken at this head, as the evidence.
2. The three controls, so "gone" means "the instrument still fires and the
   class is closed **at source**", not "this seed drew a different park".
3. A **wide sweep past the pool** (16..39, `LGP_RATCHET=off --verbose`, which
   reports drift rather than failing and prints each anchor's built-out
   margin) to answer "absent by luck?" — a class that returns off-pool is not
   closed, only hidden.
4. The one fragility already visible by reading: `anchor.reach:waterFight` is
   held at zero by a **hand-declared constant** (`boundingRadius: 19`) that
   somebody re-measured against seeds 0–15 and typed in. That is the repo's
   most expensive habit — two definitions of one thing kept in step by hand —
   and the margin is 0.2 m (seed 12 built to 18.8). If the wide sweep puts
   any seed past 19, the honest fix is a **refusal in the world phase** (the
   ride's own dressing builder retries when its lumps exceed its declared
   reach), not another re-typed number.
