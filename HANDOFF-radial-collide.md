# Radial collision / navigation / gravity — engineer handoff

Branch `eng/radial-collide` off `feat/sphere-combined`.
**Model: Opus (Claude Opus 5, 1M context), chosen by the Overseer's Engineer
default.** A replacement runs the same model.

Area as briefed: `CollisionWorld`, `NavGrid`, gravity/jumping/falling across
Player, NPCs and pets.

> **STOOD DOWN, 14 September 2026, and nothing here is reverted or deleted.**
> Jim stopped the instance-by-instance conversion — *"it seems more like trying
> to fit the new world into the old code"* — and an architect is designing a
> proper spherical domain: the canonical coordinate a 3-vector from the
> planet's centre, flatness a **declared local chart with an explicit validity
> radius**, one translation layer at the scene-graph anchor. This work is not
> wrong; it is the wrong layer. Jim: *"keep their work in case we need it
> again."*
>
> **What the redesign should take from this file**, in order of how expensive it
> would be to rediscover:
>
> 1. **The anti-tangent-frame argument** (below, verbatim) — the reason a chart
>    must be shared and global rather than solved at the mover.
> 2. **The `topIsAbsolute` fence ghost** — a 1.1 m fence is not solid from the
>    inward side past d = 80 m, live today. Fully measured; the fix is *not*
>    fully diagnosed, and §"CollisionWorld" says exactly how far it got.
> 3. **`walkHeight(x, -Infinity, z)` is `+Infinity`** — every collider in the
>    game non-solid, typechecking cleanly. A thing the new types must make
>    impossible.
> 4. **The four wrong-but-clean instruments** — the architect will build
>    instruments against a new domain and will make these same mistakes.
> 5. **`walkHeight` vs `standHeight`** — a radius and a height above ground are
>    different questions, and picking the wrong one is silent.

## Approach, approved by the Overseer before any code

**Keep the chart, fix the metric and the frame.** Not a per-mover tangent frame,
not a 3D rebuild — a third option.

`(x, z)` is already an exact, invertible, global chart of the ground: the ground
is a spherical cap over the xz-plane, so for `d < GROUND_SPHERE_RADIUS` (220 m)
the map to the surface is a bijection — an orthographic azimuthal projection,
preserving tangential distance and compressing radial distance by `cos θ`. The
2D model was therefore never *topologically* wrong. It was wrong about heights
and about lengths, which are two separable substitutions rather than a rewrite.
That is why this is one engineer and not four.

**The argument against per-mover tangent frames, which is the load-bearing one
and must survive any later "simplification":**

> **Two movers standing in different places would disagree about the geometry
> between them, so a wall's position would depend on who asked.** The chart is
> shared and global; a tangent frame is not.

The corollary the architect's `Chart` formalises: a chart is only honest inside
a radius where its distortion is bounded, and that radius must be **declared**
rather than assumed. `(x, z)` is singular at `GROUND_SPHERE_RADIUS` (220 m) and
the park already reaches 157 m — so the chart this code leans on has a validity
radius whether or not anybody wrote one down, which is the whole argument for
making it a first-class thing.

**Can a child walk right round the ball? No, and nothing here changes that.**
The chart is singular at `d = 220 m`. The park reaches 157 m. Walking round
needs a genuinely spherical chart and a generator rebuild. The Overseer is
putting that to Jim as a separate question.

## What landed

| | |
|---|---|
| `src/world/up.ts` | `walkHeight`, `yAtWalkHeight`, `footColumn`, `liftAlongUp`, `standHeight` |
| `src/entities/Player.ts` | gravity, jumping, falling integrated as a **radial altitude** |
| `src/entities/npc/NpcCharacter.ts` | the same block, same reasons |
| `scripts/playerSim.mts` | the single copy of that integration, changed in step |
| `scripts/check-radial-hop.mts` | **new**, in the `check` chain |
| `scripts/check-radial-solidity.mts` | **new**, in the `check` chain |

Chain went **65 → 67** steps, step *sets* compared (`check:chain-coverage`
passes), nothing dropped.

### Gravity — done, proven

A hop is now the same hop everywhere in the park: apex **1.2267 m at every
radius**, error 0.0000 m, against `1.28 · cos θ` before (0.90 m at the rim, and
shrinking with every metre she walked outward). Fall detection and the clearance
handed to `CollisionWorld` are radial, so `FALL_THRESHOLD`'s 0.5 m is 0.5 m of
height again rather than being spent by 0.5 m of lateral travel where the radial
gradient is 1.02 m/m.

`check:radial-hop` asserts quantities, not success — a "she jumps, she lands"
clause could not fail. Proved red by putting the height write back on `+Y`:
**20 of 21 hops failed, apex 0.1907 m at the rim against 1.2267**, the park
origin alone passing, which is what the control is for.

