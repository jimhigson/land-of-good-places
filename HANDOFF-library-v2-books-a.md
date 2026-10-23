# HANDOFF — Library v2, book engineer a: chapter books 1–3, words and pictures

Branch `feat/library-v2-books-a`, worktree `.claude/worktrees/library-v2-books-a`, cut from
`feat/library-v2-books` @ 3188e56d (the chapter books' engineering base, item 7 done; its record is
`HANDOFF-library-v2-books.md`). Engineer, Claude Opus 5.5, 23 Oct 2026. Scratch (logs, screenshots,
scripts): `.claude/library-build-scratch/books-v2/a/`.

The task: put chapter books 1 to 3 into the game, words and pictures —
`sirHopsalot` (Duck, Sir Hopsalot!), `detectiveBiscuit` (Detective Biscuit), `loudestShush` (The Loudest
Shush), `final.json` `books[0..2]`. Book engineer b does places 4–6 in parallel on its own branch.
Touch only these three files and this block's lines in `chapterBooks/index.ts`.

## Status

- [x] worktree cut at 3188e56d, `pnpm install --frozen-lockfile` (pnpm 12.1.0, node 26.5.0), branch pushed
- [x] `.parks/` hydrated from `../library-v2-books/.parks` (seed 5, restart 1, digest d6721090fb3f1d3a),
      manifest on this tree's hash fb2690b5… (same source as the base); restamp after every src edit:
      `.claude/library-build-scratch/books-v2/a/restamp.sh`
- [x] `sirHopsalot.ts` — words verified verbatim against final.json (scratch `tools/verify-words.mjs`), pictures composed
- [x] `detectiveBiscuit.ts` — likewise
- [x] `loudestShush.ts` — likewise; Trilla shows no face (model defect, see "For the join" 1)
- [x] index.ts: three imports and three entries under the "Shelf places 1–3" lines only
- [ ] every spread looked at, 1280×800 and 390×844, headless Chrome; pages fixed
- [ ] tsc, typecheck:test, check:brevity, check:served-book-reader — exit codes read

## Decisions (with reasons) — Jim is away; each is also for the PR body

1. **A pet riding a cart sits at `ON_SEAT` (0.96), a stage direction in the book**, not an import of
   `railRace/cart.ts`'s `SEAT_HEIGHT`. Tried first: importing it made `import`ing the book file start
   a park acceptance run (cart.ts → route.ts → ringPath.ts reads `PARK_BOUNDARY`, which builds the
   seed's park at import; with a stale manifest that is `accept-parks.mts 5`, killed by PID). A book is
   data that Node checks and vitest load, and must never build a park. The pictures are judged by eye,
   like every `at` in the picture books. Join item 2 offers the one-owner fix.
2. **Ducking pets sink into the tub** (`DUCKED` = seat − 0.5; RiPika's half-duck on Hopsalot p7 is
   seat − 0.18, so her eyes stay over the rim while she shows him). The pets have no limbs, and their ears
   cannot fold (the editor's note).
3. **One duck bar gate spans both lanes**, at the race's own height (`DUCK_CLEARANCE_AT_PARK_SCALE`,
   2.703 m, bar underside 2.328 m): a pet sitting up reaches 0.96 + 1.46 = 2.42 m, so its ear tips go
   into the bar with no lowering — the editor's "brought down 0.3 m" note was written against an older,
   higher clearance and is not needed.
4. **Hopsalot p7 is seen from behind the carts**, racing away towards the bar with the finish rainbow
   beyond; the riders turn to each other. Seen from the front, a bar "ahead" of them is between them
   and the reader and hides them.
5. **Detective's pink wall is drawn at size 0.6 on every page** (`WALL`): 0.96 m, still taller than the
   0.70 m mini, so the story holds; at full size its 5.1 m length shrinks the cast to a strip.
6. **Footprints on grass, at 2.2–2.4**: the kit's `pancakeFootprint` is `pathSandDark`, which vanished
   on a sand path, and the picture camera looks from about 10° above level, so a flat print shows as a
   thin oval; bigger and on grass they read as a trail.
7. **The library pages use the moonlight rig (`night`)** as the editor asked: over the library's warm
   floor colours it renders plum and amber, dim and cosy, nothing black.

## Words changed (each typo fix or brevity trim, recorded)

(none yet)

## For the join

1. **Trilla (the puff pet) has no face, in every picture and in the park.** `pets.ts`
   `createPuffCreature`: the tummy decal (blob radius 0.62R, scale [1, 0.85, 0.45], centred at
   y −0.15R, z 0.86R) protrudes to z ≈ 1.10R at the eyes' height, and the face patch sits at 1.012R with
   its eyes about 0.12R above the ball's centre — inside the tummy's volume. Rendered alone in every mood
   (`.claude/library-build-scratch/books-v2/a/puff/trilla-moods-front-10deg.png`): happy, neutral, sad
   and blink show no eyes at all; surprised and frown show only their brows over the tummy's edge. From
   10°, 30°, 50° and 70° above (`trilla-happy-10-30-50-70deg.png`): no eyes from any height, so the
   park's camera cannot see them either. Every Trilla page here (The Loudest Shush, all eleven pictures)
   and the picture books' (Trilla Goes Up High, RiPika's Balloon p4–5) are faceless. Not fixed here (this
   branch touches only its three books). The fix belongs in `pets.ts` — lower or shrink the tummy, or
   lift the eye row — and is visible, so Jim judges it. The book data already asks for the right moods,
   so the pictures gain their faces with no edit here.
2. **One owner for "a pet on a cart's seat"**: a `cart` actor option in `pagePictures.ts` that seats a
   named pet at `SEAT_HEIGHT` (as `raceCart` seats the reader) would replace this book's `ON_SEAT` stage
   direction (Decision 1).

## Questions for Jim

(none yet)
