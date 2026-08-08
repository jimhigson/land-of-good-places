# HANDOFF: interior-rules (fix/interior-rules)

Four defects from Jim's live hotel play, each fixed with a one-owner
generalisation and a red-first probe. **All four are implemented and
committed**; remaining work is full-build confirmation, test:procgen, browser
QA, PR.

## Done (each commit message carries its red proof)

1. **Walls abut** — root cause: every hotel wall box stopped at the room's
   half-extent (the perpendicular wall's centre line), leaving a see-through
   0.25 m² corner column, floor to ceiling, at every outer corner. Owner:
   `src/world/wallRuns.ts` (`segmentsMinusGaps` moved from building/parts.ts +
   `cornerClosedSpans`); hotel outer walls/partitions/alcove build through it,
   north/south own corners, east/west butt. Castle was already healthy (its
   plan rects run the full outer width) and now imports the shared arithmetic.
   Probe: check:hotel 15 walks every perimeter (two fibres, 5 cm steps,
   doorway gaps skipped) — red: 6 rooms × 14 unwalled samples.

2. **Nap visible** — root cause: `Hotel.nap` stacked TWO reclines (posture
   'reclined' → model root −1.35, PLUS group pitch −π/2) ≈ −167°: head
   measured at y = −0.64 (mattress 0.55). Fix: posture only, feet at
   bed z +0.61 so the pose's measured 1.33 m throw lands the head on the
   pillow (−0.72, y ≈ 1.01); per-bed `napBlanket` (dressing.ts) in the bed's
   rainbow, shown during nap, hidden on wake; `Bed.blanket` wiring. Probe:
   check:hotel 16 drives a REAL Player through the bed zone's Sleep action,
   one real tick, asserts head above mattress on the pillow + down-rays (head
   ray hits kid, body ray hits 'hotel.napBlanket') — red: 4 failures.

3. **Tap spacing rule** — owner `src/world/tapSpacing.ts`:
   `TAP_FINGER_METRES` (two UI units through IsoCamera's frustum formula on
   the 390×844 QA viewport ≈ 1.13 m), zone-vs-band clearance, zone-vs-zone
   separation (hard only for DIFFERENT verbs; same-verb pairs = warnings).
   Door bands became data: `layout.ts hotelDoorBands` (checkDoorways +
   atLiftDoors consume them), `Hotel.towerDoorBand`, Building
   `castleEntranceBand/castleExitBand` (+ instance `doorBands()` to dodge the
   static-import seed trap). `scripts/check-tap-spacing.mts` in the build
   chain — red: 19 failures incl. the reported suite-window-eats-door-tap by
   1.75 m. Fixes: band-aware window-zone picker (+ `WindowWall.zoneAt` pins
   lobby/suite choices; suite west wall offers no zone, glass stays);
   paintings rehung (lobby west→north 10.2, breakfast down to one at −6.4,
   garden west→north 6.3, suite ±4.8); breakfast tables a→(−6.4,6.2),
   e→(−4.6,0.2); castle frontDoor zone = its band's own handle; flowers keep
   out of stall + train-station pick areas (`STALL_PICK_RADIUS` moved to
   stallPlacement.ts; stations fed via `World` → `keepClearOfTapZones` after
   the route solves). procgen invariant 'no two tap targets crowd each other
   or a doorway' — red proof by planting large flower slot 111 on the
   water-fight booth (1 failed | 48 passed); NB disabling the keep-out alone
   stays green on all 5 seeds (no seed happens to collide), hence the planted
   mutation.

4. **Decal ladder** — owner `DECAL_STEP = 0.02` in hotel/dressing.ts, derived:
   ortho far (CAMERA_DISTANCE·3=270) / 2^16 ≈ 4.1 mm a depth step, ~6.7 mm
   height at 38°; probe 17 fails overlapping flat tops within 2 steps
   (13.4 mm), computed from the same constants — red: 20 problems (garden
   lawn/path EXACTLY coplanar 5.4 m², ocean mat/sand 19.4 m², lift-car floor
   at plate's exact 0.000 ×5 rooms, mosaic 10 mm under rugs, sunburst 8 mm).
   Fixes: rug/roundRug real boxes on rungs + `tier` for stacked rugs (lawn 1,
   ocean mat 1, pond 2), sunburst/lilyPond/rainbowRing/rainbowRug on rungs,
   chevrons rung 4 (6 over the lawn), floor plate west apron pulled back
   under the wall in lift rooms, lily pads keep a pad's width apart.
   KNOWN TRADE-OFF: rugs have no walk platforms, so feet sink 4–6 cm (lawn
   10 cm) — pre-existing behaviour, slightly deeper; flag for QA eyes.

## Verification done
- **npm run build: EXIT 0** (full battery incl. check:hotel probes 15/16/17
  and check:tap-spacing), exit code read directly, log /tmp/build-interior.log.
- **Browser QA** (headless Playwright vs vite on 5717 --strictPort, PID
  94159; scripts qa-interior.mjs / qa-tap.mjs in scratchpad):
  - Corners: qa-interior-corner-lobby-se/nw.png — solid mitred corners, no
    notch. (corner-suite-ne.png mis-aimed at sky — retake if wanted.)
  - Nap: qa-interior-nap-mid.png — head on the pillow, red rainbow blanket
    over the body, pet beside the bed; telemetry head y=0.84 (0.29 above
    the 0.55 mattress), on the pillow band.
  - Phone tap (390×844): tap ON the suite doorway → walked straight
    through to the corridor (z 1120), NO window/painting menu. (Tap at the
    door *mouth* stops 0.3 m short of the band by TapNavigator's 0.55 m
    arrive radius — she stands in the doorway; a tap in the hole goes
    through. The '🪞Look' button seen in chip dumps is the permanent HUD
    mirror button, not a zone chip.)
  - Rugs: qa-interior-rugs-lobby/garden.png — real depth, clean edges;
    flicker is not still-testable, probe 17 owns the geometry assertion.
- test:procgen final full run in background (/tmp/procgen-final.log).

## Next steps
- Confirm procgen EXIT 0, kill vite PID 94159, gh pr create (do NOT merge).
