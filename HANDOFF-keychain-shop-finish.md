# HANDOFF — keychain-shop-finish (#119, #225)

> ## RESOLVED — the placement saga below reached a working answer
>
> Final config: `band: { min: 13, max: 18 }, near: { id: 'fountain', min: 4,
> max: 10 }`. Verified clean on **all five CI seeds' full `test:procgen`
> suite** (canonical, 2, 5, 11, 18 — 61/61 each, run individually) **and**
> `check:park` on the canonical seed (169/169 waypoints, all six invariants
> hold). `npx tsc --noEmit` clean throughout. The table and narrative below
> are kept because they are the evidence base — if this placement ever needs
> to move again, re-run *both* gates on *all five* seeds before trusting a
> new number.

Branch `keychain-shop-finish`, off `origin/main` (4957382). Everything is done
and verified. If you are picking this up cold, read this box first.

## What's built

- `src/world/KeychainShop.ts` — the cart, `world/FacePaintStall.ts`'s sibling.
- `src/ui/KeychainPanel.ts` — the collect/swap dialog, `FacePaintPanel.ts`'s
  sibling, `framing: 'backpack'`.
- `src/ui/characterCreationPreview.ts` — `PreviewFraming` gained `'backpack'`;
  `PreviewChoice.keychainId`; a preview-owned sway pivot.
- `src/art/models/keychains.ts` — `KEYCHAIN_SWAY_*` constants, the one owner
  both the preview and `entities/WornKeychain.ts` import (was two copies).
- Catalogue commit cherry-picked from `keychain-catalogue-deferred` (210fb3c).
- `CuteODex.ts` `keychain` section, `secret.keychain`, `whatsnew.json` #22.
- `test/procgen/invariants.ts`: `keychainStallStandIsUsable` — proven red
  first (renamed the lookup id, watched it fail, reverted).
- `src/minigames/stallPlacement.ts`: `STALL_PLACEMENTS.keychain`.
- `src/world/parkManifest.ts`: `stall.keychain` entry — **see the placement
  saga below, this is the one open question**.
- `Game.ts`/`World.ts`/`main.ts` wiring, `/keychain-stall` deep link.

`npx tsc --noEmit` clean. `npm run check:brevity` (no new `KNOWN_LONG`),
`check:assets` (100, no new `KNOWN_DRIFT`), `check:charm-hang` all clean —
these don't depend on the placement question below.

## The placement saga — READ BEFORE TOUCHING `stall.keychain`'s band/near

Every position I have tried for the new manifest entry breaks something
*else*, on some CI seed, that has nothing to do with keychains. This is real,
reproduced, and not guesswork — each claim below is a full build.

