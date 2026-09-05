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

## Byte-identical: PROVED

All sixteen pool seeds bit-identical to the baseline above, measured after the
whole change with `scripts/park-digest-sweep.sh`. Not one mesh moved.

Note what the digest does and does not cover: it builds the park through
`park-harness.mts`, which is the `World` path (the same one `check:park` and
`test:procgen` use) and does **not** run `ParkGeneration`. The generator path is
covered by `check:park-boot` (green, sliced and straight-through solves
identical) and by `check:ground-claims`, which drives a real generation.

## Deliberate breaks, all proved red

Canonical seed geometry these were proved against — paste it with any re-run,
because a red transcript is a measurement and measurements go stale:
kerb `x -29.91508..14.91508` at `z 69`; spur `x 0`, `z 65.11..55.90999999999995`;
`halfWidth 3.89`.

| break | probe that caught it | red evidence |
|---|---|---|
| `World` makes its own registry instead of taking the letterbox | probe 3 (`===`) | exit 1, "the World's claims registry is NOT the object the generator claimed against" |
| the owner's claim shifted 0.5 m | probe 5 (claim vs drawn mesh) | exit 1, three edges at `0.5000 m apart` |
| a hand-typed copy in `World`, accurate to 5 mm | probe 4 (byte-equality) **and** probe 5 | exit 1, byte-equality diff printed, plus `0.0049 m apart` |
| the **claim alone** drifted 0.8 m (`entranceRoadClaims`, which no mesh reads) | the procgen invariant, seed 5 | `1 failed | 88 passed`, "gateway minZ is 58.5100 in the scene and the corridor claims 59.3100, 0.8000 m apart" |
| the **owner** shifted 0.8 m (`spurReach`) | *deliberately not* the invariant — the digest | invariant `89 passed`, exit 0; digest seed 5 `4672408cfa1b0af0` -> `f4f2227f0ceb51d3` |
| `ROAD_HALF_WIDTH` + 1 mm | the digest instrument itself | canonical `1ef4ff81decec5d4` -> `1c9175afb7659c80` |

Probe 4 stayed green on the 0.5 m break, correctly: that break moved the owner,
so registry and owner still agreed. Probe 4 catches registry-vs-owner drift,
probe 5 catches owner-vs-drawn-road drift. Together they close the loop; neither
alone does.

**Which instrument owns which question — get this right before re-running a
break.** Shifting the *owner* (`spurReach`) moves the claim **and the mesh
together**, so the invariant passes and *should*: measured, the drawn edge went
58.5100 -> 59.3100 and the claim followed it exactly, residual 1.37e-6 m. That
is the one-owner design working, not a check that failed to fire. A moved owner
is a **moved park**, and the instrument that owns that question is the digest —
which caught it, seed 5 `4672408cfa1b0af0` -> `f4f2227f0ceb51d3`.

To arm the invariant you must drift the **claim alone**, i.e. inside
`entranceRoadClaims()`, which `buildEntranceRoad` does not read. An earlier
version of this table described the working break as "the owner's spur end
shifted", which is a different mutation that correctly gives a green run — a
reproduction a later agent would follow to exit 0 and reasonably conclude the
check had rotted. Both mutations re-run and quoted above.

## What the new checks actually cover

- **`check:ground-claims`** — six probes, but **the canonical seed only**,
  because it drives a whole `ParkGeneration` first. It is the only thing that
  tests the letterbox hand-over at all.
- **The procgen invariant** — the same claim-is-the-road question on **7 of the
  16 pool seeds**, one per seed test file. That is issue #510's gap and this
  does not close it.

## Deliberately not done

- `CoSolveEngine` and `PlacementField` untouched, per the brief — they move onto
  `GroundClaims` at step 4.
- No trestle work (step 2), no ladder loosening (step 3), no negotiation.
- The brief's acceptance 1 asked for the road corridor and rail-race legs added
  to `check:park-boot`'s hash set. Not done in that form: the 16-seed digest
  hashes **every mesh in the park**, which strictly contains both, on 16 seeds
  rather than one. Said plainly rather than doing the weaker thing to match the
  letter.
- The brief's acceptance 3 asked for "exactly one corridor claim". It is
  **two** — the road turns a corner at the gate and a capsule is a straight
  segment. The check asserts two and says why.

## State

- [x] Worktree, install, brief and design read
- [x] Measurement instrument, both controls, 16-seed baseline
- [x] `roadCorridor.ts` — the one owner
- [x] Production `GroundClaims` + letterbox + `World` field + re-commit
- [x] `roadCorridor` scheduler task
- [x] `check:ground-claims`, added to the chain (step sets compared with main)
- [x] Invariant in `test/procgen/invariants.ts`
- [x] Deliberate breaks proved red with geometry recorded
- [x] Byte-identical on all 16 seeds
- [x] `pnpm run build` exit 0; `pnpm run test:procgen` exit 0 (759 passed, 0 skipped)
- [x] `pnpm run check` exit 0 (60 steps)
- [x] `pnpm run check:coplanar` exit 0 (224 seams, all baselined, none new)
- [x] PR 522, based on `design/round-robin-generation`

## Mesh names — issue #520

No mesh renamed. The two road mesh names moved verbatim between files. Proved by
measurement: the *set* of mesh names in the built park is identical on all 16
seeds, before vs after. So check:coplanar's name-keyed ratchet has not silently
lost a baseline entry on this branch.

## Next

Awaiting review + QA. Invisible to a player, so it merges on those without Jim.
Steps 2/3/4 remain held on Jim's ruling — do not start them from here.
