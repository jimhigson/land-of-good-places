# HANDOFF — checked-in parks (branch `tooling/parks-checked-in`)

Stopped on Jim's order, 13 Nov 2026 ~11:05, mid-build. Written by the Overseer from the
design agent's result and the stopped engineer's actions.

## What this is, and Jim's ruling

The solved-park cache was keyed on a hash of the solver's whole import closure, which
includes render code, so any render-only edit re-solved all sixteen parks (12–30 min each
on the Mac under load, 30–45 min in CI) for an identical park. On 13 Nov that stopped a
fleet of engineers opening the game at all.

Jim, 13 Nov: *"why do we need these long park solves? park geometry shouldn't be changing
now"*, *"how about if we checked in the result of the solve so we don't have to do it every
time?"*, *"great yes, do the checkin of solved parks to the repo, to speed up CI and local
builds"*.

So: the sixteen solved parks are tracked in git (`parks/`); nothing solves by default;
safety moves from "the hash matches" to "the park is still accepted by the current code"
(`validate:parks`); only a rejected seed is re-solved (`pnpm run build:parks`) and the new
file is committed with the change that caused it.

## The design (read it before touching anything)

Full text: key `parks:design` in
`/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/63860b08-4a9b-4597-b7cf-7b1677887a9f/scratchpad/handover-13-nov/parks-results.json`.
The two places it departs from the obvious shape — both need Jim's or the Overseer's eye:

1. **The existing digest cannot be the drift check.** It is a whole-scene mesh digest and
   changes on every art edit. The design adds a new *placement* digest (`layout`) and stops
   checking the render digest in. The layout digest is new and unproven: it must move when a
   thing moves, hold still under a render edit, and come out identical on the Mac and on
   Linux (the first CI run is the proof).
2. **Validation is NOT the full acceptance a fresh solve gets.** A file attempt today spawns
   `check:stall-accommodate`, which solves the seed from scratch (it needs the world phase's
   live stalls builder). The design leaves that one measure out of file validation, says so
   on stderr every run, and keeps it on every freshly solved park and on the canonical seed
   in shard 7. **This is a real weakening that Jim has not been asked about.** The clean fix
   is making `stallAccommodate` build on a hydrated park.

Also from the design's risks: `build:parks` deletes `*.json` in its output directory today
(it must not delete the tracked parks); the runtime stamp changes so a returning player is
put at the default spawn after slightly more deploys than before (small, player-visible).

## State of this branch (3 commits on `origin/main` at `34d57592`'s parent line)

- `ee2bf736` Check in the sixteen solved parks (`parks/`), with the reader and the placement
  digest that will hold them.
- `83575707` Node tooling reads the checked-in parks; a missing park throws instead of
  solving.
- `149a7c86` `validate:parks` replaces the solve: build, dev server, checks and CI read the
  checked-in parks. **This rewires 13 workflow files** (`parks.yml` becomes a 16-seed
  validation matrix; `ci.yml`'s jobs lose `needs: [parks]`; the `Checks` and
  `Procgen invariants` aggregators gain `parks`; `.github/actions/restore-parks` removed).

52 files changed. Working tree clean; everything is pushed.

## NOT done — do not merge until these are

1. A seed-5 validation was still running when the engineer was stopped; **no validation
   result for the sixteen checked-in files has been seen.**
2. Neither control has been run: (a) a render-only edit inside the closure costs zero solves
   and validation passes (time it); (b) an edit that genuinely invalidates a park is rejected
   for exactly the affected seeds, with the "run build:parks and commit" message.
3. The fresh-worktree proof: `pnpm install`, dev server, `/spawn?pos=0,0&seed=5` opens with
   no solver process spawned.
4. `tsc`, `typecheck:test`, `build` (must ship the parks), `check:prebuilt-park`,
   `check:client-no-solver`, `check:chain-coverage`, `check:boot-chunk` on the final head.
5. Docs: `docs/design/PREBUILT-PARKS.md`, the header of `scripts/lib/park-source-hash.mjs`,
   one short section in `CLAUDE.md`.
6. The adversarial review ("can a park that no longer fits the code be shipped, served or
   judged green?") — never started.
7. **A real CI run.** The workflow rewiring cannot be proven locally, and CLAUDE.md records
   that `needs:` plumbing in `ci.yml` can turn a failure into a skip. This is the park
   pipeline and the deploy path: unlike the rest of 13 Nov's work, this one should NOT be
   merged without CI green on its own PR.
8. `origin/main` moved after this branch was cut only by the plan doc (#746); re-merge main
   before opening the PR anyway.

## Pointers

- The stopped engineer's action log:
  `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/63860b08-4a9b-4597-b7cf-7b1677887a9f/scratchpad/handover-13-nov/parks--parks-build.txt`.
- Sources of solved parks without solving (from the design): the live site
  `https://landofgoodplaces.blockstack.ing/parks/<seed>.json` (all sixteen, no manifest);
  per-seed CI artifacts of main's push runs; `.parks/` in worktrees such as
  `.claude/worktrees/interior-doorways`.
- This worktree is `.claude/worktrees/parks-checked-in`. No process of this work is still
  running.
