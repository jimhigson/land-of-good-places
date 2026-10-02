# HANDOFF sb-walkreach (model: Claude Opus 5.5)

Task: check:walk-reach VOID on seed 5 (bridge @(47.0,-12.6), facade steps @(-40.1,48.5)); all seeds 0..15 must exit 0.

Findings:
- Bridge: hump is narrow and 18.5 m long along the path (144 deg); the march used 16 fixed compass bearings
  (nearest 135/157.5) and 16 m runs, so every run met the hump side-on as a 2-4 m cliff. Fix: march along the
  crossing's own pathDir too, starting past the hump's covered reach (instrument fix).
- Facade steps on seed 5: ramp foot ~1.5 m above the terrain in front (castle on a slope falling to the front).
  Investigating whether that is a real park defect.

Sweep after bridge fix (commit "march each site along its own approach axis"): bridges measure climbs on all 16 seeds.
Exit 0: 0 1 4 9 10 12 15. Exit 1, all facade-steps VOID only:
- cliff (ramp foot stands above the ground, lowest radial rise met): 5 0.955, 6 1.668, 8 1.830, 13 1.988, 14 1.600
- buried (no built surface above the ground at all): 2 3 7 11
Root: ENTRANCE_RAMP is a fixed 0.75 m drop from the door; nothing fits it to the terrain in front of the
castle. Real park defect on the cliff seeds (door trigger needs |y - BUILDING_BASE_Y| <= 1.6).

ROOT CAUSE (facade): WalkSurfaces.sample summed garden ramps plumb (BUILDING_BASE_Y + rampHeight over x - centre)
while Shell.ts draws the steps leaning in CASTLE_FRAME. Fixed: layout.ts castleSurfaceY (Newton in the castle frame,
footprint tested at the converged point), castleWorldY; Building.ts door gate uses worldToCastle(player).y outside,
entrance band y / doorstepY / leaveInterior / npc portals reference castleWorldY instead of BUILDING_BASE_Y.
Seed 5 after fix: threshold 0.36 m above ground, steps run into the ground (was 1.5 m cliff).
Next: seed-5 walk-reach, then full 0..15 sweep; check park-solve trace unchanged (sampler must not move the park).

DONE. After the sampler fix, check:walk-reach exits 0 on all 16 seeds (0..15); every facade site measures
climbs (worst radial 0.620 on seed 6, at the limit, 0 wrong refusals/admissions). Seed 5 park-solve trace
identical before/after (sampler does not move the park). Not run: pnpm run check, test:procgen.
