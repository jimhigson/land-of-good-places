# QA handoff — PRs #613 and #614 (pass halted mid-flight)

Written 11 September 2026 by the QA agent, on instruction to stop. This records
what was **measured**, what was **not reached**, and the findings either way.
Nothing here is a sign-off: neither PR was signed off.

## Which commits this was measured against — both PR heads moved during the pass

| PR | branch | head I measured | head at the time of writing |
|---|---|---|---|
| #613 | `fix/road-coverage` | **`628de5dc`** | `ced03827` (one commit newer) |
| #614 | `fix/coplanar-sphere` | **`2461309a`** | `3ca6b24b` (one commit newer) |

Both deltas are described below. **Re-check anything that touches
`check-entrance-road.mts` or `invariants.ts` against `ced03827`** — that commit
changes both of the files my #613 numbers came out of.

Worktrees used (all left clean, all detached, nothing committed to any PR
branch, nothing stashed):

```
.claude/worktrees/qa-613          628de5dc   fix/road-coverage
.claude/worktrees/qa-614          2461309a   fix/coplanar-sphere
.claude/worktrees/qa-base         36ee9ce4   feat/sphere-combined
.claude/worktrees/qa-main-ctl     dd5b3b6b   origin/main
.claude/worktrees/qa-614-browser  3ca6b24b   fix/coplanar-sphere (newer head)
```

No browser page was ever opened and no dev server was ever started, so there is
nothing of mine to close or kill.

---

# PR #613 — `fix/road-coverage`, measured at `628de5dc`

## VERIFIED — the byte-identity claim, independently, with a control

This is one of the two expensive claims, so the numbers are here in full.

I did **not** take the check's own "trestles unmoved" line on trust. I ran the
child process directly, once per seed per arm, and compared `trestleHash`:

```
seed 20260728  real 5e0d8c6f8170fecf  corridorOff 5e0d8c6f8170fecf  IDENTICAL
seed       11  real 7d68fc32744e59be  corridorOff 7d68fc32744e59be  IDENTICAL
seed       24  real ce475caa7dc60aef  corridorOff ce475caa7dc60aef  IDENTICAL
seed      128  real 45b0e64cd451dc6f  corridorOff 45b0e64cd451dc6f  IDENTICAL
seed      131  real 68a18161f7de81c8  corridorOff 68a18161f7de81c8  IDENTICAL
seed      208  real 5b191d93c8b84a83  corridorOff 5b191d93c8b84a83  IDENTICAL
seed      274  real 7e8910f5bbb19a50  corridorOff 7e8910f5bbb19a50  IDENTICAL
seed      326  real 1dfc8123bfd1c51d  corridorOff 1dfc8123bfd1c51d  IDENTICAL
seed      428  real c3538ced3b2d0757  corridorOff c3538ced3b2d0757  IDENTICAL
seed      451  real 1afdff19b9c48186  corridorOff 1afdff19b9c48186  IDENTICAL
```

**Control on the instrument, which is the part that makes the above mean
anything:** the ten real hashes are **10 distinct values**. The digest therefore
discriminates real trestle geometry, and "IDENTICAL" is a measurement rather
than a hash that cannot vary.

Reproduce with `/private/tmp/.../scratchpad/hashcmp.mjs` or, equivalently:

```
cd <worktree>
LGP_SEED=<seed> node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
  scripts/check-entrance-road.mts --one [--control]
```
and compare `.trestleHash` off the last stdout line.

**Note the hashes differ from the ones in the PR body** (it quotes
`cb5d4c8f493b50c9` for the canonical seed; I get `5e0d8c6f8170fecf`). The
*claim* — real and corridor-off identical — holds today on all ten seeds. The
PR's literal digests are a stale transcript, exactly the failure mode CLAUDE.md
describes under "a red-run transcript is a measurement, and measurements go
stale". Worth correcting if the PR gets another push, since a future agent will
try to reproduce those strings.

