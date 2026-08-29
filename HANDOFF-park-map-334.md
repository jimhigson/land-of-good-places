# HANDOFF — stylized park map (#334 + #234)

Branch: `feat/stylized-park-map`, worktree
`/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/eng-334`, cut from
`origin/main` @ `e71f80a`.

One PR closes both issues — they are the same defect seen from two angles.

## The ticket

- **#234** — `ParkMap.ts` draws concentric circles at 60 m / 62 m and sizes its
  viewport to 66 m. Since #115 the boundary is a radius-per-bearing profile
  running **59.7–101.4 m**, so the map draws the wrong shape *and* clips ~35 m
  off the bulge.
- **#334** — Jim wants the map replaced with a **stylized top-down rendering of
  the park that actually got generated**: real boundary, real path network, real
  attraction positions. Plus his addition: *"each building should have a drawing
  of it on the map (still labelled)"* — a little picture of *that* attraction,
  not a generic pin, keeping its text label.
- **Overseer clarification (29 Aug)**: geometric fidelity is first-class.
  Boundary, paths and every attraction must sit at the right relative position,
  scale and bearing so the map is genuinely navigable. Stylized art may be
  chunkier than the true footprint but must stay **anchored to the true
  position**. The check must assert positional fidelity (every attraction
  round-trips to its world position within a stated, park-derived tolerance)
  **and** full coverage of the `PARK_BOUNDARY` spline; prove it red by nudging
  one mapped position.

Reference art: a flat vector fun-park illustration Jim supplied. **Style only —
watermarked commercial stock (Getty/sorbetto), never trace or reproduce.** Take
from it: irregular lobed lawn blob on cream; broad cream path ribbons; each
attraction a little tilted three-quarter storybook picture; flat colour, soft
drop shadow, sparing dark outlines; generous empty lawn; every label readable.
Neither issue has the image attached — the description in the brief is the spec.

## Findings so far

### Where the truth lives

- `src/world/boundary.ts` — `PARK_BOUNDARY: ParkBoundary`, generated per
  `PARK_SEED`. `outline()` returns the edge as a closed 512-point polygon
  (`PROFILE_SAMPLES = 512`) — **this is the thing to draw**. Also `maxRadius`
  and `extent` (`minX/maxX/minZ/maxZ`), which is what the viewport must be sized
  from: a radius is not enough, the shape is neither circular nor centred.
- `src/world/anchors.ts` — `ANCHORS`, the one owner of the attraction list
  (position, entrance, footprint, glyph, signTitle, accent).
- `src/minigames/stallPlacement.ts` / `src/minigames` `STALLS` — the stalls.
- `src/world/pathGraph.ts` `ROUTES` + `routeCurve`, `src/world/paths.ts` `PLAZA`
  — the real path network. `ParkMap` already strokes these correctly.
- `world.train.route` / `.stations`, `world.fountain` — already read live.

### Current `src/ui/ParkMap.ts` (867 lines)

Already reads anchors, stalls, routes, train and fountain from the built world.
The circle is only in `renderOutdoor` (two `ctx.arc` at `GARDEN_HALF_SIZE` and
`GARDEN_HALF_SIZE - 2`) and in `render`'s viewport (`GARDEN_HALF_SIZE + 4`).
Attractions are drawn as coloured **pins with an emoji glyph**, which is what
#334 replaces with per-attraction drawings.