### `NavGrid` — handed to the lead engineer

I had it converted and reverted it when `ad0ca7dab45dd5e3a` said it was theirs.
My measurement and the `walkHeight` helper were adopted. Two findings went with
it:

- **`MAX_STEP` needs no change and raising it is the wrong fix.** To admit flat
  grass it must exceed 0.729 at 157 m and **1.007 at 180 m** — a different value
  at every radius — and at that setting it admits real ledges of 0.51–0.58 m
  unchecked.
- **The gate was already leaking, which was in nobody's inventory.** A real
  0.70 m ledge on the *outward* side read 0.555 m of world `y` at 80 m: the
  router planned a child straight **up** a wall she cannot climb. The lead
  measured it better than I did — it leaks from **40 m**, not 80.
- `walkHeight`'s `spaceAt` branch is load-bearing: a bare `planetRadiusAt` frame
  reads **0.662 m** for one diagonal lattice step on a *level* interior floor at
  (1200, 600), past `MAX_STEP`.

### `CollisionWorld` — **written, measured, and deliberately reverted**

`src/world/Collision.ts` is byte-identical to `origin/feat/sphere-combined`.
Read this section before touching it again; the work is done, it is the
*conclusion* that says don't ship it yet.

**The real bug, measured.** An outdoor `topIsAbsolute` collider — the railway
fences (`train/fence.ts`) and bridge seams (`train/bridges.ts`), pinned to a
*local* road surface out where the lean is worst — is compared against the
mover's world `y`. Approached from the **inward** side (from the middle of the
park, uphill in world `y`), a 1.1 m fence **stops being solid at d = 80 m** for a
child 3 m back and at **d = 157 m** for one 1.2 m back. She walks through it.
CLAUDE.md's first rule, live in the game today. Approached from *outward* the
frames agree everywhere, so a probe that only came at it downhill reports all
clear — `check:radial-solidity` comes at it from inward for that reason, and
records the number on every run.

**Why the obvious fix is not enough.** Converting both sides regressed two
procgen invariants — seeds 11 and 326, *"the bridge at (-86.0, 26.0) leaves only
0.00 m of standable width … the parapets have closed over the path itself"*.
Isolated to the **wall top gate** by reverting one gate at a time.

The frame to use is `standHeight` (height above the ground), **not**
`walkHeight` (a radius):

> `walkHeight` cancels the planet only between two points in the **same
> column**, or between two points that are both **on the ground**. It does not
> cancel between two points at different `(x, z)` that are both *off* the
> ground, because a radius grows with distance from the axis as well as with
> height. Two points at the same world `y`, 1.3 m apart radially at 90 m out,
> differ by **0.54 m** of `walkHeight`.

**A latent bug found on the way, which is real and worth fixing on its own.**
`fence.ts`'s `deckSpanForSegment` samples three points along a segment and takes
the deck with the **lowest world `y`**, as a deliberate conservatism: leave the
seam as open as possible. On the sphere that picks the wrong sample. The ground
falls away at up to 1.02 m per metre, so of two samples the one further out has
the lower `y` **and the greater height above the ground** — minimising `y`
selects the sample that makes the seam *least* open, the opposite of what the
clause was written to do. Measured on the canonical park at crossing
(138.9, -82.1): the `TRACK_CLEARANCE` centre run's seam converts to **5.91 m**
of altitude at the contact point against a walker on the deck at **5.05 m**,
0.86 m too high, so the fence goes solid across the bridge.
`scratch/seam.mts` prints that table for every crossing.

**But fixing that does not clear the two invariants**, measured: minimising on
`standHeight` instead of `y`, together with the `Collision.ts` conversion, still
leaves both seeds at 0.00 m of standable width. **So the mechanism is not fully
diagnosed and both halves are reverted.** Do not take the paragraph above as the
whole cause — it is one contributing fault, proven; there is at least one more.

**An earlier version of this file said the cause was `fence.ts` pinning the seam
to "a single flat `deckY` for a whole fence run". That was wrong** — read the
code before repeating it. `deckSpanForSegment` is already per-segment and
already samples three points. The claim was written from `bridges.ts`'s docblock
rather than from `fence.ts` itself.

**Where to start next.** `scratch/seam.mts` is the instrument: it builds the
park, walks every crossing, and prints for each overlapping seam wall what the
old gate and the new gate each decide, with both altitudes. Extend it to march
the invariant's own `standableReach` across the deck rather than only sampling
the crossing centre — the failure is about the deck's *width*, and every probe
so far has been at its middle.

Also found while doing it, and worth keeping whoever picks this up:

