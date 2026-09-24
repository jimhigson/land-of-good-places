# Prebuilt parks: solve at build time, download the decisions

**Design proposal, 23 September 2026.** Jim's request: *"procgen should be
build-time and downloaded by the game instead of done on the client that is
playing."* And, on the format: *"it probably needs to invent a file format for
this that is the park's layout as json, but not every mesh etc, so that the
client can load a reasonably small park with all decisions made, but not just
some huge 3d model or models."*

## As built, 24 September 2026 (PR #705)

Jim's two rulings of 24 September changed the proposal below in two ways:
*"there should be no ability to build built into the game as delivered —
seeds not downloadable is an error"*, and *"we only support seeds 0..15, no
others."* So there is **no client fallback**: the game carries no solver at
all, and seeds 0..15 are the only parks. What shipped:

- **`procgen/`** holds every search and both backtracking drivers — build-time
  Node code. **`src/` never imports it** (`check:procgen-boundary`), and the
  built bundle contains none of its 163 procgen-only strings
  (`check:client-no-solver`). Node tooling reaches the solver through one port,
  `src/world/prebuilt/solverPort.ts`, filled lazily by
  `scripts/ts-extension-resolver-register.mjs` (a sync `registerHooks` hook, so
  `require()` shares the module cache) and, for vitest, by
  `test/procgen/parkFacts.ts`.
- **The park file carries every decision the searches make**, not only the
  plan's: layout, cruiser, train, slide, bridge sites, the path graph and the
  street paving it leaves behind, the plan's commit order, the whole world
  phase (stall moves, walls, trees and bushes as the RNG state they were rolled
  from, fairy poles, lamps, rail-race trestles, and every claim committed), and
  the bridge footprints the `World` searches for while it builds. Format 1,
  owned by `src/world/prebuilt/parkFile.ts` (reader) and
  `procgen/world/parkFileWriter.ts` (writer).
- **No file is an error, never a solve.** A seed outside 0..15, a missing file,
  a file from another build or a failed download shows
  `ui/ParkUnavailableScreen.ts` — the seed and the reason. No timeout: a park
  is precached with the bundle that reads it. **Retry means reload**, which
  fetches again and never solves; a `?seed=` page also offers "Go to my park".
- **The dev server serves park files too**, solved by the Node solver on first
  request and cached per source hash (`scripts/lib/dev-parks.mjs`), so the dev
  client runs the production path.
- **Proof, every build:** `build:parks` solves each seed in one process, hydrates
  it in another, and requires the two whole-park digests to match, the hydrate
  process to have constructed no driver and run no world search, and a
  perturbed file to digest differently. `check:prebuilt-park` runs the same on
  the default seed in the chain.

### Sizes of the sixteen parks (format 2, as built)

Measured by `pnpm run build:parks` on an M-series Mac; every row proven.

| seed | raw | gzip -9 | brotli 11 | plan searched | plan hydrated |
|---:|---:|---:|---:|---:|---:|
| 0 | 115.3 KB | 39.5 KB | 33.1 KB | 7.2 s | 5 ms |
| 1 | 139.5 KB | 50.9 KB | 43.0 KB | 2.7 s | 6 ms |
| 2 | 139.7 KB | 50.7 KB | 42.6 KB | 7.1 s | 6 ms |
| 3 | 132.6 KB | 46.8 KB | 39.0 KB | 26.6 s | 5 ms |
| 4 | 130.0 KB | 46.6 KB | 38.9 KB | 40.3 s | 6 ms |
| 5 | 119.4 KB | 42.0 KB | 35.2 KB | 2.9 s | 5 ms |
| 6 | 131.3 KB | 47.0 KB | 39.3 KB | 4.5 s | 5 ms |
| 7 | 120.6 KB | 41.4 KB | 34.6 KB | 221.7 s | 5 ms |
| 8 | 130.3 KB | 45.3 KB | 38.1 KB | 6.6 s | 5 ms |
| 9 | 124.0 KB | 43.1 KB | 35.8 KB | 3.4 s | 6 ms |
| 10 | 130.2 KB | 46.9 KB | 39.1 KB | 4.6 s | 6 ms |
| 11 | 116.0 KB | 38.5 KB | 31.9 KB | 0.7 s | 6 ms |
| 12 | 128.3 KB | 44.4 KB | 36.9 KB | 1.6 s | 6 ms |
| 13 | 117.2 KB | 40.2 KB | 33.4 KB | 1.8 s | 5 ms |
| 14 | 123.4 KB | 44.7 KB | 37.6 KB | 5.0 s | 5 ms |
| 15 | 131.5 KB | 45.9 KB | 38.4 KB | 10.1 s | 6 ms |
| **total** | **2029.6 KB** | **714.1 KB** | **597.1 KB** | | |