**Mechanism checked too**, so "identical" is not an artefact of an inert switch:
`setEntranceCorridorHonoured(false)` sets `corridorHonoured = false`, which makes
`isInEntranceRoad` return `false` unconditionally
(`src/world/entrance/roadRoute.ts:414`), which makes
`postClearsEntranceRoad` return `true` unconditionally
(`src/world/railRace/track.ts:1394`). It is a genuine relaxation of a live code
path. The ride simply does not want to stand in the road: nearest post clears by
7.19–8.49 m across the pool.

## VERIFIED — the control's offset is derived per seed

From `check:entrance-road` at `628de5dc`, exit **0**:

```
seed 20260728  shifted 15.04 m  10 posts   worst 3.28 m in
seed       11  shifted 15.39 m  12 posts   worst 3.29 m in
seed       24  shifted 14.55 m  13 posts   worst 3.26 m in
seed      128  shifted 14.52 m  15 posts   worst 3.27 m in
seed      131  shifted 15.09 m  12 posts   worst 3.28 m in
seed      208  shifted 15.00 m  17 posts   worst 3.23 m in
seed      274  shifted 15.04 m  13 posts   worst 3.29 m in
seed      326  shifted 15.57 m  10 posts   worst 3.29 m in
seed      428  shifted 14.52 m  23 posts   worst 3.24 m in
seed      451  shifted 15.40 m  16 posts   worst 3.28 m in
```

Range **14.52–15.57 m**, ten different values — matches the PR's claim exactly.
Total 141 posts across 10 seeds, fewest 10 on a seed, worst 3.29 m in. The
control is non-zero on every seed, so the sweep demonstrably can see a collision.

## VERIFIED — the coverage notes reach a human on a passing run

`check:entrance-road` stderr, verbatim:

```
SWEPT: 145.7 m of a 145.7 m road (100.0%), from 72.8 m to -73.0 m either side of the gate, every 0.25 m
That is the whole drawn road — the span `isInEntranceRoad` keeps trestles out of — not the 2.0 m the bus is animated along
(1.0 m to -1.0 m, 1.4% of the road). Sweeping only that drove the control to zero and made this check's verdict void.
```

`check:swept-bus` stderr, exit **0**:

```
SWEPT (on seed 11; the road's length is seeded): 2.0 m of a 144.9 m road (1.4%), from 1.00 to -1.00 m either side of the gate, every 0.2 m
COVERS NOTHING ELSE: the remaining 142.9 m (98.6%) of the road is NOT swept here.
`check:entrance-road` is the check that sweeps the whole road; read that one for that.
```

and its OK line carries the fraction, so the quotable sentence cannot be quoted
without it:

```
check:swept-bus OK — swept 10 seed(s) over 2.0 m of a 144.9 m road (1.4%), the driven run only; ...
```

**The Vitest question, which is the one that actually needed measuring:** the
`[ground sphere]` notes in `invariants.ts` **do** survive the default reporter on
a fully passing run. `pnpm run test:procgen` exit **0**, `Tests 601 passed
(601)`, and the notes appear on **stderr, 10 of them** (5 seeds x 2 lines) and
**0 on stdout**. Sample:

```
[ground sphere] and the bus's own arc: 167.4 m of drawn road walked every 1 m,
out to 118.3 m from the centre (past the 102.8 m boundary the radial sweep stops
at), worst gradient 6.39% at (-66.8, 84.3).
```

Road reach 115.8–118.7 m against a 101.4–107.2 m boundary — the clause really
does walk past where the radial sweep stops, as claimed.

## FINDING — the `BUS_MAX_GRADE = 0.058` red-proof is confounded, and overstates by one seed

I ran the mutation. `BUS_MAX_GRADE 0.1 -> 0.058`, `pnpm run test:procgen`:
exit **1**, `Tests 5 failed | 596 passed (601)`. The count matches the PR.

**But the mutation cannot isolate the new clause, and on one seed it does not
reach it at all.** `theGroundIsTheSphereItClaimsToBe` has a *pre-existing*
radial clause asserting against the same constant, and it reads **higher** than
the new road clause on every seed:

