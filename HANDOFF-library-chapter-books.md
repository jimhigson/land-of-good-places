# HANDOFF — the six chapter books, as-is, stacked on part 4 (#733)

Engineer, Claude Opus 5.5, 23 Oct 2026. Branch `feat/library-chapter-books` (worktree
`.claude/worktrees/library-chapter-books`), cut from `origin/feat/library-v2` @ 9a269a31.
PR head `feat/library-chapter-books-pr` (fast-forward pushes only), base `feat/library-v2-pr` (#733's head).
Scratch: `.claude/library-build-scratch/chapter-books/` (logs `runs/<tag>/<check>.log`, each ending `exit=N`).

**The ask (Jim, 23 Oct):** "let's just merge those books as-is now". As-is: the books exactly as
`origin/feat/library-v2-books` @ 9325e0f7 has them — **no face fixes** (Trilla's hidden eyes in *The
Loudest Shush* and *Catch That Chicken!*, Grandpa Tock's buried face on *The Giant Footprints* p6–p8
are known and accepted), **nothing new**. Only what the merge needs to be correct and green.

Never push to `feat/library-v2` or `feat/library-v2-pr` (the part-4 pipeline owns them).

## Status

- [x] worktree cut from origin/feat/library-v2 @ 9a269a31, pnpm 12.1.0 / node 26.5.0, branch pushed
- [x] merge `origin/feat/library-v2-books` @ 9325e0f7 (rerere off) → **4333fc84**
- [x] package.json step-set proof (parsed) — PROOF OK, control red
- [ ] parks hydrated for the merged source hash (honest seed-5 solve running, hash 53dde20f…)
- [ ] local checks (table below)
- [ ] the look (six chapter books at 1280x800 and 390x844; a picture book; the owl's desk)
- [ ] PR opened, stacked on #733
- [ ] CI green on the PR head
- [ ] preview deep links checked and in the PR body

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

## Taking over at zero notice

`cd .claude/worktrees/library-chapter-books && pnpm install --frozen-lockfile`. Read the Status
list above and carry on from the first unticked box.
