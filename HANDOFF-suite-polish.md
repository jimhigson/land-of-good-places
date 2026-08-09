# HANDOFF — suite-polish (fix/suite-polish)

Four items from Jim on the suite bedroom (brief from session coordinator):
rugs under walls, partition ends stopping short, wall/floor colours too close,
add a bathroom reusing the castle's toilet models+rules.

## Findings so far (root causes)

1. **Rug under walls**: `dressSuite` places `rainbowRug(0.8, 0.3)` at suite-local
   (−3.4, 0). Outer radius = 0.8 + 6·0.3 = 2.6 m; the hall it sits in is only
   z ∈ [−1.5, 1.5] clear (partitions at z = ±1.7, 0.4 thick). So the rug runs
   ~1.1 m under BOTH long partitions. The lounge rug (9×5 at (2.5, 4.9)) is
   legal today but nothing makes it so.
   Fix: derive rug extents from the partition plan's clear floor (new owner
   fn), plus check:hotel probe: no rug/decal box intersects any wall/partition
   box (prove red on today's rainbow rug first).

2. **Partition ends**: `SUITE.partitions` runs 1 & 2 declare `from: −9.4`
   while the room's west wall is at −11 — a free-standing 1.6 m gap at each
   west end (comment says it was to keep the hall clear; the door gap is
   z ±1.1 and the partitions are at z ±1.7, so extending them can NOT block
   the door). East ends (`to: 11`) and the z-partitions' ends land on the
   perpendicular wall's centre line = half-thickness overlap = solid, fine.
   Owner decision: the partition DATA must reach the outer wall (extend
   from → −11); the builder cannot know −9.4 "meant" the wall. Probe: every
   partition-run end either abuts a perpendicular wall plane (outer wall or
   crossing partition, within half-thickness) or sits on a declared doorway
   jamb — red today at the two −9.4 ends.

3. **Palette**: SUITE_THEME wall=blossomWhite floor=stonePinkLight (both very
   pale). Walls must stay near-white (Eleri: rainbow needs white wall), so
   darken/saturate the FLOOR from PALETTE only (ART_DIRECTION §5). Measure
   relative-luminance delta of good readers (garden/ocean/lobby) to set the
   rule's floor; prove suite red first. Probe in check:hotel.

4. **Bathroom**: the castle's is `src/world/building/Toilets.ts` +
   TOILET_* in building/layout.ts + a 'toilets' interact zone. Rules found:
   flush-then-wash two-beat routine (playFlush/playHandwash from ui/chime),
   lid flips, swirl+stream meshes, PRIVACY ROOF that covers the room when
   occupied and lifts at the wash beat (never traps: recomputed from her
   position every frame). Models: buildPan/buildBasin (module-private —
   must be exported/shared, not copied).
   Plan: carve bathroom in the suite's SW corner — new z-partition at
   x=−4.2 (continues the bedroom-1 partition line), z 1.7..8, no doors;
   extend partition 2 to −11 (item 2) and add a doorway at x≈−7 so the
   bathroom opens off the hall. Fixtures via shared factories, solidity via
   props.place (pan standable, basin stand:false), privacy roof over the
   rect, zone `Use` + routine ticked from Hotel.update with occupied =
   player-in-rect. Lighting: suite pool light already covers it (same room).
   Watch: west-wall painting at along=+4.8 lands inside the bathroom —
   check tap spacing vs the new toilet zone, maybe move it.

## Files that matter

- src/world/hotel/layout.ts — SUITE, SuitePartition, DOOR_HALF (1.3),
  SUITE_DOOR_WIDTH (2.4), SUITE_PARTITION_HEIGHT (2.2)
- src/world/hotel/Hotel.ts — buildRoomShell (~1884), partitionRoom (~2045),
  dressSuite (~3185), dressLounge (~3442)
- src/world/hotel/dressing.ts — rug/roundRug/rainbowRug/rainbowRing, DECAL_STEP
- src/world/hotel/place.ts — HotelProps.place/footprint (solid+standable rules)
- src/world/wallRuns.ts — segmentsMinusGaps, cornerClosedSpans
- src/world/building/Toilets.ts — pan/basin/roof/routine (the shared owner-to-be)
- scripts/check-hotel.mts — probes; add 18 (rugs), 19 (partition ends),
  20 (theme contrast), 21 (bathroom)
- scripts/check-tap-spacing.mts + src/world/tapSpacing.ts — finger = 1.13 m

## State (checkpoint 2)

Committed and pushed on fix/suite-polish:
- abddb1c item 2: partitions reach walls (probe 18, red: two −9.4 ends).
  Knock-ons: west windows → one pane at 5.9; west painting +4.8 removed;
  sconce 5.6→3.6; TV −3.4→−3.0; bathroom wall carved as data (z-run at
  x=−4.2, south half) + doorway at −7.6 in the long run at z=1.7.
- decbbd8 item 1: clearFloorAround(room,x,z) owner in layout.ts (+
  WALL_HALF_DEPTH/SUITE_PARTITION_HALF moved there); probe 19 red found the
  suite rainbow rug AND the lobby nook rug through the north wall/past the
  deck edge; all rugs fitted. Garden-lawn-under-trellis is design → probe 19
  takes walls by name+shape.
- dd79257 item 3: relativeLuminance + THEME_FLOOR_CONTRAST_MIN (0.15) in
  layout.ts; probe 20 red: suite 0.115, breakfast 0.009 vs good readers
  0.186–0.274. Suite floor → stonePink (0.27), breakfast → pathSandDark
  (0.31). Needs screenshot judgement in QA.

## Item 4 — DONE (7a45fe4 + 3347f41)

Browser QA found two things the first cut got wrong, both fixed and both
now owned by checks:
- pan by the hall doorway was invisible (east partition sight shadow) →
  pan mid-room on its mat at (−7.8, 4.6);
- a phone tap in the bathroom doorway SELECTED the pan instead of walking
  (Jim's original mobile bug shape) → the doorway moved to the lounge side
  (door at z 2.9 in the z-run), became a real PortalBand (kind 'room-door',
  derived from partition data, enforced by check:tap-spacing), pan pick
  1.8, and the west pane is light-only (WindowWall.lookZone: false).

QA evidence in scratchpad: sp-*.png (suite wide, partition west, bathroom
from hall / roof on / flush / wash-lifted, bedroom, breakfast),
sp-phone-*.png (390x844 taps: doorway tap walks 2.13 m through; pan tap
raises the sign), sp-journey-*.png (real play: check-in E → key → walked
east through the yours door → hall clear door-to-far-end).
Roof telemetry: covered while inside, visible=false after wash beat.

Final gates: check:hotel OK, check:tap-spacing OK, test:procgen 270/270
zero skips, full npm run build re-running at time of writing (first full
run on dd79257-era code exited 0).

## Old plan (superseded)

Bathroom = suite SW: rect clearFloorAround(SUITE, −7.6, 4.8) →
x −10.8..−4.4, z 1.9..7.8. Door off the hall at x=−7.6 (already in data).
- Refactor building/Toilets.ts: export buildPan/buildBasin/buildPrivacyRoof
  + ToiletRoutine (timer/flush/wash/roof state machine — moved verbatim);
  castle Toilets becomes thin wrapper. DO NOT copy geometry.
- Hotel.dressSuite → dressBathroom: tiles rug (fitted) + bath mat (tier 1),
  pan at (rect.maxX−0.8, rect.minZ+0.65)=(−5.2,2.55) facing +Z, basin at
  (rect.minX+1.1, 2.55) mirror against north partition; props.place: pan
  solid+standable top 0.7, basin solid stand:false top 1.0. Privacy roof
  over rect at castle ROOF_Y. Zone 'hotel-bathroom' at pan, pick 2.4,
  stand (−5.2,3.65), verb 'Use' — spacing verified: ≥3.9 m clear of window
  zone, door band clearance ✓ by construction.
- Hotel.update ticks routine with occupied = player in rect+APPROACH.
- Probe 21 (red first): pan/basin solid, pan mountable, zone exists w/
  action + walkable stand, roof covers when occupied and lifts at wash beat.
- Then: npm run build (full chain), test:procgen (expect 270+, 0 skips),
  headless-playwright screenshots (rug edges, partition ends, recolour,
  bathroom wide+detail, phone-viewport tap in bathroom doorway), PR.
