# HANDOFF — The Library, integration branch (epic #714: #715-#719)

Branch `feat/library-714` (from `origin/main` d2cdb1f2), worktree
`.claude/worktrees/library-714`. Engineer, Claude Opus 5.5. This file is the integration
branch's own; every source branch's handoff is kept unchanged beside it
(`HANDOFF-library-art.md`, `-building.md`, `-shared.md`, `-books.md`).

**The one Library PR** (Jim's 13 Oct ruling: one PR for the whole Library) is a draft whose head
is a SEPARATE branch, `feat/library`. It moves only at a milestone, by a fast-forward push of
this branch: `git push origin feat/library-714:feat/library`. Every push to a PR head starts a CI
run that re-solves all 16 parks (30-45 min) and cancels the run before it, so work in progress
goes to `feat/library-714` (or a track branch) only. A push to `feat/library-714` runs no CI
(`ci.yml` runs on `pull_request`, on `push` to `main`, and by dispatch).

PR: see "Status" below.

## Status
- [x] Foundation merge (this file's first section). Heads merged, confirmed by `git fetch` at
      the start; none had moved from the task's list:
      art/library-715 **f54f21c0**, feat/library-building-716 **f981a57e**,
      feat/library-714-shared **d02843aa**, feat/library-books-717 **5a0cb5fd**.
- [x] Quick local checks, exit codes read from files (below). World-building checks are left
      to the PR's CI, as the task says.
- [x] Draft PR opened from `feat/library` at the foundation head (number under "PR").
- [ ] Next: tracks A (owl, Steps 5-6, `feat/library-714-owl`), B (kids, Steps 7-8,
      `feat/library-714-kids`), C (den, Steps 11-13, `feat/library-714-den`), each cut from the
      foundation head; then Step 9, Step 10's labels/tap spacing, Step 14 and the cross-part
      pieces here after the merges.

## The foundation merge (14 Oct)
All four with `--no-ff`, in the order the groundwork's merge-tree forecast measured as cleanest,
and every one with `git -c rerere.enabled=false merge ...`. (`.git/config` has
`rerere.enabled false` today, although CLAUDE.md says true; passing it on the command line makes
that certain either way.) **So no hunk was resolved by rerere**: each conflict below was
resolved by hand, and every hunk git's ordinary three-way merge resolved was read.

| merge commit | source | result |
|---|---|---|
| 0c21cdf3 | art/library-715 f54f21c0 | clean; tree == art's tree |
| ffdc8d9a | feat/library-building-716 f981a57e | clean (art is its ancestor); tree == building's tree |
| 8ad2336d | feat/library-714-shared d02843aa | clean; every file it changed == its blob, except check-deep-links.mts == building's (its only change, 4a39b06c, is the same patch as 69dfa5df, merged once) |
| 36b32b64 | feat/library-books-717 5a0cb5fd | 3 conflicts, below; 4 files auto-merged and read |

`pnpm exec tsc --noEmit` exit 0 after each of the four merges.

### Conflicts (books' merge) and how each was resolved
- **`src/state/types.ts`**, the tail of `CUTE_CATEGORIES`: both appended after `'keychain'`.
  Kept both, `'book'` then `'card'`, each with its own doc comment (the shared `/**` above the
  markers opens the book block; the card block got its own opener). `INVENTORY_KINDS`' `'card'`
  auto-merged. `dexEntries()` (books) counts catalogue, flowers, books and SECRETS only, so the
  card stays out of the dex total, as its doc says.
- **`src/main.ts`**, the `DeepLink` union and `parseDeepLink`: an add/add of two new kinds.
  Kept both: `library` (building's `/library?at=&facing=`) then `book` (books' `/book?id=`),
  and both parsers. Behaviour is independent of the order (disjoint paths).
- **`scripts/check-deep-links.mts`**, `/reptile-house?at=` (continueGame): main's race, fixed
  twice. Art 69dfa5df (carried by building and, as 4a39b06c, by the groundwork) waits for
  inside **and on the spot**; books 9083ecd4 waits for inside **and the change of space
  finished**, reads `isChanging` back and insists it is a real boolean. **Kept the
  combination**: the wait is for inside AND `spaces.isChanging === false` AND within
  `CASTLE_TOLERANCE` of the asked-for spot; the read after it asserts each (the `changing`
  vacuity guard and its own failure message from books, the position from both). No retry.
  Why both halves: on the spot proves the link moved her whenever its change began (books'
  half alone would pass vacuously if a poll landed before the change began); not changing
  proves the change is over. Building's `libraryCheck` entries wait the 69dfa5df way and were
  left as they are: `SpaceManager.changeTo` clears `changing` in the same synchronous iris
  callback that teleports her, so for a link that moves her, "on the spot" already implies "not
  changing". check-deep-links.mts is outside the park source closure.

### Auto-merged, read hunk by hunk
- `package.json`: books' `check:book-reader`, `check:served-book-reader` and shard 8's new
  step, beside art's and building's scripts. Proof below.
- `src/Game.ts`: books' reader (import, field, construction, `blocked`, interact claim, the two
  overlay guards, `dispose`, menu availability, the open-book input branch, `update`, `render`)
  on top of building's library spawn, door link and restore adoption, all present.
- `test/procgenShards.ts`: groundwork's `test/store/library-card.test.ts` (shard 6, before
  live-look) and books' `test/library/pageCurl.test.ts` (shard 6, at the end). Both present.