| seed | radial clause (pre-existing) | new road clause | fouls at 0.058 |
|---|---|---|---|
| 11 | 8.75% | 6.09% | 2 |
| 131 | 8.33% | 5.90% | 2 |
| 24 | 8.33% | 6.39% | 2 |
| 326 | 8.75% | 6.19% | 2 |
| 20260728 (canonical) | 8.33% | **5.55%** | **1 — radial only** |

So at 0.058 the canonical seed goes red **entirely on the old clause**; the new
clause asserts nothing there. And because the radial worst (8.33–8.75%) is
strictly above the road worst (5.55–6.39%) on every seed, **no value of
`BUS_MAX_GRADE` can ever make the new clause fire first.** Lowering that
constant is structurally incapable of being an arming proof for it.

The honest statement is **"4 of 5 seeds"**, not 5 of 5. Verbatim off the screen
for the four that do reach it:

```
seed 11:  the ground under the drawn entrance road reaches a gradient of 6.09% at (-68.8, 93.9)
seed 131: ... 5.90% at (-68.2, 81.4)
seed 24:  ... 6.39% at (-66.8, 84.3)
seed 326: ... 6.19% at (-20.1, 91.8)
```

**The clause itself is genuinely armed** — those four messages are real, carry
real numbers and real coordinates, and came from the new code path. My objection
is to the PR body's framing, which will be read as a measurement and is wrong by
one seed. Recommendation: a one-line correction to the PR body and to
`HANDOFF-road-brow.md`, not a code change.

**Second, smaller finding, pre-existing and not this PR's fault** (but this PR
edits the function and its doc, so it is the natural place to note it): the
radial clause computes `grade = d / GROUND_SPHERE_RADIUS` — the sphere's *own
formula*, not the built terrain. That is precisely what the new clause's own
comment criticises ("would pass by restating the model"). It can only ever fail
if the boundary radius grows; it cannot detect a terrain change. Worth a ticket.

`src/core/constants.ts` was restored to `0.1` and `git status --porcelain` on
`qa-613` is empty.

## NOT REACHED on #613

- No run of the full `pnpm run check` chain, and no `package.json` script-set
  comparison. The PR claims the script set is byte-identical to
  `feat/sphere-combined`; I did not verify that.
- Nothing measured against the newer head `ced03827`, which touches both
  `check-entrance-road.mts` (+94/-15) and `invariants.ts` (+24). **All #613
  numbers above are from `628de5dc`.**

---

# PR #614 — `fix/coplanar-sphere`, measured at `2461309a` / `3ca6b24b`

## VERIFIED — the fence-inside-masonry overlap IS pre-existing on `origin/main`

The other expensive claim, and the one that decides whether the baseline re-take
is legitimate. **It is.** Measured on `origin/main` `dd5b3b6b` — sine-hill
terrain, no sphere — with a purpose-built OBB-vs-OBB separating-axis test, not
`Box3.intersectsBox`.

**Instrument control first**, per CLAUDE.md. Self-test:

```
[ok] identical unit cubes: depth=1.0000            (overlap)
[ok] cubes 10 m apart: depth=0.0000                (clear)
[ok] cubes overlapping 0.2 m: depth=0.2000         (overlap)
[ok] cubes touching exactly (1.0 apart): 0.0000    (clear)
[ok] 45deg-rotated neighbour at (1,0,1) — AABB hulls DO overlap
     (a Box3 test would false-positive): depth=0.0000  (clear)
```

End-to-end control on the built park, fence lifted 100 m: **0 posts, 0 rails**,
against 5 and 6 unlifted. Two real defects in the instrument were found and
fixed by that control before any result was trusted (an epsilon leak that made
exact face-touching read as overlap, and a first rotated test case that was
numerically degenerate and proved nothing).

Counts on `origin/main` `dd5b3b6b`:

| seed | PR claim | measured (OBB pairs) | distinct objects | AABB-hull (for contrast) |
|---|---|---|---|---|
| 20260728 canonical | 11 + 25 | **11 + 25** | 5 posts + 6 rails | 10 + 16 |
| 326 | 17 + 36 | **17 + 36** | 8 + 8 | 17 + 22 |
| 451 | 24 + 53 | **24 + 53** | 12 + 11 | 14 + 21 |
| 128 | 9 + 16 | **9 + 16** | 4 + 4 | 6 + 10 |