Also found while doing it, and worth keeping whoever picks this up:

- **`walkHeight(x, -Infinity, z)` is `+Infinity`, and the *sign* is the whole
  hazard.** `Math.hypot` is unsigned, so `planetRadiusAt(x, -Infinity, z)` is
  `+Infinity` — **not `NaN`**, which is what it gets misremembered as, and the
  difference is the difference between a bug and a catastrophe:

  ```
  gate:  if (moverUp < baseUp) continue;   // skip this collider
  +Infinity:  5 < Infinity -> true   -> EVERY collider skipped -> NOTHING solid
  NaN:        5 < NaN      -> false  -> no collider skipped    -> all solid (safe)
  ```

  `baseHeight` **defaults to `-Infinity`** on every collider that does not
  declare a band, which is nearly all of them, so the naive conversion is a park
  a child walks straight through — and it typechecks. `up.ts:185` now guards it:
  *a non-finite height is a sentinel, not a coordinate, and must come back with
  its sign intact.* For the redesign the row is not "guard the sentinel", it is
  **"a domain type must not let a sentinel through a magnitude function at
  all"**.
- A wall's absolute height must be converted at the **contact point**
  (`closestX/closestZ`), never once at its midpoint: a long wall's declared top
  means something at a particular place.

### Pets

There is no pet gravity integrator to convert. `WildPets` poses its animals in a
group-local frame inside the castle roof garden; `GRAVITY * dt` appears nowhere
else in `src/entities`. The remaining `+Y` integrators are minigame-local or
effects (`railRace/sparks.ts` is outdoors and belongs to the effects engineer).

## The acceptance test: run, and it does not pass — but not for a radial reason

`check:park` builds again (thank you, `eng/crossing-bridge` `040ae365`; this
branch is rebased onto it). **`poiGraph: 431/431 seeds placed, 425 in the main
component` — the six stranded waypoints are real and still there.** Measured,
with controls, and the conclusion is the opposite of the brief's expectation:

**They are not caused by the flat-versus-radial frame anywhere.**

- The six are at `(-46.0, -158.1)` through `(-49.7, -177.4)`, d = 164.7–184.3 m,
  ground `y` −74 to −99.6 m, 48–57° of lean. All comfortably **inside** the play
  boundary (11.7–31.3 m from its edge), so the leash is not doing it.
- **Applying the lead's landed radial `NavGrid` changes nothing** — still 6.
  Tested, not assumed: `git checkout origin/eng/radial-visible -- NavGrid.ts`
  (136 insertions, verified present), `check:park` re-run, same six. My first
  hypothesis was that this was the step gate, and it was wrong.
- The step gate *is* badly closed out there — at those six points the flat
  `|Δy|` gate admits only **4–6 of 8** lattice neighbours on level ground
  (worst step 0.951 m) where the radial gate admits 8/8, control 8/8 at the
  origin (`scratch/poi-gate.mts`). Real, worth fixing, **and not what strands
  these waypoints**, because `poiGraph`'s edges are `CollisionWorld` clearance
  probes, not lattice routes.
- The actual blocker, named (`scratch/blocker.mts`): the edge from
  `(-46.0, -158.1)` to a reachable node **2.94 m away** at `(-43.8, -156.2)` is
  refused because two walls — `halfThickness` 0.32, **top = Infinity**, no
  base — meet in a corner across it and pinch the gap below the 2 × 0.7 m
  `poiGraph` needs (worst overlap 1.00 m at the middle sample). Cut that one
  edge and the whole six-node pocket rejoins.
- Those walls carry **no absolute top and no base**, so no frame conversion in
  this work touches them, and `resolve`'s lateral arithmetic is untouched by all
  of it. They are 23 walls of 2.10 m segments in several open chains centred
  about `(-53.3, -159.9)` (`scratch/ring.mts`, `scratch/whichwall.mts`). I did
  not identify the builder; no `addWall` call site obviously registers
  `0.32` with an infinite top.

**So this is a layout/placement finding for whoever owns the outer park's wall
runs, not a radial one.** It reproduces identically on `eng/crossing-bridge`
without my branch. One note on the instrument: my "distance to the railway"
probe returned the same rail point for every query and is **wrong** — ignore
that line if you find it in a scratch file; `route.pointAt`'s parameter is not
what I assumed.

## Still open, in priority order

1. **`fence.ts`'s flat `deckY` seam, then `standHeight` in `Collision.ts`.**
   Fully diagnosed above, with the reproduction.
