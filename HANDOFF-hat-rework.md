# HANDOFF — hat rework (1 August 2026)

Branch `feat/hat-rework`, merged directly to `main` per Jim's explicit
one-time authorization (no PR review gate for this task — see the task brief
in the session that did this work). Built on top of `feat/character-modelling`
(which itself carries `fix/hood-face-baked-texture` and
`feat/kid-face-baked-uv`) merged with `feat/hat-sizing`.

## The ask

Jim viewed a live screenshot of every hat in the character-creation preview
and gave a verdict per hat (quoted in full in the task brief). Summary:

- **Party** — reference scale, unchanged.
- **Crown** — size good, sits too high, lower it.
- **Bobble** — size good, needs a normal map with vertical knit ribs.
- **Sun** — 10% bigger, and lower it.
- **Cheery Cap** — far too big (literally wider than the kid is tall at the
  old ×1.95: 2.392 m on a 2.087 m kid), bring it down, and rebuild with six
  visible panels gathered to a button.
- **Flower Crown, RiPika Cap, Trilla Hat** — all "too big, reduce", no target
  number given.

## What changed, file by file

### `src/art/models/hats.ts`

- **`HAT_SIZE_EXTRA`** (was `{ crown: 1.3, cap: 1.3 }`) is now
  `{ crown: 1.3, sun: 1.1, cap: 0.75, flower: 0.75, ripikaHat: 0.75, puff: 0.75 }`.
  `HAT_SIZE` (×1.5) is unchanged and still the base every hat gets — party and
  bobble get no extra at all, i.e. stay at the plain ×1.5 they were already at.
  **The 31 July "crown and cheery cap ×1.3 again" blanket rule is gone** —
  replaced entirely by this per-hat table, because it was the mechanism that
  produced the oversized cap in the first place (see HANDOFF-hat-sizing.md's
  own "Finding 2": the ×1.3 was approved against geometry that no longer
  exists).
- **`hatSize()` is now exported** so `measure-hat-fit.mts` reads the real
  multiplier instead of a hand-typed copy — the exact bug class that lost the
  31 July `HAT_SIZE` change is what a hand-typed copy anywhere is.
- **`CROWN_LOWER` (0.1) and `SUN_LOWER` (0.07)**, both head units, subtracted
  from every y-offset in `createCrown`/`createSunHat` before the existing
  brow-anchored `finish()` scaling runs. See "Root cause: why 'too high' was
  not a height bug" below — this is not a threshold either script gates on,
  it was tuned by eye against the screenshot the same way the family's own
  approvals always have been.
- **Bobble Hat**: `bobbleKnitNormalMap()` paints a 128×128 tangent-space
  normal map, one rib per `sin(2π·14·u)`, applied to the dome's existing
  `SphereGeometry` (`u` already runs once round the azimuth, so the ribs
  close with no seam). `normalScale` is `(7, 7)` — see "Normal map mipmap
  washout" below for why that number is nowhere near `(1, 1)`.
- **Cheery Cap**: `hoodPart(hoodPanelSeamsGeometry(CHEERY_HOOD, { tube: 0.022,
  lift: 0.02, topFrac: 0.8 }), PALETTE.leafMid)` adds six raised seam ridges,
  one down each panel boundary, converging near the crown button. Added as an
  extra mesh in `createCap()` — the shell geometry itself (`CHEERY_HOOD`,
  `hoodShellGeometry(CHEERY_HOOD)`) is untouched, confirmed by
  `check:hood-face`'s own "Cheery Cap: flat colour, no map, no shell UVs, 2306
  vertices — untouched" line.

### `src/art/models/hoodShell.ts`

- **New `hoodPanelSeamsGeometry(spec, { tube, lift, topFrac })`.** Sweeps a
  thin tube down each of the shell's own panel-seam azimuths
  (`φ = π/panels + k·2π/panels`, the troughs of the existing `cos(panels·φ)`
  relief), from `semiY·topFrac` down to the hem, using `hoodShellSampler` so
  it rides the real surface rather than a hand-picked coordinate. Cross-section
  is built from the two **horizontal** basis vectors (radially outward,
  azimuthal-tangent) rather than `hoodHemRollGeometry`'s (radially outward,
  vertical) — correct because this tube's path is nearly vertical, so the
  plane perpendicular to it is (to the accuracy a decorative seam needs) the
  horizontal plane. See the function's own doc comment for the full
  reasoning — it explains *why* this exists (the shell's built-in `seamR`
  relief alone did not read as construction under a four-band toon ramp) as
  well as *how*.

