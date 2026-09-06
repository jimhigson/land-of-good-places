# Handoff — issue #549: the castle's corner towers have no collider

- **Branch**: `fix/castle-towers-549`, off `origin/main` at `731f7cbe`.
- **Worktree**: `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/castle-towers-549`
- **Model**: Opus 5 (1M context), chosen by the Overseer that dispatched this Engineer.
  A replacement must run the same model.
- **Visible to a player** — a child can feel it — so it **waits for Jim** (back ~09:00).
  Do not send him the link directly; hand it to the Overseer.

## The bug, measured before it was fixed

`scripts/measure-castle-towers.mts` marches a player-sized body at each tower's
axis from 14 m out, on **48 bearings** at **two strides** (0.05 m and
`PLAYER_LONGEST_STEP`), against the real `CollisionWorld` of a real built park.

On `731f7cbe`, canonical seed — all four towers, stone radius **2.214 m**:

```
tower-body-0 at (33.44,  3.60) closest approach 0.60 m, expected >= 2.83 m  <-- WALKS THROUGH
tower-body-1 at (57.89,  3.60) closest approach 0.60 m, expected >= 2.83 m  <-- WALKS THROUGH
tower-body-2 at (33.44, 22.05) closest approach 0.60 m, expected >= 2.83 m  <-- WALKS THROUGH
tower-body-3 at (57.89, 22.05) closest approach 0.60 m, expected >= 2.83 m  <-- WALKS THROUGH
```

She gets to within 0.60 m of the axis of a 2.214 m-radius stone turret.

## The controls, run before the measurement was believed

CLAUDE.md: two agents got clean, decisive, entirely wrong answers from flood
fills measuring the wrong thing, and only the control caught it. So:

- **Positive** (castle centre, known solid): closest approach **6.51 m** — the
  facade rectangle stops it, so the instrument *is* consulting collision. Had
  this read ~0, every tower result would have been meaningless.
- **Negative** (open lawn 150 m out, known walkable): closest approach
  **0.00 m** — so the instrument does not report "solid" for empty ground, and
  a stop is a real obstacle rather than the play bounds or a stale probe.

The play bounds are deliberately widened to a 1e6 sentinel for the sweep: the
park's leash would otherwise stop a march before any stone did.

## Two mechanism findings, checked rather than assumed

1. **`topIsAbsolute` does not apply here.** `addCircle`'s `topHeight` defaults
   to `Infinity`. The tower body is 10.6 m tall with a 4.2 m cone above it —
   far beyond any jump apex — so the honest collider is solid at every height a
   child can occupy, and there is no knee-high top to stand on. Checked in
   `Collision.ts`, not presumed from the ticket.
2. **The "stuck inside a solid box" trap is a *rectangle* problem, not a circle
   one.** `CollisionWorld.addRectangle` is four `addWall`s round a hollow
   middle, and a mover inside is never pushed out. A **circle** is different:
   `resolve()` pushes radially outward by `(minimum - distance) / distance`,
   and at `distance < 1e-5` — dead centre — it applies an arbitrary but stable
   shove rather than dividing by zero. So a circle is solid all the way
   through and a child who somehow started inside one is ejected, not trapped.
   **This is why the fix uses `addCircle` per tower and not `addRectangle`.**

## Which radius, and why not the wider one

