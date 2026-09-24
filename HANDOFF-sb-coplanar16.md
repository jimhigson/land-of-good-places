# HANDOFF sb-coplanar16 (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Branch fix/sb-coplanar16 off origin/wip/sb-merge. No PR.

Task (rescoped): check:coplanar sweeps exactly SUPPORTED_PARK_SEEDS (0..15), each seed a child at its recorded restart (done);
fix every NEW finding at cause (delete hidden face, no nudges, no baseline adds);
report placement-only coincidences with numbers instead of fixing them.

## Findings
Sweep of 0..15 before fixes: 4 NEW, 0 LOOSE, 695 s wall on a loaded laptop.
1-3. terrain | stall:{spookyHouse,spaceFerrisWheel,dodgems} post outline (seeds 4, 9):
   stall corner post CylinderGeometry closed bottom cap; its BackSide outline copy faces up
   into the ground (stall root is seated on the sphere's up). FIXED: posts open-ended
   (stallProp.ts); top cap was inside the knob. Diag re-run: gone on 4 and 9.
4. railRace walk-past-ring duck-bars | trestle-branches-upper (seed 4, 0.002 m2, 8.1 mm):
   PLACEMENT, not modelling. Bar 37 hangs over lane 2 (2.81 m clearance) but lane 3 at the
   same station is 2.87 m higher; the bar's +x end sits inside lane 3's track bed, 0.34 m
   from sleeper 1999's centre, -0.21..+0.09 m of its height. Reported, not fixed.
