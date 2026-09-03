# HANDOFF — 3D Artist, issue #489 (bridge parapet hole above the arch)

Branch `art/bridge-stones-489`, worktree `.claude/worktrees/art-bridge-489`.
Paired with an Engineer on `fix/bridge-parapet-489`.

## Verdict, reached before any modelling: THE KIT IS NOT AT FAULT

The authored kit (`art/blend/bridge_stones_build.py` → `coping`, `voussoir`,
`keystone`) contains **no wall piece at all**. The parapet's outer face is not
kit geometry — it is swept procedurally by `buildShellGeometry` in
`src/world/train/bridges.ts`. Nothing in `art/blend/` can produce or cure this
hole. **This is the Engineer's half. `art/blend/*` is untouched by this
branch** apart from two new *diagnostic* scripts (below).

The kit was also checked for the drift this repo has been bitten by before
(build script reading constants, render script hand-copying them):
`bridge_stones_build.py` reads every number through `ts_const()` from
`src/art/models/bridgeStones.ts` and `src/world/train/bridgeFootprint.ts`. No
copied numbers. Not the cause.

## Root cause (measured on the built park, not read off the source)

`src/world/train/bridges.ts`, in `buildShellGeometry`, the course ladder:

```ts
for (let y = crownY; y > lowestBottom - COURSE_HEIGHT; y -= COURSE_HEIGHT) {
  if (y <= highestTop + COURSE_HEIGHT) courseLevels.push(y);
}
```

`crownY` is **the road surface at the crown**, not the top of the wall. The
loop starts there and only ever descends, so **no course level is ever
generated above the roadway**. `buildCourses` clamps every column with
`yTop = Math.min(topY, Math.max(bottomY, levelTop))`, so the coursed outer
face tops out at `crownY` on every ring — while the parapet stands at
`parapetTopFor(...) = surface + PARAPET_HEIGHT + PARAPET_CROWN_LIFT·arc`,
which at the crown is `crownY + 1.23 m`.

That band is drawn by nothing. It is tallest exactly over the arch (where the
crown lift is greatest and the road is at `crownY`), and closes towards the
ramp feet — which is precisely "above the arch where some of the wall is
missing".

The guard on the next line is the tell: `if (y <= highestTop + COURSE_HEIGHT)`
filters out levels *above* `highestTop`, and can never fire, because the loop
begins below `highestTop`.

### Numbers, seed 1, `bridge-72.0`

Rays cast horizontally at the near parapet, `#` = wall present, `.` =
daylight, from the road upward at 0.1 m a mark:

```
along   0  roadY 4.40  parapetTop 5.63 (=road+1.23)  .##....................
along  -1  roadY 4.38  parapetTop 5.61 (=road+1.23)  ###....................
along  -2  roadY 4.31  parapetTop 5.54 (=road+1.23)  ####...................
along  -3  roadY 4.12  parapetTop 5.35 (=road+1.23)  ######.................
along  -4  roadY 3.86  parapetTop 5.06 (=road+1.20)  ########...............
along  -6  roadY 3.24  parapetTop 4.37 (=road+1.13)  ##############.........
along  -8  roadY 2.63  parapetTop 3.68 (=road+1.06)  #############..........
```

Every run of `#` ends at **y = 4.40 = `crownY`**, whatever the local road
height is. Confirmed on seeds 1, 3 and 5 (five bridges, three different
spans): **0.94–0.96 m of daylight straight through the parapet** on every one.
Span-independent — this is not a tiling problem.

## The instrument: `scripts/measure-bridge-parapet.mts`

```
LGP_SEED=1 node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
  scripts/measure-bridge-parapet.mts
```

Measures the built park. Exit 1 if any bridge can be seen through. Two things
it does deliberately, both of which it got wrong first and was corrected for:

- **The parapet top comes from a downward cast, not from "the horizontal ray
  stopped hitting anything".** The obvious rule declares the hole to be sky, so
  the first version of this script reported seed 1's `bridge-72.0` — a bridge
  already proved holed by hand — as **clean, exit 0**. A check that could not
  fail. Anyone changing it must re-break it and watch it go red.
