# Handoff: TypeScript 7.1 everywhere, Vite 8.3.8, bundled dev (not kept)

Branch `tooling/typescript-7-1`, **PR #779** (one PR for all three, per Jim:
"yes, try it in the same branch as is doing the upgrades"). Not merged.

## State: done, waiting on review and CI
1. **TypeScript 7.1 only** (commits 567f7597..8aec09df). `"typescript":
   "7.1.0-dev.20261006.1"`; no TS 6, no alias. The six compiler-API checks parse
   with oxc via `scripts/ts-ast.mts` (rolldown's `parseAst`). Output proved
   identical to main's TypeScript-API versions, printed and by internal dumps;
   red proofs pasted into each header. Controls: 7.1 and 5.9.3 report the
   same errors (TS2322 src/test, TS2375, TS1294 enum/param property).
   Timing: 5.9.3 ~9.7 s / 700 MB, 7.1 ~1.2 s / 444 MB per project.
2. **Vite 8.3.8** (310a37e3, d1ae4e35, 09be2908, 7c1af21e). rolldown pin 1.2.19
   (= Vite's), guarded in ts-ast.mts (throws if they differ; proved red).
   `rolldownOptions` rename is a byte-identical build. check:update-adoption
   had a real race (character-less profile reloads itself on a remembered
   seed: 2 navigations per reload on `/`, 1 on `/?seed=0`); fixed by pinning
   the seed; 3/3 green, red with skipWaiting true.
3. **bundledDev: measured, NOT on the branch.** Works for play (6 deep links,
   parks middleware, lazy chunks, no SW, HMR = full reload ~2.6 s), but a page
   cannot `import('/src/...')` under it, so check:served-static-freeze and
   check:served-book-reader FAIL (measured) and check:served-walking uses the
   same import. Gain: cold /spawn 3254 -> 2754 ms median, 477 -> 9 requests;
   server start 547 = 547 ms; warm reload 2123 -> 2191 ms; served-deep-links
   210 -> 216 s; served-cull-audit 68 -> 67 s. Not a clear win, breaks gated
   checks, so not committed (trialled in a scratch worktree).

## Not done on purpose
- The native-config-loader warning (5 extensionless imports) needs
  `allowImportingTsExtensions` in tsconfig.json: a policy change for src/.
- Node 26.5's `fetch` once threw an uncatchable `setTypeOfService EINVAL` in
  my own harness; `scripts/with-dev-server.mts` polls with `fetch` too. Not
  seen in a repo check; worth knowing if a served check ever dies that way.
- check:cycle-tdz gives no edge to `import { type A } from './x'`, though
  under verbatimModuleSyntax that import still evaluates `./x`. Kept as it was
  (a port must not change findings); maybe worth its own ticket.
