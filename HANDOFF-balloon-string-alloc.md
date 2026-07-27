# Handoff — balloon strings stop allocating per frame

Branch `perf/balloon-string-alloc`, from `origin/main` @ 37b4015.

## What was wrong

`BalloonString.rebuildGeometry` allocated a `CatmullRomCurve3` **and** a
`TubeGeometry` every frame, per held balloon, and disposed the previous one.
`MAX_HELD = 6`, so twelve geometry objects a frame plus their buffers.

## What was done

Copied `art/models/ponytail.ts`'s approach verbatim in spirit: four capsules
built in the constructor, `place()` writes `position` / `quaternion` / `scale.y`
each frame, nothing allocates in `update()`. The verlet simulation itself is
byte-for-byte unchanged.

`BalloonString.mesh` → `BalloonString.group`. Two call sites in
`HeldBalloon.ts` (`sync`, `disposeEntry`).

## Two findings worth keeping

1. **The string is permanently taut, by about a third.** `HeldBalloon.ts` pins
   one end at `player.model.holdAnchor` (≈ 0.30 m above the feet: the arm pivot
   at y 0.72 plus the anchor's own −0.42) and the other at
   `player.position.y + model.height + HEAD_CLEARANCE` ≈ 2.45 m. That is ~2.15 m
   apart, against `HELD_STRING_LENGTH = STRING_LENGTH × 1.7 = 1.615 m`.
   - This is why `place()` **must** scale each segment on Y. Fixed-length
     capsules would have drawn the string in four pieces with 0.15 m gaps.
   - It is also why the visual risk here is low: with the chain that taut, the
     Catmull-Rom spline the old tube interpolated was a straight line.
   - Nobody asked for it to be changed and it has not been. But if the family
     ever says the strings look stiff, *this* is the reason, not the drawing.
2. **World space, no matrix inverse.** Unlike the ponytail (drawn inside a
   moving character, hence its one inverse per frame), these live in
   `HeldBalloons.group`, which is never transformed. The old tube's vertices
   were world-space for the same reason. Documented on `BalloonString.group`.

## Trade-off a reviewer will ask about

4 draw calls per string instead of 1 — 24 instead of 6 for a full bouquet, and
~40 triangles per string instead of 80. Accepted: the complaint is GC pauses,
and 24 tiny meshes is not a draw-call problem. Say so rather than re-litigating.

## Status

`npm run build` passes (exit 0). **No visual QA** — the browser is not mine.
See the PR body for the list.
