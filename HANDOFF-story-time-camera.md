# HANDOFF — story time camera (`feat/story-time-camera`)

Engineer, Opus 5.5, 24 Oct 2026. Worktree `.claude/worktrees/story-camera`.

## The ask (Jim, 24 Oct 2026, verbatim)

"during story time, I'd like the camera to enter a sequence where it comes down to player-level and goes to
over the shoulder camera, with the other children listening and the reader visible - let's make this quite
small change now please"

## Plan

- Reuse the Reptile House's exhibit camera (`src/world/reptileHouse/exhibitCamera.ts`, #711): its solver
  (`solveExhibitShotSteps`, candidate eyes raycast against everything drawn) and its director (`ExhibitCamera`:
  ease down, hold, ease home, `apply` = the one place it touches the camera). Generalise only what is
  reptile-specific: the hall's bounds (`ShotWorld.room`).
- The library owns *when*: the shot is wanted while story time is `reading` and she sits on a story cushion,
  inside the room. Subjects: the owl on her chair, the three children on their cushions.
- `Game.tick` claims its focus like the exhibit camera; `check:library` and `check:labels` copy that wiring.
- Deep link: `/library?sit=1&story=now` (sit her on cushion 1, or 3).

## Status

- [ ] solver generalised, check:exhibit-camera still green
- [ ] story camera + Game wiring
- [ ] deep link `sit`
- [ ] check:library clause (every cushion x 1280x800 and 390x844), proved red
- [ ] checks, PR, CI, browser look, frame sheet
