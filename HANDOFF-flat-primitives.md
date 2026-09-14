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

## Still to do

**3. Types that refuse the mistake** — the remaining deliverable.

The measured constraint that decides the design, probed with `tsc` before
designing anything:

- A **branded number** (`number & { [brand]: true }`) does **not** stop
  `alt < geo.cy` or `alt - geo.cy`. TS allows both. It only stops a plain
  `number` being *passed* where the brand is required.
- An **opaque** type (not a number at all) stops both:
  `TS2365: Operator '<' cannot be applied` and `TS2362`.

So "a height cannot be compared against a coordinate" requires `Altitude` to be
**opaque**, with its own small operator vocabulary. That is correct but has a
wide blast radius across three in-flight lanes, which is why it is staged after
the check rather than before it. Do not land it without telling the Overseer
first — the brief is explicit that the timing matters.

`Geo` already does the positional half of this well (`cx`/`cy`/`cz` so
`geo.y` will not compile). The gap is `Altitude` and an `Up` that can only come
from `upAt`.

## Rules I am working under

- Never the shared checkout; never `git stash` (shared across worktrees).
- Verify the chain by **parsing** `package.json`'s scripts object, never grep —
  names are prefixes of one another.
- Read exit codes directly; never pipe a check through `tail`/`head`.
- Push after every commit.
