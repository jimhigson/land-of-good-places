# HANDOFF — paving-clear

- Model: Claude Opus 5.5 (1M), assigned by the Overseer. Role: Engineer.
- Branch `fix/paving-clear` off `fix/paths-to-doors` 7b0b4003; lead a52ae9484877226d6 merges into wip/sb-merge; NO PR, NO committed acceptedRestarts.ts.
- Worktree: `.claude/worktrees/paths-to-doors` (reused). Scratch: scratchpad `paths-to-doors/`.

## Task
New PARK_ACCEPTANCE measures: (1) no drawn paving under any building/booth solid footprint (owner: colliders), (2) none outside the park boundary. Controls red first; fix generators at cause; restarts per seed; procgen diff+control, check:park 0..15, coplanar, determinism, before/after frames.

## Leads from paths-to-doors probe
- paving under stall booths seed 11 (-41, 29.6); along/outside boundary wall seed 3 z≈60–66; under castle corners (seed 13 (27,-29)).

## Before (base 9656825e generator + new instrument, base accepted table 0:1 1:0 2:0 3:8 4:3 5:5 6:1 7:0 8:7 9:3 10:0 11:0 12:0 13:8 14:1 15:8)
- noDrawnPavingUnderASolid red 16/16: hotel jambs (kerb at doormat) all 16; booths 15/16 (0.04–6 m², incl. paving inside booths); boundary wall 8/16; shut-in pockets most seeds.
- noDrawnPavingOutsideThePark red 6/16 (seeds 3,4,6,10,13,15; 0.04–1.24 m²).
- Instrument: CollisionWorld.solidDepthAt + ownedBy (owners castle/hotel/booth/boundary wall); garden walls/fountain rim/posts counted not judged.

## Fixes so far (HEAD after 'cross-section screen' commit)
- hotel doormat TOWER_DOORMAT_REACH = jamb end + SPUR_PAVED_REACH; streets pass neighbour plots by SPUR_PAVED_REACH; junction aprons shrink off built solids; layout: doormat+lead clear of boundary wall (DOORMAT_WALL_ROOM), arrival lanes off other plots; paths.ts distanceToBuiltSolids + routeClearsSolids (cross-section) in spur/fallback/connectors; kiosk head-on lead; parkPlan refuses drawn sample under a solid (consumed layout).

## 2 Oct late (HEAD ddcf2bb7, base e6b7708d — no table; restarts resolve via acceptedPark cache / LGP_PARK_RESTART)
- Added: EXIT_INSIDE_EDGE = SPUR_PAVED_REACH + wall half + 0.1; distanceToBuiltSolids includes boundary wall (gate exempt); BUILT_SOLID_MARGIN 0.25.
- Measure scoped: under building/booth/boundary wall only (shut-in counted on stderr, not judged; rail-corridor connector at seed 10 r0 is a separate defect to report).
- Sweep r0 at head: both new measures PASS on all 10 parks that build (5,7,9,11,14,15 DuckBarRefusal — not mine, reported to lead).
- Controls red: booth (2.02 m² under booth), castle (1.62 m²), outside (11.27 m²) — seed 12 r0.
- accept:parks 0-15 --fresh running in worktree paving-clear-base (frozen ddcf2bb7) → pc-accept.json/log.

## Handed to lead (3 Oct) — head rebased on 6de631e0
- Partial accept (frozen f1f8d067 on 4964e204, stopped per Jim's 'CI verifies' rule): new measures rejected 0 of 41 rejected attempts. Seeds measured on both: head 0:4 1:5 4:4 5:3 6:2 8:1 10:1 attempts vs base 0:1 1:1 4:4 5:3 6:2 8:4 10:1.
- Rebased head: clean run + booth/outside controls on seed 12 r0 as expected (pass / red / red).
- Skipped locally: full accept, test:procgen, check:park, coplanar, determinism, frames — CI and the lead's merge run them.