Format 2 added the placement loops' answers (`built`); ~13 KB of each file is
the boundary's 512 radii at full precision.

The files grew from the plan-only ~25 KB of step 1 to ~110 KB because they now
carry the world phase. Where the bytes are, on the default seed (raw): the
world phase's claims ~30 KB (fairy lights, lamps, stalls and trestles; the
trees' and bushes' claims are derived on read and cost nothing), bush
positions ~22 KB, the path graph ~17 KB, the cruiser ~11 KB. The claims could
be derived from the decisions like the trees' are, which would take roughly a
quarter off; not done yet.

### The bundle, before and after

JavaScript emitted by `vite build`:

| | raw | brotli 11 |
|---|---:|---:|
| before (client solved) | 3,430,754 B | 783,721 B |
| after (no solver) | 3,297,858 B | 744,451 B |

The `Garden` chunk (208,636 B, where the searches lived) is gone; the `Game`
chunk grew by ~12 KB for the hydration code and the file reader.

### Checks retired, and why

| check / mechanism | why it no longer applies |
|---|---|
| `check:solve-cost` | budgeted the CPU the client spent searching; the client searches for nothing |
| `check:park-boot` | proved the client's search was sliced across frames without stutter; nothing is sliced |
| `check:arrival-completes` | proved a slow device's search finished inside the bus ride; loading is a fetch and a few ms of hydration. `check:ground-claims` still drives the real `ParkGeneration` to completion |
| `SolveScheduler` (`src/boot/solveScheduler.ts`) | sliced the solve across frames |
| `CLIENT_BUNDLE` flag | briefly used to fold the search out of the bundle; replaced by the import boundary |
| `measure-generation-slices`, `measure-cruiser-slices`, `profile-park-boot-slice` | measured the slicing of that solve |

Kept deliberately: the searches' own generator `yield`s. They are how the
driver takes turns between features (Jim's round-robin, Decision 12), not
only how a browser frame was spared, and `feat/structural-backtrack` is
reworking that driver now. A coarse bound on `build:parks` replaces the
frame budgets: an 18-minute step timeout in CI and a per-seed kill
(`LGP_PARK_TIMEOUT_MS`, 12 min) that names the seed.

### Placement loops moved into the file too (Jim, 24 Sep: they count)

Everything that chose among candidates while the `World` built now reads its
answer from the file's `built` section (`src/world/prebuilt/built.ts`), and
its search moved to `procgen/`: the Sky Cruiser's pylons, the slide's legs,
the rail race's exit and finish arch (`RailRaceRoute` now takes its start
decided), the ferris wheel's exit, the railway's stations, and the park
boundary's radii. The boundary is the awkward one: several modules read the
park's edge at module scope, so the page now fetches the park file **before**
loading the game (`src/bootstrap.ts`), with the update gate set up first so a
new build still reaches a park that cannot open. The boundary's search loads
through its own light loader in Node, because it is first asked for while the
game's modules are still importing. `check:prebuilt-park` now also fails if a
hydrated park ran any of these searches.

Left on the client, deliberately: the rail race's hazard schedule
(`planHazards` — a fixed-seed roll of the race's obstacles per level, no
search or refusal), the ride cameras' shot planning (runtime camera work), and
the conservative bridge keep-out the flowers read (a shrink-to-fit reservation
derived from the decided crossings).

### Seeds: what the switch to 0..15 cost in coverage

At the base (`ae8257fb`) only seeds 2 and 5 of 0..15 pass `check:park` and
every invariant; that is why #705 waits on `feat/structural-backtrack`. The
old per-seed invariant files were on 20260728, 11, 24, 131 and 326; the old
pool also held 128, 208, 274, 428 and 451. Their failures at the base, and
whether a seed of 0..15 still shows each one:

| failure on a retired seed | still reproduced on 0..15 |
|---|---|
| 11, 451: *built the park it was asked for* | 11 |
| 11, 128, 131, 274, 451: *every modelled coping stone sits on the wall it caps* | 6, 11 |
| 131: *no two close destinations are left with a wildly disproportionate paved detour* | 7 |
| 208, 326: *the Rail Race finish rainbow stands on the ground* | 6 |
| 128: `check:park` — `route.unreachable` 3, `route.crossesRail` 1, `poi.stranded` 57; *every doormat can be walked to*; *every railway crossing has a bridge you can walk to* | **none** |
| 208: *the park's own paving rides over every bridge, none left in a tunnel* | **none** |
| 274: *every spur starts on the drawn centre line of the path it branches from* | **none** |
| 428: *no two stations stand in each other* | **none** |

