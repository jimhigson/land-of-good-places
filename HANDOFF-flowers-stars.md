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

## State

- [x] FIX 1 implemented + committed
- [x] FIX 2 implemented + committed
- [x] `npm run build` green (exit 0)
- [x] PR raised

## Visual QA still needed (no browser)

1. Walk at night: stars + moon shift with camera movement, gently.
2. Zoom in/out at night: the sky shifts more per step of walking when zoomed in;
   nothing pops or jitters.
3. Stroll a full lap: "Pick!" chips are now rare.
4. Picking a large flower still works (bend/pick/smell, sparkle, respawn).
5. Small flowers show no chip and no rainbow, and you walk straight through them.
