# HANDOFF — radial world UI, effects and lighting

## STOPPED, 14 September 2026 — parked, not abandoned

Jim ruled that the instance-by-instance radial conversion this branch belongs
to is **papering over the cracks** — *"trying to fit the new world into the old
code"* — and an architect is designing a proper spherical domain instead:
canonical coordinate a 3-vector from the planet's centre, flatness as a
**declared local chart with a validity radius**, one translation layer at the
scene-graph anchor.

**This work is not wrong; it is at the wrong layer.** Jim: *"keep their work in
case we need it again."* So the branch is pushed, complete and left alone. Do
not rebase it, do not open a PR for it, and do not delete it. Eleven commits,
all pushed, `tsc` clean at every one.

**Nothing here is a requirement for the new design** — `RADIAL-INVENTORY.md` is
the architect's requirements document, and the lead (`ad0ca7dab45dd5e3a`) holds
the one true copy of which rows are closed. The closed-row list below was sent
to it.

**Three findings must survive whatever architecture wins.** They are the
expensive-to-re-derive kind, so they are stated in full under
[Findings that outlive the branch](#findings-that-outlive-the-branch) rather
than left implicit in a diff: the fill light below the local horizon, the
`interact.ts` import trap, and `TERRAIN_RADIUS`. The first and third are the
same disease as everything else found that day — a flat assumption, or a stale
datum, standing in for a quantity that had moved, producing a visible wrong
nobody had named.

- **Branch**: `eng/radial-fx`, off `origin/feat/sphere-combined` (`31d0fb2a`).
- **Worktree**: `.claude/worktrees/eng-radial-fx`.
- **Model**: Opus 5 (1M context). Chosen by the Overseer when this engineer was
  dispatched — a replacement must be the same model (CLAUDE.md).
- **Reports to**: the Overseer, `landofgoodplaces-fc`. Lead engineer for the
  radial conversion is `ad0ca7dab45dd5e3a`.

## The brief (superseded — kept for context)

`RADIAL-INVENTORY.md` (on `seek/radial-inventory`, **not** on this branch)
§3.1, §3.2 and §3.4 — the ~15 `src/` world-UI, effects and lighting sites the
earlier altitude sweep never looked at. **`tapMarker.ts` and `rainbowRing.ts`
are the lead's, not mine** — do not touch them.

## Rows closed, in commit order

| row | file | commit subject |
|---|---|---|
| §3.1 `Highlights.ts:281,217` | `src/world/Highlights.ts` | guarantee ring lies on the ground it marks |
| §3.2 both rows | `src/world/DayNight.ts` | fill + sky ambient use the player's up |
| — | `scripts/measure-fill-elevation.mts` | the measurement behind it, re-runnable |
| §3.1 `flowerSparkle.ts` | `src/art/effects/flowerSparkle.ts`, `src/world/up.ts` | `tiltFor`, and the pick flourish plays in the flower's frame |
| §3.1 `puffs.ts`, `dustPuff.ts` | both | smoke and heel dust leave the ground they were kicked off |
| §3.1 `ActionChips.ts:210` | `src/ui/ActionChips.ts` | the action chips anchor above the thing |
| §3.4 | `src/core/constants.ts`, `src/world/Garden.ts` | `TERRAIN_RADIUS` deleted |

**Left open deliberately**: §3.1's `interact.ts:254` (and with it §2.4 #2). I
closed it, then reverted it — see below. The row is still open and its right
home is the checks side.

**Still open otherwise in my area**: nothing. §3.1's `rainbowRing.ts:140,290,317` and
`tapMarker.ts` are the lead's. §3.3 (coaster/castleWindows clearance) is not
world UI and was left alone.

## The two shared things I added — tell whoever owns them

1. **`tiltFor(x, y, z, target)` in `src/world/up.ts`** — the space-aware twin
   of `tiltToSphere`: the rotation from the flat authoring frame into the frame
   at a world point, the identity indoors. Four effects use it. The lead owns
   shared helpers; if it wants this shaped differently, it is one function.
2. ~~`sameStorey` moved into `interact.ts`~~ — **done and then reverted.**
   `interact.ts` **cannot import `world/spaces.ts`**: the chain is `spaces` →
   `building/layout` → `parkLayout` (seed-dependent), and `building/layout` →
   `tapSpacing` → back into `interact`. A static import from `test/procgen`
   then loads the park manifest before the seed is set and `parkFacts` throws
   at collection time. Measured: `test:procgen` went from the base's
   `49 failed | 269 passed | 279 skipped` to `132 passed | 465 skipped` — no
   failures, 137 fewer tests run, nothing red. The fix belongs one layer out,
   or behind a `spaces`-free owner of "which space is this"; the note is
   written into `ZONE_HEIGHT_TOLERANCE`'s doc comment. `scripts/`,
   `check-tap-spacing.mts` and `invariants.ts` are untouched by this branch, so
   there is no conflict waiting for whoever takes §2.4 #2.

## What has NOT been verified, and why

- **The park does not build headlessly on this branch** — `check:park` and
  `check:hotel` die inside `new World` on a `railD 0.0` crossing throw that
  pre-dates all the sphere work (inventory §0). So every park-shaped check is
  asserting nothing, mine included, and the lighting/effects work has to be
  judged in a browser.
- `tsc --noEmit` and `typecheck:test` are clean on every commit.

## Findings that outlive the branch

These three are true of the **park**, not of this branch's approach to it. Any
architecture meets all three. They are written out in full here because each
one cost real measurement to find and would cost the same again.

### 1. The cool fill light was below the *local* horizon across the outer park

`DayNight`'s fill was `position.set(-keyDirection.x, 0.55, -keyDirection.z)` —
opposite the key, lifted `0.55` (`tan 28.8°`) above the **world** horizon. On a
sphere that is not the horizon anyone is standing on. Measured
(`scripts/measure-fill-elevation.mts`, on this branch, sun 30° up), its
elevation above the **local** horizon:

| distance from origin | ground lean | fill elevation, local horizon |
|---|---|---|
| 0 m | 0.0° | **+32.0°** |
| 40 m | 10.5° | +22.1° |
| 100 m | 27.1° | +6.2° |
| 157 m | 45.5° | **−11.5°** |

So past roughly 90 m out the fill shone at or from **below** the ground, and
every bench, every stall and Eleri herself glowed cool blue along her bottom
edge — while the same objects by the fountain looked right, so there was no
seam to point at and nothing to blame.

**The part worth keeping is not the number, it is that the code already said
this.** The comment two lines above that expression reads: *"straight opposite
would light the ground from underneath and every toy would glow along its
bottom edge."* The author named the exact failure, guarded against it
correctly for a flat park, and the guard silently stopped holding when the
ground curved. That is the clearest example found that day of a flat
assumption producing a visible wrong that nobody had named — and it was found
by measuring, not by looking: the branch's own screenshots at 09:00 could not
show it, because the fill's worst case needs a low sun.

The fix on this branch localises it in `followPlayer` (the only code that knows
where she is standing) and gives +32.0° at **every** radius, identical at the
centre by construction. A spherical-domain design gets this for free *if* light
directions are expressed in the local chart; if they are expressed in world
axes it will reproduce the bug exactly.

Same file, same cause, second row: the `HemisphereLight`'s axis is
`light.position`, which nothing had ever assigned, so three.js left it at `+Y`.
Grass facing the local up at the rim received `0.5 + 0.5·cos 45.5° = 0.85` sky
and 0.15 green ground bounce instead of pure sky — the outer park going
continuously greener and flatter than the middle, again with no seam.

### 2. The import trap — `interact.ts` cannot reach `world/spaces.ts`

**This is real under any architecture and the new design will meet it**, because
a spherical domain needs exactly the thing that triggered it: somewhere to ask
*which chart is this point in*.

`sameStorey` needs to know whether a point is outdoors, so `interact.ts`
imported `world/spaces.ts`. The chain is:

```
interact → spaces → building/layout → parkLayout   (seed-dependent)
                    building/layout → tapSpacing → interact   (cycle)
```

A static import of that from `test/procgen` loads the park manifest **before
the seed is set**, and `parkFacts` throws at collection time. Measured:

| | test files | tests |
|---|---|---|
| base `31d0fb2a` | 6 failed | `49 failed \| 269 passed \| 279 skipped` (88.6 s) |
| with the import | 6 failed | `132 passed \| 465 skipped` (2.6 s) |

**Zero failures. 137 fewer tests actually run. Nothing red to say so.** The only
tell is the *pass* count, and it was caught solely by running the suite on the
base as well and comparing. CLAUDE.md already warns about this shape ("a skipped
test is not a passing test", 76 silent skips); this is a second instance, from a
different direction, and the duration collapse (88.6 s → 2.6 s) is a cheaper
tripwire than the counts if anyone wants one.

The change was **reverted**. The note lives in `ZONE_HEIGHT_TOLERANCE`'s doc
comment in `src/world/interact.ts`, which is the file a future agent will be
standing in when it is about to repeat this. Whoever owns "which chart is this
point in" must be reachable from `interact.ts` **without** dragging
seed-dependent park data behind it.

### 3. `TERRAIN_RADIUS` said "where the ground stops" and was 168 m wrong

| | |
|---|---|
| `TERRAIN_RADIUS` (doc: *"where the ground stops"*) | **83.5 m** |
| `GARDEN_PLAY_RADIUS` (how far a child can walk) | 135.5 m |
| `TERRAIN_EDGE_RADIUS` (where the drawn disc actually ends) | **251.7 m** |

Nothing read it. `Garden.ts`'s `buildTerrain` has always built the disc from
`boundary.ts`'s `TERRAIN_EDGE_RADIUS` = `PARK_BOUNDARY.maxRadius +
TERRAIN_APRON`, which follows the boundary wherever a seed puts it;
`TERRAIN_RADIUS` was imported into `Garden.ts` for a `{@link}` in a doc comment
and referenced nowhere else in `src`, `scripts` or `test`. **Two other comments
in `constants.ts` then reasoned from the wrong number** — one justifying the
600 m interior origin as "far past TERRAIN_RADIUS", one deriving
`INTERIOR_PLAZA_RADIUS` from "the same reasoning".

Deleted rather than re-tuned: a corrected 251.7 would be a second copy of a
derived value, which is the fault it was already an instance of. A note stands
in its place. All three sites also claimed *"the camera is orthographic"*, which
the game has not had for some time — the same stale-assertion disease
`RADIAL-INVENTORY.md` flags in `Sky.ts:137-145`.

### Also handed on

- **`tiltFor(x, y, z, target)`** in `src/world/up.ts` — the space-aware twin of
  `terrain.ts`'s `tiltToSphere`: the rotation from the flat authoring frame into
  the frame at a world point, the identity indoors, safe to call every frame
  because it returns a rotation rather than composing one onto an object. It
  exists because `upFor` is not enough for **effects**: a particle's launch
  vector, a squashed blob's flattening axis and a star's spin axis are
  *directions*, and a direction cannot be fixed by moving it. Four effects use
  it. Under the new design the same distinction is still needed — positions map
  through the anchor, directions need the chart's rotation.
- **`DayNight`'s terminator is Jim's call, not an engineer's** (inventory §3.2,
  third row). Deliberately untouched. The outer park sits in true geometric
  shadow for hours while `nightFactorValue` says noon — a terminator is what a
  planet does, and nothing in the lighting rig knows about it, so "it is
  daytime" and the actual illumination disagree.
- **Every run on this branch was done twice — once here, once on the base** —
  because the base is red before this branch (inventory §0) and a bare exit code
  from a red branch says nothing. Finding #2 exists *only* because of that
  habit.


## Verified

Every run below was done **twice — once on this branch and once on its base at
`31d0fb2a`** — because the base is already red (inventory §0) and a bare exit
code from a red branch says nothing. What is being asserted is *parity*, not
green.

- **`tsc --noEmit`** and **`typecheck:test`** clean.
- **`pnpm run check`**: both runs execute the **same 20 steps in the same
  order** and both die at `check:npc-perch` on the same pre-existing
  `railD 0.0` crossing throw inside `new World`. The chain itself is
  **65 steps, step set identical to the base's** — parsed from the `scripts`
  object, not grepped; no step added, none dropped, and the full 122-name
  script set is equal.
- **`pnpm run check:coplanar`** and **`pnpm run check:swept-bus`**: both die in
  `new World` on that same throw, on this branch and on the base, with the
  identical message. Neither can assert anything until §0 is fixed.
- **`pnpm run test:procgen`**: `49 failed | 269 passed | 279 skipped`, failing
  set **identical to the base's**, name for name and count for count (the base
  is red before this branch — inventory §0, the `railD 0.0` crossing throw).
  Compared by name rather than by count, because a count cannot see a swap.
- **In a browser**, two dev servers side by side (base on 5419, this branch on
  5418), `/spawn?seed=428&pos=118,0&facing=270` — 118 m out, 30° of lean:
  - the park builds, no new console errors (only the base's own `skyCruiser`
    warnings, byte-identical on both);
  - the grass at the rim reads brighter after the hemisphere fix — sampled
    mean green **111.5 → 114.9** over the same patch;
  - running leaves a proper trail of dust puffs lying flat on the leaned grass.
- **The fill-light direction is proved by measurement, not by eye**:
  `scripts/measure-fill-elevation.mts`, sun 30° up, elevation above the *local*
  horizon **+32.0° / +22.1° / +6.2° / −11.5°** at 0/40/100/157 m before, and
  **+32.0°** at every radius after.
- **Not shown in a frame**: the fill's worst case is a low sun, and `/spawn`
  cannot freeze the clock while `/view` has no player for `followPlayer` to
  read — so the blue underneath-lighting itself was not photographed. The
  measurement above is the evidence for that row.