**Every figure reproduced to the unit, 8 of 8.** Deepest penetration: a post
reaches **0.356 m** inside a block (seed 451), 0.293 m canonical. Rails only
0.009–0.013 m, clipping a block's top corner — consistent with the PR's account
of the seam being a block's top face against a rail's top face.

**Conclusion: the re-take is not silencing a live finding.** Post penetrations of
a third of a metre on plain sine-hill terrain are not reachable by any tolerance
argument, and the phenomenon is non-zero on all four seeds with no sphere
anywhere near it.

**One wording defect worth a one-line fix** if #614 gets another push: the PR's
and the baseline comment's figures are counts of overlapping **(fence-part,
block) pairs**, not of distinct fence parts, but "11 posts + 25 rails" reads as
the latter. The true object counts on the canonical seed are **5 posts and 6
rails**; one post buried in a corner touches several blocks. The numbers are
right, they just describe pairs — and that comment is the artefact the next agent
will read.

## VERIFIED — the coplanar separations, independently, on the sphere branch

Built the park at `3ca6b24b` and dissected the tightest block-top/rail-top pairs:

```
seed 326  gap 2.0 mm at (70.9, -35.2)  blockTop -1.8228  railTop -1.8248
seed 128  gap 3.4 mm at (92.9,  14.9)  blockTop -3.5261  railTop -3.5294
```

The PR quotes "seed 326 -1.823 against -1.825" and "seed 128 -3.526 against
-3.529". **Both match to the quoted precision.** The two-unrelated-0.62s
explanation is therefore consistent with the measured geometry.

Full picture across seeds (AABB screen, so counts are indicative):

| seed | overlapping pairs | tightest gap | where |
|---|---|---|---|
| 20260728 canonical | 60 | **14.5 mm** | (72.3, -7.4) |
| 326 | 206 | **0.4 mm** | (81.7, -29.3) |
| 128 | 43 | 3.4 mm | (92.9, 14.9) |
| 451 | 100 | 25.5 mm | (98.0, 26.4) |

**This matters for judging how bad the flicker is, and nobody has looked yet.**
On the **canonical seed** — the one a fresh preview or a first-time player gets —
the tightest gap is **14.5 mm**, which is far too large to z-fight. The
sub-millimetre coplanarity is a **seed-326** phenomenon (0.4 mm), and seed 326 is
not what a visitor sees by default. My unverified expectation, for whoever picks
this up, is that the flicker is **not visible on the default park at all** and
that the visible artefact Jim would actually notice is the *interpenetration*
itself — a wooden fence rail passing through a stone wall — which is #612 and is
already on `main`.

## VERIFIED (statically, from the diff) — nothing else was baselined upward

- Exactly **one** entry changed upward:
  `garden|garden/boundary-wall/boundary-blocks|park-train/rail-fence/<Mesh:BoxGeometry>`,
  `0.0507 / 1 seam -> 0.2802 / 2 seams`. The diff contains **11 removed entry
  lines and 1 added entry line**; the added one and one of the removed ones are
  that single modified entry, leaving **10 pure deletions**.
- Those 10 are the **nine `BASELINE LOOSE`** drops (hotel tower shell + door
  jamb, water-fight plot, sky-cruiser, dodgems, spooky-house, face-paint stall,
  `path-kerb|path-surface`, rail-race duck bars) **plus** the separate
  `garden|park-train/railway-bridges/bridge/deck|...|bridge/shell` deletion,
  which the PR claims as a *fix* rather than a loose drop. Counts match the PR.
- `shell|wallTop` is **not** in the committed baseline: the only `wallTop`
  occurrence that is an entry is the pre-existing, unchanged
  `garden|garden/terrain|park-train/railway-bridges/bridge/wallTop`
  (0.2295 / 1). `bridge/deck` appears **0 times**. So neither fix was baselined —
  consistent with both being genuine fixes.

