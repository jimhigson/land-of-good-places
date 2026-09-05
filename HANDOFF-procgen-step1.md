# Handoff — procgen stage 3, step 1: the road becomes the first production placer

- **Branch**: `feat/procgen-step1-road-placer`, cut from `origin/design/round-robin-generation`
  (which already contains `origin/main` — `git log origin/main ^HEAD` is empty, no rebase owed).
- **Worktree**: `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/procgen-step1`
- **Model**: Opus 5 (1M context). Chosen by the Overseer that dispatched this Engineer.
  A replacement must run the same model.
- **Brief**: `docs/BRIEF-stage3-step1-road-placer.md` (Architect, a Fable agent, still resumable).
- **Scope discipline**: step 1 only. Steps 2/3/4 are held pending Jim's ruling.
  No trestle/road negotiation, no ladder loosening, `CoSolveEngine` deliberately untouched.

## The measurement instrument (built and controlled first)

`scripts/park-digest.mts` builds the real headless park for one seed and prints a
sha256 per mesh name plus one for the whole park. `scripts/park-digest-sweep.sh <dir>`
runs it once per pool seed, each in its own process (a second park in one process is a
lie — `paths.ts` mutates module-level paving).

**Two controls, both run before trusting it, per CLAUDE.md:**

1. **Determinism.** Two full 16-seed sweeps on an unchanged tree: all 16 digests
   bit-identical. (`diff -r` showed 144 lines, every one of them a Node PID inside a
   `.err` stderr warning — compare the `.txt` files only.)
2. **It can see a change.** `ROAD_HALF_WIDTH` perturbed by **1 mm**
   (`CAT_BUS_WIDTH / 2 + 1.25` → `+ 1.251`), canonical seed:
   `1ef4ff81decec5d4` → `1c9175afb7659c80`. Restored afterwards.

**Baseline, `origin/design/round-robin-generation` @ `44d3f5e6`, before any edit:**

| seed | meshes | park digest |
|---|---|---|
| 20260728 | 5537 | `1ef4ff81decec5d4` |
| 5 | 5478 | `4672408cfa1b0af0` |
| 11 | 5501 | `3d7098ac16d5af70` |
| 24 | 5501 | `1b48deefa186db1f` |
| 115 | 5485 | `a57c89548926fae2` |
| 128 | 5519 | `a654419e288abe67` |
| 131 | 5566 | `1f32d63d063371e6` |
| 208 | 5512 | `0305ee63446870a6` |
| 225 | 5524 | `6bdf2c8fbc772cc5` |
| 267 | 5539 | `0b47b3a1d8ec2d01` |
| 274 | 5502 | `a3e0a4b175f05a70` |
| 288 | 5529 | `2c142db9da46cc31` |
| 326 | 5589 | `557aadc7a55ef1bf` |
| 346 | 5521 | `dfc5b82bf9b9e078` |
| 428 | 5533 | `3ee474a535a825a5` |
| 451 | 5568 | `cf7ce9b1b9df321e` |

Full per-mesh digests are in the scratchpad at
`/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/before/`.
If that is gone, regenerate from `44d3f5e6` — the sweep is committed.

## The finding that changes the brief's plan

**The brief says "the road is constants". It is not.** The road's centreline is
computed inside `buildEntranceRoad()`, a private function in `Entrance.ts`, from
two *live measurements*:

- The **kerb**'s two ends come from `kerbReach()`, which marches outward asking
  `PARK_BOUNDARY` where the road's inner edge would re-enter the park, clipped by
  `ENTRANCE_BUS_ARRIVE_X` / `ENTRANCE_BUS_VANISH_X` + half a bus. `PARK_BOUNDARY`
  is available during generation (import-ladder rung 1), so this half is fine.
- The **spur**'s inner end comes from `spurReach()`, which walks in from the gate
  asking `forEachPavedDisc` where the plaza's paving already starts (#472's
  coplanar-seam fix). **`publishPaving()` is called only from `buildPaths()` in
  `pathGraph.ts`, which `Garden` runs inside `new World(...)`** — i.e. *after*
  generation has entirely finished (`journeyDirector` holds the bus until then).

So a scheduler task **cannot** see the spur's true inner end. Publishing an
approximation of it would be exactly the copy the brief forbids, and caching
whichever caller asks first would change the road (the pre-paving answer is the
longer `ENTRANCE_STOP_Z` fallback) and break byte-identity.

**Design adopted in response** (report to the Architect; it satisfies the brief's
rule — "the claim must BE the road" — while respecting the real ordering):

1. `src/world/entrance/roadCorridor.ts` becomes the **one owner** of the road's
   centreline. `Entrance.ts` builds its ribbons from exactly its output; nothing
   re-derives an endpoint.
2. A `roadCorridor` scheduler task in `parkGeneration.ts` commits the road's
   corridor claims from that same owner, at the last rung — the road's ground is
   claimed in the round-robin.
3. `Entrance` **re-commits** the same feature through the same owner when it
   actually builds. `GroundClaims.commit` already preserves a feature's commit
   order across a re-commit. This is what makes the registry on the *built* park
   hold the road as built, rather than a snapshot taken before the paths existed.

## State

- [x] Worktree, install, brief and design read
- [x] Measurement instrument built, both controls passed, 16-seed baseline captured
- [ ] `roadCorridor.ts` — the one owner
- [ ] Production `GroundClaims` instance + letterbox + `World` field
- [ ] `roadCorridor` scheduler task
- [ ] `parkFacts.ts` read-only exposure
- [ ] Invariant in `test/procgen/invariants.ts`
- [ ] Deliberate breaks proved red, with the geometry pasted
- [ ] `check`, `test:procgen`, `check:coplanar`, `build` — exit codes read directly
- [ ] After-sweep vs baseline
