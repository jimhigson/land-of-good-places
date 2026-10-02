# HANDOFF: sb-coverage (helper to #706)

Model: Claude Opus (chosen by #706). Branch `fix/sb-coverage` from `origin/wip/sb-merge`.

Task: (1) classify every park-building check as decision vs non-decision;
(2) add decision checks to acceptance (park-attempt); (3) scope the rest in
docs/design/STRUCTURAL-BACKTRACKING.md; (4) unit test pinning
src/world/pavingLegibility.ts verdicts, proved red by mutation.

## State
- started; worktree created, deps installed.
- Batch 1 pushed (c90dfefe): pavingLegibility test (16/16 mutations red); swept-bus,
  entrance-road, castle-window, cruiser-turn-radius in acceptance in-process via
  scripts/lib/{sweptBus,entranceRoad,rideFindings}.mts. Cost 0.135 s CPU per attempt (seed 5 r0).
- Lead's ruling (later): EVERY decision-judging check into acceptance, incl. coplanar,
  every-seed-builds, path-preference, stall-accommodate, cat-bus, hotel, castle-towers,
  npc-dispersal a-d, slide-rider/pet-slide trackside framing. Own commit per measure; message lead per batch.
- Do not run scripts without LGP_PARK_RESTART set: the resolver triggers a full acceptance loop.