`CASTLE_TURRET_FOOTPRINT_RADIUS` is 2.45 (the roof cone's oversail); the body's
base is `TOWER_RADIUS * TOWER_BASE_FLARE` = **2.214**. The collider takes the
**body's** radius, because the cone begins at 10.6 m and a child cannot reach
it. Using 2.45 would stand her 0.24 m off visible stone — an invisible wall,
which is a smaller fault than walking through but still a fault.

Taken from `CASTLE_TOWERS[i].radiusBottom` rather than retyped, so a turret that
is re-flared takes its collider with it.

**Coordinate frames agree**: `facadeX(local) = BUILDING_CENTRE_X + local`, and
`CASTLE_TOWERS` builds `x = BUILDING_CENTRE_X + localX`. Same frame, so the
tower solids are directly usable as world coordinates. Verified by reading both,
because a frame mismatch would have put four colliders in the wrong place while
every number still looked plausible.

---

# DONE — PR 581 open, approved, green on all six gates

**Nothing here is outstanding.** An earlier version of this file said
`test:procgen` was red on seed 288 with a decision left to make. That is
**stale and was wrong to leave standing**: it is green, and had been for some
time before the record caught up.

## Final state, measured at `08dca78c`

| gate | exit |
|---|---|
| `pnpm run check` (63 steps) | **0** |
| `pnpm run test:procgen` (21 files, **759 passed, 0 skipped**) | **0** |
| `pnpm run check:coplanar` (224 seams, all baselined, none new) | **0** |
| `pnpm run check:swept-bus` | **0** |
| `pnpm run check:park-pool` (**all 16 pool seeds**) | **0** |
| `pnpm run build` | **0** |

**Four standalone gates, not three.** Each was verified to have actually
*executed* by finding its own script name in its own log — an exit code alone
does not prove a step ran, and another agent reported "all gates green" having
never executed `check:swept-bus`. One trap in that technique: `check:hop-clearance`
runs `scripts/measure-hop-clearance.mts`, so grepping for the check's name
finds nothing even though it ran.

## What the fix turned out to be: one omission, four consumers

"How far does the castle reach?" had no owner, and four places each answered
with the same wrong rectangle. All four were silent for the same reason — the
turrets were walk-through, so standing inside drawn stone looked fine.

| consumer | how it surfaced |
|---|---|
| the **collider** | a child walks through 2.3 m of stone |
| the layout solver's **entrance** | 3 of 16 seeds put sign, doormat and spur inside a tower |
| the path **spur's target** (`paths.ts:3902`) | a spur stopping 2.00 m short |
| the **waypoint seeder** (`insideFacade`) | seed 5: a waypoint 0.57 m from a turret axis, `poi.nospot: 1` |

The last two were **found by this fix, not caused by it**. Making the stone
solid is what made them observable.

Only the three broken parks moved: 274 1.15 → 3.61 m, 288 0.46 → 3.60 m, 346
0.45 → 3.60 m. **Thirteen seeds unchanged, canonical included.** The 1.4 m
stand-off was deliberately not shrunk to make a seed pass.

## The seed-288 warp re-search is SUPERSEDED — do not imitate it

`parkWarp.ts`'s 288 entry was re-searched here
(`{layout:{waterFight:1}}` → `{layout:{'stall.waterFight':2}}`, SOLVED in 26
candidates, `stranded=0`, `oracle=pass`, JSONL under `measurements/`).

**Jim has since ruled the seed pool becomes 0..15** — *"I don't care about
those seeds — the new procgen should work for 0..15 so forget they ever
existed"* — so seed 288 is a park being retired, and that re-search is about
geometry nobody will generate. It is left in place because it is correct for
the pool as it stands today and removing it would make this branch red, **but
it is not a live mechanism to copy.** Anyone reaching for "re-search the warp
vector" as a remedy should first check whether the seed still exists.

The seed-5 warp re-search was **abandoned** and is not in the diff: UNSOLVED
after 35 candidates, and its best candidate (`{layout:{fountain:1}}`) passed
`check:park` while failing the Rail Race camera invariant — tested rather than
believed from the label. Seed 5 was fixed at its source instead, in
`insideFacade`, and keeps its original vector.

## Independently confirmed in review

Re-measured by the reviewer rather than taken on trust: bodies y 0.73–11.33 at
radius **2.2140** (two rings — 2.2140 foot, 2.0500 top), roofs y 11.33–15.53 at
**2.4500**, so the cone genuinely starts 10.6 m up; the taper argument for not
using `topIsAbsolute` holds on measured ring data; `CASTLE_TURRET_BASE_RADIUS`
is genuinely single-owner with mesh and collider both built from it; and the
discs go into the **placed** footprint, so both pre-existing consumers of
`edgeDistanceAlong` are corrected without learning what a turret is.

## Filed separately, not fixed here

- **#577** — the walk graph can leave two close destinations without a
  connector (seen on 288, on spare seed 1104 while vetting, and in seed 5's
  recorded history).
- **#579** — the documented local pre-push ritual can go fully green on a tree
  that breaks a park: `check` and `test:procgen` do not build the sixteen
  parks. This is how the fourth consumer was found, and it has since caught a
  second agent.
- Both recorded spare seeds, **1102 and 1104, fail against current `main`** —
  the spares noted in `parkSeedPool.ts` are stale.

## The `/spawn` link (held for the Overseer to give Jim)

Verified standable against the built collision world:
`/spawn?pos=60.4,24.0&facing=233`

*You used to stroll straight through the corner tower, and on some parks the
castle's own doormat was buried inside it; now the tower stops you and the
doorway is out in the open.*
