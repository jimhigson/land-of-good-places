# HANDOFF — The Library: resume here (paused 14 Oct 2026, about 17:30 BST)

Jim paused the whole Library build so his token allowance could roll over: *"let's pause this
work - write handover documents for every work in progress in the repo and put them on the
branch for this work ... Let the documents have everything needed for a cold agent(s) to
resume."* Every agent was stopped. Nothing uncommitted was lost: every worktree was clean and
pushed at the pause (checked branch by branch). **This file is the entry point.** It says where
everything is, what is done, what was cut off mid-way, and the order to resume in. The detail
lives in the files it points to, all on this branch (`feat/library-714`).

Read in this order: this file → `docs/library-build/PLAN-parts-4-5.md` (the decided build plan
for parts 4 and 5) → `HANDOFF-library-714.md` (the integration branch's own record) → the part
handoffs as you need them (`HANDOFF-library-art.md`, `-building.md`, `-books.md`, `-shared.md`).

---

## 1. What the Library is, and what Jim has ruled

Epic **#714**, parts **#715** (Blender art kit), **#716** (building and reading room), **#717**
(twelve picture books and the 3D paper-book reader), **#718** (owl librarian, readable shelves,
library card, recommendation, shush, story time), **#719** (secret bookcase door, hidden den,
baby dragon, sleeping library cat). Read the epic first; do not re-ask its questions.

Jim's rulings (13 Oct, three rounds of questions; full record on the epic): a classic pillared
building with steps, fat columns and a pediment with a carved book, signed "The Library"; the
layout solver places its plot by backtracking on every seed; one dim, cosy floor as its own
disjoint space; twelve short picture books about the park, one sentence and one big picture a
page, read in a **3D book mesh with paper-like page turns whose pictures are the game's own
models rendered to textures** (his exact ask; never a DOM panel); a bookmark per book in the
Cute-o-dex and a prize for all twelve; an owl librarian (glasses, cardigan, behind her desk) who
says "Shhh!" to runners and jumpers with no penalty, hands over a library card on the first
visit (an inventory item, like the hotel key), recommends a book that glows until read, and holds
story time with library children on the rug where the player can sit too; a secret door behind
a bookshelf into a hidden room where a baby dragon hoards books (nest, warm glow puff, a new
Cute-o-dex entry); a sleeping cat that purrs and twitches when petted. All models authored with
headless Blender scripts.

**One PR for the whole Library** (13 Oct): *"work autonomously to give just a single PR when
done, so I can give a yes/no or ask for improvements on the work as a whole."* That PR is
**#720** (see §2). Raise no other.

**What changed on 14 Oct**, in Jim's words, and what he was promised:
- *"I still have seen zero - give a summary of what needs to be done before I see a working
  example"*: the parts 1-3 merge was rushed into a draft PR so a preview deployed. He has seen
  it (link in §2). **Promise: his preview is updated as each part lands, not only at the end**
  (move the PR head at each milestone; see §2).
- *"ok so we have an empty room with nothing to read yet, correct?"*: yes. **Promise: reading
  a book straight off the shelf (plan Step 5) is the first thing built**, and his preview is
  updated the moment it lands.
- *"we also need some more grown-up books, these are ok for a 3 year old, so keep them, but add
  more that have ~30 words per page and more involved story lines with jokes, adventure,
  adversaries, conflict, but resolve well. A 6 year old advanced reader needs a bit more."*
  **Promise: six chapter books** (8-10 pages, about 30 words a page) with jokes, adventure,
  someone in the way, a real conflict and a warm ending, on their own shelf, plus a
  **"Big reader"** award for reading all six; the twelve picture books stay exactly as they
  are. This is "track D" (§5).

Talking to Jim: two sentences at most; only work ready to look at, or a question he must answer.
Never a PR link: the preview host from the PR's NEWEST "Deploy PR preview" comment (never
assembled by hand), plus a deep link to the feature, plus one sentence "you will see X when you
do Y". Load the link yourself first. See CLAUDE.md "The browser" and "PRs".

---

## 2. Where everything is at the pause

