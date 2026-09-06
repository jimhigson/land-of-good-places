# HANDOFF — pet beds (#582)

**Branch** `feat/pet-beds-582`, worktree `.claude/worktrees/pet-beds-582`, based on `d80a3d4c`.

## The ask
Jim, 6 Sep 2026: the hotel bedroom needs **as many pet beds as the player has pets**.
Done = she sleeps, and every pet is asleep *in* a bed. Not a fixed larger number.

## Status
- [x] Worktree + `pnpm install --frozen-lockfile` (pnpm 12.1.0 running, confirmed)
- [ ] Survey of pet/bed/hotel code (subagent running)
- [ ] Implementation
- [ ] Reachability instrument + **control run first**
- [ ] Gates: `check`, `test:procgen`, `build`, `check:coplanar`, `check:swept-bus`, `check:park-pool`
- [ ] Browser watch: 1 pet, several, maximum — pet must *reach and enter* a bed
- [ ] PR

## Open questions to bring to the Overseer (not to decide alone)
1. Max pet count + whether the bedroom has floor space for that many beds.
2. Bed layout as count grows (row / cluster / along a wall) — Jim's call, screenshot each option.
3. Build-time placement from the save's pet list vs. beds appearing as pets are acquired.

## Findings
- `GAME_DESIGN.md:541` — ferris gondola has **three** low pet tub chairs, "one each,
  present whether occupied or not". A hint at a pet cap of 3, but it may itself be a
  fixed number rather than a derived one. Confirm by measuring, do not assume.

## Traps recorded in CLAUDE.md that apply here
- `topIsAbsolute` for knee-high props (`hotel/place.ts` is the precedent).
- A `CollisionWorld` rectangle is four walls round a hollow middle — a mover that gets
  inside is never pushed out. Beds must be unreachable-inside or genuinely leavable.
- `keepOutsFor` owns where she must be able to stand. Prove with a reachability
  instrument and **run a control on the instrument first**.
- `check:park-pool` builds all sixteen parks (#579); `check` + `test:procgen` can be
  green while a pool park is broken.
