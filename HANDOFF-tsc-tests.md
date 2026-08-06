# HANDOFF — tsc-tests (E5-statue)

Branch `fix/typecheck-tests`, worktree `.claude/worktrees/tsc-tests` (own
`npm ci`). Issue **#192** — `tsc --noEmit` never typechecked `test/`.

**Status: done, PR raised. `npm run build` exit 0, `test:procgen` green.**

## Base changed: now straight onto `main` (E11, 5 Aug)

It used to be rebased onto `origin/chore/invariant-return-complaints` per an
earlier ordering ruling. **That branch is dead** — its content reached `main`
inside PR #196, and what remained on it had gone stale enough that replaying it
would have reverted five later merges (#196, #203, #211, #213). See
`HANDOFF-e11-prs.md` on `chore/invariant-return-complaints` for the measurement.

So this branch was rebased with `git rebase --onto origin/main e3de651`, which
**drops** the two invariant commits and keeps only the four that are actually
about #192. `HANDOFF-invariant-type.md` correctly disappears from the diff; the
only `invariants.ts` change left is the `builtRings` fix, +28/-4 against main,
with all 21 of main's invariants intact.

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

## Not done — `scripts/` is still uncovered (issue #197)

`scripts/` holds **49 files, 37 of them `.mts`**, and the 31 `check:*` scripts
that gate the build live there. None are typechecked except the few the tests
reach transitively (`park-harness.mts` and its imports, which this branch does
cover — and which is exactly where one of the five errors below was found).
That is the same bug as #192 with a bigger surface. **Deliberately out of
scope**, tracked as **#197**.

(Counted 5 Aug: #197's title says 42 and an earlier draft of this file said 45.
Neither matched. The numbers above are `ls`.)

## Five more errors found when rebasing onto current main (E11, 5 Aug)

Rebasing turned `typecheck:test` **red**, on five errors that had landed on
`main` since this branch was cut. That is the gate working before it has even
merged — every one was invisible to `main`'s own build.

| Where | What |
| --- | --- |
| `scripts/park-harness.mts` | `InteriorControls` gained `openShop`; the inert stub never got it |
| `test/input/text-entry-guard.test.ts` (x2) | called `justPressed('interact')`, which #122 made a type error on purpose |
| `test/store/live-look.test.ts` (x2) | `backpackKind: 'classic'` / `shoeKind: 'trainer'` — neither is in its union since #131 |

The interact one is the interesting one. #122 excluded `interact` from
`justPressed`'s parameter type so that reading it anywhere but
`InteractRouter` is a compile error; this test predates that and compiled only
because nothing checked `test/`. Switched to `takeInteractPress()`, the
sanctioned door — which *consumes* the edge, so the test now genuinely asserts
the "exactly once" its own name claims.

## State

- [x] `tsconfig.test.json`, no Node types reaching `src/`
- [x] `builtRings` fixed by narrowing
- [x] `typecheck:test` wired into `build`, proved to bite
- [x] build exit 0, procgen 127/127 (was 85/85 — main has grown)
- [x] five later errors on main fixed, found by the gate itself
- [x] rebased straight onto `origin/main`; merge-base == main's tip
- [x] PR raised

---

# Dev server: NOT running (standing instruction, 5 Aug)

Jim: *"don't keep servers open for me, just be ready to start them when I ask."*
This branch never needed one — it is a build-time typecheck change with no
visual surface — but if you want the app off it:

```
cd /Users/jim/dev/landOfGoodPlaces/.claude/worktrees/tsc-tests && npx vite --port 5323 --strictPort
```

PR is up. It no longer waits on `chore/invariant-return-complaints` — that
branch is redundant and should be deleted unmerged, not landed first.
