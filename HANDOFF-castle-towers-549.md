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

# BLOCKED — a second defect the fix exposes, needing a ruling

## The collider work is done and green

`check:castle-towers` passes and goes red (exit 1, all four turrets, 0.60 m
against 2.214 m of stone) when the registration is deleted. `pnpm run check`
exit **0**. `pnpm run build` exit **0**. The base-radius one-owner refactor is
in and behaviour-preserving (drawn mesh still 2.2140).

## What blocks it

`pnpm run test:procgen` is **red: 1 failed | 758 passed**, on
`seed 288 > every entrance has standable ground` — a **pre-existing invariant**,
not one of mine. My turret clause passes on all seven tested seeds (2.83 m).

Root cause, measured: `parkLayout` puts an anchor's entrance at
`plot centre + dir x (edgeDistanceAlong(footprint) + 1.4)`, and the building's
footprint is the **24 x 18 rectangle, which excludes the four corner turrets** —
precisely the same omission as the collider, one level up. So on a seed whose
outward bearing points at a corner, the **sign, the doormat and the path spur's
end land inside drawn stone.**

It was invisible for exactly as long as the turrets were walk-through: a child
could stand inside a tower, so "standable ground at the entrance" was true.

## How widespread — 3 of the 16 pool seeds, measured on `main`'s own layout

| seed | entrance | nearest turret | verdict |
|---|---|---|---|
| 274 | (-31.5, 23.1) | 1.15 m | **INSIDE STONE** |
| 288 | (27.8, -22.2) | 0.46 m | **INSIDE STONE** |
| 346 | (-28.1, 22.2) | 0.45 m | **INSIDE STONE** |

(against a 2.214 m stone radius; the other thirteen are clear, closest 3.49 m.)
Only 288 is in the seven-seed procgen set, which is why only it went red.

## Why I did not fix it here, and what I tried

I implemented the smallest post-hoc fix — push the castle's entrance outward
along its own bearing until a child standing there clears every turret, with
`ANCHOR_ENTRANCE_STAND_OFF` made a shared owner so `parkLayout` and the push use
one stand-off. It works geometrically but **cascades into the path network**: on
288 the anchor moved 3.75 m and seed 288 then failed *two* different invariants —

- `spur-building's end at 26.2, -20.9 stops 2.00 m short of 'building' (anchor)
  at 24.6, -19.7 — a path to nowhere`
- a detour ratio: `'stall.keychain' and 'station-0' ... 16.13x, wasting 215.5 m`

That is a generator change with player-visible consequences on at least three
parks, and the correct version is almost certainly at the source — the layout
solver siting the castle, or choosing its entrance bearing, so that its own
turrets are not in the way ("procgen backtracks on collision, always") — rather
than a post-hoc shove that the path router then has to chase. **Reverted; the
branch carries only the collider work.**

## The ruling needed

Three options, none of which is mine to pick:

1. **Fix the layout solver** so the castle's entrance clears its own turrets,
   in this PR or a stacked one. Player-visible on ~3 of 16 seeds (a sign and a
   doormat move); needs Jim either way.
2. **Land the collider and fix the entrance in a separate ticket**, which means
   `test:procgen` is red on 288 in the meantime — not acceptable under zero
   tolerance, so this only works if the two land together.
3. **Replace seed 288 in the pool.** Explicitly sanctioned by CLAUDE.md, but it
   would hide a defect that demonstrably affects 274 and 346 too, so I would
   argue against it.

## State

- [x] Collider registered from one owner, measured, documented
- [x] `check:castle-towers` in the chain, proved red without the fix
- [x] Procgen invariant, proved red, coverage note on stderr
- [x] Reachability proved with controls; `pnpm run check` and `build` exit 0
- [ ] **BLOCKED**: `test:procgen` red on seed 288 — awaiting the ruling above
- [ ] `check:coplanar`
- [ ] PR

## The `/spawn` link, ready for Jim (do not send directly)

Verified standable against the built collision world, canonical seed, all four
corners; use the south-east turret:

`/spawn?pos=60.4,24.0&facing=233`

One sentence: *walk into the castle's corner turret — before, you strolled
straight through the stone and out the other side; now it stops you.*