The four **none** rows are known generator faults that no longer have a seed
exhibiting them. The invariants that catch them still run on all sixteen
seeds. The default seed moved from 20260728 to 5 (see `parkSeedPool.ts`).

---

## Recommendation (the proposal, 23 September)


**Ship the park's *decisions* as a small, versioned JSON file per seed — never
its geometry — solved in CI by a separate `build:parks` step, emitted into the
bundle by a Vite plugin, precached by the service worker, and hydrated on the
client in place of the searches.** On the canonical seed the plan searches
cost **7.8 s of CPU** on an M-series Mac (CI runners read ~2x that; a phone
will be worse), and the decisions they produce serialise to **~25 KB of JSON,
~10 KB brotli**. The built geometry of the same park is **49 MB raw, 5.1 MB
brotli** — 500 times larger, and tied to every renderer change. The client
keeps the solver as a fallback for any seed with no prebuilt file (a `?seed=`
off the pool, a dev server, a build whose parks are missing), so nothing that
works today stops working. A check proves on every build that a park hydrated
from its file is **byte-identical, by `park-digest`, to a fresh solve** — and
that the hydrated boot really did skip the searches, so it cannot pass by
quietly re-solving.

The first step is small: the three costly plan searches (cruiser, train,
slide) plus the layout go in the file; everything cheap stays client-side
until later steps move it.

---

## 1. What to precompute and ship

### What the client does today (canonical seed, measured)

`src/boot/parkSolve.ts` drives seven coarse builders (`src/world/parkPlan.ts:341`):
layout, cruiser, train, slide, crossings, pathGraph, road. Then the `World`
constructor runs a *second* `ParkSolve` — the world phase
(`src/world/worldPhase.ts:173`: stalls, fountain, walls, trees, bushes, fairy
lights, lamps, rail-race trestles) — and builds every mesh.

`LGP_SOLVE_COST_REPORT=1 pnpm run check:solve-cost`, M-series laptop, thread CPU:

| stage | CPU ms | pieces | notes |
|---|---:|---:|---|
| layout | 56 | 768 | plot placement |
| **cruiser** | **2975** | 771,062 | rail search + profile |
| **train** | **1266** | 302,918 | loop search |
| **slide** | **3428** | 3,008,025 | chute search |
| crossings | 11 | 101 | |
| pathGraph | 48 | 133 | streets, spurs |
| road | 0 | 0 | |
| **plan total** | **7782** | | 0 refusals, 0 unwinds on this seed |
| World constructor (headless) | 1619 wall | | of which world-phase solve ≈ 400 ms (walls 156, bushes 81, railRace 79, fairy 29, trees 25, lamps 25) |

`check:solve-cost` records CI's medians at 2.0–2.3x these
(`scripts/check-solve-cost.mts:129`). The canonical seed needed **zero**
retries or unwinds — so all 7.8 s is the attempt-0 searches themselves.
**Shipping only the ledger's attempt numbers would save nothing**; the file
has to carry what the searches *found*.

### Decisions, not geometry

Measured on the canonical seed:

| what | raw | gzip -9 | brotli 11 |
|---|---:|---:|---:|
| plan decisions (layout + cruiser + train + slide + crossings), JSON | **25.1 KB** | 11.1 KB | **9.9 KB** |
| built scene geometry (5846 meshes, 4379 unique geometries, 320 instanced; every attribute, index and instance matrix) | **49.0 MB** | 13.7 MB | **5.1 MB** |

Geometry is rejected on four grounds: it is 500x the size; it goes stale on
every renderer or art change, not just generator changes; colliders, walk
surfaces, nav grids and interact zones are built alongside the meshes, so
shipping meshes still needs the builders to run; and it is exactly what Jim
said not to make.

### What the file holds (format 1)

One owner: `src/world/prebuilt/parkFile.ts` holds the TypeScript type of the
file, its `PARK_FILE_FORMAT` number, and the one encoder/decoder pair.