### `scripts/measure-hat-fit.mts`

- Console header no longer hand-types which hats have an extra multiplier —
  it now prints `hatSize(k)` for every kind, read from `hats.ts`.
- **`MIN_SPAN` 0.75 → 0.7, `MAX_SPAN` 2.4 → 2.0, `MAX_TIP` 1.6 → 1.5.**
  Re-derived from the new measured range (span 0.83–1.66, tip 0.98–1.43×,
  against the old 0.87–2.12 and up to 1.51×) — tighter on both ends because
  this pass mostly made hats *smaller*. `MIN_EYE` (0.02, a rule not a drift
  detector) is unchanged. Full reasoning, including what each bound would
  have caught, is in the doc comment above the constants.

## Root cause: why "sits too high" was not a height bug

Measuring the crown before touching it: its band's post-scale lowest point
was **already below** where it started pre-scale (−0.1665 m vs. −0.15 m). It
was not floating above its intended position in the vertical sense at all.

What was actually happening: `finish()` grows a hat about its **brow line**
(`y ↦ brow + k·(y − brow)`, `HANDOFF-hat-sizing.md`'s own fix, still correct
and untouched here) — the lowest point anything in the hat crosses the eyes.
For the crown, that contact point turns out to sit very close to the band's
own bottom edge (a cone-point of the crown grazes eye height off to one side,
even though dead front has no eye contact at all — `kidEyeTopAt(0)` is
`null`). Scaling almost the entire hat outward from a point barely below its
own base makes the band's **radius** balloon (×1.95 wider) far faster than
its vertical position drops. A `CylinderGeometry` band is an open ring, not a
solid disc, so once its radius is well past the skull's actual width at that
height, the background shows straight through the gap between the ring and
the hair beneath it — which is exactly what "floating above the head" looks
like in a screenshot, even though every vertex is lower than before.

