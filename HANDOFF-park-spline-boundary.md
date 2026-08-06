# HANDOFF — park 2x, gentle-spline boundary (issue #115)

Branch `feat/park-spline-boundary`, **stacked on `fix/paths-to-nowhere`** (#114,
PR #196). Worktree `.claude/worktrees/park-spline-boundary`. Dev port **5319**
when needed; **5310 belongs to #114 and must stay alive for QA.**

Spec: `REQUIREMENTS-2026-07-28.md` §6. Rulings that bind this work:
- Decision 5 — everything moves except the entrance.
- Family, 5 Aug — **every park should be unique**; **nothing reserves space**;
  ride generation keeps retrying and bails only after very many tries.

## Done

- `src/world/boundary.ts` — generates a gentle closed outline per seed, of a
  target area, passing exactly through the gate. `PARK_BOUNDARY` is the one per
  build, from `PARK_SEED`.
- **The player clamp and the nav lattice both ask the boundary now**, not a
  radius. `setPlayBounds` takes a `ParkBoundary`; the castle interior passes
  `circleBoundary`, which genuinely is one. Deliberately behaviour-identical —
  the garden still gets `GARDEN_PLAY_BOUNDARY`, the old circle, because the
  clamp cannot move alone (see below).

**`GARDEN_PLAY_BOUNDARY` is the one line that switches the garden onto the
generated outline**, and it must change in the same commit as the terrain, the
rim and the wall. On its own it would let a player walk out to 110 m, through
where the masonry is not and off the side of a terrain disc that still ends at
83.5 m. The shell migrates in one piece.

## The two findings that matter

**1. The gate pin is what creates the variety — it is not a constraint fighting
the design.** A park of 2x area has a mean radius (~82 m) well outside the gate
(60 m), so the outline must come *in* to meet it: the park pinches at the
entrance and swells away from it. Measured, that gives radii of 57–110 m and
pairwise mean differences between seeds of 3.6–11.4 m. Pinning the gate at the
mean radius instead collapses the spread to **zero** — every seed identical. So
the pin is the generator, and this is not a reserved gate zone: it is one
pinned point on an otherwise free curve.

**2. "2x area" moves the whole outer shell, not just the lawn.** Doubling the
honest play area (`GARDEN_PLAY_RADIUS` 58, 10,568 m²) needs mean radius ~82 m,
which is outside the Rail Race outer ring (70.2), `TREELINE_INNER_RADIUS`
(71.5), `RIM_START` (72), and level with `TERRAIN_RADIUS` (83.5). The crest and
treeline were only *just* moved out on 2 Aug to clear those rings. **Base
settled at 58** (see the ruling below); the factor stays a single tunable
(`PARK_AREA_MULTIPLIER`) and the outer shell derives from the boundary, so
revisiting it is one constant rather than a rewrite.

## Three things the generator got wrong first

All found by measuring, none by reading the code. Worth knowing before editing.

1. **First-acceptable search found nothing, on every seed**, and silently fell
   back to a circle — every park identical, the exact failure the uniqueness
   ruling exists to prevent. Only a spread-of-radii probe caught it. Now it
   searches 2000 candidates and keeps the gentlest. Measured: 200 tries leaves
   three of five seeds too sharp, 2000 leaves none.
2. **The silent circle fallback is gone** — it throws now. Quietly returning a
   circle is *how* (1) hid.
3. **`distanceToEdge` was wrong by up to 14.4 m.** Searching segments near the
   query point's own bearing is true for a circle and false for a park running
   57–110 m: from near the origin the nearest edge is wherever the park is
   narrowest, most of a turn away. Striding the whole loop still left 0.13 m
   from a **near-tie 108 vertices from the winner** — widening the refinement
   window does nothing for that, which is why it looked fixed when it was not.
   It now scans every vertex by squared distance and projects only the few
   beside it. Exact against brute force, 1.6 µs per call.

## Numbers as committed

| seed | area err | rmin | rmax | spread | min curvature radius |
|---|---|---|---|---|---|
| 20260728 | −0.00% | 59.7 | 101.4 | 41.7 | 26.4 |
| 2 | −0.00% | 58.4 | 110.4 | 52.0 | 26.4 |
| 5 | −0.00% | 59.9 | 99.9 | 40.0 | 25.6 |
| 11 | −0.00% | 60.0 | 107.0 | 47.0 | 28.9 |
| 18 | −0.00% | 60.0 | 101.2 | 41.2 | 27.3 |

Gate hit exactly on every seed (`distanceToEdge(gate) = 0.000`).
`GENTLE_CURVATURE_RADIUS` floor is 20 m, taken from the camera (~36 m of
visible ground depth), not from the generator's own target.

## Is `r(θ)` an "arbitrary curved shape"? Measured: yes — and SETTLED

Jim reframed the issue (5 Aug): **the shape freedom is the deliverable, the size
increase is only the means**. That raises a fair challenge — `r(θ)` is
star-shaped, so every ray from the centre crosses the edge exactly once and it
can never express a crescent, horseshoe or kidney.

Measured rather than argued. For a polar curve the signed curvature numerator is
`r² + 2r'² − r·r''`; where it goes negative the boundary genuinely curves
*inward*. It does, on every seed:

| seed | concave % of edge | circleness `4πA/P²` | max deviation |
|---|---|---|---|
| 20260728 | 27.7% | 0.849 | 26.6% |
| 2 | 28.1% | 0.836 | 36.2% |
| 5 | 23.4% | 0.875 | 26.3% |
| 11 | 26.4% | 0.872 | 31.7% |
| 18 | 23.4% | 0.867 | 26.2% |

A perfect circle is 0% and 1.000. So between a quarter and a third of every
park's edge is a real bay or waist. The outlines were drawn and put in front of
Jim: <https://claude.ai/code/artifact/fdf33550-bbae-4fcc-af6b-7db2d3b5c191>

**Ruling, 5 Aug: "Those shapes are all fine, thanks." Keep `r(θ)`. No
representation change.** The star-shaped limit — no crescents, horseshoes or
kidneys — is accepted, not merely tolerated. Do not reopen this without a new
ruling; it is recorded in `boundary.ts`'s own doc comment too.

The escape hatch stands if it is ever wanted: every consumer asks
`distanceToEdge`, never a radius, so only `profileBoundary` and
`generateParkBoundary` would be replaced, and the gate pin survives either
representation.

**Pattern worth reusing: when a judgement is visual, produce the visual.**
Drawing the outlines got a decision in one round instead of three, and measuring
concavity properly — signed curvature going negative, not eyeballing — is what
made the answer trustworthy.

**Base settled at 58** by the Overseer, and the shape framing agrees with the
variety framing: freedom is bought with the gap between mean radius and the
pinned gate, so 58 (gap 22 m, 23–28% concave) beats 52 (gap 13.5 m, tamer).

## Still to do — the consumers

Hard boundaries, all must move to `distanceToEdge`:

1. `Collision.ts:709` player clamp **and** `NavGrid.ts:324`, which mirrors it —
   **these two must change in lockstep** or tap-to-move disagrees with walking.
   Plus `Building.ts:507`, which restores the garden clamp on leaving the castle.
2. `terrain.ts:28` rim, and `Garden.ts:76` polar terrain mesh (a disc topology —
   needs re-tessellating for a non-circular outline).
3. `Garden.ts:142-253` boundary wall — an angle sweep at constant radius, at
   three levels of detail (blocks, 28 pillars, a 64-gon collision polygon).
   Needs an arc-length walk of the outline instead.
4. `parkLayout.ts:170` `|centre| + boundingRadius <= PLOT_EXTENT_LIMIT`, plus
   `parkLayout.ts:82`'s hand-copied `GATE_RADIUS = 60`, and every manifest
   `band` (annuli about the origin).
5. `train/route.ts` — `WALL_INNER_RADIUS` at four sites, and a radius-per-bearing
   representation underneath. `railRace/route.ts` — closed-form circular in ~10
   places (`length = TAU*R`, `angleAt(d) = -d/R`). **These two are #116's lane.**

Soft/aesthetic, should follow but will not break the park: `Scenery.ts`
scatter + treeline, `Flowers.ts`, `Fireflies.ts`, `paths.ts:78` ring solve,
`ParkMap.ts` (which draws the park's shape to the player).

Already shape-agnostic, leave alone: `rail/generate.ts`, `coaster/route.ts`,
`scripts/check-park.mts`.

## Invariants still to write

Area within tolerance, spline gentleness (curvature floor), wall continuity.
**Prove each red first** — break what it guards, watch it fail, restore.

Note `Invariant` is now `(facts) => readonly string[]`; the registrar holds the
only `expect`. Inherited from #114's merge of the contract branch.

## Gotchas

- A fresh worktree has **no `node_modules`** — `npm ci` or vitest exits 127.
- `tsconfig` covers only `src`, so **`tsc` never typechecks `test/`** (#192).
- Expect invariants that quietly assumed circular symmetry to start failing as
  seeds diverge. That is the point — **swap the seed and write down why, never
  weaken the assertion.**
