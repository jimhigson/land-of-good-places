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

## State

- [x] Worktree at `731f7cbe`, installed
- [x] Instrument written, **both controls passed**, bug quantified
- [ ] Register the colliders from `CASTLE_TOWERS`
- [ ] Prove the check goes red without the fix
- [ ] `keepOutsFor` reachability: prove no doorway / stand spot / seat blocked
      (the castle doorway is on the **south** face between `ENTRANCE_MIN_X` and
      `ENTRANCE_MAX_X` — the nearest thing at risk)
- [ ] Fold the sweep into `check:castle`
- [ ] Invariant in `test/procgen/invariants.ts` if placement is generated
- [ ] `check`, `test:procgen`, `check:coplanar`, `build` — exit codes unpiped
- [ ] `/spawn` link + one sentence, handed to the Overseer, not to Jim

## Rebase warning inherited

`main` moved twice tonight: #517 added `check:node` **first** in the chain, #523
wrapped the chain in a watchdog. If a chain conflict arises, rebuild the
resolution from the **merge base**'s step list (not a moved `main`), re-apply
this branch's addition, and verify by **parsing** the scripts object comparing
step **sets** — never counts, never grep. `rerere` is on and will replay a stale
resolution silently.


---

# Status after the layout fix (ruling: option 1)

## Both halves of the omission are now fixed, from one owner

The castle's extent had **two** wrong answers in the codebase and no owner: the
collision world did not know about the turrets, and neither did the layout
solver. Both now ask the same source.

- `core/constants.ts` (which imports nothing — the only cycle-free home, since
  `building/layout.ts` imports `parkLayout`) owns `CASTLE_TURRET_BASE_RADIUS`
  and `CASTLE_TURRET_CORNERS`.
- `parkLayout`'s `footprintAsPlaced` writes the turrets into the **placed**
  footprint. Both consumers of `edgeDistanceAlong` already read
  `PlacedEntry.footprint` — the entrance placement, and the spur's target at
  `paths.ts:3902` — so neither had to learn what a turret is, **and the
  short-spur cascade disappeared without its own patch.**
- They could not be declared statically in `parkManifest`, because the drawn
  castle is not centred on its plot: it is nudged `BUILDING_CENTRE_NUDGE`
  toward the park middle, in a direction that depends on where the plot landed.

**Measured result: only the three broken parks moved.**

| seed | before | after |
|---|---|---|
| 274 | 1.15 m from a turret axis — INSIDE STONE | 3.61 m — clear |
| 288 | 0.46 m — INSIDE STONE | 3.60 m — clear |
| 346 | 0.45 m — INSIDE STONE | 3.60 m — clear |

The other **thirteen** seeds' entrances are unchanged, canonical included.

## One failure left, and it is not local

`test:procgen`: **1 failed | 758 passed**, seed 288,
`no two close destinations are left with a wildly disproportionate paved detour`
— `stall.keychain` and `station-0` are 14.2 m apart but 229.7 m by paving
(16.13x).

Investigated rather than assumed:

- **Not the collider.** The train route on 288 is byte-identical with and
  without it — loop length 188.263 both ways, same station tap points. The
  railway does not pass near the turrets on that seed.
- **Not local to the castle.** `station-0` is at (-24.7, -19.5); the castle
  entrance moved from (27.8, -22.2) to (25.2, -20.1), roughly 50 m away.

So the 2.6 m entrance move reshuffled the **global** path solve, and this seed
now lands on a network where two close destinations get no direct connector.
That is chaotic sensitivity in the walk-graph search, not a generator refusing
to adapt to the change — the one that *was* refusing (the spur stopping 2.00 m
short) is fixed and gone.

**I deliberately did not shrink the turret stand-off to make this pass.** 1.4 m
is the same stand-off every other anchor's doormat gets; picking a smaller one
because it makes a seed green is the disease CLAUDE.md names.

## The decision left

1. **Make the walk graph guarantee a connector** between close destination
   pairs. Real work in `paths.ts` and its own ticket, I think.
2. **Replace seed 288 in the pool, and write down why.** This was refused
   earlier — correctly — because it would have hidden the entrance defect. That
   reason is gone: the defect is fixed on all three seeds. What remains is a
   seed whose park has a genuinely poor walk (230 m between two things 14 m
   apart), which is exactly the "not every seed makes a good park" case the pool
   exists for.

## The `/spawn` link, ready for Jim (do not send directly)

Verified standable against the built collision world:
`/spawn?pos=60.4,24.0&facing=233`

Both halves in one sentence: *walk up to the castle's corner turret — you used
to stroll straight through the stone and out the other side, and on some parks
the castle's own doormat was buried inside it; now the tower stops you and the
doorway is out in the open.*
