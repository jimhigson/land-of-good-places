# Handoff: TypeScript 7.1 everywhere (and two follow-on Vite PRs)

Branch `tooling/typescript-7-1`, worktree `.claude/worktrees/ts71`.
Throwaway baseline worktree at main (TS 5.9.3): `.claude/worktrees/ts71-baseline`
(detached; remove when done). Scratch outputs: the session scratchpad.

## Plan as it stands (coordinator, 14 Nov, latest)
**ONE branch (`tooling/typescript-7-1`), ONE PR, three revertible commit groups**
(Jim: "yes, try it in the same branch as is doing the upgrades"). The numbered
"PR 1/2/3" below are now commit groups on this branch, not separate PRs.

1. **PR 1 (this branch):** TypeScript 7.1 is the ONLY TypeScript ("ok let's use
   7.1 everywhere then"). `"typescript": "7.1.0-dev.20261006.1"`, no aliases,
   no TS 6. The six scripts that used the compiler API are ported to oxc via
   `rolldown/parseAst` (rolldown pinned 1.2.6 = vite 8.2.2's). Each port must
   report the same findings as before on main (diff old vs new) and go red on a
   deliberate break, red output pasted into its header. Finish with
   `git grep -nE "5\.9|typescript6|typescript@"` clean bar historical notes.
2. **PR 2 (branch cut from this one):** vite 8.2.2 -> latest (8.3.8 at 11:30),
   rolldown pin -> the new vite's rolldown. Prove build, boot-chunk,
   client-no-solver, precache limit, update-adoption, served-deep-links,
   shard-1, headless boots on dev + preview. List deprecation warnings.
3. **PR 3 (on PR 2's branch):** `experimental.bundledDev` in vite.config.ts.
   Measure off vs on (cold start, requests, time-to-playable, served checks,
   warm reload). Open the PR only if a clear win and nothing broke.
   Report all three PRs together at the end.

## Done
- 567f7597: TS 7.1 via alias + TS 6 alias (superseded).
- 4e1967b6: TS 7.1 under its real name, TS 6 gone, rolldown 1.2.6 added.
  Lockfile vs main = exactly that (all 7 native binaries incl. linux-x64).
- Controls on 7.1 (identical to 5.9.3, files restored): src TS2322, test
  TS2322, exactOptionalPropertyTypes TS2375, enum TS1294 (src + test),
  parameter property TS1294; exit 2 with error, exit 0 after restore.
- Timing (load ~27): 5.9.3 9.91 s / 697 MB and 9.58 s / 703 MB;
  7.1 1.37 s / 444 MB and 1.12 s / 443 MB (tsconfig / tsconfig.test).
- Before-outputs of the six checks on main captured (scratchpad/before).
- All six ported (c65b2bb9, 56a37f02, 0af61591, d3e45799) via scripts/ts-ast.mts.
  Printed output byte-identical to main for five; flat-primitives differs only
  in corpus size (937/949 vs 936/948: ts-ast.mts is a new file in scripts/).
  Internal dumps (every match, every edge, every string) old vs new: all six
  byte-identical. Regenerated flat baseline old == new byte-identical (the
  committed one differs from both by 9 entries' order only: pre-existing).
- First full oxc run threw on scripts/lib/*.d.mts (flat-primitives scans
  .d.mts; TS parsed them as declarations by name): ts-ast.mts uses lang dts.
- No `typescript` importers remain (git grep).

- Red proofs pasted into all six headers (7724570a); optional-chain arming
  fixture (02f5ffcd); CLAUDE.md Building note (8aec09df).
- TS part verified: controls re-run on final setup; scripts object equal to
  main; chain-coverage 0; fresh frozen install 0; build 0; shard-1 0 (1027 s);
  test:procgen 0 (54 files, 2217/2217, 851 s). **Draft PR #779** opened.
- Vite: 310a37e3 (vite 8.3.8, rolldown 1.2.19, README), d1ae4e35
  (rolldownOptions rename: byte-identical build), 09be2908 (ts-ast.mts throws
  if the rolldown pin != Vite's rolldown; proved red with pin 1.2.6).
  Six AST checks + dumps re-proved identical on oxc 0.156. build 0,
  boot-chunk 0 (boot 51 chunks 3802 KB vs main 49 / 3806 KB; ~340 KB moved
  ui -> ripika chunk; 2 new small chunks chime, types). Warnings: only the
  pre-existing native-config-loader one (needs allowImportingTsExtensions in
  tsconfig.json to fix = policy, so listed not fixed).

## Next
- Vite proofs still to run: update-adoption (PORT=own), served-deep-links,
  shard-1, test:procgen, headless boots dev+preview (scratchpad/measure.mjs).
- Then bundledDev (measure off vs on; keep only if a clear win).

## Port facts (oxc ESTree vs TypeScript's tree)
- Offsets are UTF-16, safe to slice. parseAst defaults to lang js and
  preserveParens false: always pass lang ts + preserveParens true.
- Optional chains get a ChainExpression wrapper TS has no node for: unwrap
  wherever the TS code inspected a child's kind.
- `=`, `**=` are AssignmentExpression, not BinaryExpression.
- `export const` = ExportNamedDeclaration{declaration}; `export {..}` /
  `export * from` are ExportNamedDeclaration{declaration:null} / ExportAllDeclaration.
- An annotated binding identifier's span INCLUDES `: Type`: use `id.name`.
- Shorthand `{ a }` gives key AND value nodes with one span: visit one.
- Parse errors throw PARSE_ERROR (TS silently gave a partial tree).
