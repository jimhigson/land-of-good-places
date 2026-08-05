# HANDOFF — invariant return type (board task #15)

Branch `chore/invariant-return-complaints`, worktree
`.claude/worktrees/invariant-type`, off `origin/main` @ `a68ed54`.
One file changed: `test/procgen/invariants.ts` (+111/-50).

`npm run build` exit 0. `npm run test:procgen` exit 0, 85 tests, 5 seeds.

## Done

`type Invariant` is now `(facts: ParkFacts) => readonly string[]`, not
`=> void`. Invariants return complaints; `registerParkInvariants` holds the
only `expect` for them. File header gained a third rule plus a
"prove it can fail" line; the type carries the full story in its own comment.

All 16 migrated. 12 mechanical, 4 by hand (`entrancesAreUsable`,
`railRaceExitFitsTheParty`, `railRaceStallStandsAtTheRim`,
`skyCruiserTurnsGently`) — those had used `toBeDefined()`/`toBe(true)`/
`toBeGreaterThanOrEqual` directly, and now return one self-describing
complaint per problem. Each of the four was teeth-checked *individually*.

## The finding that matters — the type alone was NOT enough

Verified by writing a hollow invariant and typechecking it: **it compiled
fine.** `tsconfig.json`'s `include` is `["src", "vite.config.ts",
"vite-config-env.d.ts"]` — **`test/` is never typechecked**, by `npm run
typecheck` or by `npm run build`. So "make it a compile error" does not, on
its own, do anything at all.

What saves it is the *runner*: a void invariant now returns `undefined`, and
`expect(undefined, ...).toHaveLength(0)` throws. Verified — a deliberately
hollow invariant fails on all five seeds, exit 1, instead of passing. So the
mistake is caught today, loudly, at runtime.

The compile-time half is real but **latent**. Proven with a probe tsconfig
that adds `test` to `include`: it produces exactly
`error TS2322: Type '(facts: ParkFacts) => void' is not assignable to type
'Invariant'. Type 'void' is not assignable to type 'readonly string[]'.`

### What closing that would cost (NOT done — needs a ruling)

27 errors appear when `test/` is included. Three groups:

1. **`allowImportingTsExtensions: true`** — tests and `scripts/*.mts` import
   with explicit `.ts`/`.mts` extensions. Harmless with `noEmit`, but it is a
   compiler-option change.
2. **`@types/node`** — `test/procgen/parkFacts.ts:123` uses `process`, and
   the project has **no `@types/node` at all**. This means adding a
   devDependency, and if it were added to the *main* tsconfig's `types` it
   would also let Node APIs typecheck inside browser code, which is a real
   loss. A separate `tsconfig.test.json` + its own `check:` script avoids
   that and is the shape I would recommend.
3. **Two genuine pre-existing type errors** in this very file, at
   `builtRings` — `group: Object3D | undefined` is filtered by a predicate
   whose type does not line up (`TS2322`, `TS2677`). Nothing has ever caught
   them because nothing typechecks this directory. They are latent bugs, not
   noise.

I did not do any of this: it changes the build for every agent with work in
flight, and the Overseer asked for small and surgical. Flagged to the
Overseer for a ruling.

## Coordination

- **This conflicts textually with any branch touching `invariants.ts`.** Any
  in-flight invariant must gain a `return complaints;` and lose its
  `expect(...)`. That is a one-line change each, and the compiler will not
  tell them — the test failing loudly will.
- My own `chore/rail-race-pr-triage` adds `droppersHangUnderRealRails` and
  needs exactly that migration when it rebases. I own both branches.
