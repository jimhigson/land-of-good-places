# HANDOFF — the six chapter books, as-is, stacked on part 4 (#733)

## PAUSED 23 Oct 22:00 — how to pick this up

Jim paused all work at 22:00 ("get all agents to write detailed handover so can be picked up later");
the Mac was at load 50–127 and every check crawled. Nothing is running for this track: every process
of mine was stopped by PID, and no dev server, browser or solve is left. **Nothing is lost**: every
commit is pushed. **No `feat/chapter-books-main` branch or `.claude/worktrees/chapter-books-main`
worktree was ever created** (the Overseer's books-onto-main plan arrived and was paused before step 2).

### Where everything stands

| what | where |
|---|---|
| this branch | `feat/library-chapter-books` @ the commit that adds this section (on top of 43069bf5), pushed; worktree `.claude/worktrees/library-chapter-books`, clean |
| PR | **#734** "The Library: six chapter books for a big reader" — head `feat/library-chapter-books-pr` @ **e03200d5**, base `feat/library-v2-pr` @ 66549d88 (#733's head, which part 4 has not moved since); **open**. Its body (`.claude/library-build-scratch/chapter-books/pr-body.md`, applied with `gh pr edit 734 --body-file …`) still describes 83b72db; the round-2 version (the shelf fix section, the shelf walk to try) is written in that file but **not yet applied** |
| part 4 (#733) | `origin/feat/library-v2` @ 4a72c49b when paused — **already inside e03200d5** (merged 4 times this round, each `-c rerere.enabled=false`, step sets proved). Part 4 failed browser QA round 1; its fixer was mid-change (check-library.mts, Collision.ts uncommitted in `.claude/worktrees/library-v2` — never write there) |
| reviews | review round 1 of #734: **approved**. Review round 2 and QA round 2: **stopped unfinished** at the pause |

### CI on e03200d5 — RED, on part 4's clause, not on the books

Run **39995947413**: 89 jobs — **86 success, Deploy skipped, `Checks shard 4` failed**, so the
required **`Checks` is red**; **`Procgen invariants` is green**; Update adoption **39995947169** green.
Shard 4 (job 120589029762) stops in `check:library` on ONE clause, part 4's **RECOMMEND "found from
the desk"** (added by part 4's a79c265f, the glowing book's beacon): *"over 180 frames at the desk's
front, a sparkle of its glow stood in the open over the top of 'north-8' (3.20 m) … on 0 (0
sparkle-frames; 0 hidden by the room; the lowest at — m) — 80% wanted"*. Locally, identical:
`runs/final-park/check:library.log` exit 1, 257 ✓ 1 ✗ (every other clause green — SHELF WALK, NEVER
INSIDE HER and the rest).

**Diagnosis (measured, `beacon/beacon-from-desk.mts`, log `beacon/run-1.log`):**
- **The clause does not hard-code north-8.** It measures the case of the book the owl actually
  recommends (`recommendFor` → `library.shelfBooks.find(first.id).slot.bookcase`). On this tree the
  owl recommends **catBusDay**, which stands on north-8.
- **Why the pick changed:** `recommendation.ts`'s `RECOMMENDATION_ORDER` is a seeded Fisher–Yates
  shuffle of *all* of `BOOKS` (`LIBRARY_RECOMMEND_SEED` 0x0b00c9), so six more books reshuffle it.
  With the 18 books: **catBusDay → goodnightPark → biscuitStorm\* → detectiveBiscuit\* →
  loudestShush\* → giantFootprints\*** → bookDragon → keychainStall → catchThatChicken\* → fireflies →
  duckBars → sirHopsalot\* → trillaHigh → fountainWish → biscuitBreakfast → bigParade → ripikaBalloon →
  foreverSlide (\* chapter book). **The owl's first pick is a picture book (catBusDay), her second too
  (goodnightPark); picks 3–6 are chapter books** — Jim may want her to steer a six-year-old to picture
  books first; nothing was changed. On part 4's twelve picture books the same shuffle gives
  fountainWish → fireflies → catBusDay → goodnightPark → trillaHigh → keychainStall → …
- **The beacon really is hidden from the desk — for 15 of 18 books.** Every book made the glowing
  book in turn, RECOMMEND's exact question asked from the desk's front (1280×720, 180 frames): only
  **fountainWish, keychainStall and goodnightPark pass (100%)**; trillaHigh 14%; the other 14 score 0
  — their sparkles are **off the screen** (e.g. 0.6 m over north-8's top projects to (1522, 137);
  west-4's chapter books to x 58–153, y −78…−124), never hidden by the room. So part 4's clause passes
  on part 4's own tree only because its first pick is fountainWish; part 4's own third pick
  (catBusDay) fails it too. **It is a defect in part 4's beacon promise ("seen across the room …
  from the desk"), which the books' reshuffle exposed**: the owl's recommendation is unfindable from
  the desk for most books, a real problem for a child. For part 4 to fix (a beacon the screen shows
  wherever the book is, or a recommendation she can find, or a clause that asks "from the book's
  aisle"); this PR changes none of it. If the books go onto main without part 4 (below), this clause
  is not there; when part 4 later meets the books, it goes red again unless part 4 has fixed it.

### The shelf blocker (QA round 2 on 83b72db) and its fix — done, pushed, green

QA: walking along the big readers' shelf (six books 0.6 m apart on west-4) and pressing **Read it!**
opened the book of the stand just left, at every stand 2–6; also link after link on one profile.
- **3b461529 `src/world/Selection.ts`** — two general rules. (1) The proximity hysteresis band is
  `min(0.6 m, 0.5 × the gap between the two zones' stands)` (`hysteresisBand`, `HYSTERESIS_SHARE`):
  the old fixed 0.6 m never let go between zones ≤ 0.6 m apart (on the rival's own stand it is
  exactly the gap nearer, never *more*); the middle half of a gap stays anti-flicker; pairs ≥ 1.2 m
  apart unchanged. (2) A tapped pick survives until the proximity pick CHANGES (`tapBaseline`,
  `tapOutlives`) — it used to be dropped whenever proximity held anything else, so a tap on a
  neighbouring book snapped back. Hover unchanged. Outside the park closure.
- **4d0dd06f `check:library` SHELF WALK** (header item 17): the real child, a real `Selection` wired as
  `Game` wires it, E through the `InputSystem`'s keydown listener → `InteractRouter`; 21 arrivals
  (north, south, from the aisle, link after link), 10 taps on a neighbour's book, a sway midway.
  Mutations `fixed-hysteresis`, `no-hysteresis`, `tap-loses`. **Reds**: pre-fix Selection → exit 1,
  223 ✓ 22 ✗ (11/21 arrivals, 0/10 taps); `fixed-hysteresis` 234 ✓ 11 ✗; `no-hysteresis` 244 ✓ 1 ✗ (the
  sway changed 8 times); `tap-loses` 234 ✓ 11 ✗. Geometry: seed 5 restart 1, room at (−600, −600),
  west-4 stands (−16.10, 5.50 … 2.50) every 0.60 m, facing 270, stand radius 3 m.
- **0e0f9da7 `check:tap-spacing` rule 3**: every space, every pair of equal-rank selectable zones
  within reach: the real `Selection` stood on one stand, then at 9 points within 5 cm of the other's —
  the first must let go. Green: 62 pairs, 558 probes, 0 failing. **Red** on the pre-fix Selection:
  exit 1, 10 problems — exactly the shelf's 10 neighbouring pairs. Rule 2's 12 "harmless" finger
  warnings are a different thing (pick areas within 1.13 m) and stay warnings.
- **Proved on the deployed preview too**: `look/preview-walk.mjs` (one page, F3 readout, arrow keys,
  E, Escape; the opened book named by its cover colour, `look/identify-books.py`) — **control on the
  old preview pr-734-83b72db: 1 of 11 presses right** (all 22 frames opened by eye). It was never run
  on a fixed preview: e03200d5's preview exists but CI was red, then the pause. Next: run it on the
  newest preview host, expect 11 of 11, open every frame.
- Checks with the fix: full `pnpm run check` exit 0 (2467 s, all 88 leaves), `test:procgen` exit 0
  (48 files, 2167 tests, 0 skipped) — both on the fix before part 4's QA-1 merges; on later trees the
  targeted checks (see Round 2 log) all green except the beacon clause.

### Jim's rulings that bind this

1. 23 Oct: **"let's just merge those books as-is now"** — Trilla's hidden eyes (*Shush*, *Chicken*) and
   Grandpa Tock's buried face (*Footprints* p6–p8) stay; no face fixes, nothing new.
2. 23 Oct 22:00, on the books waiting for part 4: **"isn't adding more books quite simple using
   existing book structures, shelves, etc?"** — the Overseer read it as: the books go onto main on
   their own, independent of part 4. **That is the plan to resume** (below), unless Jim says otherwise.

### The alternative plan — the six books straight onto main, without part 4

Facts it rests on (all measured with git): the track-D base `origin/feat/library-714-books2` @
d32a205a was cut from the foundation 5d524193, **which is on main**; `origin/art/story-props` @
d431a47d is main (merge base 7ce1deae, in #722) + 9 kit commits; main's `check-library.mts` already has
the WITH A REAL CHILD harness (d6486af8) SHELF WALK runs on. The file-by-file inventory of everything
this branch differs from main in, by which side touched it (`git log --full-history` per file
against the books' and part 4/5's commit sets), is
**`.claude/library-build-scratch/chapter-books/inventory.tsv`** (class, books-commits, part-4/5-commits,
file, first part-4/5 commits):
- **BOOKS — take wholesale from this branch (90 files):** `src/world/library/chapterBooks/*` (7),
  `docs/library-build/chapter-books/final.json`, `src/world/library/bookKinds.ts`, `books.ts`,
  `readBooks.ts`, `reader/BookReader.ts`, `reader/pageFaces.ts`, `reader/pageGeometry.ts`,
  `reader/readerAssets.ts`, `reader/readerWords.ts`, `reader/storyProps.ts`, `src/art/assets/storyProps.glb`,
  `storyPropsGlb.ts`, `src/art/models/shopItems.ts`, `src/ui/CuteODex.ts`, `src/style.css`,
  **`src/world/Selection.ts`**, `scripts/check-copy-brevity.mts`, `check-asset-contract.mts`,
  `check-library-glb.mts`, `check-story-props-glb.mts`, `lib/check-glb-kit.mts`,
  `pack-story-props-asset.mts`, `art/blend/{blendkit.py, hotel_render.py, story_props.blend,
  story_props_{build,export,render}.py}`, `art/renders/story-props/*` (45), `ASSET_MANIFEST.md`,
  `GAME_DESIGN.md`, **`package.json`** (adds `check:story-props-glb` to shard-1 after
  `check:library-glb`, plus `pack:/blend:/render:story-props` — re-prove by parsing),
  `test/library/big-reader.test.ts`, `test/procgenShards.ts`, and the books' handoffs.
- **SHARED — take ONLY the books' hunks (12 files):** `scripts/check-library.mts` (track D's READABLE
  kind clauses + a80be87c's `CHAPTER_BOOKS.length === chapterSlots` + SHELF WALK and its 3 mutations;
  NOT the owl/card/recommend/shush/sit/kids/story/never-inside-her/den clauses),
  `scripts/check-book-reader.mts` (chapter pages, 9/9b model sheet, section 8 `LAST` fix; NOT part 4's
  item 11 / cbe0b608, 9a2fe385), `scripts/check-tap-spacing.mts` (rule 3; main lacks part 4's per-space
  stderr lines (56ba141a) — keep rule 3's summary line, drop its per-space addition),
  `src/main.ts` (track D's `/book` chapter-book hunk; NOT `/library?story=now`, 93a07cb7),
  `src/state/secrets.ts` (the Big reader secret; NOT Story listener 1adbe142 nor the conditional
  listing 745cb651 — with six books it is always listed), `src/world/library/Library.ts` (track D's
  2-line change only), `furnish.ts` (the `PlacedBook`/`shelveFace`/`bookInstances` exports + track D's
  line; NOT `pieceToRoom`, 93a07cb7), `layout.ts` (the big readers' shelf: six chapter slots on west-4,
  stands as keep-outs, bb1fab30/93c01cf5; NOT den/cushions/owl/kids), `props.ts` (track D's 4 lines),
  `shelfBooks.ts` (track D's kind pairing; NOT the API adaptation's `WAITING_SLOTS`, 81ef26e5 — with
  all six books in, equality holds), `reader/pagePictures.ts` (the books' file; part 4's f19cd1fc was
  the identical flat-ok line), `test/library/chapter-books.test.ts` (cases 1–4; NOT part 4's case 5).
- **PART45 — leave out (30 files):** owl/kids/den/story time/cushions/labels scene 5:
  `LibraryOwl.ts`, `LibraryKids.ts`, `libraryKidDriver.ts`, `recommendation.ts`, `storyTime.ts`,
  `shell.ts`, `World.ts`, `Collision.ts`, `Game.ts`, `SpeechBubble.ts`, `InventoryDrawer.ts`,
  `spritePuffs.ts`, `libraryAssets.ts`, `NpcCharacter.ts`, `residentLooks.ts`, `waypointDriver.ts`,
  `ridePose.ts`, `HotelGuests.ts`, `seatedPose.mts`, `check-labels.mts`, `check-deep-links.mts`,
  `test/procgen/parkFacts.ts`, `docs/design/LABELS.md`, part 4/5's handoffs.

Steps: (1) `git worktree add .claude/worktrees/chapter-books-main -b feat/chapter-books-main
origin/main`, `pnpm install --frozen-lockfile`, `git push -u origin feat/chapter-books-main`, a short
`HANDOFF-chapter-books-main.md`. (2) `git checkout origin/feat/library-chapter-books -- <BOOKS files>`
(the list above / inventory.tsv). (3) Port each SHARED file's books' hunks onto main's version by
hand — main has the engine (#722), so match main's current API (numeric tops, `props.box`), never
paste part 4's. (4) tsc, typecheck:test, brevity, story-props-glb, library-glb, assets,
flat-primitives, cycle-tdz, vitests locally; package.json step sets by parsing. (5) New PR, base
main, title "The Library: six chapter books for a big reader", body says it replaces #734 (reuse
`pr-body.md`, minus the part-4 merges and the beacon); close #734 with a pointer. (6) Park-dependent
checks (check:library, book-reader, tap-spacing) with CI's `parks-<hash>` artifact once CI has
solved it — **do not solve locally while the Mac is loaded**. (7) Every CI job green, then the shelf
walk on the newest preview (`look/preview-walk.mjs <host> <dir>`, expect 11 of 11) and one book read
at each size; report PR, head, CI, preview host.

### Where things are (`.claude/library-build-scratch/chapter-books/`)

- `runs/<tag>/<check>.log` (each ends `exit=N seconds=S`): round 1 `static1`, `park1`, `served1`,
  `vitest2`, `full/` (round 1's full check and test:procgen); round 2 `r2-*` (the fix: `r2-fix*`,
  reds `r2-red-nofix`, `r2-tap-red-nofix2`, mutations `r2-mut-*`, `r2-wide`, `r2-served-*`, `r2-full/`
  = the full check + test:procgen on the fix), `r2m-*` (after part 4's QA-1 merge), `final-park/`
  (e03200d5: library red on the beacon clause; check:exits was killed by me at the pause — no failure
  line, unmeasured there; green on a9729328).
- parks: `runs/parks/build-parks-*.log`; the worktree's `.parks/` holds **CI's 16 parks for
  2b2fe559** (= e03200d5's tree; `ci-parks-2b2fe559fb90/` is the download), older sets in
  `.parks/r1-53dde20f/`, `.parks/all16/`, `.parks/seed5-only/`. `parks-fresh.sh` says FRESH/STALE.
- the look: `look/shots/` (139 frames, round 1), `look/NOTES.txt`, `look/recheck/` (the chip-press
  ghost), `look/preview-local/`, `look/preview-83b72db/`, `look/walk-83b72db/` (the control walk, 22
  frames), `look/look.mjs`, `look/preview.mjs`, `look/preview-walk.mjs`, `look/identify-books.py`.
- QA's evidence: `.claude/library-build-scratch/l734qa/` (comment.md, sheet-walk1.png, …).
- the beacon diagnosis: `beacon/beacon-from-desk.mts`, `beacon/run-1.log`.
- scripts: `run-checks.sh`, `merge-scripts-proof.mjs` (parsed step sets; `merge-scripts-proof-*.log`).
- QA minor not acted on (as-is): *Duck, Sir Hopsalot!* (122,187,220) and *Biscuit and the Storm*
  (114,165,208) covers are close blues in the reader.

---

Engineer, Claude Opus 5.5, 23 Oct 2026. Branch `feat/library-chapter-books` (worktree
`.claude/worktrees/library-chapter-books`), cut from `origin/feat/library-v2` @ 9a269a31.
PR head `feat/library-chapter-books-pr` (fast-forward pushes only), base `feat/library-v2-pr` (#733's head).
Scratch: `.claude/library-build-scratch/chapter-books/` (logs `runs/<tag>/<check>.log`, each ending `exit=N`).

**The ask (Jim, 23 Oct):** "let's just merge those books as-is now". As-is: the books exactly as
`origin/feat/library-v2-books` @ 9325e0f7 has them — **no face fixes** (Trilla's hidden eyes in *The
Loudest Shush* and *Catch That Chicken!*, Grandpa Tock's buried face on *The Giant Footprints* p6–p8
are known and accepted), **nothing new**. Only what the merge needs to be correct and green.

Never push to `feat/library-v2` or `feat/library-v2-pr` (the part-4 pipeline owns them).

## ROUND 2 (23 Oct, ~16:30) — QA blocker: "Read it!" at the big readers' shelf opens the PREVIOUS book

QA (`.claude/library-build-scratch/l734qa/comment.md`, `sheet-walk1.png`, `sheet-laptop-titles.png`):
walking north along west-4's stands (0.6 m apart) and pressing E opens the book of the stand before,
at every stand 2–6; the same with the six `/library?at=` links opened one after another on one
profile. Cause per QA: book zones have no stand radius (DEFAULT_STAND_RADIUS 3 m), and
`Selection.pickNearby` keeps the held zone unless a rival is MORE than HYSTERESIS_MARGIN (0.6 m)
nearer. My look missed it: every book was opened on a fresh profile with nothing held.

Overseer's ask: fix the RULE (hysteresis must never hold the previous zone once she is on another
zone's own stand; keep the anti-flicker midway between two zones; a tap on a book opens that book);
a check that walks the shelf both ways in ONE session pressing the interact key at each stand, proved
red without the fix (geometry pasted); if tap-spacing's warnings describe this, make them a failure
that can go red; run library/tap-spacing/labels/exits + every Selection-driving check, full `check`,
`test:procgen`; push, fast-forward the PR head, every CI job green, walk the shelf on the NEWEST preview
on one page. As-is still holds for everything else.

Progress (this round): see "Round 2 log" at the end.

## Status

- [x] worktree cut from origin/feat/library-v2 @ 9a269a31, pnpm 12.1.0 / node 26.5.0, branch pushed
- [x] merge `origin/feat/library-v2-books` @ 9325e0f7 (rerere off) → **4333fc84**
- [x] package.json step-set proof (parsed) — PROOF OK, control red
- [x] part 4 moved (66549d88, LABELS.md + its handoff, docs only): merged → **16ee9be8**; park hash
      unchanged 53dde20f…; step-set proof re-run, PROOF OK
- [x] parks: the honest seed-5 solve of this tree (below); `chapter-books/parks-fresh.sh` says
      FRESH/STALE before every World-building check
- [x] 16-seed solve for `test:procgen`: `LGP_PARKS_OUT=.parks/all16 LGP_LANES=3 LGP_RESTART_LANES=2
      pnpm run build:parks` at hash 53dde20f… → **exit 0, 4663 s, "16 park(s) proven"**; restarts
      `0:3 1:1 2:3 3:7 4:1 5:1 6:1 7:5 8:1 9:0 10:9 11:4 12:0 13:6 14:8 15:4` — **identical to #733's
      CI** (run 39953269843, `merge-parks` at source c7182d44): the books change no park's acceptance on
      any seed. Seed 5's digest 9c7a86e2b266ca08 again (the separate seed-5 solve's: deterministic).
      Swapped into `.parks/` (the seed-5-only set kept at `.parks/seed5-only/`); parks-fresh: FRESH,
      16 seeds
- [x] targeted local checks (table below), all exit 0
- [x] full `pnpm run check` (seed 5): exit 0, 2708 s
- [x] **`pnpm run test:procgen`** on the 16 honest parks: **exit 0, 315 s, "Test Files 48 passed (48)",
      "Tests 2167 passed (2167)"**, 0 skipped; its stderr notes are the standing park-wide ones ("the
      park gate arch invariant asserts nothing about whether a child can walk through the gateway"
      ×16, etc.), none the library's
- [x] CI's own park jobs, locally on the 16 honest parks (`runs/ci-extra/`): `check:coplanar` exit 0
      (72 s: "186 same-facing coplanar seam(s) across 16 seed(s) and 10 space(s) … All of them are in
      the baseline; none is new" — the six books on the shelf add no seam); `check:walk-reach` exit 0
      ("walk reach OK"); `check:swept-bus` exit 0 (17 seeds, both controls held); `check:entrance-road`
      exit 0 (16 pool seeds, tightest 5.68 m, seed 9)
- [x] PR held until #733's CI run 39953269843 was down to its last job (its parks stage had 28
      runners going; the account runs ~40 jobs at once), then opened
- [x] the look (six chapter books at 1280x800 and 390x844; a picture book; the owl's desk) — below
- [x] **PR #734** opened, stacked on #733: head `feat/library-chapter-books-pr` (fast-forward pushes
      only: `git push origin feat/library-chapter-books:feat/library-chapter-books-pr`), base
      `feat/library-v2-pr`; body from `chapter-books/pr-body.md` (`gh pr edit 734 --body-file …`);
      first CI run 39964056493 (+ Update adoption 39964056536) on d063e876
- [x] part 4 moved again (2c9c1fca, its handoff only: CI round 1 green on 66549d88): merged with rerere
      off, park hash unchanged 53dde20f…, step-set proof PROOF OK (`merge-scripts-proof-final.log`)
- [x] the PR head fast-forwarded d063e876..**83b72db8** once run 39964056493's Parks job had saved the
      parks cache for 53dde20f… (CI's `merge-parks`: restarts `0:3 1:1 2:3 3:7 4:1 5:1 6:1 7:5 8:1 9:0
      10:9 11:4 12:0 13:6 14:8 15:4`, exactly the local solve's). **CI 39972640138 on 83b72db8: completed
      success** — 31 jobs, 25 success, 6 skipped (five Parks jobs on the cache hit, Deploy as on every
      PR); required **Checks: SUCCESS**, **Procgen invariants: SUCCESS**; **Update adoption
      39972639958: success**. (The superseded run 39964056493 on d063e876 was cancelled by the push —
      the concurrency group — not red.)
- [x] preview: the newest "Deploy PR preview" comment names **83b72db** —
      `https://pr-734-83b72db-land-of-good-places.blockstack.workers.dev`; its `/version.txt` is
      a830e4ab = `refs/pull/734/merge` (parents 66549d88 and 83b72db8), whose tree is byte-identical to
      83b72db8's. `look/preview.mjs` on it: `/book?id=sirHopsalot` and `/library?at=-16.1,5.5&facing=270`
      both HTTP 200, the reader opened (the shelf by its real "Read it!" chip), no page error, at 1280x800
      and 390x844; all 10 frames opened (`look/preview-83b72db/`). Both links, each with its "you will
      see" sentence, are in the PR body's "What to look at".
- Overseer, 23 Oct ~16:15: **keep #734's head at 83b72db8** (a reviewer and QA work against it; Jim
  merges once CI is green) — only a red check's fix moves it; no fast-forward for docs-only commits
  (this handoff's later commits stay on `feat/library-chapter-books`), and docs-only commits on
  `feat/library-v2` are not chased. Part 4 at the report: 2c9c1fca, inside 83b72db8; #733 still open.

## The merge (4333fc84)

`git -c rerere.enabled=false merge --no-ff origin/feat/library-v2-books` into 9a269a31. Two merge
bases (criss-cross): 33bcc361 (where the books were cut) and the engine's 7ce1deae (which reached the
books through `art/story-props` and part 4 through the round-four engine merge); ort merged them.
The books add 40 commits over feat/library-v2.

- **One conflict, `src/entities/Player.ts`** (the hover rescue), exactly as both handoffs named it:
  took the engine's side whole (its `altitudeAt` comparison and comment — identical to main's
  Player.ts) and dropped the books' `// flat-ok: the same body a moment later …` line, which excused
  a `p.y − hoverAt.y` that no longer exists. That comment was the books' only Player.ts change
  (`git diff 7ce1deae origin/feat/library-v2-books -- src/entities/Player.ts`: one added line).
  check:flat-primitives after: exit 0, 109 flat-ok sites, "no new flat primitives, and no stale
  baseline entries".
- **Auto-merged, both sides verified present:** `check-library.mts` = part 4's file + exactly the
  books' a80be87c READABLE hunk (`CHAPTER_BOOKS.length === chapterSlots.length`, the WAIT note and
  the null "waiting" pairing gone); `furnish.ts` = part 4's `pieceToRoom` + the books' exported
  `PlacedBook`/`shelveFace`/`bookInstances`; `pagePictures.ts` = the books' file exactly (both
  sides carried the identical `strapJetpack` flat-ok line, so it is in once).
- **Every other path** differing between the parents is one side's file exactly: 39 part 4's, 81 the
  books', and `reader/pictureProps.ts` deleted (the books' cece064a). The four files the books
  changed since 33bcc361 but the merge took from part 4 (`check-solids.mts`, `trace-npc-driver.mts`,
  `NpcSystem.ts`, `Player.ts`) are the engine's at 7ce1deae on the books side, and main's newer
  engine on ours — nothing of the books' lost.
- `shelfBooks.ts` and `check-book-reader.mts`: part 4 never touched them since 33bcc361, so the
  books' copies (WAITING_SLOTS empty; items 1–10 with the section-8 `LAST` fix) are the result.
- The integration review's join condition: `git grep -w "pictureProps|buildPictureProp|PropPart|PropShape"`
  over `src/world/library` and `check-book-reader.mts` → nothing (the remaining `PropPart` hits in
  the repo are main's measured-top type in Toilets/hotel/measuredTop, unrelated).

**package.json proof** (`chapter-books/merge-scripts-proof.mjs <wt> HEAD^1 HEAD^2 HEAD`, parses all
three `scripts` objects): exit 0, **PROOF OK**. HEAD^1 179 names, HEAD^2 183, result 183 = the
union; nothing missing, nothing invented; 26 chains, each result step set **exactly the union** of
its parents' sets — `check:shard-1` 26 / 27 → 27 (+`check:story-props-glb`, after
`check:library-glb`), `blend:story-props` new (3), the other 24 equal (`check` 9, shards 2–7 and 9,
`check:all` 6, `check:crowd` 5, the `blend:*` chains). `check:shard-8` (one step) equals both
parents' text. **Control** (the pre-merge HEAD as the "result"): exit 1, `5 PROBLEM(S)` —
`LOST [check:story-props-glb]` in `check:shard-1` and the four story-props names missing.

## Checks (exit codes read; counts off the screen; logs `chapter-books/runs/<tag>/`)

| check | exit | off the screen |
|---|---|---|
| `tsc --noEmit` | 0 | 1166 files, 233478 lines (all 7 `chapterBooks/` files among them) |
| `typecheck:test` | 0 | |
| `check:story-props-glb` | 0 | 61 nodes, both readers agree; "ships as built" |
| `check:library-glb` | 0 | 65 nodes, both readers agree |
| `check:assets` | 0 | 167 assets check out, 28 still carry recorded drift |
| `check:flat-primitives` | 0 | 109 flat-ok sites, "no new flat primitives, and no stale baseline entries" |
| vitest `test/library` + `test/store/library-card` | 0 | 4 files, 21 passed, 0 skipped (pageCurl 4, big-reader 8, chapter-books 5, card 4) |
| vitest `test/library test/store` (as the books' join ran it) | 0 | **9 files, 63 passed** (the join's own figure) |
| `check:library` | 0 | **210 ✓, 0 ✗**, "All clauses passed." (part 4's count: READABLE's `<=` became `===`, no clause added); `✓ 6 big readers' slots for the 6 chapter books`; `READABLE: 18 books (BOOKS.length), 18 slots, 18 zones pressed through a stub opener`; 76 keep-outs (74 room + 2 den); no WAIT note |
| `check:brevity` | 0 | `12 picture books, 6 chapter books (60 chapter pages)`; the Library 57 lines (36 templates × the 18 titles), 10 titles; **434 pieces** short enough (the join's 432 + part 4's 2), 6 recorded exceptions; 10 CONTROLs ok; seed 5 hydrated from its prebuilt file |
| `check:labels` | 0 | 15983 frames at 390x844, library 3413; 55 labels; the owl's 2 of 2 visits, story time 1800 frames (1138 reading), bubble/Get up/both 1138; no overlap |
| `check:tap-spacing` | 0 | 10 spaces, **152 zones**, 27 bands; the library **21 zones** (Talk + 18 Read + 2 Sit; part 4 had 15), 1 band, 21 zone-band, **12 close zone-zone pairs**, each a warning "… overlap but both say 'Read' — harmless ambiguity, left alone" (neighbouring chapter books on west-4, 0.6 m apart, within the 1.13 m finger); 32 same-action warnings in all (part 4: 20). Not a failure; the shelf's layout as the books ship it — reported, not changed |
| `check:exits` | 0 | "check:exits OK"; the library 795 exits, 155 off the lattice, 0 nowhere; both Sit chips "→ its own Get up chip"; 64 placement sites, 54 driven |
| `check:jitter` | 0 | 34 children, 9000 frames, worst own step 0.177 m (Luca), bound 1 m; worst speed 4.983 m/s |
| `check:crowd` | 0 | trace `frames=90000 children=12`, `covered climbs=9 trips=61 chats=369 paints=4 …`; npc-perch, separation, dispersal, presence OK |
| `check:served-book-reader` (port 6743) | 0 | "check:book-reader passed", **2806 ok, 0 FAIL**; `6 real chapter book(s) measured, 164 worded chapter face(s) held to their boxes`; chapter books' thinnest pictures 53.5 / 52.2 / 51.6 / 54.0 / 51.0 / 18.0 % (the join's figures exactly); every picture model drawn, all 63; section 8 (goodnightPark completes the dex) and 10 (off the shelf) ok; vite pid 23929 stopped, port free after |
| `pnpm run build` | 0 | built in 736 ms |
| **`SERVED_CHECKS_PORT=6747 pnpm run check`** (the full chain, at d9b4a56c = 16ee9be8's code, seed 5's honest park) | **0** | **2708 s**; `check:chain-coverage`: 108 check:* scripts, 99 leaves all reachable from CI, "check" is 9 shards / 84 distinct steps. Parsed from package.json, all 88 distinct leaves of `check` (counted with raw commands) ran: 86 by their `$` line in the log, `tsc --noEmit` by sequence (between deck-fallthrough at log line 344 and `typecheck:test` at 633 in one `&&` chain), the crowd trace by its output (`frames=90000 children=12`, `trace=0eae0c9c`). 41 `dismount: no clear, open spot` lines are logged by passing steps — reptile-house 6, labels 2, exhibit-camera 33 — **exactly part 4's own counts** in its sweep logs (`fin/runs/`): pre-existing, not the books' |

**The honest park.** `LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run build:parks` at 4333fc84 (hash
`53dde20f5ea285c66810d5912e470269bd1ba38f1afb143e33c2a2e08f8aa453`; 16ee9be8 and later handoff commits
leave it unchanged): exit 0 in 514 s; restart 0 rejected by check:coplanar (231 s); **restart 1
accepted as shipped (134 measures, 507 s), proven, digest 9c7a86e2b266ca08**; control (cruiser
+0.5 m) f02667cfadc338d5 differs. Against part 4's seed-5 file: `format`, `build`, `seed`, `restart`,
`measures`, `features`, `planOrder` byte-identical; only `acceptance` (its source hash) and `digest`
moved — the books move nothing in the park, but the digest is this tree's own, so a restamped part-4
file would NOT have been this tree's park.

The books' own files are byte-identical to `origin/feat/library-v2-books` after the merge
(`git diff --stat origin/feat/library-v2-books HEAD -- chapterBooks/ final.json storyProps.glb
storyPropsGlb.ts reader/ books.ts readBooks.ts shelfBooks.ts bookKinds.ts test/library/` is empty):
"as-is" by construction.

## The look (16ee9be8; scratch `chapter-books/look/`)

My own vite dev server (`node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 6741 --strictPort`,
**pid 25748, killed by PID, port free after**) on the honest seed-5 park; Jim's installed Chrome,
headless, `chromium.launch` (a throwaway temp profile, never the MCP's), every context closed.
`look/look.mjs` takes every chapter book **off the big readers' shelf as a child does**:
`/library?at=<its stand>&facing=270&seed=5`, waits for the game's own selection to hold
`library-book:<id>`, clicks the real **"Read it!"** chip, then turns every page with the reader's own
next button — every spread at 1280x800, every face at 390x844 — then a picture book
(*RiPika's Balloon*, off north-2) and the owl's desk front (`/library?at=6,8.7&facing=180`, "Get a library
card!" pressed). `look/look-run.log` + `look/shots-owl/look.log`: **every book opened by its chip on the
right book, read to its end (6 spreads; 12 faces upright), `pagesFit` true, no upright card, no page
error, at both sizes**; the owl greeted at both sizes, no page error. (The first pass's owl visit looked
for her chip once while her arrival line had it put away — a script fault; it now waits, and passed.)

**All 139 screenshots opened**, and what each showed is in `look/NOTES.txt` (written while each was
open): every page's words inside the page, every picture drawn, the coral *Shush*, Nimbus grey then
white, The End on every book. The known, accepted faces are as reported (Trilla's eyes under her
tummy patch in *Shush*, Trilla surprised throughout *Chicken*, Grandpa Tock's cream-disc face on
*Footprints* p6–p8). **Nothing the merge broke.**

One thing seen and run down, **not the merge's**: a faint rainbow-edged pill across the first spread
just after the chip is clicked (*Shush* spread 00, *RiPika's Balloon* spread 00). `look/recheck/`
reopened both and sampled `.action-chips` at 0/60/120/300/1000 ms after the click: opacity 0.87 → 0 by
~245 ms (its 140 ms fade), the pill gone by ~1 s, on the picture book (part 4's own content) exactly as on
the chapter book. It is part 4's chip-press transient caught by screenshot timing; this merge changes
no reader, chip or highlight code (`git diff --stat origin/feat/library-v2 HEAD -- src/`: 19 files, the
books', the kit and the reader's picture code only).

Also run against that server: `CHECK_BOOK_READER_URL=http://127.0.0.1:6741 pnpm run check:book-reader`
→ exit 0, 2806 ok, "check:book-reader passed".

**The two "What to look at" links, dry-run on a production build** (`vite build --outDir /tmp/lcb-dist`,
so `dist/` was not touched under the running check chain; `vite preview` pid 28662 on 6749, killed by
PID; `look/preview.mjs`, which reads only the DOM because a production build has no `window.game`):
`/book?id=sirHopsalot` (+`&seed=5`, the only seed solved locally) opens *Duck, Sir Hopsalot!* and turns;
`/library?at=-16.1,5.5&facing=270` stands her at the big readers' shelf with **"Read it!"** up, and the
chip opens the book — both at 1280x800 and 390x844, HTTP 200, no page error, all 10 frames opened. On
the PR preview the same script runs without the seed suffix (step 9).

## Taking over at zero notice

`cd .claude/worktrees/library-chapter-books && pnpm install --frozen-lockfile`. Read the Status
list above and carry on from the first unticked box. `.parks/` holds all 16 honest parks for hash
53dde20f… (check with `chapter-books/parks-fresh.sh`; a src edit inside the closure makes it STALE).

- **Never** push to `feat/library-v2` or `feat/library-v2-pr`; the PR head moves only by
  `git push origin feat/library-chapter-books:feat/library-chapter-books-pr` (fast-forward). A push to
  the PR head cancels the PR's running CI run (concurrency group `ci-<ref>`), so push it only for a real
  change or the final head.
- If `origin/feat/library-v2` moves: `git -c rerere.enabled=false merge --no-ff origin/feat/library-v2`,
  then `node .claude/library-build-scratch/chapter-books/merge-scripts-proof.mjs $PWD HEAD^1 HEAD^2 HEAD`,
  and if the park hash moved, re-solve (`LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run build:parks`). If
  #733 has merged: merge `origin/main` instead and `gh pr edit 734 --base main`.
- Step 9: take the host from the PR's newest "Deploy PR preview" comment (it must name the head sha),
  then `node .claude/library-build-scratch/chapter-books/look/preview.mjs <host> <outDir>` (headless
  Chrome, throwaway profile; no seed suffix on the preview), open every frame, and put the two links
  in `chapter-books/pr-body.md`'s "What to look at" → `gh pr edit 734 --body-file …`.

## Round 2 log

- **Root causes (both in `src/world/Selection.ts`, both general):**
  1. *Proximity:* the hysteresis band was a fixed `HYSTERESIS_MARGIN` 0.6 m: a held zone keeps the pick
     until a rival's stand is MORE than 0.6 m nearer. On a rival's own stand the rival is exactly the
     gap nearer, so any two zones 0.6 m apart or closer never let go of each other (the shelf's stands
     are 0.6 m apart). Fix: `hysteresisBand(held, rival) = min(0.6, HYSTERESIS_SHARE 0.5 × gap)`. The
     middle half of the gap stays anti-flicker; the quarter round each stand (0.15 m on the shelf) always
     belongs to its own zone. Pairs ≥ 1.2 m apart keep 0.6 m — unchanged (every space but the library's
     chapter shelf: nearest equal-rank stands elsewhere 1.79 m+).
  2. *Tap:* `refreshSticky` dropped a tapped pick whenever proximity held anything ELSE, so standing at
     one book she could never select another by tapping it. Fix: a tap records the proximity pick at
     that moment (`tapBaseline`); the tapped pick is dropped when proximity CHANGES (she walked up to
     something else — the file's own header's rule). Hover unchanged (never beats a different
     proximity pick); hovering the thing just clicked keeps the tap's standing.
  `Selection.ts` is OUTSIDE the park closure: hash still 53dde20f…, parks valid, CI parks cache hit.
  Commit 3b461529.
- **check:library SHELF WALK** (item 17; 4d0dd06f): real child, real Selection wired as Game, E through
  `InputSystem`'s keydown listener → `takeInteractPress` → `InteractRouter`; stub opener with isOpen so
  the selection is blocked/cleared while a book is open, exactly as `Game.selectionBlocked`.
  21 arrivals (north 1→6 from stand 1, south 6→1, from the aisle 1.5 m out onto each next stand, link
  after link = teleport k−1 then k), 10 taps on a neighbour's book (aim = the book mesh's bounds centre
  projected through the game camera), a sway ±0.08 m midway between loudestShush/giantFootprints.
  Geometry (from the run's note): seed 5 restart 1, room at (−600, −600); west-4 stands room-local
  facing 270: sirHopsalot (−16.10, 5.50), detectiveBiscuit (−16.10, 4.90), loudestShush (−16.10, 4.30),
  giantFootprints (−16.10, 3.70), biscuitStorm (−16.10, 3.10), catchThatChicken (−16.10, 2.50); gaps
  0.600 m; band between neighbours 0.300 m (fixed) / none-0.6 (pre-fix); stand radius 3 m; light touch
  0.249 (coast 0.05 m); every stop ≤ 0.016 m off its stand.
  - with the fix: exit 0, **245 ✓ 0 ✗** (210 + 35): 21/21 arrivals, 10/10 taps, sway 0 changes
  - **pre-fix Selection.ts (83b72db8's, swapped in, restored): exit 1, 223 ✓ 22 ✗** — 11/21 arrivals
    (aisle 5/5 wrong; straight walks and links wrong or right on the exact-tie float), 0/10 taps
  - `LIBRARY_CHECK_MUTATE=fixed-hysteresis`: exit 1, 234 ✓ 11 ✗ (11/21 arrivals; taps, sway green)
  - `=no-hysteresis`: exit 1, 244 ✓ 1 ✗ (the sway changed 8 times; arrivals, taps green)
  - `=tap-loses`: exit 1, 234 ✓ 11 ✗ (0/10 taps; arrivals, sway green)
- **check:tap-spacing rule 3** (0e0f9da7): every space, every ordered pair of selectable equal-rank
  zones within reach of each other, the real Selection stood on one stand, then at 9 points within 5 cm
  of the other's: the held zone must let go (a zone sharing that stand may answer). The 12 rule-2
  warnings are a finger's miss (pick areas within 1.13 m), not this bug, and stay warnings. With the
  fix: exit 0, 62 pairs, 558 probes, 0 not letting go (library 40 pairs; keychain-rack opened 12;
  hotel lobby 4, breakfast 4, suite 2; park/castle 0 — 60 selectable, nearest equal-rank stands 1.93 m,
  beyond the flowers' 1.3 m reach). **Pre-fix: exit 1, 10 problems** — all 10 neighbouring shelf pairs
  both ways (held at 7 or 9 of 9 points), nothing else. (First version probed only the exact stand:
  2 of 10 on the pre-fix code — a float tie; hence the 5 cm ring.)
- **Selection-driving checks with the fix, all exit 0** (`runs/r2-wide`, `r2-served-*`): check:labels
  (15983 frames, library 3413, no overlap), check:exits ("OK"; the library 795 exits, 0 nowhere),
  check:hotel ("OK"), check:reptile-house ("All clauses passed."), check:keyring-view ("every keyring
  visible and separately tappable on every viewport"), check:served-book-reader (port 6751, "passed"),
  check:served-walking (port 6753, tap-to-move OK at spawn / after the keychain view / a returning save).
- **`pnpm run test:procgen`** on the fixed tree, 16 honest parks: exit 0, 349 s, 48 files, 2167 tests,
  0 skipped. Full `pnpm run check` running (`runs/r2-full/check.log`, SERVED_CHECKS_PORT 6747).
- **The preview walk instrument** (`look/preview-walk.mjs` + `look/identify-books.py`): ONE page, F3
  readout, arrow keys (pairs learned by trying: north ArrowUp+ArrowRight, south ArrowDown+ArrowLeft,
  west ArrowUp+ArrowLeft, east ArrowDown+ArrowRight), stops when the readout shows the stand exactly
  (0.1 m), E, then Escape; the book that opened is named by its cover board's colour (a 5×8 patch at
  x 102–110, y 420–490 on the left board, 1280×800), calibrated on this round's verified dev frames
  (production and dev frames give identical patches: sirHopsalot 137,191,215 in all four checked).
  **CONTROL on the old preview pr-734-83b72db** (pre-fix): 11 presses, **1 of 11 right** — every press
  after the first opened the previous book (north) or the next one (south): QA's bug exactly, all 22
  frames opened by eye and agreeing with the colours (`look/walk-83b72db/`).
- **Full `pnpm run check` on the fix** (code = 0e0f9da7's, park 53dde20f): **exit 0, 2467 s**; all 88
  leaves accounted for (86 by their `$` line, tsc by sequence, the crowd trace by its output); SHELF
  WALK 21/21 + 10/10 and rule 3's 62 pairs inside it; 41 dismount warnings = part 4's own count.
- **Overseer (~17:40):** ignore agent a01b801898cba05c5's message (a duplicate of part 4's fixer, stopped);
  never write to library-v2; merge the newest origin/feat/library-v2 before the final CI run.
- **Merge b1d8dce9** = origin/feat/library-v2 @ cbe0b608 (8 commits: the owl solid wherever she is
  drawn, NEVER INSIDE HER, Big reader listed only with a chapter book, the card at full strength).
  **One conflict, `test/library/chapter-books.test.ts`**: both sides had added a "case 4" (the books'
  cover colours; part 4's "lists Big reader … only while there is a chapter book"). Both kept, imports
  unioned (PALETTE, SECRETS), header describes both, part 4's renumbered **case 5** (with six books its
  assertion reads "Big reader is listed": passes). `state/secrets.ts` (auto-merged) now imports
  `chapterBooks/index` into the state module; its comment said the index's "one import is a type" —
  with the books in it imports six data files, each importing only types: comment corrected (still
  data only; check:cycle-tdz: the same 5 sites as its baseline). Auto-merged, both sides present:
  check-library (SHELF WALK + NEVER INSIDE HER), check-book-reader (1–10 + part 4's 11), check-labels.
  package.json: PROOF OK. Then **merge a9729328** = 9a2fe385 (check-book-reader item 11, scripts only).
  Park hash now **eaa23002…** (Library/LibraryOwl/Collision/World/storyTime/secrets in the closure);
  the 53dde20f sets kept at `.parks/r1-53dde20f/`, `.parks/all16/`, `.parks/seed5-only/`.
- Park-free checks on a9729328, all exit 0: cycle-tdz (5 = baseline), flat-primitives (109 flat-ok, no
  new), chain-coverage (99 leaves reachable), assets, story-props-glb, library-glb, vitest test/library +
  library-card **4 files, 22 tests** (chapter-books 6: case 5 included).
- On a9729328 (hash eaa23002, honest seed 5 restart 1, digest 9c7a86e2b266ca08 — unchanged by part 4's
  owl fixes): check:library **256 ✓ 0 ✗** (SHELF WALK 21/21, 10/10, sway 0; NEVER INSIDE HER in), and
  tap-spacing (62 pairs, 0 not letting go), labels, exits, brevity, hotel, reptile-house, keyring-view,
  jitter, crowd, served-book-reader (2808 ok, item 11 in), served-walking, served-deep-links,
  served-menu-reach — **all exit 0**; every served port free after.
- Part 4 kept moving: merged **7965e947** (69ba3716; the card's sparkles; LibraryOwl + check-library;
  hash 797d5c0b, seed 5 re-solved: restart 1, same digest) → PR head fast-forwarded 83b72db8..69ba3716,
  CI 39994583659 started; then part 4 pushed **a79c265f** (the glowing book's beacon, LibraryOwl +
  check-library) and **4a72c49b** (its handoff: QA round 1's minors done) — merged (e03200d5, clean,
  PROOF OK, tsc 0, hash **2b2fe559**), PR head fast-forwarded 69ba3716..**e03200d5** (that cancels
  39994583659 — superseded, not red); **CI 39995947413 + Update adoption 39995947169** on e03200d5.
  Seed 5 re-solving locally for 2b2fe559; then the targeted checks on e03200d5.
- The local seed-5 solve for 2b2fe559 was **stopped by me (by PID, my worktree's processes only)** after
  49 min with no verdict: the machine was at load 42–50 from other agents, and one attempt sat 31 min in
  `check:stall-accommodate` (a search script, always solves). CI solves the same hash on its runners;
  its **`parks-2b2fe559…` artifact** (16 seeds, this exact tree) is what the final local checks use —
  `gh run download <run> -n parks-<hash> -D <dir>`, copy `*.json` into `.parks/`, then `parks-fresh.sh`.
  `.parks/` has no top-level manifest until then: run nothing World-building before it is restored.