- `ASSET_MANIFEST.md`: books' paragraph on the reader's page textures beside art's kit row and
  section 41.

### Every file, audited against the branch that changed it
116 files are changed by one or more of the four branches (relative to main). **109 are
byte-identical to the blob of a branch that changed them.** The 7 that equal no single branch
are exactly the multi-branch files above: ASSET_MANIFEST.md, package.json,
check-deep-links.mts, Game.ts, main.ts, types.ts, procgenShards.ts. (The only files where art's
blob differs from building's, package.json and check-deep-links.mts, are among those 7: each is
building's plus books', read above.) Spot checks asked for by the task, by blob id:
- `HANDOFF-library-art.md` == art's == building's; `HANDOFF-library-building.md` == building's;
  `HANDOFF-library-shared.md` == groundwork's; `HANDOFF-library-books.md` == books'.
- `src/world/library/reader/*`: all 5 files identical to books' (`git ls-tree` diff empty).
- `src/art/models/libraryAssets.ts`, `src/art/models/libraryKit.ts`: identical to building's.

### The check chain: step sets parsed and compared (never grepped)
Instrument: `merge714/chains.mjs` in the orchestrator scratchpad. It parses `scripts` at
origin/main, at each of the four branch heads and in the merged tree; for every script holding
`&&` (25 chains, in any version) it builds the expected SET as main's steps plus each branch's
additions minus each branch's removals, and compares it with the merged chain, also checking
for duplicates and that main's steps keep their relative order; script names and every
non-chain value are compared too. Output on the merged tree (36b32b64), exit 0:
```
script names: base 165, merged 173, expected 173; missing [] extra []
OK  blend:library: base 0 steps, merged 3, expected set 3   (art and building: the same 3)
OK  check:shard-1: base 24 steps, merged 26, expected set 26
      origin/art/library-715 +[pnpm run check:library-glb | pnpm run check:png-integrity]
      origin/feat/library-building-716 +[pnpm run check:library-glb | pnpm run check:png-integrity]
OK  check:shard-4: base 14 steps, merged 15, expected set 15
      origin/feat/library-building-716 +[pnpm run check:library]
OK  check:shard-8: base 1 steps, merged 2, expected set 2
      origin/feat/library-books-717 +[pnpm run check:served-book-reader]
chains compared: 25; all equal as sets, base order kept
```
No branch removes a step or a script. Controls, run first on copies of the merged
package.json, both exit 1:
- a one-for-one swap in shard 4 (`check:library` -> `check:hall-solid-again`, same count):
  `BAD check:shard-4: base 14 steps, merged 15, expected set 15; MISSING [pnpm run check:library]; EXTRA [pnpm run check:hall-solid-again]`
- a drop in shard 1 (`check:png-integrity` removed):
  `BAD check:shard-1: base 24 steps, merged 25, expected set 26; MISSING [pnpm run check:png-integrity]`

The merged chains, parsed (`check` = shards 1-8 in order):
```
check:shard-1 (26): check:chain-coverage, check:pow-operator, check:node, check:text, check:flat-primitives, check:cycle-tdz, check:shop-spacing, check:stall-shape, check:gondola-sightline, check:hop-clearance, check:deck-fallthrough, tsc --noEmit, typecheck:test, check:brevity, check:assets, check:hat-fit, check:glasses-fit, check:hood-face, check:baked-face, check:character-parity, check:library-glb, check:png-integrity, check:hair, check:crowd, check:speech-bubbles, check:procgen-boundary
check:shard-2 (4): check:speech-bubbles:wide, check:ride-camera, check:slide-rider, check:pet-slide
check:shard-3 (14): check:orientation, check:sky-view, check:space-night, check:waypoints, check:seed-pool, check:seed-coverage, check:park, check:park-map, check:hud-during-rides, check:jitter, check:castle, check:castle-towers, check:benches, check:castle-floors
check:shard-4 (15): check:hall-solid, check:hotel, check:reptile-house, check:library, check:labels, check:exhibit-camera, check:tap-spacing, check:look-around, check:nav-routes, check:path-preference, check:rail-race, check:cart-shape, check:tie-frame, check:cruiser-solves, check:cruiser-turn-radius
check:shard-5 (8): check:cruiser-clearance, check:castle-window, check:backpack-peek, check:statue-occlusion, check:keyring-hang, check:keyring-view, check:wall-tunnelling, check:served-deep-links
check:shard-6 (4): check:climb-wave, check:cat-bus, check:prebuilt-park, check:client-no-solver
check:shard-7 (6): check:cat-bus-suspension, check:bus-journey, check:ground-claims, check:layout-rung, check:stall-accommodate, check:arrival-camera
check:shard-8 (2): check:served-walking, check:served-book-reader
```

