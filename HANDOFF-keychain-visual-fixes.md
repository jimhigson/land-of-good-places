# Handoff: keychain visual fixes (PR #331 follow-up, Jim's 23 Aug feedback)

Branch: `keychain-size-physics` (worked from worktree branch
`keychain-oneshot-2`, pushed to the PR branch). Base was `9197ab2`.

## The four asks, and where each landed (all in commit `5232b47`)

1. **Idle sway at rest** — `src/entities/WornKeychain.ts`: the picker's
   two-sine idle sway (`KEYCHAIN_SWAY_*`, `art/models/keychains.ts`) is added
   *under* the pendulum springs every frame; `update()` is now the only
   writer of `pivot.rotation`. Springs untouched. Verified numerically in a
   real browser: at rest the pivot reads z≈0.158/x≈-0.067 and drifts, where
   pre-fix it was frozen at exactly 0.
2. **Charm reads attached to the bag** — `src/art/models/backpacks.ts`
   `CHARM_HANGS`: every bag's clip point moved from the low outer corner to
   the **upper outer flank**, and 2-4 cm prouder in x, so the 2.5x charm
   hangs across the bag's own silhouette instead of entirely below it.
   `check:charm-hang` passes: 0.030-0.040 m on all five bags (healthy range).
3. **Rumi doll charm** — `src/art/models/keychains.ts` `rumiCharm()` (lilac
   ponytail, honey skin, ink dress — mirrors `NpcSystem.ts`'s `RUMI` spec),
   added to `KeychainKind`/`KEYCHAIN_KINDS`/`CHARMS`, plus catalogue copy in
   `src/world/building/shops/catalogue.ts` (`KEYCHAIN_COPY.rumi`). Stall
   rack, picker, Cute-o-dex and save all pick it up from `KEYCHAIN_KINDS` —
   no other list needed touching.
4. **Strawberry outline separation** — root cause: `addOutline` inflates the
   *capped* cone, so the base cap grew a dark disc floating `thickness`
   beyond the base; invisible at 20 cm, a detached ring at 2.5x. Fix: the
   cone is open-ended (cap was buried under the shoulders anyway) and the
   shoulders blob gets its own outline so the union silhouette is what
   carries the line.

## Verification state

- `tsc --noEmit` clean; `check:charm-hang`, `check:assets`, `check:brevity`
  pass.
- Full `scripts/with-node npm run build` — first run failed `check:park-boot`
  purely from CPU contention (a headless-Chromium QA capture was running at
  the same time); re-run alone it passes. A final clean serial build run is
  the outstanding gate — do not skip it.
- Browser QA (playwright-core + `--enable-unsafe-swiftshader` Chromium,
  dev server `vite --port 5873 --strictPort` in this worktree): picker shows
  all six charms, Rumi collects + wears (`wornKeychainUid: keychain.rumi#N`),
  idle sway confirmed numerically, screenshots under the session scratchpad
  `shots-after/`. Before/after comparison uses a detached worktree
  `.claude/worktrees/keychain-before` at 9197ab2 (symlinked node_modules),
  vite port 5874.

## Still to do if picked up mid-task

- Capture "before" screenshots (TAG=before HAS_RUMI=0 PORT=5874 qa3.cjs).
- Push screenshots to the `qa-screenshots` orphan branch, PR comment on #331
  with raw.githubusercontent.com links + verdicts.
- Final clean `npm run build` (nothing else running), then report.