```jsonc
{
  "format": 1,                 // PARK_FILE_FORMAT — bumped on any schema change
  "build": "<commit sha>",     // __APP_VERSION__ of the bundle it belongs to
  "seed": 20260728,
  "features": {
    "layout":   { "seed", "fountain", "entries": [ {id, x, z, footprint, boundingRadius, entranceX, entranceZ, signYaw} ] },
    "cruiser":  { "plan": <route>, "profile": { "points": [x,y,z,…], "length", "stationDistance", "castleSpan", "crestY" }, "exitX", "exitZ" },
    "train":    { "plan": <route> },
    "slide":    { "route": <route>, "points": [x,y,z,…], "exitX", … every PlannedSlide scalar },
  }
}
// <route> = { "closed", "segments": [[x0,z0,x1,z1,x2,z2,x3,z3,length,turn,kind], …], "report" }
```

The rule for what goes in: **the output of a search, never the output of a
derivation.** A route is its cubic segments (13 / 14 / 7 of them) — the
arc-length tables, samplers and `TrainRoute`'s 720-sample lookup are rebuilt
from them by the exact functions that build them after a fresh solve
(`buildRoute`, `new TrainRoute`, `new CoasterRoute(options, presolved)`), so
the hydrated and solved paths share every line after the search.

**Where the bytes are, and what could shrink them.** The cruiser's profile
curve (140 control points, ~7 KB raw) and the slide's chute points (80, ~4 KB)
are most of the file. Both are *derivations* of a route plus an RNG stream
position, so they could be regenerated by re-running `coasterProfileSearch`
(~10–20 ms) from one stored RNG state. Format 1 keeps them: 11 KB is not worth
a second code path whose only purpose is to be smaller, and storing them
means the client runs no search at all for the cruiser. Revisit if the file
ever matters.

Non-finite numbers and `-0` do not survive `JSON.stringify` (`Infinity` →
`null`, `-0` → `0`); the codec tags them, and the round-trip check below is
what proves nothing else is lost.

### What stays on the client after step 1

| stage | CPU ms (Mac) | why it stays for now |
|---|---:|---|
| crossings, pathGraph, road | ~60 | `pathGraphSearch` leaves side state in `paths.ts` (`pavedLatticeNodes`, `usedTaps`, …; `src/world/paths.ts:5849`) that the `World` reads; capturing it is step 3 |
| world phase | ~400 | its decisions live inside builders that also build meshes; step 4 |
| mesh + collider construction | ~1200 | this is building, not solving — it stays on the client for good |

So the plan's 7.8 s becomes ~60 ms. **Measured on the implementation**
(`scripts/park-file-probe.mts`, thread CPU, M-series): the hydrated plan costs
**61–118 ms** across all 26 seeds built (pool and 0..15), almost all of it
`pathGraph`; the `World` constructor is unchanged at ~1.6 s. In a headless
Chromium (SwiftShader), `/spawn?seed=20260728` had its plan decided **0.94 s**
after navigation; `/spawn?seed=3`, which has no file, took **24 s** to solve.

### Measured per seed (implementation, `pnpm run build:parks`)

Every row proven: hydrated digest equal to the fresh solve's, hydrate process
ran zero search pieces, perturbed-file control differs. Sizes are the file as
written; `vite build` reports gzip for the shipped copy within 0.1 KB of these.

| seed | raw | gzip -9 | brotli 11 | plan searched (CPU) | plan hydrated (CPU) |
|---:|---:|---:|---:|---:|---:|
| 20260728 | 24.0 KB | 10.6 KB | 9.5 KB | 8126 ms | 69 ms |
| 11 | 24.5 KB | 10.7 KB | 9.4 KB | 712 ms | 71 ms |
| 24 | 24.5 KB | 10.8 KB | 9.5 KB | 1745 ms | 100 ms |
| 128 | 21.0 KB | 9.2 KB | 8.1 KB | 1460 ms | 77 ms |
| 131 | 22.1 KB | 9.6 KB | 8.4 KB | 2620 ms | 70 ms |
| 208 | 29.8 KB | 13.5 KB | 11.8 KB | 2518 ms | 79 ms |
| 274 | 24.4 KB | 10.9 KB | 9.6 KB | 8041 ms | 75 ms |
| 326 | 24.3 KB | 10.8 KB | 9.5 KB | 8105 ms | 69 ms |
| 428 | 21.7 KB | 9.6 KB | 8.5 KB | 34596 ms | 81 ms |
| 451 | 33.1 KB | 14.8 KB | 12.9 KB | 676 ms | 109 ms |
| **pool total** | **249.5 KB** | **110.5 KB** | **97.2 KB** | | |

