# HANDOFF sb-hotel

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Branch fix/sb-hotel off origin/wip/sb-merge.

## Seed 10 "tower not solid 23 deg off its doorway" — root cause (measured)
Not a hole. Traced the 22.5 deg march: two posts outside the door (circle r=0.22 at (-41.8,0.1),
r=0.28 at (-44.1,-0.3)) slide it across toward the door axis, then the door jamb's end cap
(wall (-47.1,-1.7)-(-45.3,0.1)) slides it round into the doorway; it crosses the facade plane at
|across| < 1 m (between the jambs) and stops on the lobby back wall at along 5.97 = 5.0 + 0.35 + 0.62.
Probe 22 judged the end point. Fix (c0667c43): judge by where the march crossed the facade plane.
Mutation: dropping ring face 1 -> red on seed 10 (0.15 m from centre, 34 deg).

## Seed 8 "front door walled up"
At its current recorded restart (7, after merging origin/wip/sb-merge 146163b4) seed 8 passes.
Restart 1 no longer builds at all on this code (DuckBarRefusal in railRace/simulate.ts), so the
old walled-door failure cannot be reproduced; not investigated further.

## Status: DONE. check:hotel exit 0 on seeds 0..15 at recorded restarts; tsc + typecheck:test exit 0.