**The fix is not a bigger sink toward the eyes** (that would reopen the
face-covering bug `finish()`'s brow anchoring exists to prevent) — it is
sinking the hat's own *pre-scale* geometry deeper, so that after the same
brow-anchored growth the ring's lower half sits inside the hair silhouette
(the bunches, which are much wider than the bare skull `check:hat-fit`
measures) rather than hanging clear of it. `CROWN_LOWER`/`SUN_LOWER` do
exactly that. There is no `check:*` gate for "does the background show
through the gap" — it is a rendering question, not a geometry one — so both
constants are tuned by eye against the screenshot and recorded as such in
`hats.ts`'s own comments.

**Sun Hat's version of the same complaint had a simpler cause**: its brim is
a *solid* disc, not a ring, so there was nothing to see through — just a
plain vertical gap between the brim's underside and the hair, closed by
`SUN_LOWER` alone.

## Normal map mip-map washout (Bobble Hat)

First pass: `normalScale = (1, 1)`, the painted tilt un-amplified. Rendered:
**completely flat**, no visible ribs at all, despite the texture and material
both being provably correct (confirmed: `material.normalMap` set,
`mapImageSize` 128×128, and reading the canvas's own pixel row back showed
real R-channel oscillation 58–234 across the width).

Root cause, found by testing `normalScale = (20, 20)` (visible) against
`(1, 1)` (invisible) rather than guessing: **`CanvasTexture` mip-maps by
default**, and a `sin(2π·RIBS·u)` pattern's positive and negative tilts
average towards zero at any mip level coarser than one texel per rib — so
the GPU was sampling an almost-uniformly-grey mip level at the size the dome
actually renders at. Two independent fixes were needed together:

1. `texture.generateMipmaps = false; texture.minFilter = LinearFilter` — stop
   the averaging.
2. `normalScale = (7, 7)` — even un-mipped, a literal 35° painted tilt barely
   registers under `TOON_RAMP`'s four discrete bands; most of the dome's
   surface sits inside one band regardless of a shallow normal perturbation,
   and only the fragments near a band boundary show anything. 7× was the
   smallest multiplier that read clearly in a screenshot at the preview's own
   distance — found by rendering at 1, 4, 7 and 20 and comparing, not by
   picking a number that looked right in the texture alone.

**The general lesson, for the next canvas-painted normal map in this repo**:
a periodic bump pattern needs mipmaps off (or a resolution/frequency chosen so
mip washout does not matter at the sizes it will actually render at), and
`normalScale` under this game's four-band toon ramp needs to be tuned by
rendering, not read off the angle that was painted — the ramp swallows a
"physically" correct tilt almost everywhere except right at a light/shadow
boundary.

## Six-panel Cheery Cap: what was tried first, and why it needed geometry

`CHEERY_HOOD` already had `panels: 6, seamR: 0.045, seamSharp: 6` — a
`cos(6φ)`-shaped radius relief, sharpened by `hoodShellGeometry`'s own
`seamSharp` mechanism, present in the code since before this task (it is what
the Cheery Cap has had since the earlier hood-shell rebuild). It does not read
as six panels at gameplay distance or in the character-creation preview: it
is a smooth, continuously-shaded bump under a toon ramp with only three or
four bands, and a shallow radius perturbation with `computeVertexNormals`-
smoothed normals just does not create a visible edge.

The fix that actually reads is real, raised geometry: six swept tubes
(`hoodPanelSeamsGeometry`), one per panel boundary, in a contrasting accent
colour (the same `PALETTE.leafMid` the peak and button already use, tying
"seam, peak, button" together as one trim colour — see the function's doc
comment). Confirmed by rendering at two tube radii (0.014, then 0.022 once
0.014 proved too subtle in a screenshot) — the seam relief alone was left in
place underneath (still contributing a little shading), but the geometry is
what actually makes six panels legible.

## Hats stay procedural — not baked into the character asset

Explicitly considered, per the task brief's instruction to use judgement.
**Not done, and this is the right call**: the bake-vs-patch rule
(ART-AGENT-NOTES.md §5, and the hood-face story it comes from) is about a
worn item with **one** fixed identity needing its own painted face — RiPika's
hood, Trilla's hood, both baked into their own single texture in the prior
PRs this branch builds on. A hat in the shop is the opposite shape of
problem: **one head, many freely-swapped hat kinds**, shown/hidden per
`WornHat.ts`. Baking any of them into the kid's own UV would mean either (a)
one shared UV window fighting over eight different hat shapes, which the
face-bake pattern has no answer for, or (b) a UV variant per hat kind on the
*character* asset, which is the crowd-instancing blow-up
(`kidCrowd.ts`/`InstancedCrowd`) this codebase has already deliberately ruled
out once, for exactly this reason (see ART-AGENT-NOTES.md §5's "deliberate
exclusions"). Every hat here stays a separately-built `AssetHandle` parented
to `hatAnchor`, exactly as `entities/WornHat.ts` already expects, and nothing
in this task touched that mechanism.

## The screenshot harness: `hat-samples.html` / `art/samples/hats.ts`

New, small, permanent dev tool — same pattern as `art-samples.html`. Reuses
`CharacterPreview` itself (the exact class `CharacterCreation.ts` drives), not
a re-implementation: constructs it, calls `.update()` with the same
skin/hair/outfit/eye/backpack/pet defaults the real character creator opens
on, picks the hat from `?hat=<kind>`, then drives **one manual frame at
`dt = 0`** (bypassing `requestAnimationFrame` entirely by calling the
instance's own `frame(0)` once) and calls `.setRunning(false)` before the
browser's real animation loop ever gets a turn. That is what makes two
screenshots of two different builds comparable — see ART-AGENT-NOTES.md §6's
"how to actually get a matched before/after screenshot": freeze the clock,
don't trust two shots at two different animation phases.

`window.__hatPreview` is exposed for ad-hoc console poking (turning the stage
to peek at an angle) — nothing in the file itself reads it back, and calling
the instance's own `frame()` again from the console re-arms its
`requestAnimationFrame` loop, which is a harness gotcha worth knowing about,
not a bug in the shipped page: after any manual poking, call
`preview.setRunning(false)` again before leaving the page running.

## Verification actually performed

- `npm run build` — **exit 0**, checked directly (`echo $?`), never piped.
- `npx tsc --noEmit` clean throughout, run after every code change.
- `npm run check:hat-fit`, final numbers:

  ```
  hat            width    head   grip   span    rise     tip  of kid     eye
  --------------------------------------------------------------------------
  party          1.212   0.935   1.30   0.87   1.000   2.981    1.43   0.329
  crown          1.644   1.202   1.37   1.28   0.710   2.691    1.29   0.195
  bobble         1.273   1.126   1.13   1.03   0.844   2.825    1.35   0.263
  sun            2.312   1.263   1.83   1.66   0.384   2.365    1.13   0.267
  cap            1.425   1.202   1.19   1.22   0.525   2.506    1.20   0.208
  flower         1.054   1.037   1.02   0.83   0.063   2.043    0.98   0.302
  ripikaHat      1.343   1.202   1.12   1.21   0.817   2.798    1.34   0.215
  puff           1.615   1.383   1.17   1.22   0.801   2.782    1.33   0.232

  worn size, per hat: party ×1.500, crown ×1.950, bobble ×1.500, sun ×1.650,
  cap ×1.125, flower ×1.125, ripikaHat ×1.125, puff ×1.125
  shop stands 0.85 m apart: widest two are puff at 0.782 m and cap at
  0.780 m, leaving 69 mm between them.
  hat fit: all 8 hats fit the head they sit on.
  ```

- `check:hood-face` — both critter hoods' faces still land within 0.0003 of
  authored UV after the resize; Cheery Cap confirmed untouched (2306
  vertices, unchanged).
- `check:baked-face`, `check:character-parity`, `check:hair`, `check:crowd`
  all green, none of them touches anything this branch changed.
- **Screenshots, own dev server (port 5401, PID noted at session start),
  frozen-clock harness** — before/after for all 8 hats, plus intermediate
  steps for the ones that needed iteration (crown, sun, cap sizing, cap
  seams at two tube radii, bobble ridges at four `normalScale` values). Every
  one actually opened and looked at, not just diffed by byte count — this is
  the exact trap ART-AGENT-NOTES.md §6 warns about (`toDataURL` blank-canvas
  and new-vs-new tautology false positives), and it is why the bobble ridge
  and cap seam problems were caught at all rather than shipped invisible like
  the hood faces were.
- `npm run test:procgen` — **could not run**: `vitest` is not installed in
  this environment (`node_modules/.bin` has no `vitest`), same limitation the
  `feat/character-modelling` agent hit and recorded. Not blocking here: this
  branch does not touch `test/procgen/invariants.ts` or anything procedural
  generation reads, only hat models and the hat-fit measurement script, and
  `check:park`/`check:hat-fit`'s own `MIN_STAND_GAP` gate (both inside
  `npm run build`, both green) are what actually cover shop-stand placement.

## What was NOT independently verified

- **The real character-creation UI's hat picker**, end to end (tapping
  through the shop, buying, wearing, taking off). The harness drives
  `CharacterPreview` directly with a fixed choice rather than the full
  `CharacterCreation.ts` flow — same rendering code path, same camera framing
  logic, but the click-through itself was not exercised.
- **The shop's actual display stands in the running park** (`fitouts.ts`) —
  covered numerically by `check:hat-fit`'s stand-gap gate, not seen rendered
  on an actual stand in the world.
- **A phone-sized viewport.** All screenshots were taken at the browser
  window's existing size (deliberately not resized — the shared Chrome
  profile had another agent's tab open on a different port, and CLAUDE.md's
  own lesson is that `resize_page` resizes the whole shared window, not just
  one tab).
- **The three-quarter / iso-camera angle for the Cheery Cap's seams.** A
  quick console-driven attempt to turn the stage and re-render worked once
  but is not a repeatable technique (see the harness gotcha above); the
  seams were judged front-on only, which is the same view the
  character-creation preview itself always shows, so this matches what the
  task explicitly asked to verify against, but it is not the game's own 38°
  camera.

If any of the above turns up a problem, the fix is almost certainly a small
follow-up to `CROWN_LOWER`/`SUN_LOWER`/`HAT_SIZE_EXTRA`/the seam tube's
`{ tube, lift, topFrac }` — every one of these is a single named constant
with the reasoning for its current value written next to it.
