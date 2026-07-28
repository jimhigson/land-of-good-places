# HANDOFF — flowers-stars

Branch `flowers-stars`, worktree `.claude/worktrees/flowers-stars`.
Two small family-reported fixes, one PR. Browser NOT owned — build-verify only.

## FIX 1 — "Pick!" chip appears far too often

**Cause.** `Flowers.interactZones()` emits one zone per *live* flower — 400 of
them, scattered over a 55 m radius. Every flower is pickable, so a chip is
almost always on screen.

**Fix.** 90 % SMALL (the existing model, pure decoration, **no interact zone at
all**) / 10 % LARGE (new: taller stem + a five-petal bloom with an amber
centre, ~2–2.5× the presence). Only LARGE flowers get zones, are found by
`nearestWithin`, and can be picked.

The split is decided once per index in the constructor from its **own** `Rng`
stream (`SIZE_SEED`), so:
- it is deterministic per flower index,
- the main `this.rng` stream is untouched → the meadow's existing layout,
  colours and stagger are bit-identical to before.

A slot's size class never changes on respawn.

**Persistence check (done).** Nothing keys picked flowers by index. `pick()`
calls `gameStore.collectFlower(colour)` which appends an inventory item keyed
by colour + uid; `state/save.ts` persists inventory + `wornFlowerUid` only.
There is no per-slot flower state in the save at all, so the split cannot make
an old save inconsistent.

## FIX 2 — stars are screen-locked ("wallpaper")

**Cause.** `Sky` is a full-screen quad drawn with an `OrthographicCamera(-1,1,1,-1)`;
the star field is hashed straight off screen NDC, so it never moves.

**Important finding — a world-anchored dome cannot fix this.** The game camera
is orthographic (`CAMERA_IS_ORTHOGRAPHIC`, "one camera angle, forever"), and an
orthographic projection has **zero** depth parallax: a world-fixed dome centred
on the origin projects to exactly the same screen pixels no matter where the
camera is, i.e. it reproduces the current bug; and a dome re-centred on the
camera each frame is likewise frame-identical. The camera also never rotates,
so a rotation-derived offset is always zero.

**Fix.** Authored parallax. Each frame the camera reports where the **world
origin** lands on screen (its position along the camera's own right/up axes, in
world units — no matrix inversion, just two dots against `matrixWorld`'s first
two columns), divided by the current view half-height to get screen units. The
sky samples its field at `p - uSkyOffset`, where `uSkyOffset = anchor *
SKY_PARALLAX`. `SKY_PARALLAX = 1` would pin the sky to the ground 1:1; 0.08
makes it a very distant sky that slides slowly. Zoom falls out for free: the
half-height divide means the same walk shifts the sky further when zoomed in.

The **moon and sun share the same offset** — one sky, moving as one piece.
A star-field that drifts while the moon stays nailed down would read as a bug.

## FIX 3 — the fairy-light string is very faint

**Cause.** Both rigs (`FairyLights`, the plaza ring; `TreeLights`, the
tree-to-tree garlands) drew the wire with `LineBasicMaterial`. WebGL ignores
`linewidth` on essentially every platform, so a line is always **one device
pixel** — half a CSS pixel on a retina screen. There is no thickness setting to
turn up.

**Fix.** The wire becomes geometry: a `TubeGeometry` of radius 0.025 m on five
faces, in both rigs, replacing the `Line`/`LineSegments`. Same colour, fog and
dusk opacity ramp; bulbs and halos untouched. `TreeLights` merges its per-span
tubes so it keeps its one-draw-call promise. Neither casts a shadow.

## FIX 4 — twice as much run dust

`DUST_STRIDE` halved (π → π/2): two puffs per foot instead of one, so every
puff keeps the size and lifetime it had and only the cadence changes. The side
a puff comes off is now taken from `floor(step / 2)`, i.e. per *foot*, or the
two trails would zip across each other instead of staying two lines.

## NOT DONE — RiPika fountain statue (follow-up)

Asked for late, cut at the landing call. **Nothing was written for it** — no
files, no commits. Research that a successor can start from:

- `src/art/models/ripika.ts` — `createRipika()` returns a `RipikaHandle` with
  `height: 1.46` (to the ear tips) at scale 1. `buildRipikaHead(scale)` is
  already designed to be reused at any size (the hat shop is the other caller).
- Suggested approach: build a `createRipika()`, `setWalkPhase(0, 0)` for a rest
  pose, scale to ~1.7 m, then traverse and re-material every mesh to a warm-grey
  stone ramp keyed off each original colour's luminance (so the cocoa tips and
  the cream tummy survive as tonal steps in stone). **Skip meshes whose material
  has `side: BackSide`** — those are `addOutline`'s inverted-hull shells; re-tint
  them with `inkTint(stoneGrey)` instead of replacing them.
- The painted face is the one mesh whose material has a `map` (a canvas texture
  with tomato cheeks). Hide/dispose it and carve features as geometry instead —
  otherwise the statue keeps pink cheeks. `RipikaHandle` does **not** currently
  expose `skullR`; `buildRipikaHead` returns it, so adding
  `skullR: ripikaHead.skullR` to the handle is a two-line change and is what a
  carved-feature pass wants for placement.
- Where it goes in `src/world/Fountain.ts`: the centre is already a column
  (y 0.1–1.8), an upper bowl (top face y 2.16), bowl water (surface y 2.17), a
  finial ball (y 2.5) and a water spout (y 2.86). **Replace the finial and the
  spout** with a short grey plinth standing on the bowl water at y 2.17
  (bottom radius ≤ 1.2 to sit inside it) and the statue on top. The six jets sit
  at y 1.45, radius 1.22 — below and outside that, so nothing clips. Feet land
  around y 2.5; a 1.7 m statue tops out near 4.2 m, about the fairy poles'
  height, which is as tall as it should get before it starts occluding the
  plaza ring behind it.

## State

- [x] FIX 1 flowers — committed
- [x] FIX 2 stars — committed
- [x] FIX 3 fairy-light wire — committed
- [x] FIX 4 run dust — committed
- [ ] RiPika fountain statue — not started, see above
- [x] `npm run build` green (exit 0)

## Visual QA still needed (no browser)

1. Walk at night: stars + moon shift with camera movement, gently.
2. Zoom in/out at night: the sky shifts more per step of walking when zoomed in;
   nothing pops or jitters.
3. Stroll a full lap: "Pick!" chips are now rare.
4. Picking a large flower still works (bend/pick/smell, sparkle, respawn).
5. Small flowers show no chip and no rainbow, and you walk straight through them.
6. A large flower's growth: bud → petals flare late → amber centre, no pop.
7. Fairy-light strings read as cord at default zoom and at both zoom extremes,
   in daylight and after dark; the plaza ring and the tree garlands match.
8. Running dust: two lines behind her heels, denser but not a cloud.
