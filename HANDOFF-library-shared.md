# HANDOFF — The Library, shared slice of parts 4+5 (epic #714; #718, #719)

Branch `feat/library-714-shared` (from `origin/main` d2cdb1f2), worktree
`.claude/worktrees/library-shared`. Engineer, Claude Opus 5.5. **Raise no PR** — Jim's 13 Oct
ruling is one PR for the whole Library, raised by the orchestrator at the end.

Plan: `library-plan-parts-4-5.md` in the orchestrator's scratchpad (Ground rules, Seams, Numbers,
Decisions, Steps 1, 2, 7, 8, 13). This branch builds only the slice that touches code OUTSIDE
`src/world/library/`, plus the one new file `src/world/library/libraryCard.ts`, so it merges into
the integration branch later without conflicts.

## Scope (from the task)
1. Step 1 changes 1, 2, 3, 4, 6, 7 — speechTiming.ts, Player.isRunning, ridePose 'listening',
   Collision.restoreWall + JUMP_CLEARANCE_GRACE export, spritePuffs.ts, measure.visibleReachXZ.
   NOT change 5 (props.ts / layout.ts are on the building branch).
2. Step 2 state slice — types.ts 'card', store.grantKeepsakeOnce, libraryCard.ts, vitest.
   NOT libraryLines.ts, NOT the brevity loop (need BOOKS from the books branch).
3. Step 7 — scripts/lib/seatedPose.mts (tolerances lifted out of check-castle + seatedErrors).
4. Step 8 NPC seams — residentLooks.ts, NpcSystem (PLAYER_SEPARATION export, driver, riding/seated
   separation), NpcCharacter (seated state, posture animate, separateFrom).
5. Step 13 — chime.ts playSecretDoor, playSecretThunk, playPurr.

## Status
- [ ] baselines (running)
- [ ] items 1-5
- [ ] verify (tsc, typecheck:test, vitest, baselines identical, red proof)
- [ ] check, test:procgen, build (or CI dispatch)

## Environment notes
- Node: `fnm use --install-if-missing` -> v26.5.0; pnpm reports `pnpm/12.1.0`.
- Baseline parks: `.parks/` copied (read-only) from the library-art worktree; its manifest
  sourceHash `e272e0c0…` equals this base's `parkSourceHash`, so every baseline check hydrated the
  shipped park instead of solving. Any closure edit changes the hash, so post-edit runs need a
  fresh `LGP_SEEDS=5 pnpm run build:parks` (or CI).