| branch | head | state |
|---|---|---|
| `art/library-715` | f54f21c0 | done (Blender kit, `library.glb`, `LIBRARY_FACES`, renders, `check:library-glb`, `check:png-integrity`); merged |
| `feat/library-building-716` | f981a57e | done (building on the glb, reading room, colliders, keep-outs, `/library`, `/library-door`, `/library?at=`, `check:library`); merged |
| `feat/library-books-717` | 5a0cb5fd | done (twelve books, paper reader, `/book?id=`, Cute-o-dex bookmarks and prize, `check:book-reader`); merged |
| `feat/library-714-shared` | d02843aa | done (the plan's shared owners outside `src/world/library`: speechTiming, `Player.isRunning`, the 'listening' posture, `CollisionWorld.restoreWall`, SpritePuffs, `visibleReachXZ`, the 'card' kind + `grantKeepsakeOnce` + `libraryCard.ts`, `seatedPose.mts`, NPC seated/driver seams, three chimes); merged |
| `feat/library-714-assets` | 88ac6218 | done (plan Steps 3-4 + the WITH A REAL CHILD harness); merged at 6ab4b8a2 |
| **`feat/library-714`** | this file's commit (on 6ab4b8a2) | **the integration branch.** Holds all of the above plus plan Steps 0-4. Worktree `.claude/worktrees/library-714`. |
| **`feat/library`** | 9e49816b | **head of the draft PR #720.** Trails `feat/library-714`; moved only at milestones (below). |

**PR #720** (draft), head `feat/library`, base `main`; GitHub links it to #714-#719
(`Closes …` in its body).
- **The newest preview** (verified by loading it headless at the pause): built from 8f0cb8c,
  `https://pr-720-8f0cb8c-land-of-good-places.blockstack.workers.dev` + `/library-door` (the
  pillared front with "The Library", standing at the door), `/library` (the dim reading room),
  `/book?id=ripikaBalloon` (a paper picture book; tap the right-hand page). Always re-read the
  newest preview comment: the host changes with every push.
- **CI at the pause:** run **38600489442** on 9e49816b was still running. It carries the fixes
  for the two reds of run 38580957653 (on 8f0cb8c3): Procgen invariants shard 4
  (`railRaceRoadBounded` timed out on a stale seed pin; re-pinned at the cause, 04e98676) and
  Checks shard 8 (its watchdog killed `check:served-book-reader`; frame-counted settling,
  588c413b, and that check on its own shard 9, c136443b). **First job on resume: read that run's
  every job** (`gh run view 38600489442 --json jobs`); if anything is red, root-cause and fix it
  on `feat/library-714` before anything else (zero tolerance; a flake is a failure).
- **Why the PR head is a separate branch:** every push to a PR head starts a CI run that
  re-solves all 16 parks (30-45 minutes) and cancels the run before it, so pushing work in
  progress there would mean no run ever finishes and no preview ever deploys. Work goes to
  `feat/library-714` or a track branch; a milestone moves the PR head by a fast-forward:
  `git push origin feat/library-714:feat/library` (never force; if it is refused, the branches
  diverged: stop and find out why). A push to `feat/library-714` itself runs no CI.

**Worktrees** under `.claude/worktrees/`: `library-714` (integration, clean), and the four
finished part worktrees `library-art`, `library-building`, `library-books`, plus
`library-parks` (a detached park-hydration helper an earlier agent left). All clean and pushed;
remove them when the PR has merged (`git worktree remove`), never before checking they are clean.
The empty track-D branch made just before the pause was deleted (it had no commits).

---

## 3. What is done

- **Parts 1-3 and the groundwork**, merged into `feat/library-714` (merge notes, conflict
  resolutions and the parsed check-chain proof in `HANDOFF-library-714.md`, "The foundation
  merge").
- **Plan Steps 0-4** (`HANDOFF-library-714.md`, "Foundation, first half" and "Foundation,
  second half"): Step 0's facts and baselines; Step 1 change 5 (props `box` returns its walls,
  `detach`/`attach`, den-tagged keep-outs, the zero-length capsule) **plus a Collision fix the
  plan did not know it needed** (a zero-length wall was a ghost to the mover; 773efb7c, guarded
  by `check:wall-tunnelling`); Step 2's `libraryLines.ts` and the brevity loops; Step 3's
  creatures as assets (`libraryCreatures.ts`, `libraryFaces.ts`, `LIBRARY_GLB_STYLES`, PAINTED
  FACES); Step 4's parsed `/library` link; the WITH A REAL CHILD harness in `check:library`.
- **Track D's writing panel**: three writers (funny, adventure, mystery and friendship) wrote
  nine ten-page chapter books; a judge chose six with edit notes. Committed in
  `docs/library-build/chapter-books/` (`DRAFTS.md` to read, `drafts.json` and `judging.json` for
  agents).

## 4. What was cut off mid-way by the pause

1. **The Steps 3-4 merge's checks.** The merge commit 6ab4b8a2 is pushed (clean merge, every
   blob audited; `HANDOFF-library-assets.md` folded into `HANDOFF-library-714.md` and deleted),
   but its engineer was stopped while running the checks. Re-run on the head, exit codes read:
   `pnpm exec tsc --noEmit`, `pnpm run typecheck:test`, `check:library`, `check:assets`,
   `check:brevity`, `check:served-deep-links`, the vitest `test/store/library-card.test.ts`, and
   the scripts typecheck instrument described in `HANDOFF-library-714.md` ("tsc does not see
   `scripts/`"). The park source hash after this merge is `d283ffaa…` (same section): seed 5
   was being built for it.
2. **The chapter books' editor.** Not run. Run `docs/library-build/workflows/chapter-editor.js`
   (Workflow tool) or give its prompt to one agent: it applies the judge's notes and writes the
   final JSON to `.claude/library-build-scratch/chapter-books.json`. **Commit that file to
   `docs/library-build/chapter-books/final.json`** so it cannot be lost again.
3. **Track D's engineering base** (`infraTask` in `docs/library-build/workflows/library-build.js`).
   Not started.

## 5. What remains, in order

Everything below is specified in `docs/library-build/PLAN-parts-4-5.md` (Steps 5-15, each with
files, changes, the check it adds and the red that proves it), with the overrides written into
`docs/library-build/workflows/library-build.js` (the per-step "notes" and the merge prompts).
The overrides that matter: tracks instead of one engineer; the groundwork already did Step 1's
changes 1-4, 6, 7, Step 2's state slice, Step 7's `seatedPose.mts` and 'listening' posture, and
Step 8's NPC seams (verify, never rebuild); the harness exists; the PR is already open.

0. **CI first** (§2), then **finish §4.1** on `feat/library-714`. Its head is then the
   *foundation head* every track cuts from.
1. **Two foundation reviews**, in parallel with the tracks: one proves nothing from the four
   source branches was lost in the merges (file by file, and the check-chain step sets parsed,
   never grepped); one reviews Steps 0-4 against the plan and breaks their checks deliberately.
   Their findings are fixed at the first merge (step 3 below).
2. **Four tracks in parallel**, each on its own branch and worktree cut from the foundation head,
   each step reviewed while the next is built:
   - **A** `feat/library-714-owl`: Step 5 (the readable books on their shelves), then Step 6 (the
     owl: solid, alive, card, recommendation, shush). **Jim was promised Step 5 first: when it is
     green, move the PR head to A's Step 5 commit (a fast-forward; it descends from the
     foundation head) so his preview lets him read off the shelf**, and tell him with the link.
     Never type twelve: every count derives from `BOOKS.length`, because track D grows it.
   - **B** `feat/library-714-kids`: Step 7 (sitting on the cushions; note the groundwork found
     that `seatedErrors` cannot see ONE lifted foot, so Step 7's red must rotate BOTH legs), then
     Step 8 (the three library children; the `parkFacts` exclusion or every seed fails).
   - **C** `feat/library-714-den`: Steps 11, 12, 13 (den walls and lintel, the secret leaf with
     both collider states and the guard, the baby dragon and the sleeping cat). The owl's shush
     suppression in the den and the labels-scene visits wait for the join.
   - **D** `feat/library-714-books2` (re-create it from the foundation head): after §4.2, the
     engineering base (a book kind; one file per chapter book plus one index; the reader's
     chapter page with a picture and a paragraph, legible on a laptop and on a phone held upright
     within GAME_DESIGN.md's TEXT/UI-SCALE rule, measured by `check:book-reader`; a brevity
     shape for chapter pages, 20-40 words, sentences at most 120 characters, keyed to the chapter
     kind only and proved not to leak; six more `LIBRARY_READABLE_SLOTS` on a "big readers"
     stretch of shelving clear of the secret shelf, the den wall, the desk, the cushions and the
     children's aisles; the existing all-books prize stays tied to the twelve picture books; a
     SECRETS row `secret.bigReader` "Big reader" 📚 "You read every chapter book!"; one predicate
     saying which books story time may read: picture books only); then two engineers picture
     three books each in parallel and LOOK at every page; then a merge and a review.
3. **Merge A and B** into `feat/library-714` (and D if it is done), fixing the foundation
   reviews' and the tracks' last review findings first; then **Step 9** (story time; it reads
   picture books only, through D's predicate) and **Step 10's labels scene and tap spacing**;
   then a milestone push and a message to Jim.
4. **Merge C (and D)**, then **Step 14** and every "For the join" item in the track handoffs
   (at least: no shush in the den, story time carries on while she is in the den, the labels
   scene's cat and dragon visits); milestone push.
5. **Finish**: a review of the join and browser QA on the deployed preview, in parallel; fix;
   every PR check green; QA again until approved.
6. **The PR**: merge `origin/main` in (rebuild any check-chain resolution from parsed step sets;
   pass `-c rerere.enabled=false`), rewrite the body ("What to look at" with deep links and one
   sentence each, the chapter books, the visible decisions: the open-book pediment, the secret
   bookcase swinging into the den rather than the room, three children rather than four), QA
   screenshots on the `qa-screenshots` orphan branch, a "QA: approved" comment, `gh pr ready`,
   and ONE peer review posted as a comment whose first line is the verdict.
7. **Tell Jim**: the newest preview link with a deep link and the sentence. The plan's
   "Preview paths" table has the five deep links and their sentences; add the chapter shelf.

## 6. Relaunching the pipeline (for an orchestrator)

`docs/library-build/workflows/library-build.js` is the exact Workflow script that was running,
with its paths made stable (`SCRATCH` is the gitignored `.claude/library-build-scratch`, `PLAN`
is this branch's committed copy). It skips any stage whose result is passed in
`args.cached[<key>]`. Minimal cached object for a finished stage:
`{ "baseCommit": "…", "headCommit": "…", "commits": [], "done": [], "notDone": [], "checks": [], "reds": [], "deviations": [], "forJoin": [], "conflicts": [], "ci": "none" }`.

| key | stage | state | head |
|---|---|---|---|
| F1A | the merge and the draft PR | done | 009dea3e (base d2cdb1f2) |
| F1B | Steps 0, 1 change 5, 2 | done | 9e49816b |
| F2 | Steps 3-4 + harness | done | 88ac6218 |
| FM | merging F2 in | **checks cut off (§4.1)**: finish by hand and pass it cached with the verified head, or let it run (its prompt resumes) | 6ab4b8a2 |
| Dw1-Dw3, Dj | chapter writers, judge | done (committed files) | — |
| De | chapter editor | **not run (§4.2)** | — |
| everything else | | not started | |

Pass `"writingElsewhere": true` so track D does not re-run its writers (its book engineers read
the editor's JSON from `.claude/library-build-scratch/chapter-books.json` and wait for it if
needed). Dry-run every edit before launching: `node docs/library-build/workflows/dryrun.mjs happy`
(it stubs `agent()`; scenarios `happy`, `relaunch`, `dieC`, `deadWriters`).

Lessons from running it, so they are not paid for twice:
- **A workflow resume replays only the longest unchanged prefix** of agent calls; a failure in
  the middle makes everything after it run live again. Pass finished results in `args.cached`
  (the script's own mechanism) instead of relying on resume.
- **Usage limits stop agents mid-run** (Fable's did on 14 Oct). Subagents inherit the session's
  model; never hard-code one. Every prompt is written so a replacement agent can resume from the
  branch's handoff.
- **The prebuilt parks**: almost every file here is inside the parks' source closure, so each
  commit has a new park hash and a World-building check must first solve a park (seed 5 alone
  is about 20 minutes). How to hydrate `.parks` from CI's artifact or a sibling worktree whose
  manifest hash matches, and how to build only the seed you need: `HANDOFF-library-shared.md`,
  and the dev-server hash trap in `HANDOFF-library-building.md`. Batch edits before running
  World-building checks; leave the full gate to the PR's CI at milestones.
- **`tsc` does not typecheck `scripts/`** (by design); after a merge that touches check scripts,
  use the scratch tsconfig instrument in `HANDOFF-library-714.md`.
- **rerere**: this repo's `.git/config` has it off today although CLAUDE.md says on; pass
  `-c rerere.enabled=false` on every merge so the answer is certain, and rebuild check chains
  from parsed step sets.
- **A pre-existing `/reptile-house?at=` race in `check:deep-links`** was fixed twice (art
  69dfa5df, books 9083ecd4); the integration kept the root-cause version. If it ever flakes,
  read both commits before touching it.

## 7. Risks to keep an eye on

The plan's own "Risks to watch" section, plus: track D's six new shelf stands must not land on
track B's cushion seats and kid routes or track C's den wall (all three are keep-outs proved by
`check:library`'s REACHABILITY and `props.assertClear`); the chapter page's text size against
TEXT/UI-SCALE on a phone held upright; the owl's clearance to the z = 4 aisle (0.03-0.05 m;
move her spot south by up to 0.2 m, never shrink her radius); the canvas count with three
children (print it; the lever is two children).