Also present and must keep working: tap-to-walk / tap-to-use (#309, #315) via
`canvasToPlane` → `useAttraction` → `isReachable` → `walkTo`; the indoor floor
view; label collision-avoidance in `drawLabel` at `minTextPx()`.

### Prior work

- `origin/stylized-map` — **2 commits ahead of an older main**, `f985f43` "Draw
  the park map as a stylized illustration, from real park geometry (#334)" and
  `4379e21` "Bigger icons and a smoother blob outline" (23 Aug). Touches
  `src/ui/ParkMap.ts` (+130/-58) and adds `src/ui/parkMapArt.ts` (606 lines).
  Copy of that file saved for review. **Decision pending — see below.**
- `origin/park-map` — does not exist (the brief listed it; `git` says unknown
  revision). Nothing to build on there.

## Decisions

- **D1** — one PR closes #334 and #234.
- **D2 — take `origin/stylized-map`'s icons, drop its geometry.** Reviewed in
  full. Split verdict:
  - **Keep `ICONS` / `drawIcon`** (~430 of its 606 lines): one flat-shaded
    vector drawing per attraction — castle, hotel, ball pit, ferris wheel,
    dodgems, water fight, sky cruiser, rail racer, spooky house, fountain,
    station, tree. Bold dark outline, two or three flat fills, no gradients.
    That is exactly Jim's "each building should have a drawing of it", already
    written and in the right idiom. Re-using it is cheaper and better than
    redrawing thirteen icons, and it is original art, not traced.
  - **Drop `buildBlobBoundary` and `scatterTrees`.** `buildBlobBoundary`
    *invents* a park outline from content positions plus three sine harmonics.
    It never reads `PARK_BOUNDARY` at all. That is precisely CLAUDE.md's "two
    definitions of one thing" disease — a second, fictional park shape drawn
    where the real one belongs — and it satisfies #334's "not a circle" while
    leaving #234 entirely unfixed. `scatterTrees` likewise invents trees rather
    than drawing the ones the park placed.
  - **Decisive fact**: `origin/stylized-map` never touched `render()`'s
    viewport, still `GARDEN_HALF_SIZE + 4`. **The ~35 m clip of #234 is still
    present on that branch.** So it cannot be merged as-is regardless.
- **D3 — the map's geometry comes from `PARK_BOUNDARY`.** Ground shape is
  `PARK_BOUNDARY.outline()`; viewport is sized from `PARK_BOUNDARY.extent`
  (not `maxRadius` — the shape is not centred on the origin, so a radius
  cannot frame it without slack on one side and a clip on the other).

- **D4 — no reference image was ever available.** Neither issue has one
  attached (checked the bodies, the comments and the whole repo: nothing).
  #334's own body says the image "will be attached by whoever picks this up".
  The art was built from the Overseer's written description of it. **Asked Jim
  for the file on 29 Aug.** If you are picking this up, get it before
  re-styling anything.
- **D5 — there is no image-generation tool in this environment.** No diffusion
  model, no text-to-SVG service, no image MCP. Available: Blender MCP (3D, one
  instance, Jim's Mac only), headless Chromium via `playwright-core`, Node, and
  hand-authored vector code. So the icons are hand-written Canvas 2D paths in
  `parkMapArt.ts` — which is also the form that fits this repo (deterministic,
  diffable, themeable, no binary asset to keep in step).

## Status

- Map rewired: lawn is `PARK_BOUNDARY.outline()`, viewport is
  `outdoorParkMapProjection` (the one owner), paths are the real `ROUTES` as
  cream ribbons, trees are the park's own biggest `foliageOccluders`, and every
  attraction is a drawing of itself plus its label.
- `npm run check:park-map` is written, wired into `build`, and **green**:
  worst boundary overshoot 0.00 px over 5 canvas sizes x 512 vertices; worst
  position error 0.0000 m against independently re-derived truth (tolerance
  0.62 m = `PLAYER_RADIUS`); bearing error 0.000°, scale spread 0.000%.
- **Proven red three ways** — messages quoted in the PR body:
  - `--mutate=viewport` (reinstates the old 66 m square): *"CLIPPED on square
    (520x520): the park's outline falls up to 102.7 px (26.1 m) outside the map
    canvas. The boundary runs 59.7-101.4 m and spans x -86.5..92.1, z
    -84.5..71.8 m."* This reproduces #234 exactly, and the 59.7-101.4 m figure
    it measures is the same one the issue quotes.
  - `--mutate=position`: *"MISPLACED "railRacer" (stall) ... the map draws it
    at (-8.33, 47.38) m but the park put it at (-11.33, 47.38) m — out by 3.00
    m, tolerance 0.62 m (PLAYER_RADIUS)."*
  - `--mutate=stretch`: *"SCALE NOT UNIFORM: map pixels per world metre ranges
    3.5354..3.6827 ... a spread of 4.00%, tolerance 0.10%."*

## Next steps

1. ~~Review prior work~~ — done, see D2.
2. Draw the boundary from `PARK_BOUNDARY.outline()`; size the viewport from
   `PARK_BOUNDARY.extent`.
3. Per-attraction drawings, anchored to true positions, labelled.
4. Fidelity + coverage check; prove it red by nudging a mapped position.
5. `npx tsc --noEmit`, `npm run test:procgen`, `npm run build` (unpiped, check
   exit code). Headless playwright-core screenshots on **port 5334**
   (`--strictPort`, kill by PID). No chrome-devtools MCP.
6. Screenshots onto the `qa-screenshots` orphan branch; PR via `gh pr create`
   referencing both issues. **Do not merge.**

## DONE — PR #353 raised, not merged

All deliverables complete. Build exit 0, procgen 443/443, check green and
proven red three ways, screenshots on `qa-screenshots` under `park-map-334/`.

Dev servers 27758 and 31291 both killed; `eng-334-before` and `eng-334-shots`
worktrees removed. This worktree (`eng-334`) is the only one left and can be
removed once the PR merges.

Known unrelated finding for its own issue: **sweep seed 3 fails to generate**
(`RailRouteUnsolvable`, all 96 attempts dead-end). Pre-existing on `main`.

## Review round 2 (29 Aug) — all blockers closed, restyle in

Reference image finally arrived at
`<scratchpad>/park-map-reference.png` (Getty stock — never commit it).
Key thing the prose description missed: **the reference has NO outlines**.
Flat shapes, darker tones of the same hue instead. Icons all redrawn.

Blockers closed:
1. **Phone labels** — four causes: icon size ignored map scale; one candidate
   position per label; long names on one line; canvas locked square in a boxed
   card. Now 13/14 desktop, 9/14 portrait, 7/14 landscape (was 12/7/4).
   **Not solved, improved** — 14 names cannot fit at 380px with the TEXT rule.
   Icon size and label count trade directly. A pannable/zoomable map is the
   real answer and should be its own issue.
2. **Assertion 2 was vacuous** — comment claimed independence, code did a
   round-trip. Anchors now compare against `scene.getObjectByName('anchor:<id>')`.
   New `--mutate=entrance` fires at 8.90-16.91 m. Stall/fountain/station
   branches still share their owner and now say so.
3. **Rides drawn at their booths** (22.0 m worst) — rule was inverted. Ride
   now wins at `anchor.position`; duplicate booth dropped; real footprint
   drawn faint underneath.

Smaller: planeToCanvas delegates to the projection; labels test against icon
boxes (solid core only — reserving full sprite boxes starved them to 7/14);
trees spread by minimum spacing.

All green: build 0, procgen 443/443, check red on all four mutations.
Screenshots `v2-*` under `park-map-334/` on `qa-screenshots`.

## Re-review round 3 (29 Aug) — all four items done

1. **Castle branch of assertion 2** now reads `castle-walls` from the scene.
   NB `anchor:building` would be **wrong** — that is the plot, 3.54 m from the
   masonry; it would fail a correct map.
2. **drawCoaster** drew closed ellipses over the mountain. Back arcs ->
   mountains -> front arcs, so the track goes behind the peak.
3. **Phone space** — the 237px of free card was real. Claiming it alone did
   NOTHING (8/14 either way): height was never the constraint, horizontal
   crowding round each icon was. Only paid once labels got 12 candidate
   positions reaching out to 2 text-heights. Both halves needed.
4. **Count corrected**: was 8/14 not 9 — I had been counting painted text
   runs, and a wrapped name paints as two lines. Canvas now carries
   `dataset.labelCount` from `labelBoxes.length`; read it, don't infer it.

Now 13/14 desktop, 11/14 at 390px, 7/14 at 320px, 8/14 landscape.
Screenshots `v3-*`. Build 0, procgen 443/443, check red on all four mutations.

## Round 4 (29 Aug) — Jim: "put the cat bus on too, near the entrance gates,
## and also the gates themselves"

Session handed over after the previous engineer was dropped. Worktree `eng-334`
was intact and clean at `2337678`; `node_modules` present, no `npm ci` needed.

### The real owners — found, and this is the whole ticket

Both positions come from **`src/world/entrance/layout.ts`**, which is the one
module that owns entrance geometry and is deliberately dependency-free (it
imports only `core/constants` and `core/mathUtils`), so `parkMapContent.ts`
stays headless and the check still runs on plain Node.

- **The gate** — `ENTRANCE_GATE_X` / `ENTRANCE_GATE_Z`, i.e.
  `cos/sin(ENTRANCE_ANGLE) * ENTRANCE_WALL_RADIUS` = **(0, 60)**, the centre of
  the gap cut in the boundary wall. `Entrance.ts` builds the arch there: two
  posts on the wall's tangent at `±ENTRANCE_GATE_HALF_WIDTH` (4.3 m) and a
  torus crossbar at exactly `(ENTRANCE_GATE_X, ENTRANCE_GATE_Z)`.
- **The cat bus** — `ENTRANCE_BUS_DOOR_X` / `ENTRANCE_BUS_STOP_Z` = **(0, 69)**,
  9 m outside the wall on the kerb. See "what the bus's position means" below.

### What "the cat bus's position" means on a map — decided

**The map draws the cat bus at its stop: where its door comes to rest, dead in
front of the gate.** Not where the bus currently is.

That is forced, not preferred. The bus is not park furniture — `Entrance.ts`
builds `ArrivalSequence` only when `arrivalIsDue()`, the bus rolls in from
`ENTRANCE_BUS_ARRIVE_X`, and once it has driven off past
`ENTRANCE_BUS_VANISH_X` it is disposed. For nearly the whole of a save there is
no bus in the world at all, so "wherever it currently is" is undefined most of
the time and could never be asserted. A route is not a point either.

What *is* permanent, owned and checkable is the stop, and a map marking a bus
stop with a picture of the bus is what a paper map does. `ENTRANCE_BUS_DOOR_X`
is specifically "where the bus's **door** stops", which is the half a child
cares about — it is what `ArrivalSequence` parks the bus by, working the
vehicle's centre back from it via `bus.doorDrop`, so a longer bus still stops
with its door here. That makes it the stable point of the pair.

### Check truth sources

- **gate** — genuine scene-graph truth: the arch crossbar, which `Entrance.ts`
  positions, named `entrance-arch` for the purpose. Same pattern as
  `castle-walls`. A map that read the bus stop, the wall radius or the shelter
  instead is caught.
- **cat bus** — `layout.ts`, the same owner the content list read. Stated
  plainly, exactly as the stall/fountain/station branches already are: it
  proves the projection round-trips and the feature resolves, not that the
  content list picked the right field. No separately-positioned scene object
  exists to ask, because for most of the game there is no bus.

New mutation `--mutate=gateway` swaps the two, a 9 m error on both.

### Round 4 result — done, pushed, not merged

16 features. Everything green: `tsc` 0, `build` 0 unpiped, procgen 443/443,
`check:park-map` green and red on **all five** mutations (`viewport`,
`position`, `stretch`, `entrance`, `gateway`).

**Label counts, read off `dataset.labelCount` / `dataset.featureCount`:**

| | before (of 14) | now (of 16) |
|---|---|---|
| desktop 1440 | 13 | **14** |
| phone 390 | 11 | **11** |
| phone 320 | 7 | **8** |
| landscape | 8 | **8** |

Two features added and **no existing name was lost** — the absolute count went
up or held at every size. Both new features sit alone on the park's southern
edge where nothing else competes.

The one name that does not fit is **"Cat Bus 67" at desktop and landscape**.
The gate and the bus stop are 9 m apart, which is ~31 px at desktop scale
against icons ~30-51 px wide, so "The Gates" takes the space under the bus and
the bus has nowhere left. It is present at 390 px and 320 px. Reported to the
Overseer rather than rebalanced.

Also seen and **not** fixed here (folded into #359, same class as the
reviewer's "Ball Pit labels the wrong thing" note): in landscape "The Gates"
is placed at an outermost candidate ~90 px from the gate, reading as a label
for empty path.

**Round 3 CSS blocker fixed**: `.parkmap` gives up its horizontal padding under
34rem. Measured after: card, canvas and hint all **0 px overflow** at 390, 320,
landscape and desktop. `qa-park-map.mjs` now screenshots the **viewport**, not
`.parkmap-card` — capturing the element is why this was invisible for two
rounds.

Also done from round 3's non-blocking list: castle scene lookup fails loudly
instead of `??`-ing back to the plot; the wrong-*field*-vs-wrong-*constant*
clause added to assertion 2's note; every `--mutate` mode now in the header's
copy-pasteable list.

Dev server 89352 (port 5334) killed. Screenshots `v4-*` on `qa-screenshots`
under `park-map-334/`, four sizes x two seeds, zero page errors.

**Next: issue #359** — pannable/zoomable map, as a second PR stacked on this
branch. Zoom/pan must be expressed *through* `outdoorParkMapProjection()`, not
as a second transform; reuse the game's existing gesture handling; the fidelity
check must hold across the zoom range and at panned offsets.
