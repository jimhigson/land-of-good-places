# HANDOFF sb-cop3

Model: Claude Opus 5.5, chosen by the structural-backtrack engineer. Branch fix/sb-cop3 (from origin/wip/sb-merge). No PR.

Task: clear 3 NEW check:coplanar findings at recorded restarts.

1. facePaintStall | terrain, seed 2 — post outline hull's bottom cap (BackSide, faces up) 7.8 mm from terrain at (31.6, 37.9). Fix: post cylinder drops its bottom cap from the index (FacePaintStall.ts), as stallProp.ts / railRace track.ts did.
2. terrain | stone-walls, seed 10 — wall box's -y face 9 mm from terrain at (66.8, 1.0). Fix: withoutBoxFloor() in Scenery.ts drops the floor face.
3. fairy-string-59 | fairy-string-60, seed 15 — probing (scripts/_probe-cop3.mts, scratch, do not commit).

Status: fixes 1, 2 written; not yet verified.
