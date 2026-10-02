# HANDOFF sb-cop3

Model: Claude Opus 5.5, chosen by the structural-backtrack engineer. Branch fix/sb-cop3 (from origin/wip/sb-merge). No PR.

Task: clear 3 NEW check:coplanar findings at recorded restarts.

1. facePaintStall | terrain, seed 2 — post outline hull's bottom cap (BackSide, faces up) 7.8 mm from terrain at (31.6, 37.9), 0.028 m². Fix: post cylinder drops its bottom cap from the index (FacePaintStall.ts), as stallProp.ts / railRace track.ts did. DONE.
2. terrain | stone-walls, seed 10 — wall box TOP face (hidden under coping) meets terrain where the wall runs into a hillside (foot = lower end ground), 9 mm, 0.115 m² at (66.8, 1.0). First guess (floor face) was WRONG — sweep only pairs same-facing faces. Fix: withoutBoxTop() in Scenery.ts. Probe on seed 10: no stone-walls pairs left. DONE.
3. fairy-string-59 | fairy-string-60, seed 15 — chain folds back: 59 runs 14.5 m (-33.2,-18.4)->(-47.7,-19.0), 60 returns to (-41.7,-20.5), 15.9 deg apart; tubes run through each other 0.140 m past the shared pole (post top radius 0.110). Same fold exists unreported on seeds 3, 4 (0.8, 2.6, 5.9 deg). Fix: fairyPoleBuilder.chooseSpot refuses a candidate whose cables (at itself or either neighbour) run together beyond POLE_DRAWN_TOP_RADIUS (fairyCablesRunTogether / FAIRY_CABLES_PART_WITHIN). Invariant fairyStringsNeverDoubleBack (invariants.ts) measures drawn tubes; PROVED RED on seed 15 with rule disabled (0.140 m vs 0.110 m).

Next: check:coplanar (running), test:procgen, park:attempt seeds 2/10/15 at recorded restarts, revert-proofs per fix.
Scratch probes scripts/_probe-cop3*.mts are untracked; never commit; delete at end.