**As served** by the Cloudflare preview (`content-encoding: br`, measured with
`curl`): 9.0–14.1 KB brotli per park, **106.4 KB brotli / 115.4 KB gzip for
the whole pool** (249.8 KB identity).

Seeds 0..15 (`check:every-seed-builds`' sweep, `LGP_SEEDS=0,…,15`) total
**397.3 KB raw, 176.3 KB gzip, 155.6 KB brotli**, 21.4–29.1 KB each. The
searches there are where the real spread is: **seed 7 takes 217 s** of CPU to
solve on this Mac, seed 4 40 s, seed 3 26 s — each hydrates in under 0.1 s.

### A finding: parks already differ between machines, by an ulp

CI (Linux x64) and this Mac (arm64) solve the same seed to decisions that
differ in the last bits — seed 11's train and bridge sites by at most
**1.1e-13 m** over 102 numbers, seed 208's layout by 7e-15 m, seed 326 not at
all. Harmless in the park, but it moves the whole-park digest (vertices are
hashed at 1e-6, and a million vertices put some on a rounding edge): seed 326,
with byte-identical decisions, digests differently on the two machines. So a
digest is only ever compared on the machine that produced both sides — which
is what `build:parks` does — and never carried from one machine to another.
It also means that today every device builds a very slightly different park;
with prebuilt parks the *plan* is the CI machine's everywhere.

## 2. Which parks

Today (`src/world/parkSeedPool.ts`): `resolveParkSeed()` takes `LGP_SEED`,
then `?seed=`, then the seed this profile remembered (`lgp:parkSeed`), then a
fresh draw from `PARK_SEED_POOL` (10 seeds; `CANONICAL_PARK_SEED` =
20260728). Node with nothing pinned always gets the canonical seed.

- **Prebuild exactly `PARK_SEED_POOL`** — the one owner of "parks a child can
  be given". No second list. At ~10 KB brotli each the whole pool is ~100 KB,
  so all of it is precached. `check:every-seed-builds`' 0..15 are a test
  sweep, not parks a child gets; the build script accepts a seed list for
  measuring them.
- **An arbitrary `?seed=`** has no file and falls back to the client solve —
  the developer path, unchanged. The solver stays in the bundle.
- **Saves** reference a seed only through `lgp:parkSeed`; that does not
  change. A remembered seed that has since left the pool is already redrawn
  (`parkSeedFor`).

## 3. Determinism and versioning

- The file's `build` must equal the bundle's `__APP_VERSION__`, its `format`
  must equal `PARK_FILE_FORMAT`, and its `seed` must equal `PARK_SEED`; any
  mismatch discards the file and solves. **A stale park against a new bundle
  cannot be hydrated.**
- The file lives at `/parks/<seed>.json` inside the same `dist/` as the bundle,
  emitted in `generateBundle` so the PWA precache manifest (generated after)
  lists it. Precache and bundle are then one atomic unit: the waiting-worker /
  `UpdateGate` flow (`src/update-adoption.ts`) swaps them together. An old
  bundle fetching from the network after a deploy gets the *new* file, whose
  `build` does not match — rejected, solved. Correct, and never wrong.
- **Old saves** keep working: the file does not change which park a seed is.
  A save is a seed plus positions; the positions mean the same park as long
  as the generator is unchanged, which `LAYOUT_VERSION` already owns.
- **A bonus, not a goal:** today every device solves its own park, and V8,
  JavaScriptCore and SpiderMonkey do not promise bit-identical `Math.sin` /
  `Math.exp`. The pool is vetted in Node. A prebuilt park is *the* Node park,
  so an iPad child gets exactly the park that was vetted.

## 4. Build pipeline

- **`pnpm run build:parks`** (`scripts/build-parks.mts`) solves each pool
  seed in its own process (the seed is read once at import), writes
  `.parks/<seed>.json` with a `sourceHash` of the generator inputs (`src/**`,
  `package.json`, `pnpm-lock.yaml`), and verifies each file by hydrating it in
  a second process (section 5). Lanes in parallel.
- **`pnpm run build` stays `vite build`**, fast, and never solves. Its plugin
  (`prebuiltParksPlugin` in `vite.config.ts`) emits `.parks/*.json` into
  `dist/parks/`, stamping `build`. If `.parks/` is **missing** it emits none
  and says so (the client solves — correct, slower). If it is present but its
  `sourceHash` does not match the source being built, **the build fails**:
  shipping a park solved from other code is the one outcome that must be
  impossible. `LGP_REQUIRE_PARKS=1` (set in `deploy.yml` and
  `pr-preview.yml`) makes *missing* fail too, so production can never ship
  without them.
- **CI**: `deploy.yml` and `pr-preview.yml` run `build:parks` before `build`,
  cached with `actions/cache` keyed on the same inputs as `sourceHash`.
  Measured locally: the pool builds and verifies in **57 s** over four lanes
  (seed 428's 35 s solve is the long pole). At CI's ~2x that is ~2 minutes on
  a cache miss, zero on a hit (docs- or CI-only commits). Both well inside the 10- and 30-minute
  timeouts. Committed artefacts were rejected: they are a second copy of the
  generator's output kept in step by hand, which is this repo's most common
  bug.

## 5. Checks

- **`check:prebuilt-park`** (canonical seed; in the `check` chain): process A
  solves fresh, builds the headless park, takes the `park-digest`, writes the
  file; process B hydrates from the file, builds, takes the digest. They must
  match. Two controls every run: B's driver must report **zero pieces** for
  cruiser/train/slide (else it re-solved and the match proves nothing), and a
  process C hydrating a deliberately perturbed file (one plot moved 1 m) must
  produce a **different** digest (else the instrument is blind).
- **`build:parks` runs the A/B comparison for every seed it ships**, so every
  deployed file has been proven equal to a fresh solve by the same build.
- `check:park`, `test:procgen`, `check:every-seed-builds` keep measuring
  **fresh solves** — Node never reads a park file unless `LGP_PARK_FILE` names
  one — so the generator stays under test; the file is proven equal to it.

## 6. Loading UX

- ~10 KB brotli per park; the whole pool ~100 KB precached with the bundle
  (the bundle itself is several hundred KB), so on install it is free, and
  **offline play works with no solve at all**.
- One small blob, not streamed: at 10 KB there is nothing to stream.
- The fetch is started at launch and the plan task waits on it (a rung on
  `ParkGeneration`'s import ladder; an `await` before `loadGame()` on the
  deep-link / continued-save path). A fetch that fails or takes longer than
  **3 s** is abandoned for the client solve, so a bad network can never hang
  the boot. A seed with no file gets the app's own HTML page back with a 200
  (the service worker's `navigateFallback`, and `vite preview`, both do this);
  anything not served as JSON counts as "no file".
- What the child sees: the same cat-bus ride. It stops being a loading screen
  that is doing 8 s of work and becomes a ride with ~2 s of work behind it —
  the minimum ride length still holds. The continued-save path, which today
  pays the whole solve behind a static splash, gains the most.

## 7. Migration

Each step ships green on its own.

1. **Format 1 + hydration for layout, cruiser, train, slide** — the 7.7 s.
   `build:parks`, the plugin, the client fetch, `check:prebuilt-park`. The
   solver stays as fallback. *(Implemented on `feat/prebuilt-parks`.)*
2. **CI wiring**: `build:parks` + cache in `deploy.yml` / `pr-preview.yml`,
   `LGP_REQUIRE_PARKS=1`. *(Implemented with step 1.)*
3. **Crossings and pathGraph** into the file, once `paths.ts`'s side state
   is captured as data rather than left behind by the search.
4. **World phase decisions** (trees, bushes, walls, lamps, fairy poles, stall
   moves, trestles) into the file — splitting each builder's decision from its
   mesh-building. After this the client runs no search at all.
5. **Optionally**, drop the solver from the production bundle and refuse
   off-pool `?seed=` (Jim's call below).

### Risks and what is lost

- **Infinite variety** is already gone — a child gets one of the vetted pool.
  Prebuilding changes nothing there.
- **Per-player parks** likewise do not exist today.
- **Bundle/park skew** is the real risk, and it is closed by three separate
  locks: `build` stamp, `format` number, and the build failing on a
  `sourceHash` mismatch.
- **Hidden solver side effects** — state a search leaves in a module that the
  world later reads — would make a hydrated park differ. The digest check is
  what finds them; `paths.ts` is the known one and is why pathGraph waits for
  step 3.

## Decisions only Jim can make

1. ~~Keep the client solver for off-pool `?seed=`?~~ **Decided 24 Sep: no.**
   An off-pool seed is an error.
2. ~~Grow the pool?~~ **Decided 24 Sep: seeds 0..15, no others.**
3. **Open:** do the placement loops listed under "Still decided on the
   client" count as building, to be moved into the park file?
