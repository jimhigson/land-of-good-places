# HANDOFF — Library part 5: the secret den, the baby dragon, the sleeping cat and six chapter books (PAUSED 23 Oct 2026, ~11:45 BST)

Read this first. It is the entry point for whoever resumes part 5.

## Where the Library is
- **On main:** parts 1-3 and readable shelves (#720), and the engine rework (#722, merged 23 Oct as 6d70f695).
- **Part 4 (#718)** is PR **#733**, being finished as this is written: the owl librarian, the card, the recommendation, the shush, the three children, the cushions and story time. Branch `feat/library-v2`, head `feat/library-v2-pr`, base main. Jim: *"do the smaller library merge to main first, pausing all other work"*. So part 4 merges first, and part 5 was paused.
- **Part 5 (this file)** is built and reviewed track by track, but **not yet joined**. Every piece is pushed:

| piece | branch @ head | state |
|---|---|---|
| the secret shelf (Step 12), the dragon and cat (Step 13), the den rebuilt from Blender pieces | `feat/library-v2-den` @ d209d0df (worktree `.claude/worktrees/library-v2-den`) | done; Step 12 and the den pieces reviewed; **Step 13's review was lost to an API timeout and must be re-run** |
| the six chapter books, pictured from Blender props: Duck, Sir Hopsalot!; Detective Biscuit; The Loudest Shush; The Giant Footprints; Biscuit and the Storm; Catch That Chicken! | `feat/library-v2-books` @ 9325e0f7 (worktree `.claude/worktrees/library-v2-books`) | done and reviewed: one major (faces) and minors below |
| the den's Blender kit (libraryDen.glb: floor, walls with niches, lintel, lanterns, gold book) | `art/library-v2-den` @ 0c0fecd0 | done; comes in through the den branch |
| the chapter books' story-props kit (storyProps.glb, about 30 models: Nimbus the storm cloud, rubber duck, footprints, rainbow arch …) | `art/story-props` @ d431a47d | done; comes in through the books branch |
| **this branch** `feat/library-v2b` | cut from `feat/library-v2` at the pause; holds only this file | the join happens here |

## What remains (the join, then the PR)
1. In this worktree, `git merge origin/feat/library-v2` first, since part 4 has moved on and may have merged by now (then also `origin/main`). Then merge `origin/feat/library-v2-den` and `origin/feat/library-v2-books` (`-c rerere.enabled=false`, `--no-ff`).
   - Resolve the conflicts in Library.ts, layout.ts, check-library.mts, secrets.ts, LABELS.md and package.json, keeping both sides' intent.
   - Rebuild check chains from parsed step sets.
2. **Re-run the lost review of Step 13 and the den pieces**: one reviewer over `feat/library-v2-den`, commits 067889b3..d209d0df.
3. Fix the review findings below, **the faces first**:
   - Trilla's eyes are hidden in The Loudest Shush; Catch That Chicken! forces one 'surprised' face; Grandpa Tock's face is buried on The Giant Footprints p6-p8.
   - Use the measured fixes: scale the puff's face patch by the ball and lower the tummy decal (pets.ts createPuffCreature); move the tortoise's face onto the head's measured front (reptiles.ts).
   - Restore Chicken's editor moods.
   - Look again at every picture those models appear in, picture books and park included.
4. Every "For the join" item in `HANDOFF-library-v2-den.md`, `HANDOFF-library-v2-books.md` and `HANDOFF-library-v2.md`. At least:
   - no "Shhh!" while she is in the den;
   - story time carries on while she is in the den;
   - story time reads picture books only, through the books track's predicate;
   - check-labels scene 5's cat and dragon visits;
   - any page or model the book engineers flagged.
5. Plan Step 14 (`docs/library-build/PLAN-parts-4-5.md`): /library-den and the unsavable den links, check:tap-spacing's open-shelf snapshot, KIDS den avoidance, ASSET_MANIFEST, and the library_build.py docstring.
6. Checks, with exit codes read: tsc, typecheck:test, check:library, check:labels, check:tap-spacing, check:brevity, check:assets, check:library-glb, check:exits, check:solids on seed 5, check:jitter, check:served-deep-links, check:served-book-reader and the vitests.
7. Open the PR. Fast-forward `feat/library-v2b-pr` (create it) to the head, then open a draft. Its base is `feat/library-v2-pr` while #733 is open, and **main** once #733 has merged. Title: "The Library, part three: the secret den, the baby dragon, the sleeping cat and six chapter books". The body says "Closes #719, closes #714".
8. The PR's CI green, browser QA on the preview, one peer review, then Jim's yes or no.

## The findings to fix (verbatim from the track reviews)
### Track C, Step 12 (secret shelf) review
- **minor** `src/world/library/furnish.ts:530` — No check covers the pull book's gap in the secret row. With the gap removed, two decorative books pass through the gold book and check:library stays fully green. The gap is right today; nothing would notice if it went.
  - Fix: Extend SECRET SHELF's gold-book clause. Read the library.secretShelf.books instances on LIBRARY_SECRET_BOOK.shelf and assert that none overlaps the pull book's thickness, printing the clearance. Prove it red with pullBookGap=false, as a check-side mutation in the MUTATIONS allow-list or by hand, and paste the red with its geometry in the handoff.
- **minor** `src/world/library/secretShelf.ts:61` — The quarter turn has two owners. `const SWING_DEGREES = 90` (line 61) gives the open footprint's facing (line 166), and `export const SWING_END = Math.PI / 2` (line 59) drives the drawn swing. If one changes without the other, the drawn open leaf stops off its open collider, and only the SWEEP CONTROL notices.
  - Fix: Derive one constant from the other, e.g. `const SWING_DEGREES = (SWING_END * 180) / Math.PI;`, or compute the open footprint's facing from SWING_END, so one constant owns the turn. The SWEEP CONTROL stays as the drift alarm.

### Track C, the Blender den pieces review
- **major** `scripts/check-library.mts:870` — THE DEN, DRAWN never checks that the den walls are visible or that every kit node is drawn. A den wall set invisible (only its body left, so an invisible wall) passes with '✓ ... drawn 5.20 m tall'. Removing the niche boards under the 476 books also passes. The census line prints '(9 room nodes, 2 lanterns)' from LIBRARY_DEN_ROOM_NODES.length, which is a constant, not a count.
  - Fix: In THE DEN, DRAWN: 1. Assert that every name in LIBRARY_DEN_ROOM_NODES is found exactly once, and that each lantern has both LIBRARY_DEN_LANTERN_NODES. Print the measured counts, not the constants. 2. Assert that the west wall, the north wall and the lintel are visible all the way up their parent chain (to model.root, and to westWall for the lintel). 3. Assert that the south wall is the one wall hidden, so a swapped hide goes red either way. 4. Prove the clause red with M7 and M8 and paste each red with its geometry into the handoff.
- **minor** `scripts/check-library.mts:1019` — The lantern clause, shell.ts's doc and ASSET_MANIFEST §42 all say the den lanterns are 'out of every reach, so drawn with no body'. Only a jump is measured. A jet-pack flier in the library reaches the lanterns' band (3.89–4.53 m) and passes through them, and no run ever says so.
  - Fix: Either: - give each lantern a body over its drawn extent, banded from its lowest point to its top as the lintel is (the drawn thing's own body, not a blocker; that is CLAUDE.md's default), or - while Jim's question is open, reword the clause, the libraryDenLanternSpots doc and ASSET_MANIFEST §42 to 'out of a walker's and a jumper's reach; a jet-pack flier passes through (question for Jim)', and write that gap to process.stderr on every run.
- **minor** `scripts/check-library.mts:846` — The test for whether a mesh is an ink outline has three owners. The check defines it twice (THE DEN, DRAWN and SECRET SHELF's new gold-book clauses). The same commits export `isOutlineMesh` from materials.ts, which the handoff calls 'the outline's owner'.
  - Fix: Import isOutlineMesh from src/art/style/materials.ts in both clauses, delete the two local copies, and drop the now-unused BackSide/MeshBasicMaterial imports if nothing else uses them.

### Track D, the chapter books review
- **major** `src/art/models/pets.ts:444` — Two of the six books lose their characters' faces. Trilla, the heroine of The Loudest Shush, has no eyes on 8 of its 11 pictures. In Catch That Chicken! she wears one 'surprised' face on all 11 pictures, and it reads as worried and teary even on the happy ending. Grandpa Tock, the giant of The Giant Footprints, has no eyes on p6-p8. The engineers measured the cause and designed the fix, but deferred it to the join (J5) as a question for Jim, who is away. As delivered, these books are not cute where it matters most.
  - Fix: Make both measured model fixes before the PR goes to Jim. Jim is away, so decide it ('pick what a six-year-old will enjoy more') and record the decision. - pets.ts: scale the puff's face patch by the ball's own [1, 0.92, 1.04] and lower the tummy decal (the books-a proposal). - reptiles.ts: put the tortoise's face on the head's measured front surface; do not type a new z. Then: - Restore Catch That Chicken!'s editor moods: happy on p4, p5, p8, p9 and p10; sad on p7. - Re-run check:assets, check:served-book-reader and join/tock-face.mts (it must report 10 of 10 seen). - Look again at Shush, Chicken, Footprints p6-p8, Trilla Goes Up High, RiPika's Balloon p4-p5 and the Reptile House.
- **minor** `src/world/library/chapterBooks/biscuitStorm.ts:29` — Mrs Crumpet's pile of books is defined twice, by hand, and the two copies already differ. final.json asks for Storm p4's pile to be 'drawn exactly as in The Loudest Shush'.
  - Fix: Give the pile one owner. Export crumpetPile and pileTop from loudestShush.ts, or from one shared helper the file layout allows, and call it from biscuitStorm.ts. Take the step from the kit's measured closed-book height, not a typed by-eye number.
- **minor** `src/world/library/chapterBooks/sirHopsalot.ts:28` — Picture positions copy numbers that other modules own, and one comment disagrees with its own number. - sirHopsalot.ts: ON_SEAT 0.96 is a copy of SEAT_HEIGHT × RIDE_SCALE × 0.4. - The Giant Footprints p9: y 2.1 is a typed copy of the cat bus's roof height (5.24 × 0.4). - The Giant Footprints p10: the comment says the tortoise sits at 'SEAT_HEIGHT 0.958 at park scale, doubled', which is 1.916, but the value used is 2.1.
  - Fix: Move SEAT_HEIGHT into railRace/dimensions.ts and re-export it from cart.ts. Then the books can compute ON_SEAT from SEAT_HEIGHT and RIDE_SCALE without loading a park. The other route is join item 2: a rider/seat option on the cart actor. Also fix the p10 comment or its value, and derive or label the cat-bus roof figure rather than typing 2.1.
- **minor** `src/world/library/chapterBooks/index.ts:59` — Nothing in the repo holds the six books' words to final.json. The 'verbatim' promise rests on two copies of the words kept in step by hand, proved only by scratch instruments outside the repo.
  - Fix: Add a case to test/library/chapter-books.test.ts that reads docs/library-build/chapter-books/final.json and compares CHAPTER_BOOKS' order, ids, titles and every page's text. Prove it red with a one-character edit. Otherwise, state in index.ts that final.json is the editor's historical draft and drop the verbatim promise.
- **minor** `HANDOFF-library-v2-books.md:396` — The handoff's documented 9b red (taking parkBench off the model sheet) no longer goes red at the head, and nothing says it went stale. A replacement following it would conclude the clause had rotted.
  - Fix: Replace the handoff's 9b reproduction with the jetpack line, with its input (9325e0f7, seed 5) and output. Add a note that the parkBench transcript was proved before any real book drew a bench.
- **minor** `test/library/chapter-books.test.ts:90` — Case 4 says every book has 'a cover colour of its own' but compares exact hex values only. - Duck, Sir Hopsalot! and Biscuit and the Storm are two light blues on the same shelf row of the big readers' bookcase. - Detective Biscuit's cover is exactly the colour of the shelf boards it stands on.
  - Fix: Give Biscuit and the Storm a cover that is not light blue, and Detective one that is not the case's wood; judge both by eye on the shelf and in the Cute-o-dex. Make case 4 hold each chapter cover to a minimum perceptual distance from every other cover, and list the picture books' existing close pairs as known, since those books must stay unchanged.


## Jim's rulings that bind
- **The epic (#714):** the brief.
- **Chapter books, 14 Oct:** six of them, about 30 words a page, with their own shelf and the Big reader award.
- **The engine:** anything solid is jumpable with no floor marking; no tall fences; *"maybe check with me first"* before any new blocker or guard.
- **Pets:** on rides all but one hop into her backpack; seats are 'not a ride'.
- **Blender, 22 Oct:** *"model in Blender as much as is needed, in preference to coding geometric primitives"*. Nothing new is drawn from three.js primitives.

## How to resume with the orchestration
The Workflow script `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/wf/library-part5.js` (gitignored scratch, stable path) does steps 1-8 above. Its stages: the Step 13 review, the join, the join's review, a gate loop, a QA loop, the PR, one peer review, and a final sync with part 4.
- It embeds every finished result as `CACHE_ALL`.
- Its join prompt creates this worktree if it is missing, and treats an existing one as a restart.
- Relaunch it once #733 has merged. In the PR step, set the base to main rather than `feat/library-v2-pr`.
