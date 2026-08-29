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

_(record each as it is made)_

- **D1** — one PR closes #334 and #234.

## Next steps

1. Review `origin/stylized-map`'s `parkMapArt.ts`; either build on it or write
   down plainly why not.
2. Draw the boundary from `PARK_BOUNDARY.outline()`; size the viewport from
   `PARK_BOUNDARY.extent`.
3. Per-attraction drawings, anchored to true positions, labelled.
4. Fidelity + coverage check; prove it red by nudging a mapped position.
5. `npx tsc --noEmit`, `npm run test:procgen`, `npm run build` (unpiped, check
   exit code). Headless playwright-core screenshots on **port 5334**
   (`--strictPort`, kill by PID). No chrome-devtools MCP.
6. Screenshots onto the `qa-screenshots` orphan branch; PR via `gh pr create`
   referencing both issues. **Do not merge.**
