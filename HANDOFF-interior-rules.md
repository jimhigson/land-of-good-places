# HANDOFF: interior-rules (fix/interior-rules)

Four defects from Jim's live hotel play, each with a generalisation:

1. **Walls don't abut** — `Hotel.buildRoomShell` wall spans are boxes centred
   on the perimeter line, each stopping at ±half-extent: at every outer corner
   two perpendicular walls leave an empty 0.25 × 0.25 m column (half a wall
   thickness each way) you can see through diagonally. The castle
   (`building/Shell.ts` `wallShapes`) does NOT have the disease — its north
   face runs the full outer width (`planRect(-ox, ox, …)`), covering corners.
   Plan: extract a common span-run builder the hotel uses (mirroring the
   castle's closed-corner rule), plus a red-first perimeter probe in
   check:hotel.

2. **Tap targets too close to doors** — tap flow: `Game` → `Selection.handleTap`
   (ray vs pick sphere centred `(x, y+r/2, z)` radius `pickRadius`); if it hits
   a zone the tap selects and does NOT walk; otherwise TapNavigator walks and
   `checkDoorways`' walk-through bands do the exits. Suite exit (west gap
   ±1.1) vs suite west-window zone (centre 0.4 m in from wall at z≈±1.95,
   pickRadius 2.2): pick sphere covers the doorway band → tap on the door
   selects the window. Plan: extract doorway bands as data with one owner
   (checkDoorways reads them), new rule = zone pick area must clear every
   doorway band and other zones' pick areas by a finger-derived margin; check
   script `scripts/check-tap-spacing.mts` in the build chain, red first.

3. **Napping child vanishes** — `Hotel.nap` sets `ridePosture = 'reclined'`
   (model.root.rotation.x = −1.35 via `applyRidePose`) AND
   `setRidePose(…, pitch = −π/2)` (group.rotation.x). Double recline ≈ −167°:
   she is rotated backwards into the mattress. Fix: one recline owner, head on
   pillow (bed asset pillow is at −Z end, mattress top 0.55 =
   `BED_MATTRESS_TOP`), plus a nap blanket per bed shown during the nap.

4. **Rug/decal ladder z-fights** — the "decal ladder" (dressing.ts header):
   mosaic plate (flat PlaneGeometry) 0.02, rug tops 0.03, sunburst rays 0.022,
   ring 0.04, chevrons 0.06. Gaps of 2–10 mm between overlapping flat faces.
   WebGL guarantees only 16 depth bits; ortho far = CAMERA_DISTANCE·3 = 270 →
   one depth step ≈ 4.1 mm; at 38° pitch a vertical gap needs ~6.7 mm per
   step. Plan: derive a MIN separation (~2 cm) from those constants with one
   owner, rebuild the ladder on it, give the mosaic real thickness or lift the
   rugs; extend probe 10 to all rooms/heights, red first.

## State
- Worktree fresh off origin/main 993dcf3. npm ci done. No code changes yet.
- Next: diagnostic measurement of the built world (scripts/diagnose-interior.mts,
  scratch, not for commit) to confirm all four with numbers.

## Key files
- src/world/hotel/Hotel.ts — buildRoomShell 1806, partitionRoom 1942,
  interactZones 832, checkDoorways 1182, nap 1774, update napping 1131,
  layMosaic ~3545, dressSuite beds ~3113.
- src/world/hotel/layout.ts — rooms, gaps, partitions, SUITE_BED_SPOTS.
- src/world/hotel/dressing.ts — rug/roundRug/rainbowRing/sunburst/floorChevron,
  RUG_Y ladder at top.
- src/world/Selection.ts — pick sphere in `intersect`; interact.ts —
  pickInteractZone (XZ disc).
- src/entities/Player.ts — applyRidePose/applyReclinedRidePose (RIDE_RECLINE
  −1.35), setRidePose pitch.
- scripts/check-hotel.mts — probe framework; probe 10 = lobby deck coplanar
  scan. scripts/park-harness.mts — buildHeadlessPark.
- Castle: src/world/building/Shell.ts wallShapes (closed corners, healthy),
  interactZones.ts.

## Verification plan
- Headless probes red-first (record red in commit messages).
- Browser via headless Playwright: chromium at
  /Users/jim/Library/Caches/ms-playwright/chromium_headless_shell-1234/…,
  patterns in scratchpad live-stair.mjs / live-art-sofa.mjs; /hotel deep link;
  lobby origin (−600, 600), suite (−600, 1380). Phone viewport 390x844 for tap
  test. Own vite port with --strictPort, kill by PID.