2. **The sideways half of the hop.** A jump on a ball carries her outwards and
   brings her back — up to **0.875 m at the rim**. It is not implemented, so in
   her own frame the hop still leans towards the middle of the park by that
   much. `check:radial-hop` measures it and announces it on **every run**,
   deliberately asserting neither way: asserting zero would enshrine it, and
   asserting the right answer would be a check red on purpose.
   **Do not fix it by re-deriving position from altitude** (`position = foot +
   up * altitude`). That was tried. It makes lateral position a function of
   altitude, so the instant a surface drops away she is teleported sideways, off
   the deck, which raises the altitude further — a runaway:
   `check:deck-fallthrough` went from green to **401 of 1280 runs losing the
   surface at gradient 0.1**, gaps reaching 50 m. It needs an integrated
   horizontal impulse at take-off that gravity takes back.
   `footColumn`/`liftAlongUp` are kept in `up.ts` for that work and are
   documented as not used by the movement code.
3. **The metric factor.** Chart lengths compared against real-metre thresholds
   (`maxSafeStep`, path costs, tap spacing) still under-read radially by
   `cos θ`. Not started.
4. **A deck hop is not covered** by `check:radial-hop` — it feeds `SimPlayer`
   `terrainHeight`, so every hop it measures is off the grass. Same code path,
   but nothing would notice if it broke. The check says so on every run.

## Measuring, and what is red that is not ours

**The canonical park does not build headlessly on this branch.** `new World`
throws `railD 0.0 (0.0, 125.8)` in `crossings.ts`, so every check through
`park-harness.mts` dies — `check:park`, `check:hotel`, `check:nav-routes`,
`check:npc-perch` and more. The `check` chain gets ~19 steps in and stops there.
**Confirmed identical on the base commit**, and the lead engineer bisected it:
first bad is the merge `502ec802`, whose two parents are both green, and it is
the gate arch's new colliders moving the path router's answer. Not radial, not
ours, and it blocks the `check:park` six-stranded-waypoints acceptance test I
was briefed on. `check:fountain-hop` is also red on the base (4 seeds).

So the acceptance test could not be run. What was measured instead:

- `pnpm run check:radial-hop` and `check:radial-solidity` — new, run green
  individually, both proved red by deliberate mutation.
- `check:deck-fallthrough`, `check:hop-clearance`, `check:wall-tunnelling` —
  the three that drive `playerSim.mts`, all green.
- `pnpm run test:procgen` — **49 failed / 269 passed, exactly the base's
  numbers**, failing test sets diffed by name and identical. That parity is the
  regression gate that actually caught the collision problem.
- `scratch/nav-control.mts` — the nav step gate, no park needed.

**The four wrong-but-clean measurements, the most reusable thing here.**
Every one of them read decisively and was wrong; three were instruments and the
fourth was a fix.

1. **A test ledge built as `terrainHeight(x, z) + 0.70`** — claimed a 0.70 m
   ledge, measured 0.49 m of real height at d = 157, because 0.70 m of world `y`
   out there is `0.70 · cos θ` of altitude. Both gates "leaked" it and the
   *correct* gate looked broken too. Build a test ledge with `yAtAltitude`.
2. **`keepOutsFor(deck)` fed straight to `spaceAt`** — claimed to ask "are these
   keep-outs indoors", actually asked about points in the park: `keepOutsFor`
   returns **deck-local** coordinates, and `(19.2, 5.0)` is an ordinary spot on
   the grass as well as one on the mall floor. All 351 reported "in the garden",
   and the identity assertion under it "failed" by 2.32 m — the planet, measured
   somewhere the keep-out has nothing to do with.
3. **A ring probe at d = 157 m** — claimed to measure whether a collider was
   solid, actually measured the **soft boundary leash**, which shoves a mover
   16 m where a ring point falls outside the play bounds (the park's edge is not
   a circle). Gate every probe on `distanceToEdge` first.
4. **Re-deriving position from altitude** (`position = foot + up · altitude`) —
   not an instrument but a *fix*, and the worst of the four. It makes lateral
   position a function of altitude, so the instant a surface drops away the
   mover is teleported sideways, off the deck, which raises the altitude
   further. `check:deck-fallthrough` went green → **401 of 1280 runs losing the
   surface at gradient 0.1**, gaps reaching 50 m. The lateral half of a radial
   hop must be an **integrated impulse**. That is a property of the formulation,
   not of this code, and it will be true in the new domain too.

**Longer form of the same three instruments:** Recorded because the next person will hit the same shapes: a test ledge
built as world `y` instead of `yAtAltitude`; `keepOutsFor` returning **deck-local**
coordinates fed straight to `spaceAt` (all 351 points "in the garden",
`(19.2, 5.0)` being an ordinary spot on the grass as well as one on the mall
floor); and a ring probe at 157 m falling outside the play bounds, where the
soft boundary shoves a mover 16 m and it reads as "the collider was solid".
