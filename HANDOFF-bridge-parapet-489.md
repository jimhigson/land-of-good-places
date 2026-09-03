# HANDOFF — issue #489, the hole in the bridge parapet above the arch

Branch `fix/bridge-parapet-489`, worktree
`.claude/worktrees/bridge-parapet-489`. Off `origin/main` at `7a1d81f9`.

## Status

Root cause identified by reading; **instrument not yet run** — do not trust the
diagnosis below until the numbers under "Measured" exist.

## The diagnosis (read, not yet measured)

**It is not the authored stone kit, and it is not the arch's cut.** It is the
coursed outer face of the spandrel/parapet wall, in
`src/world/train/bridges.ts`'s `buildShellGeometry`, and it is one number.

`courseLevels` is built downward from **`crownY`** — the road surface at the
crown:

```ts
for (let y = crownY; y > lowestBottom - COURSE_HEIGHT; y -= COURSE_HEIGHT) {
  if (y <= highestTop + COURSE_HEIGHT) courseLevels.push(y);
}
```

so the topmost course level is exactly `crownY`, and nothing above it is ever
pushed. `buildCourses` then clamps every column into those levels:

```ts
const yTop = Math.min(topY, Math.max(bottomY, levelTop));
```

with `topY` = this ring's parapet top. Where the parapet top is **above**
`crownY`, `yTop` clamps down to `crownY` and the wall between `crownY` and the
parapet top gets **no outer face at all**.

The parapet top is `surface + parapetHeightFor(hump)`, and at the crown that is
`crownY + PARAPET_HEIGHT + PARAPET_CROWN_LIFT` = `crownY + 0.72 + 0.45` =
**`crownY + 1.17 m`**. So the missing band is widest — up to 1.17 m — exactly
at the crown, which is directly above the arch, and narrows to nothing out on
the ramps where the road surface has fallen a parapet's height below the crown.

That is Jim's report precisely: a run of wall absent above the arch's opening,
the parapet either side intact.

The `Ring.outerTop` vertices (`bridges.ts:1122`) are created at the parapet top
and then **never referenced by any quad** — dead vertices, which is the tell.
Before #360 the outer face was one quad `outerBottom → outerTop` and there was
no gap; #360 replaced it with the coursed column and anchored the courses on the
road crown instead of on the wall top.

The comment on the course levels states the intent — *"anchored on the crown so
the top course lands square under the coping"* — and that intent is right; the
anchor is simply the wrong crown. `PARAPET_CROWN_LIFT` (also #360, same commit)
put the coping 0.45 m above the road crown the levels are anchored on.

### Why you can see through it rather than seeing the inside of the wall

Only the **outer** face is missing. The inner face (`innerTop` → `innerBottom`)
and the `wallTop` cap are drawn full height. Those are single-sided, so the game
camera — looking down at the near parapet from outside — sees straight past the
missing outer face, through the back of the inner face, to the grass and railway
beyond.

## Ownership split

**Mine (Engineer), not the Artist's.** The fault is in how the swept shell is
built in `src/world/train/bridges.ts`; the authored kit
(`art/blend/bridge_stones_*.py`, voussoirs / keystone / coping) is placed
correctly and is not implicated. I have not touched `art/blend/*`.

## The intended fix

Anchor `courseLevels` on the **parapet top line** rather than the road crown:
start the ladder at `highestTop` and drop the now-redundant
`y <= highestTop + COURSE_HEIGHT` guard. Then course 0's `levelTop` is at or
above every ring's own parapet top, `yTop` clamps to the parapet top, and the
face covers the whole wall by construction. `crownY` then has no remaining use
inside `buildShellGeometry` and the parameter should go — one owner, rather than
a second crown definition sitting unused.

## Still to do

1. Run the instrument (below) and paste per-seed numbers under "Measured".
2. Answer the collider question: `guardRails`' `topHeight` already reads
   `parapetTopFor`, i.e. the *arced* top, so the collider is expected to be
   correct where the mesh is not — confirm by measurement, not by reading.
3. Fix, re-measure, add the invariant, prove it red against today's geometry
   and paste the geometry beside the transcript.
4. `pnpm run check`, `pnpm run test:procgen`, `pnpm run build`; `check:coplanar`
   especially — new wall area meets the coping plane.
5. Eyes on it in a browser, standing on a bridge, on more than one seed.

## The instrument

A see-through probe, derived from the drawn `wallTop` mesh rather than from the
formula behind it.

`wallTop`'s vertex buffer is written four per ring by `buildShellGeometry` —
`copingOuter[+], copingOuter[−], copingInner[+], copingInner[−]` — so vertex
`4r + 0..3` gives, for ring `r`, the outer edge point and the inner edge point
on each side, both at that side's own parapet-top height. Outward direction is
`normalize(outer − inner)` in plan.

From each outer point, march a horizontal ray in from `D` metres outside at a
ladder of heights below the parapet top and record the first **front-face** hit
on the bridge group. Where the outer face exists the ray stops at the wall;
where it does not, it sails past.

**Control:** the same probe at a height well below `crownY`, where the wall is
known to be drawn, must hit on every sample. An instrument that reports a hole
everywhere, or nowhere, is measuring the wrong thing — two agents on this
project have had clean, decisive, wrong answers from exactly that.

## Measured

*(not yet run)*