## The newer head `3ca6b24b` — read it, it is a self-correction

`2461309a -> 3ca6b24b` is **comment-only**, in `scripts/coplanar-baseline.mts`.
The author strikes their own load-bearing claim — "two solids that interpenetrate
will always put some pair of faces in a shared plane" — as false, with a
counterexample, and replaces it with a measurement: 757 overlapping block/rail
pairs across the pool, gap band `[-0.187, +0.118]` (spread 0.305 m), and a rail
height of 0.80/0.90/0.98 would each leave **zero** pairs within 1 cm. The
argument becomes "no *honest* height exists" (it would be a number tuned to
today's terrain, and a visible art change that is Jim's call), which is a
materially better argument than the one it replaces.

**Consequence for QA: the specific claim I was asked to test — the
two-solids-must-share-a-plane reasoning — was already withdrawn by the author
before I got to it.** The re-take now rests on pre-existence (verified above)
plus "a height fix would be tuned and visible", which I did not independently
test.

## NOT REACHED on #614 — the gaps, plainly

These were dispatched and the sub-agent was killed by the halt before reporting.
**None of the following was measured. Do not read anything above as covering
them.**

1. **`--print-baseline` was never run.** The claim that the nine entries were
   re-taken *by hand* rather than by the tool — which is what stops today's worse
   numbers being banked silently for live findings — is **unverified**. My static
   diff reading above is consistent with it (only one entry moved upward) but it
   is not the same test: it shows *what was committed*, not *what the tool would
   have written*. Run the tool and diff its output against the committed file.
2. **`deck|shell` was never proved fixed by measurement.** The author's control
   (`index=full` vs `index=emptied`, `min.y` identical to the bit, `raycastHits`
   2 -> 0) was **not reproduced**, and the call sites that raycast or measure a
   bridge were **not enumerated**. The risk being guarded against is a reader
   that is *not* index-blind and *does not* exclude `deck` by name.
3. **`shell|wallTop` was never proved red.** The `snapToWallTop` hunk was not
   reverted and `check:coplanar` was not watched going red with `shell|wallTop`
   named. Per CLAUDE.md this is the gate: a fix that was never watched fail has
   not been QA'd.
4. **`check:coplanar` was not run on either the PR head or the base.** So I
   cannot state what this PR turns from red to green, or its exit code. **Note
   the PR body itself says `pnpm run check` was still running when it was
   opened and its exit code was not yet known.** CI on #614 was
   **pending** on Checks / Entrance road / Coplanar faces / Procgen invariants /
   Swept bus when I last looked.
5. **No browser pass at all.** The flicker was never looked at. The coordinates
   to aim at are in the table above; `?seed=326` works on any URL
   (`src/world/parkManifest.ts:38`), so
   `<preview>/spawn?pos=81.7,-29.3&seed=326` is the place to stand, and the
   canonical-seed comparison point is `pos=72.3,-7.4`. **Per CLAUDE.md, a PR
   with a visible artefact cannot be signed off without this.**

---

# Verdicts

**Neither PR is signed off.**

- **#613** — everything I was asked to measure was measured and the PR's
  substantive claims hold: the byte-identity is real and controlled, the offsets
  are derived per seed, the coverage notes reach stderr and survive Vitest's
  default reporter on a green run. **One finding**: the `0.058` red-proof is
  confounded by a pre-existing clause and is "4 of 5", not "5 of 5"; the new
  clause is nevertheless genuinely armed. I would call that a PR-body correction,
  not a blocker — but it is the Overseer's call, and it was **measured at
  `628de5dc`, one commit behind the current head**.
- **#614** — the load-bearing claim (pre-existence on `main`) is **CONFIRMED**,
  reproduced 8 of 8 with a controlled instrument, and the separations match to
  the quoted precision. **But three of the four things I was asked to check were
  never reached** — the `--print-baseline` comparison, the two seam fixes proved
  red, and the browser look at the flicker. **This PR is not close to a QA
  sign-off**, and the visible artefact means it cannot become one without eyes on
  a rendered frame.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AdWSEA9ZM7e1tnoSodQ5Aw