### Quick local checks at 36b32b64 (logs: `merge714/q-*.log` in the orchestrator scratchpad)
| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | control first: a deliberate `const broken: number = 'not a number'` in a scratch src file gave exit 2, TS2322; removed, exit 0 |
| `pnpm run typecheck:test` | 0 | |
| `pnpm run check:library-glb` | 0 | 449528 bytes; 65 nodes; 3 faced heads; LIBRARY_FACES == the file's extras; both readers agree on 65 nodes |
| `pnpm run check:png-integrity` | 0 | 249 committed PNGs, 229.1 MB read, every one complete |
| `pnpm run check:chain-coverage` | 0 | 101 check:* scripts (93 leaves, 8 aggregate); "check" is 8 shards holding 79 distinct steps |
| `pnpm run check:seed-coverage` | 0 | every one of the 16 parks is built by a merge-blocking check |
| `pnpm exec vitest run test/store/library-card.test.ts` | 0 | Test Files 1 passed (1); Tests 4 passed (4); none skipped |
| `LGP_PARK_RESTART=3 pnpm run check:brevity` | 0 | 285 pieces of copy are short enough; 6 still carry a recorded exception (books alone said 283; building's sign title and subtitle are the other 2) |
| `pnpm run build` | 0 | 478 modules; "prebuilt parks: shipping none — no .parks/manifest.json" (expected locally; CI builds them) |

**Why `LGP_PARK_RESTART=3` on check:brevity.** It imports `world/anchors.ts` ->
`parkLayout.ts` -> `parkManifest.ts`, whose `PARK_RESTART` is read at module load; in Node the
resolver (`scripts/ts-extension-resolver-register.mjs` -> `acceptedRestartSync`) runs the
acceptance loop on a hash miss (seed 5 is about 20 minutes), and this tree's hash is new. The
override skips the resolver; brevity reads authored strings, so the restart cannot change what
it measures (it solved seed 5 restart 3's layout, 76 s). Same trick as the groundwork's
`LGP_PARK_RESTART=3` scratch runs.

### Not run locally (left to the PR's CI, by the task)
`pnpm run check` (the World-building shards, incl. check:library, check:served-deep-links and
check:served-book-reader), `pnpm run test:procgen`, coplanar, swept bus. No `.parks` exists for
this tree: its park source hash is new (below), so any World-building check would first run
acceptance loops. No CI was dispatched by hand: the PR's own run is the gate.

**Park source hash at 36b32b64: `6b86bf43c3a69cecf3deee1b43453c4e0a17af20c9098db54159bf47fe4034b0`**
(`parkSourceHash`, 494 closure files). CI's parks artifact for this tree will be named
`parks-6b86bf43...`; download it into `.parks` (verify with `scripts/verify-parks.mts`) to run
World-building checks locally at this source without solving. Any closure edit makes a new
hash. Outside the closure (measured): check-deep-links.mts, main.ts, Game.ts,
reader/BookReader.ts. Inside: state/types.ts, library/Library.ts, art/models/libraryAssets.ts.

## Decisions (made here, with reasons)
- **The deep-links race: the combination of both fixes** (above). The task asked for the
  version that removes the root cause, waiting for the change of space to finish and for her to
  be on the spot; each fix alone covers one half.
- **rerere off on every merge.** CLAUDE.md records rerere replaying a stale resolution
  silently; resolving by hand and reading every auto-merged hunk is cheaper than auditing a
  replay.
- **The PR body names each issue with its own keyword** (`Closes #714, closes #715, ...`):
  GitHub links only the first issue in the bare comma form ("Closes #714, #715"), so the
  literal line would have closed #714 alone on merge.

## For the join (and the tracks)
- The plan's SIT red must rotate BOTH legs (`HANDOFF-library-shared.md`, Decisions:
  seatedErrors' one-foot blind spot).
- `/library` is already a parsed `DeepLink` kind (building), so the plan's Step 4 extends
  `parseLibraryLink` (`story=now`) rather than creating it; `/library-door` is a
  `RIDE_DEEP_LINKS` entry. The plan's `/library-den` goes in that table too.
- New deep-link cases go through building's `libraryCheck` in check-deep-links.mts (it waits
  for inside and on the spot).
- A Node script that imports the park (anything reaching `parkManifest.ts`) runs the acceptance
  loop on a hash miss: hydrate `.parks` from CI's artifact for the exact hash, or pin
  `LGP_PARK_RESTART` for scripts whose result cannot depend on the park.
