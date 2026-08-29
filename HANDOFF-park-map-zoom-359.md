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
