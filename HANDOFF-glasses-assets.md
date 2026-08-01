# HANDOFF — glasses-assets

Branch `feat/glasses-assets`, worktree `.claude/worktrees/glasses-assets`,
branched from `origin/main` (today's hat rework, character-creation tabs and
jetpacks already in).

## Task

Glasses for character creation — sunglasses, star, heart, plus the existing
"none" default. **Scope: assets + rig wiring only.** A separate agent wires up
the character-creation UI on top of this; `CharacterCreation.ts` and any
picker UI were not touched.

## State: done, build green, not yet opened as a PR (as instructed)

`npm run build` exit 0, checked as an actual exit code (not piped through
`tail`/`head`).

## What was added

- `src/art/models/glasses.ts` — `createGlasses(kind: GlassesKind): AssetHandle`,
  `GlassesKind = 'sunglasses' | 'star' | 'heart'`, `GLASSES_KINDS`. Modelled on
  `hats.ts`'s `createHat`: same `toonMaterial`/ink-outline conventions, same
  "authored in head units, converted once by a `fit` group scaled by
  `KID_HEAD_SCALE`" pattern. Origin is the point that mounts on
  `kid.glassesAnchor` (an "anchor"-origin asset, same family as hats — see
  `check-asset-contract.mts`'s `Origin` type).
- `src/art/models/kid.ts` — new `glassesAnchor: Group` on `KidHandle`, added to
  `crown` alongside `hatAnchor`/`hairAnchor`/`jetpackAnchor`. Positioned at the
  midpoint of a new exported `kidEyeCentre(side: -1 | 1): Vector3`, which sits
  next to the existing `kidEyeTopAt(azimuth)` and reuses its sphere
  trigonometry (evaluated at the eye's own azimuth instead of its outer
  corner) rather than re-deriving "where the eyes are" a second time.
- `src/art/style/artPalette.ts` — a small "glasses" section in `ART`: reuses
  `PALETTE.flowerRed`/`PALETTE.flowerYellow`/`ART.heartPink` as frame colours
  where an existing name already fit the shape (stars are yellow, hearts are
  `heartPink`), and adds three new lens-tint colours where nothing already
  matched (`glassesSunLens`, `glassesStarLens`, `glassesHeartLens`).
- `scripts/measure-glasses-fit.mts` + `npm run check:glasses-fit`, wired into
  `build`. The `measure-hat-fit.mts` pattern: build the real kid and the real
  glasses, measure vertices, gate on span vs. head width, centre-line drift,
  and vertical position vs. the eyes' own measured height.
- `scripts/check-asset-contract.mts` — the three `glasses.*` kinds added
  alongside `HAT_KINDS`, origin `'anchor'`. All three pass with no drift
  ("95 assets check out" includes them).

## Exact API for the UI agent

```ts
import { createGlasses, GLASSES_KINDS, type GlassesKind } from '../art/models/glasses';
// GlassesKind = 'sunglasses' | 'star' | 'heart' — 'none' is just "don't attach one"

const glasses = createGlasses(kind);   // AssetHandle: { root, height }
kid.glassesAnchor.add(glasses.root);   // no offset maths — mirrors kid.hatAnchor.add(hat.root)
```

`glassesAnchor` is a plain `Group`, exposed on `KidHandle` next to `hatAnchor`.
There is no `setGlassesWorn`-equivalent yet (unlike `setHatWorn`) because
nothing currently needs `kid.height` to re-measure when glasses go on — glasses
sit far below the top of the hair/hat and cannot be what `visibleTop` finds.
If that assumption ever stops holding (a very tall future pair?), add one
mirroring `setHatWorn`.

There is **no `entities/WornGlasses.ts`** — `entities/WornHat.ts` is the
closest precedent if the UI agent wants one (pop-in scale animation, name-label
height math, etc.), but building it was left to that agent since it is
UI/gameplay wiring, not an asset.

## Hats and glasses: coexist cleanly, no special-casing needed

`hatAnchor` sits at the crown (world y ≈ 1.98 m on the default kid);
`glassesAnchor` sits at the eyes' own height (world y ≈ 1.52 m, ~0.6 m
forward of the skull centre) — well separated, and every hat is already
contractually required to clear the eye line (`hats.ts`'s `browLine`, gated
against `kidEyeTopAt`). So a sun hat's brim and a pair of sunglasses at the
same time is two independently-worn things with no shared geometry to
conflict over. Nothing needed changing in `hats.ts` for this.

One thing genuinely worth an eye once there is a UI to look at it in: the sun
hat's brim silhouette, worn low and wide, might visually crowd star/heart
glasses' larger lens shapes from directly above at the 38° iso camera — not a
measured problem (nothing overlaps in geometry), just a "does it look busy"
question that needs the actual browser, which this task did not have.

## The one real bug found and fixed here

The first version of `measure-glasses-fit.mts` copied `measure-hat-fit.mts`'s
`hypot(x, z)`-about-an-anchor span metric. That is only valid when the
measuring frame's Z origin sits on the object's own central axis — true for
`hatAnchor` (a hat wraps the skull's own vertical axis) and false for
`glassesAnchor` (glasses sit ~0.6 m forward of it). Measuring the bare head's
width about `glassesAnchor` reported **2.53 m** against `measure-hat-fit.mts`'s
own **1.40 m** for the identical head; separately, measuring the glasses about
`hatAnchor` reported them at **1.14×** the head instead of the true ~0.6×.
Both numbers looked plausible in isolation and were only caught by
cross-checking against a sibling script measuring the same head. Fixed by
measuring a genuine left-right span (`max x − min x`) instead, which is
frame-independent here since every head-mounted anchor is a *translated*, not
*rotated*, child of `crown`. Written up in `ART-AGENT-NOTES.md` §10
(committed on `feat/character-modelling`, the notes file's home) since it is
a durable trap, not a one-off.

## Transparency

No new transparency approach — followed the existing convention exactly:
`toonMaterial(colour, { transparent: true, opacity })`, the same recipe
`balloons.ts`'s flying-corgi goggles use (torus rim + flattened tinted `blob`
lens, `decal()`-ed). Star/heart lenses use the same idea with
`starGeometry`/`heartGeometry` (`style/shapes.ts`, already correctly wound)
instead of a torus, since neither shape has an obvious "rim" primitive: a
solid frame-coloured copy of the shape sits a hair behind a smaller,
transparent, tinted copy of it.

## Not done / left for the next agent

- Character-creation tab UI, the picker itself, wiring `GlassesKind` into
  save/load state — explicitly out of scope for this task.
- No `entities/WornGlasses.ts` — see above.
- No visual QA in the actual running game (no browser access this session;
  the Overseer said who owns it and it was not this task). Everything here is
  verified by measurement scripts and `npm run build`, per CLAUDE.md's rule
  for when the shared Chrome profile is not yours to drive.
