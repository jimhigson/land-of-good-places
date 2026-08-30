# HANDOFF: map tap-to-close (fix/map-tap-to-close) — COMPLETE, PR raised

Jim: *"Deployed map isn't zoomable by pinching. As soon as I touch the screen
the map closes. Should be a definite tap to close."*

**The pinch half was already fixed** on `254484d2` — re-confirmed in my own
before-measurements: pinch reaches 4.00x at all four viewports and never closes
the map, on unmodified `main`. **The close-on-touch half was not**, and is what
this branch fixes, plus two things QA found while confirming it.

## What changed

1. `src/core/input/tapGesture.ts` (NEW) — the one definition of "a tap":
   18 px drift, 600 ms, timed by `event.timeStamp`. `PointerControls`
   (tap-to-walk) and both of `ParkMap`'s surfaces read it.
2. `ParkMap` backdrop closes on a **definite tap** — down and up on the
   backdrop, inside that window — not on `pointerdown`. The map canvas drops
   its private 8 px/no-time-limit rule for the same one.
3. The hint asks the **layout** whether a tappable backdrop exists and says
   "tap ✕ to close" when it does not (phone portrait is full-bleed).
4. The label ladder is generated from the canvas and marches out along
   whichever axis has spare paper, with a leader line back to the picture;
   placement is split from painting so all text is drawn last.

## Measured, identical harness (`scripts/qa-map-gestures.mjs`), dev server 5390

| viewport | backdrop | closes on pointerdown | closes on definite tap | drag from backdrop keeps open | pinch keeps open / zoom | labels |
|---|---|---|---|---|---|---|
| 390x844 before | none (full-bleed) | n/a | n/a | n/a | yes 1.00->4.00 | 11/16 |
| 390x844 after | none (full-bleed) | n/a | ✕ closes: yes | n/a | yes 1.00->4.00 | **16/16** |
| 844x390 before | 49,195 | **YES (bug)** | yes | **no (bug)** | yes 1.00->4.00 | 8/16 |
| 844x390 after | 49,195 | no | yes | yes | yes 1.00->4.00 | **16/16** |
| 768x1024 before | 30,512 | **YES (bug)** | yes | **no (bug)** | yes 1.00->4.00 | 15/16 |
| 768x1024 after | 30,512 | no | yes | yes | yes 1.00->4.00 | **16/16** |
| 1440x900 before | 182,450 | **YES (bug)** | yes | **no (bug)** | yes 1.00->4.00 | 14/16 |
| 1440x900 after | 182,450 | no | yes | yes | yes 1.00->4.00 | **16/16** |

Tap-to-walk on the map canvas still fires at all four (it gained a 600 ms
window when it took the shared definition) — `canvasTap true`.

Portrait names dropped before, by name off `dataset.missingLabels`: The Spooky
House, Sky Cruiser, The Rail Race!, The Land Hotel, **and Bluebell Halt**
(QA counted four; it is five). After: none, at all four viewports.

## Gates

`npx tsc --noEmit` 0 · `npm run build` 0 (unpiped) · `npm run test:procgen` 0
(453 tests). First build attempt failed on `check:park-boot` — the known
load-dependent flake #324, with my dev server running; passed twice on its own
and the full build passed once the server was stopped.

## Notes for whoever picks this up

* Screenshots: `/tmp/lgp-map-qa/` (`before-*`, `after-*`, `shot-*`).
* **Headless Chromium delivers touch ~2.0-3.1 s apart on this page** — the main
  thread is saturated by the park rendering behind the overlay. A tap harness
  that relies on dispatch timing therefore measures every tap as a long press.
  `qa-map-gestures.mjs` passes CDP's `timestamp` on each touch instead, which
  is what Chrome puts on `event.timeStamp`. Do not "fix" that back.
* Dev server was port 5390, `--strictPort`, killed by PID (7482/7501). Nothing
  of Jim's was touched.
