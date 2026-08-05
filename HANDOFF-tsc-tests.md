# HANDOFF — tsc-tests (E5-statue)

Branch `fix/typecheck-tests`, worktree `.claude/worktrees/tsc-tests` (own
`npm ci`). Issue **#192** — `tsc --noEmit` never typechecked `test/`.

**Status: done. `npm run build` exit 0, `test:procgen` 85/85. No PR.**

**Rebased onto `origin/chore/invariant-return-complaints`** per the Overseer's
ordering ruling — that branch lands first. Rebase was clean (no shared files).

## What was done

| File | Change |
| --- | --- |
| `tsconfig.test.json` | **new** — second project covering `test/` + `vitest.config.ts` |
| `test/node-env.d.ts` | **new** — declares the one Node global the tests use |
| `package.json` | `typecheck:test` script, wired into `build` after `tsc --noEmit` |
| `test/procgen/invariants.ts` | the two real `builtRings` type errors, fixed |

## `@types/node` is the WRONG answer — do not re-attempt it

This was the recommended fix and it is wrong. Recorded here because the failure
is counter-intuitive and someone will try it again.

`types` is per-**project**, not per-directory, and the test project necessarily
pulls in most of `src/` transitively — the tests import the park. So Node's
globals do not stay in `test/`. Worse, Node does not merely *add* globals, it
**redeclares DOM ones with different types**:

```
src/minigames/spookyHouse/hotspots.ts(65,5):
  error TS2322: Type 'number' is not assignable to type 'Timeout'.
```

That file is already written the portable way, `ReturnType<typeof
window.setTimeout>`. With `@types/node` loaded the *type* resolves to Node's
`Timeout` while the *call* resolves to the DOM overload returning `number`, so
**correct code stops compiling**. Three files broke this way and none of them
was wrong — the config was. "Fixing" them would have meant editing working
browser code to suit a runtime it never executes in, with a blast radius of
every `src/` file the tests reach.

`test/node-env.d.ts` declares `process.env` — the only Node global actually
used, and only because it is how the seed reaches `parkManifest.ts`. No Node
types are installed at all.

**If the tests ever need real Node APIs** (`fs`, `path`, `Buffer`), the answer
is probably to stop pulling `src/` into the same project, not to accept the DOM
collisions.

## The `builtRings` fix: narrowed, not asserted

Two real errors, latent on main because nothing had ever typechecked this file.
`.map` produced `group: Object3D | undefined`; the guard claimed `ring is
BuiltRing`, which TypeScript rejects (TS2677) because `BuiltRing.label` is
`string` while the mapped element's is `'walk-past' | 'race'`.

Fixed with `flatMap` + a narrowing `if`, **not** a corrected predicate. A
predicate is an assertion the compiler takes on trust — which is exactly what
let the mismatch hide. Now nothing is asserted, so nothing can be asserted
wrongly. Behaviour unchanged: a missing ring is still dropped, deliberately.

## Proved the build actually catches test/ errors

Injected a deliberate type error into `test/procgen/invariants.ts` and confirmed
`npm run build` **fails with exit 2**, naming it. Before this branch that error
was invisible. A check nobody has watched fail is not a check.

## Not done — `scripts/` is still uncovered

`scripts/` holds **45 files**, including every `check:*.mts` that gates the
build, and none are typechecked except the few the tests reach transitively
(`park-harness.mts` and its imports, which this branch does now cover). That is
the same bug as #192 with a bigger surface. **Deliberately out of scope** — it
would surface an unknown number of new errors. Worth its own issue.

## State

- [x] `tsconfig.test.json`, no Node types reaching `src/`
- [x] `builtRings` fixed by narrowing
- [x] `typecheck:test` wired into `build`, proved to bite
- [x] build exit 0, procgen 85/85
- [ ] PR (not raised — Overseer's call; merges after `chore/invariant-return-complaints`)
