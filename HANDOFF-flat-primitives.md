# HANDOFF — closing the flat-primitive category

**Model: Opus 5 (1M context)**, chosen by the Overseer's brief. A replacement
must run the same model (CLAUDE.md, "A replacement runs the same model").

**Branch**: `eng/flat-primitives-check`, off `origin/feat/sphere-combined`
(base `90e62c5b`).
**Worktree**: `.claude/worktrees/eng-flat-types`.
**Role**: Engineer, reporting to the Overseer (`landofgoodplaces-fc`).

## The brief in one line

Everyone else on the sphere rebuild is fixing instances of the two mistakes.
This lane makes them impossible to write, so nobody has to find them again.

## Done and pushed

### 1. `Chart`'s flat form throws rather than lying (commit 1)

- `FlatChart.upAt` now asserts inside the validity radius. It was the only one
  of the three unguarded, and it is the worst: a position wrong by the
  departure is centimetres, an **up** wrong by the lean is the whole second
  mistake. Measured by a control test: a flat up read at 157 m is **40.9°** off.
- `flatChart()` refuses a chart whose departure exceeds **0.05 m**
  (= 4.69 m radius on R = 220) unless given `{ departure, because }`.
- That acceptance is checked against the real departure, so a signed-off number
  that has gone stale is a build failure with both numbers in the message.
- `test/geo/core.test.ts`: 27 → 32 tests, all passing.

### 2. `check:flat-primitives` (commit 2) — armed and proved red

`scripts/check-flat-primitives.mts` + `scripts/flat-primitives-baseline.mts`.
TypeScript-AST scan over 597 files of `src/`, `scripts/`, `test/`. Five rules:
`HARD_UP`, `Y_DIFFERENCE`, `Y_OVER_GROUND`, `Y_THRESHOLD`, `FLAT_DISC`.
Two-way ratchet (new finding → red; fixed finding → BASELINE LOOSE → red).

**It caught its own bug before it landed, and that is the thing to keep.**
The first draft matched 57 of 93 flat discs because `-Math.PI / 2` parses as
`(-Math.PI) / 2` — the minus binds to `Math.PI`, not to the division — and it
was stripped at the outer level. Among the 36 invisible sites was
`tapMarker.ts`, the inventory's worst-felt defect. **Nothing would have gone
red.** Both halves of the control that caught it now run on every invocation:
`selfTest()` (every rule fired on its own fixture, plus four that must not
fire) and `textualControl()` (`text − excused == ast`, structurally, so it
survives people fixing sites).

Four deliberate breaks, all exit 1, on `90e62c5b` — re-runnable, and the
geometry is the branch's own source at that sha:

| break | result |
|---|---|
| `new Vector3(0,1,0)` + `zone.y - terrainHeight(...)` into `Highlights.ts` | 2 × NEW FLAT PRIMITIVE |
| delete `tapMarker.ts`'s `this.ring.rotation.x = -Math.PI / 2` | BASELINE LOOSE (baseline 1, now 0) |
| restore the sign bug in `isPiOverTwo` | ARMING FAILURE, FLAT_DISC |
| `if (false && ...)` on the `Y_OVER_GROUND` rule | ARMING FAILURE, Y_OVER_GROUND |

Cost **0.65 s**; inserted after `check:text`. Chain step **sets** compared
(not counted): 65 → 66, `DROPPED []`, `ADDED ["pnpm run check:flat-primitives"]`.
`check:chain-coverage` confirms reachability.

Baseline: 217 expressions / 241 findings — HARD_UP 55, Y_DIFFERENCE 58,
Y_OVER_GROUND 27, Y_THRESHOLD 8, FLAT_DISC 93. **Not adjudicated**, on purpose.

### 3. `Altitude` and `Up` (commit 4) — additive, nobody ambushed

`src/world/geo/Altitude.ts`, `src/world/geo/Up.ts`. **`tsc --noEmit` and
`typecheck:test` both exit 0 with no other file touched**, so the three
in-flight lanes compile exactly as before and adopt at their own pace.

The measured constraint that decided the design — probed with `tsc` **before**
designing anything, not after:

| expression | branded `number` | opaque |
|---|---|---|
| `alt < geo.cy` | **compiles** | TS2365 |
| `alt - geo.cy` | **compiles** | TS2362 |
| `needsAltitude(plainNumber)` | TS2345 | TS2345 |

A brand on a `number` is assignable *to* `number`, so every operator stays
open — it guards function boundaries only, which is the half that was never the
bug. So **`Altitude` is opaque** (six operations, no runtime representation).
**`Up` is only a brand**, because for an *object* type a brand already refuses
a plain `Vector3` while staying assignable to one — which is why it could be
wired into `Geo.up`/`Frame.up` with zero breakage.

`altitudeOf` delegates to the existing `altitude`, so there is no second
definition to drift.

Proved red (all `@ts-expect-error`, which TS fails as TS2578 when the expected
error does **not** occur — so these cannot rot):
- `Altitude` as a branded number → TS2578 on 4 lines, exit 2.
- `Up` as a plain `Vector3` alias → TS2578 on 2 lines, exit 2.

`check:flat-primitives` caught the two world-axis literals in the new test file
on its first run; they now carry `// flat-ok:` with a reason. The hatch worked
on its author first, which is the right first customer.

## Still to do — the decision the Overseer owns

Nothing here forces adoption. **Migrating a subsystem to `Altitude`/`Up` is
what breaks a lane**, and that is the call to make deliberately:

- Decide whether bridges/railway, exteriors and rides adopt now or after their
  current work lands, and tell those engineers directly before anything moves.
- The baseline's 217 entries are the migration list. As sites are fixed the
  check prints BASELINE LOOSE and asks for the line to be deleted, so the
  table shrinks to zero as the category closes. That is the progress metric.

Two rules I would extend the check with next, both from the inventory and both
additive: `new Box3()` round possibly-leaning geometry (10 uses in `test/`,
every one axis-aligned), and a raycast fired along world `+Y`
(`invariants.ts:5400,6357` — the clause deciding whether the train drives
through its own bridge).

## Rules I am working under

- Never the shared checkout; never `git stash` (shared across worktrees).
- Verify the chain by **parsing** `package.json`'s scripts object, never grep —
  names are prefixes of one another.
- Read exit codes directly; never pipe a check through `tail`/`head`.
- Push after every commit.