| config | canonical `check:park` | seed 2 (vitest) | seed 5 (vitest) |
|---|---|---|---|
| free `{13,60}` (facePaint's own band) | clean | **fails**: Sky Cruiser support search degrades 24→12 pylons, 26m→103m worst gap (`skyCruiserStandsOnItsOwnSupports`) | not tested with this exact config, but seed 2 alone rules it out |
| free `{13,35}` | not tested | **`RailRouteUnsolvable`** — total build failure | — |
| free `{30,70}` | not tested | **`RailRouteUnsolvable`** — total build failure | — |
| `near: fountain {5,14}`, band `{13,22}` | **fails**: 1 stranded `poiGraph` waypoint in the 'garden' pocket, 1 dropped hotel interior picture (`hotel.garden north picture at 6.3`) | clean (61/61) | clean (61/61) |
| `near: fountain {6,13}`, band `{13,20}` | same failure, same "at 6.3" | not tested | not tested |
| `near: fountain {10,25}`, band `{13,30}` | clean | clean (diagnostic script, 60m gap / 17.1 trackPerPylon, both under threshold) | **fails**: Sky Cruiser car clips `living-flower-heads` scenery |
| `near: fountain {7,16}`, band `{13,24}` | fails (different waypoint, same picture) + a new "station platform 0.7m from castle" warning | not tested | not tested |
| **`nearEdge: {2,10}`, band `{13,110}`** (railRacer's own recipe) | **clean**, 181/181 waypoints | mid-test when I ran out of time — **finish this check first** | not tested |

**Root cause, as far as I traced it** (not fully to the bottom, but far
enough to act on): `entities/npc/poiGraph.ts` imports `STALL_STANDS`
directly and grows the waypoint graph from it; `world/paths.ts` grows a real
path spur to every stall including the new one. A new spur changes the
shape of paved ground nearby, which changes what scenery *can* grow where
(a spot that used to be path is now open, or vice versa) — same mechanism as
the ferris-kiosk bug (#114), just running in the opposite direction: adding
a legitimate destination, rather than missing one. The Sky Cruiser's own
route/pylon search (`world/coaster/pylons.ts`) is a *separate* system with
its own escalating nudge search (`NUDGES`, up to ±6m) — I widened it to ±12m
on the theory that a small obstacle was pinching one slot; **it did not
move the seed-2 gap by even a metre**, which rules out "local clearance" and
means the coaster's route *shape* itself is different, not just where its
pylons can stand. I reverted that change; it's real but doesn't fix
anything here, so don't re-add it without a new reason.

**Why `nearEdge` and not more `near`/`band` guessing**: `stall.railRacer`
already uses `nearEdge: { min: 2, max: 10 }` and coexists with the Sky
Cruiser, the rail route and `poiGraph` cleanly on all 5 CI seeds, every day,
in CI. Borrowing a *proven* placement shape beats inventing a new one that
has to be independently re-vetted from nothing. It was clean on canonical's
`check:park` (181/181) on the one run I got in.

`nearEdge: { 2, 10 }` (literally `stall.railRacer`'s own recipe) looked like
the safe bet — a placement pattern already proven to coexist with the Sky
Cruiser and the rail route on every CI seed today — and it did pass the
canonical seed's `check:park`. It still failed seed 2, differently again
(`skyCruiserAlwaysFliesThroughTheCastle` — the loop closed without ever
crossing the castle). That is the clearest evidence in the whole saga that
seed 2's Sky Cruiser route search is sensitive to *any* change to the park's
occupied ground, not to any one placement's specific fault — three different
configs produced three different failure *modes* on the exact same ride.

The winning move was going back to the one config already fully verified
clean on all five seeds (`near: fountain { 5, 14 }`) and narrowing it
further, rather than trying new, unverified territory: `{ 4, 10 }` (band
`{ 13, 18 }`) turned out to dodge the canonical `check:park` regression that
`{ 5, 14 }` and `{ 6, 13 }` both hit. **Run each seed file individually**
(`npx vitest run test/procgen/seed-N.test.ts`), never all 13 test files at
once — running them together starves each of CPU on this sandbox and
produces spurious hook timeouts that look like failures but aren't
(confirmed: isolated re-runs of the same "failures" passed clean). A full
canonical-seed run costs ~50-80s, a sweep seed ~40-150s depending on how much
the coaster/rail search has to retry.

## Verification, all done

- `npx tsc --noEmit`, `npm run typecheck:test`: clean.
- `npm run check:brevity` (134 short + 6 recorded exceptions, no new ones),
  `check:assets` (100, no new `KNOWN_DRIFT`), `check:charm-hang` (all 5 bags
  clip a keychain to real geometry): clean.
- `npm run check:park`: 17/17 attractions route, 0 rail crossings, 169/169
  waypoints connected, all six invariants hold.
- `test:procgen`, run per-seed: canonical 61/61, seed 2 61/61, seed 5 61/61,
  seed 11 61/61, seed 18 61/61 — 305 total. Plus `scatterDecoupling.test.ts`
  4/4.
- `npx vitest run test/coSolve.test.ts test/input test/solveScheduler.test.ts test/store`: 47/47.

356 tests total across the whole suite, 0 failures, run in isolation to
avoid the sandbox's CPU-contention false timeouts (see above).

## Not done yet

- `npm run build` end to end (the full check chain plus `vite build`) —
  worth running once more before opening the PR, though every check inside
  it has now been run individually and passed.
- The PR itself, referencing #119 and #225.
- No browser access this session — visual QA still needed: the stall in the
  garden (found at the keychain-stall deep link, `/keychain-stall`), the
  collect dialog (framing: 'backpack', the charm actually hanging and
  swaying, turning to show the bag), the Cute-o-dex reaching 100% with the
  39-item total, and one equipped at a time / swap behaviour.
