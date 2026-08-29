# HANDOFF — pannable, zoomable park map (#359)

Branch `feat/park-map-zoom-pan`, worktree `.claude/worktrees/eng-359`, cut from
`origin/main` @ `7c3370d` (which already contains #353, squash-merged as
`69bfedc` — the gate, the cat bus and the `--insets` QA tooling are all on main).

Predecessor context: #353's PR body and `HANDOFF-park-map-334.md` on main.

## The ticket

14 (now 16) names cannot fit on a 380 px phone canvas at the TEXT rule's
minimum size. Icon size and label count trade directly, so tuning cannot solve
it. Zoom breaks the constraint: show a legible portion and let the child move
around it. Measured counts that motivate it (from #353, of 16 features):
desktop 14, phone 390 **11**, phone 320 **8**, landscape **8**.

## The one architectural rule

**`outdoorParkMapProjection()` stays the single owner of the world-to-map
transform.** Zoom and pan are extra *inputs* to it, never a second transform
composed on top. A `ctx.translate`/`ctx.scale` round the renderer would mean
the map draws at one transform while `toPlane` — and therefore every tap
(#309/#315) — inverts another; the fidelity check would stay green while taps
landed in the wrong place. #234 was exactly one such second definition.

## Done so far

`src/ui/parkMapProjection.ts`:

- `MapView { zoom, centreX, centreZ }`, `MAP_MIN_ZOOM = 1`, `MAP_MAX_ZOOM = 4`.
- `defaultMapView(w, h)` — whole park, framed centre.
- `clampMapView(view, w, h)` — the child can never pan into blank paper: the
  explorable region is exactly what zoom 1 frames. At zoom 1 the permitted
  interval collapses to a point, so the view is pinned and the projection is
  **bit-identical to what #353 shipped**. `check:park-map` still green,
  unchanged, with no view passed.
- `outdoorParkMapProjection(w, h, view?)` — with no view, byte-identical
  behaviour to before. With one, it multiplies `base.scale` by zoom and
  re-centres the origin. Still one affine map, still one `toCanvas`/`toPlane`
  pair derived from it.

## Left to do

1. **Gestures** — pinch + drag on the canvas, and wheel on desktop. Must not
   fight tap-to-walk/tap-to-use (#309/#315): a drag past a threshold should
   cancel the tap. Note #244: pinch can currently zoom while a ride owns the
   camera — the guard is on the wheel only. Reuse the game's existing pinch
   handling rather than writing a second one.
2. **Labels at a zoom threshold** rather than all competing at once.
3. **Extend `check:park-map` to hold at every zoom level and panned offset** —
   currently it proves one view. A map accurate only when fully zoomed out is
   #234 recurring one level up. Sample a grid of (zoom, centre) and assert
   position round-trip + conformality at each; assert clamping never shows
   beyond the zoom-1 region. **Prove each new assertion red** with its own
   `--mutate` (e.g. zoom applied to one axis; clamp allowing the park to leave).
4. Re-measure label counts at all four sizes, at zoom 1 and zoomed in.
5. Screenshots, `qa-screenshots` branch, PR. **Do not merge.**

## Conventions carried over from #353

- Dev server on **port 5334**, `--strictPort`, killed by PID. Headless
  `playwright-core`; no chrome-devtools MCP.
- `scripts/qa-park-map.mjs` captures the **viewport**, not `.parkmap-card`, and
  takes `--insets` to simulate a notched phone (headless reports every
  `env(safe-area-inset-*)` as 0).
- Label counts come from `dataset.labelCount` / `dataset.featureCount`, read
  off the DOM — never from counting painted text runs, which double-counts a
  wrapped name.
- `git diff --stat origin/main...HEAD` — **three dots**.

## DONE — PR #372 raised, not merged

All five items complete. Label counts (visible denominator):

| | zoom 1 | zoom 2 | zoom 4 |
|---|---|---|---|
| desktop | 14/16 | 12/12 | **4/4** |
| phone 390 | 11/16 | 12/15 | **4/4** |
| phone 320 | 8/16 | 8/13 | **4/4** |
| landscape | 8/16 | 11/14 | **7/7** |

Every visible name is drawn at max zoom, at every size. Zoom 1 unchanged from
#353 by construction (assertion 4).

Check: 7 assertions, 175 views, all 8 mutations red. Key measurement —
`--mutate=zoom-axis` raises **140** failures under assertion 5 and **0** under
assertion 3, proving the zoom grid catches a class the default-framing check
was structurally blind to.

Deliberately NOT asserted (structural, written into the file instead): the
round-trip at zoom (exact for any affine map), and drawn-vs-inverted agreement
(one MapProjection, no second path).

Found: **#244 is stale** — it says the wheel is guarded and pinch is not; the
code is the opposite, fixed by #282. Should be closed or rewritten. Not touched.

Build 0, procgen 453/453, tsc clean. Dev server 93228 killed. Screenshots on
`qa-screenshots` under `park-map-zoom-359/`. Worktree `eng-359` can be removed
once #372 merges. **Do not merge.**

## Round 2 of review (#372) — all four addressed

1. **Pan clamp was broken and the check agreed with it by construction.**
   `clampMapView` bounded by the rectangle zoom 1 *frames*; `frameExtent` fits
   the smaller axis, so that rectangle is mostly letterbox and at zoom 4 the
   view fitted inside the empty band — blank map. Now clamps to the park's
   extent + lawn margin, centring rather than clamping when content < view
   (which is what preserves zoom 1). Assertion 6 rewritten to sample the canvas
   against the real boundary polygon: **measures the outcome, not the rule**.
   `--mutate=clamp-letterbox` reinstates the bug → `0.0% of the canvas is park`.
   Live repro at 844x390 zoom 4 after three drags: **36.7% lawn**.
2. **`zoomedAboutPoint`/`pannedBy` were untested and are NOT structural** — my
   vacuity argument was right about the round-trip and wrong about these.
   Assertion 8 added; `--mutate=focal` and `--mutate=pan-sign` red.
   NB it caught a bug in the *test* first: at zoom 2 on 700x300 the park's
   width still fits, so pinning x is correct. Sample at MAP_MAX_ZOOM only.
3. **Wheel `deltaMode`**: `wheelNotches()` exported from PointerControls and
   reused. The hand-copied constant left the normalisation behind.
4. **`setPointerCapture`**: now `capture()`. It was the first line of the
   handler, so a throw silently killed the whole gesture.

Corrected the "140 vs zero" claim: the zero was a wiring artefact
(`zoom-axis` only applies in `projectionForView`; assertion 3 uses
`projectionFor`). The real number is **140 of 175 views = 175 − 35 at zoom 1**.

#244: premise is backwards, but do NOT close — its *Fix* section (move the
guard into `nudgeZoom`, assert every input path) is undone, and this PR adds a
third caller-side condition. Retitle to the residue.

11 mutations red, green green. Build 0, procgen 453/453, tsc clean.
Dev server 23734 killed. **Do not merge.**
