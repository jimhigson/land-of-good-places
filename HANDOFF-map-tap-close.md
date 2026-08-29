# HANDOFF: map tap-to-close (fix/map-tap-to-close)

Jim: *"Deployed map isn't zoomable by pinching. As soon as I touch the screen
the map closes. Should be a definite tap to close."*

The **pinch half was already fixed** on `254484d2` — confirmed again in my own
before-measurements (pinch reaches 4.00x at every viewport and never closes the
map). What is left is the **close-on-`pointerdown`** half, plus two things QA
found while confirming it.

## Measured BEFORE (dev server 5390, real CDP touch, `scripts/qa-map-gestures.mjs`)

```
phone-portrait   canvas 380x693  labels 11/16  backdrop none (card fills screen)
phone-landscape  canvas 626x270  labels  8/16  backdrop 49,195   closedOnDown TRUE  dragKeptOpen FALSE
tablet           canvas 601x693  labels 15/16  backdrop 30,512   closedOnDown TRUE  dragKeptOpen FALSE
desktop          canvas 657x654  labels 14/16  backdrop 182,450  closedOnDown TRUE  dragKeptOpen FALSE
```
Pinch: 1.00 -> 4.00x, map stayed open, at all four. Hint text at all four
(including portrait, which has no backdrop): "Tap where to go, or tap outside
to close."

Park extent spanX 178.5 m, spanZ 156.4 m (+6 m margin each side). Portrait
draws the park at 380x336 inside a 380x693 canvas — **357 px, 52% of the
paper, blank**.

## Plan

1. **Shared tap definition** — `src/core/input/tapGesture.ts` (NEW): 18 px
   drift, 600 ms, three predicates. `PointerControls` now imports it instead of
   owning its own copy. DONE, tsc clean.
2. `ParkMap` backdrop: definite tap (down+up on the root, within drift/time),
   and its canvas uses the same constants instead of `DRAG_SLOP_PX = 8`.
3. Hint derived from the real layout (is there a backdrop gap?), not a
   breakpoint guess.
4. Portrait labels: use the blank letterbox bands for names.

Dev server: port 5390, `--strictPort`. Kill by PID only.
QA harness committed at `scripts/qa-map-gestures.mjs` (not in the build).