- **The pass/fail line is visible daylight, not the `shell` gap.** The swept
  shell legitimately stops short at the ramp feet where the parapet has
  tapered and the coping caps what is left (0.16 m, zero daylight). Failing on
  that would be red when the game is right. The shell figure is printed as the
  diagnostic that points at the cause; the verdict comes from rays against
  everything drawn.

## Two faults, not one — the second one matters

A candidate one-line change (kept at `candidate-fix.patch` in the artist's
scratchpad; **not committed to this branch**, it is the Engineer's to make):

```ts
const firstLevel = crownY + Math.ceil((highestTop - crownY) / COURSE_HEIGHT) * COURSE_HEIGHT;
for (let y = firstLevel; y > lowestBottom - COURSE_HEIGHT; y -= COURSE_HEIGHT) {
```

Measured with it applied:

| seed / bridge | daylight before | daylight after |
|---|---|---|
| 1 / `bridge-72.0` | 0.96 m | **0.00 m** |
| 3 / `bridge-4.0` | 0.94 m | 0.16 m |
| 5 / `bridge-12.0` | 0.96 m | **0.00 m** |
| 5 / `bridge-56.0` | 0.94 m | 0.16 m |
| 5 / `bridge-142.0` | 0.96 m | **0.00 m** |

So it is **necessary but not sufficient**. A second, smaller hole survives on
two of the five bridges: **0.16–0.18 m of daylight at 1.10–1.28 m over the
road, at along ≈ ±6 m** — mid-ramp, at the top of the wall, not at the arch.
It is *not* a ladder-anchoring artefact: replacing the anchored `firstLevel`
with a plain `highestTop + COURSE_HEIGHT` gives byte-identical numbers. The
likeliest suspect is the `revealAtTop` suppression added by #472 (the deleted
horizontal reveal under a course that collapsed at the parapet top), because
that is the only other thing in `buildShellGeometry` that deletes a face at
exactly that height — but that is a hypothesis, not a measurement, and it is
the Engineer's file.

**Do not close #489 on the one-liner alone. Run the instrument on all five
seeds and require exit 0.**

## Collision

The collision walls are built from `parapetTopFor` directly (`bridges.ts`
~line 756), i.e. from the parapet's true top, not from the drawn courses. So
the **collider is correct and the mesh is what is wrong**: a child can see
through the parapet but cannot walk or fall through it. The fix restores
geometry to match a collider that already covers it; **no collider change is
required**, and the parapet's shape does not move.

## Deliverables on this branch

- `scripts/measure-bridge-parapet.mts` — the instrument above.
- `art/blend/bridge_shell_dump.mts` (`pnpm run dump:bridge-shell`) — builds
  the real park and writes one bridge's drawn meshes to OBJ, in the bridge's
  own frame, centred on its crown. No arguments lists that seed's bridges.
- `art/blend/bridge_shell_render.py` (`pnpm run render:bridge-shell`) —
  imports those OBJs, flat greys per named part, **saturated orange
  backdrop**, four shots to `art/renders/<stem>-{parapet,flank,iso,mouth}.png`.
  Neither script carries a bridge dimension: the dump writes the vertices the
  game draws and every camera is derived from the imported bounding box, so
  there is nothing to drift the way `bridge_stones_render.py`'s hand-copied
  constants once did. This exists because `render:bridge` assembles a preview
  from the *kit* and is structurally unable to show a fault in the swept shell.
- `art/renders/{before,after}-seed{1-72,5-142}-*.png` — 16 renders, the hole
  and the candidate repair, two seeds, two spans. `before-*-flank.png` and
  `before-*-parapet.png` are the ones that show Jim's bug plainly: coping
  blocks standing on open air over the arch ring.
- `ASSET_MANIFEST.md` §32 — the two scripts and why they exist.
- `package.json` — `dump:bridge-shell`, `render:bridge-shell`. Script *set*
  compared against `origin/main`: 104 → 106, **nothing dropped**.

## Status

- [x] Kit inspected, cleared, drift check clean
- [x] Root cause measured, seeds 1/3/5
- [x] Instrument written, proved capable of failing, control run both ways
- [x] Second, independent fault found and quantified
- [x] Before/after renders committed
- [x] `ASSET_MANIFEST.md` entry
- [ ] Nothing further owed by the artist unless the fix changes the parapet's
      *shape*, which the candidate does not.
