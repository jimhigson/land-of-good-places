# The Library, parts 4 and 5 — one build plan (#718 owl & readable shelves, #719 secret den, dragon & cat)

Epic #714. This plan is for **one engineer** building both parts, in order, on the integration branch that carries parts 1–3. Nobody is available to ask: every ambiguity is decided here, with its reason, in **Decisions** at the end.

## What was read (read-only; nothing was edited)

| where | commit | notes |
|---|---|---|
| `art/library-715` (`.claude/worktrees/library-art`) | `6071175bd4264166484bd78f0d0e6bef326af990` | `src/art/assets/library.glb` parsed: 65 nodes, 0 materials. `libraryGlb.ts` exports `LIBRARY_GLB_BASE64` **and `LIBRARY_FACES`** |
| `feat/library-building-716` (`.claude/worktrees/library-building`) | `d937dac77d8b861425c5093834b0993fcfec514f` | every `src/world/library/*`, `libraryAssets.ts` (primitives), `check-library.mts` |
| `feat/library-books-717` (`.claude/worktrees/library-books`) | `1b3fce2a7ff6272346d1b566e3534d00cd6cdc44` | has an uncommitted edit to `reader/BookReader.ts` (someone's live work; untouched) |
| `origin/main` | `d2cdb1f2b3b38918c28fa92f3ed25ba83c74d37d` | the CLAUDE.md that binds (see "Ground rules"). The shared checkout (`a354d5c9`) was read only. |

No integration branch existed at read time.

**What changed since the six designs were written.** They quoted older commits, so these corrections apply everywhere below:
- **The owl:** `owl-head`'s pivot is `(0, 0.735, 0.020)`, not 0.851. `owl-beak` and `owl-glasses` carry **the same translation**, so they hang under the head at local (0,0,0). `owl-wingL` is at `(0.340, 0.698, 0)`; `owl-wingR` and `owl-heldBook` are at `(-0.340, 0.698, 0)`. The plan reach measured off the file is about 0.65 m (head ±0.614, glasses front z 0.616); the body alone is ±0.40.
- **The dragon:** `dragon-horns` now **rides the head pivot** `(-0.044, 0.434, 0.060)`, and `dragon-spines` is a separate node at the origin. **A real head turn is therefore safe.** `dragon-tail` pivots at `(-0.070, 0.128, -0.339)`. Height 0.90 m (horns).
- **The nest:** `dragonNest-pad` top 0.145; covers top 0.19; plan radius about 0.80.
- **The cat:** `cat-head` pivots at `(-0.051, 0.124, 0.040)`. `cat-earL` and `cat-earR` are siblings at `(-0.018 / -0.198, 0.271, 0.100)`. `cat-tail` pivots at `(0.125, 0.058, -0.143)`. Height 0.35.
- **The book pile:** top 0.900; plan x −0.444..0.444, z −0.309..0.346.
- **The secret shelf:** `secretShelf-carcass` spans x 0..4, y 0..3.2, z −0.6..0, with its origin on the front-left vertical edge. `shelf-carcass` is the same case, centred.
- **Face figures are owned by the art**, as `LIBRARY_FACES` in `libraryGlb.ts`, packed from glb extras and asserted by `check:library-glb`. **Never type them.**
  - owl: eyes `[0.6827, 0.5494, 0.3173, 0.5494]`, window `1.2272 × 0.9873 m`, rim `[0.1073, 0.1296]`;
  - dragon: eyes v 0.5, window `0.7579 × 0.5125`;
  - cat: eyes v 0.4423, window `0.3835 × 0.3055`.
- **The books branch no longer creates `src/art/models/libraryAssets.ts`.** Its models are in `src/world/library/reader/readerAssets.ts` (`createStoryDragon` is there), so there is no add/add conflict.
- **The art render script `art/blend/library_render.py` reads colours out of `src/art/models/libraryAssets.ts`.** It uses a regex for `name: { … colour: PALETTE|ART.key }`, so creature colours must live there, as literal keys.

## What she will see when it is done

She walks into the dim library. A round owl in a lilac cardigan and big glasses stands behind the desk, blinking. The owl turns her head to watch her and says *"Come to my desk for your library card!"*

She presses **Get a library card!** The owl beams through four short lines, and on *"Here is your very own library card!"* the room flashes, a chime plays, sparkles rise and the owl flaps a wing. A 🪪 Library card is now in her backpack. Pressing **Say hello!** later gets *"Try “Fireflies at Night” next!"*, and across the room one book that stands proud of its row starts to glow and twinkle; its chip says **Read me!**. The twelve real books on the shelves all lean out a little and say **Read it!**, and pressing one opens the paper book. If she sprints or jumps, the owl raises her free wing and a *"Shhh!"* pops up; nothing else happens.

**Story time.** Every couple of minutes the owl calls *"Come and sit on the rug for story time!"* and flies over the bookcases to the big armchair. Three library children walk down the aisles and sit on the rug, legs down and hands in laps, facing her. She reads a whole picture book aloud, one sentence at a time, then everyone wanders off and the owl flies home. Two cushions always offer **Sit down**. Sitting through a whole story earns a **Story listener** card.

**The secret den.** On the north-west wall, a gold book that twinkles now and then sticks out of one bookcase. **Pull the book!** slides it out with a creak, and the whole bookcase swings slowly **away from her**, into a dark gap in the wall, and lands with a thunk. Behind it is a tiny secret room. On a nest made of books sits a mint baby dragon: it breathes, blinks and flicks its tail, and turns its head to look at her. It puffs a warm glow, says *"Oh, a visitor for me!"*, and a **Dragon friend** card appears in the Cute-o-dex. **Say hi!** makes it puff again. She can walk back out whenever she likes, and the next time she comes in from the park the bookcase is back in place, ready to be found again.

**The cat.** By the desk, in the lamp's pool, a ginger cat sleeps on a pile of five fat books. **Pet the cat!** makes it lift its head, twitch its ears, smile, send up hearts and purr.

## How this plan was chosen

- **Part 4** builds on design 1 (six-year-old delight), the judges' 85-point winner. It takes these grafts:
  - from design 0: a genuinely solid owl; readable books in stacks that fade with their stack; a measured flight clearance; Sit chips only on the cushions no child takes; declared kid routes swept by a check; one shared `residentLooks` module; the `story=now` link parameter; the `shift-books` mutation.
  - from design 2: verify the base before editing; assert cushion height = `KID_HIP_HEIGHT`; a served check that presses a shelf chip; save round-trip cases; a tap anywhere gets her up; a wing-only shush while she is talking; vacuity guards; a texture-count note.
- **Part 5** builds on design 1 (the leaf swings into a walled pocket of the library), the declared winner on an 83–83 tie. It takes these grafts:
  - from design 0: one owner for "she is in the den" (`libraryDenContains`); a drawn lintel with a banded collider; the dex awarded on *meeting* the dragon, with a control; the leaf drawn from the same source as its neighbours.
  - from design 2: the twinkling special book; dragon lines with personality; den links that cannot be saved; the dragon's colours shared with the storybook's dragon; `'wall'` tops on the nest and the pile; a resident-avoidance clause armed by a mutation.
  - fixes for the judges' findings on design 1: the lintel; den contents hidden while the shelf is shut; the guard opening instantly; honest measured radii; a post-swing mutation that can actually go red; a real head turn.

---

## Ground rules for this build (origin/main CLAUDE.md, plus what is decided here)

1. **Shell first.** Run `fnm use --install-if-missing`, then `pnpm exec node -e "console.log(process.env.npm_config_user_agent)"`, which must report pnpm 12.1.0. Use `pnpm`, never `npm`. **Never `git stash`.** Never `git add -A` or `.`; name every file.
2. **Branch.** The integration branch is the remote branch whose history contains the current tips of all three of `origin/art/library-715`, `origin/feat/library-building-716` and `origin/feat/library-books-717`. Test each candidate with `git merge-base --is-ancestor`; if several qualify, take the most recently committed. Work in a worktree on a local branch `feat/library-parts-4-5` cut from it, and push with `git push origin HEAD:<integration>`. If a push is rejected, `git pull --rebase origin <integration>` and push again. **Fallback, only if no branch qualifies:** create `feat/library-714` from `origin/main`, merge art, then building, then books, rebuild each `check:shard-N` chain as main's steps plus each branch's additions, and record it in the handoff. **Raise no PR.** Jim's 13 Oct ruling is one PR for the whole Library, raised from the integration branch by the workflow (`HANDOFF-library-art.md`).
3. **Commit and push after every step,** and after every edit inside a step that would be annoying to redo. Keep `HANDOFF-library-owl-den.md` on the branch, updated at every step.
4. **Gates.** Almost every file here is in the prebuilt-parks source closure. Measured with `parkSourceClosure`: `src/world/library/*`, `libraryAssets.ts`, `World.ts`, `NpcSystem.ts`, `NpcCharacter.ts`, `Player.ts`, `ridePose.ts`, `Collision.ts`, `SpeechBubble.ts`, `chime.ts`, `state/types.ts`, `store.ts` and `secrets.ts` are all inside it. So every commit changes the park hash.
   - **Each step:** run its named targeted checks, plus `pnpm exec tsc --noEmit` and `pnpm run typecheck:test`. Read exit codes and never pipe through `tail` or `head`.
   - **At the end of part 4, the end of part 5, and before handback:** run the **full gate**: `pnpm run check`, `pnpm run test:procgen`, `pnpm run check:coplanar`, `pnpm run check:swept-bus` and `pnpm run build`. When the local accepted parks miss the new hash (a fresh worktree has none), dispatch CI on the branch with `gh workflow run ci.yml --ref <integration>`, as the art agent did in run 38537415092, and read **every** job's result.
   - **Why WIP pushes are allowed before the full gate:** the integration branch has no open PR, so a push runs no CI and cannot merge anything. Nothing is handed over without the full gate green.
5. **TypeScript.** `exactOptionalPropertyTypes` applies: omit optional fields, never assign `undefined`. `erasableSyntaxOnly` applies: no parameter properties and no enums.
6. **Browser.** If the Overseer grants the browser: run your own dev server with `--strictPort` on a port nobody uses, and kill it by PID. Pages open with `background: true` and close the moment they have been read. Links for Jim come only from the PR preview comment, or from a **build served by `vite preview`**, never from a dev server.

---

## The seams both parts share, and who owns them

| seam | the single owner | part 4 adds | part 5 adds |
|---|---|---|---|
| positions, stand spots, routes | `src/world/library/layout.ts` | the five cushion seats; kid plans and routes; the owl spot leaves the keep-outs | den rectangle and stands, `libraryDenContains`, nest, cat pile and stand, secret book slot, sconce move |
| solids and keep-outs | `src/world/library/props.ts` | the owl's zero-length capsule | both leaf collider sets (`box` returns its walls; `attach`/`detach`), den-tagged keep-outs |
| every word | `src/world/library/libraryLines.ts` | owl, story and chips | dragon, cat and chips |
| every creature colour | `LIBRARY_GLB_STYLES` in `src/art/models/libraryAssets.ts` | owl | dragon, nest, cat, pile |
| `Library.interactZones()` | `Library.ts`, one method | owl Talk; Read ×12; Sit ×2 | Pull; Pet; Say hi |
| `Library.screenLabels` | `Library.ts` | `owl.bubble` | `creatureBubble` |
| `Library.update()` order | `Library.ts` | story → owl (speech, flight, shush) → glow → seated jump | leaf + guard → dragon/cat + dex → faders → den visibility |
| entering and leaving | `enterRoom` / `standOutside` / `adoptRestoredPlayer` | kids visible; story aborted on leaving; greeting reset | leaf open iff she is in the den; closed on leaving |
| `doorBands()` | `Library.ts` | — | 3rd band: the den doorway (fires nothing) |
| the check | `scripts/check-library.mts` | real-player harness; READABLE, OWL, CARD, RECOMMEND, SHUSH, SIT, KIDS, STORY, FLIGHT, PAINTED FACES | DEN WALLS, LINTEL, SECRET SHELF, CREATURES, LIGHT den cells, KIDS den-avoidance |
| mutation hooks | one allow-list in check-library | `faces-upside-down`, `shift-books`, `card-twice`, `block-route`, `block-cushion`, `no-story` | `no-lintel`, `seal-den`, `open-leaf-hollow`, `resident-in-den` |
| deep links | one parsed `/library` kind in `main.ts` | `?at=&facing=&story=now` | `/library-den` (ride-table entry); den links unsavable |
| puffs of sprites | `src/art/effects/spritePuffs.ts` | card sparkles, glow twinkle | dragon puffs, cat hearts |

## Numbers and their single owners

| number | value | owner |
|---|---|---|
| line hold time | `min(3.8, max(2.1, 1.5 + words × 0.22))` | `src/ui/speechTiming.ts` (moved out of Hotel.ts) |
| running | `DUST_SPEED` (`PLAYER_MAX_SPEED × 1.12`, private) through `Player.isRunning` | `Player.ts` |
| owl collider radius | `visibleReachXZ(owl.root)`, measured (≈0.65) | `LibraryOwl.ts` reads `measure.ts` |
| owl spot | `LIBRARY_LIBRARIAN_SPOT (6, 5.3)`; may move south by ≤0.2 m only if AISLES or the desk clearance fails (never shrink the radius) | `layout.ts` |
| shush | run 0.35 s, cooldown 6 s, wing −1.3 rad for 1.2 s | `LibraryOwl.ts` |
| card | `card.library`, kind/category `card`, cheer at line 2 | `libraryCard.ts`, `libraryLines.ts` |
| glow | emissive 0.25 + 0.35·(½ + ½·sin(2.4t)); twinkle every 1.4 s | `LibraryOwl.ts` |
| readable book | the tallest, thickest `libraryBookShapes()` shape; 0.03 m proud; 0.1 rad lean | `furnish.ts` (`READABLE_PROUD`, `READABLE_LEAN`) |
| flight | 3.2 s; cruise = `libraryBookcaseSize('stack').height` + 0.6; plateau t ∈ [0.2, 0.8] | `LibraryOwl.ts` (`owlFlightPose`, exported pure) |
| perch | `libraryArmchairSize(true).seat` and new measured `.seatCentre` | `libraryAssets.ts` |
| story clock | first after 40 s inside, then every 150 s; gather timeout 40 s | `storyTime.ts` |
| kid pace | stroll `GUEST_PACE` 0.45 (lifted); summons 0.7; route arrive 0.45; seat arrive 0.5; leg timeout 30 s | `residentLooks.ts`, `libraryKidDriver.ts` |
| separations | `SEPARATION` (exported); `PLAYER_SEPARATION` (**export it**) | `NpcSystem.ts` |
| cushion top | `KID_HIP_HEIGHT` (0.36, `art/models/kid.ts`) | `libraryAssets.ts` (asserted in `Library`) |
| seated-pose tolerances | floor 0.015, hip 0.003 | `scripts/lib/seatedPose.mts` (lifted from check-castle) |
| seeds | owl `0x0b00c4`; kids `0x0b00c5 + i·997`; recommend `0x0b00c9`; dragon `0x0b00d1`; cat `0x0b00d3`; fx `0x0b00d5` | each module's own named constant |
| den | depth 5.6, door half 2 (asserted against the measured case length / 2 within 0.02), north 1.6 past the gap | `layout.ts` |
| lintel base | case height − `JUMP_CLEARANCE_GRACE` − 0.05 | `shell.ts` (grace exported from `Collision.ts`) |
| leaf | slide 0.12 m over 0.3 s; swing 1.6 s ease-out cubic to +π/2 | `secretShelf.ts` |
| dragon | meet radius 2.2; puff 1.2 s; belly emissive rest 0.2, peak 1.2; idle puff 9–14 s; tail flick 5–9 s; look within 3 m | `LibraryDen.ts` |
| cat | pet 2.2 s; re-pet guard 0.5 s | `LibraryCat.ts` |
| lights | budget stays 8: no new `PointLight` | `lighting.ts` (unchanged) |

---

## The build, in order

Every step leaves the game working and checkable. Each step lists its **files**, **changes**, the **check** it adds, and how that check is **proved red**. Paste every red transcript into the handoff together with the geometry it was proved against (seed, coordinates, sizes).

### Step 0 — Base, worktree, baselines, handoff
- **Do:**
  - Find the integration branch (Ground rule 2), add the worktree `.claude/worktrees/library-parts-4-5`, run `pnpm install --frozen-lockfile` and the shell checks (rule 1).
  - **Read, don't assume:**
    - `src/art/assets/libraryGlb.ts` exports `LIBRARY_GLB_BASE64` and `LIBRARY_FACES` with all three heads.
    - The glb node list and pivots match the "What changed" list above. Parse with `readGlbParts` in a scratch script outside the repo.
    - `BOOKS.length === LIBRARY_READABLE_SLOTS.length === 12`.
    - Which source `libraryAssets.ts` draws the wall cases, cushions and armchairs from (primitives or glb). Print `libraryCushionSize().top`, `libraryArmchairSize(true).seat` and `libraryBookcaseSize('wall')`.
    - Whether `libraryAssets.ts` already imports `LIBRARY_GLB_BASE64`.
    - Parse `node -e "console.log(Object.keys(require('./package.json').scripts))"` and write down the **set** of steps in each `check:shard-N` chain. `check:library` is in shard 4, `check:library-glb` and `check:png-integrity` in shard 1, `check:served-book-reader` in shard 8.
  - **Baselines** (exit codes, clause counts copied off the screen): `check:library`, `check:labels`, `check:tap-spacing`, `check:brevity`, `check:assets`, `check:hotel`, `check:reptile-house`, `check:npc-presence`, `check:jitter (scripts/check-npc-jitter.mts)`, `check:climb-wave`.
- **Files:** `HANDOFF-library-owl-den.md`, holding the facts above, the decisions list, the step checklist and your dev-server port and PID when you have one.
- **Check:** none new. Every later red must be attributable to this branch.

### Step 1 — Shared owners, no visible change
- **Files:** `src/ui/speechTiming.ts` (new), `src/world/hotel/Hotel.ts`, `src/entities/Player.ts`, `src/entities/ridePose.ts`, `src/world/Collision.ts`, `src/world/library/props.ts`, `src/world/library/layout.ts` (types only), `src/art/effects/spritePuffs.ts` (new), `src/world/reptileHouse/ReptileHouse.ts`, `src/art/style/measure.ts`.
- **Changes:**
  1. **`speechTiming.ts`** exports `lineSeconds(line)`, moved verbatim from `Hotel.ts`, whose private copy is deleted in favour of an import. Two speakers, one rule.
  2. **`Player.isRunning`.** Add `get isRunning(): boolean`, true when not airborne, not riding, and the **same planar speed `spawnRunningDust` measures** is at least `DUST_SPEED`. Read its definition and reuse it exactly. `spawnRunningDust` then starts `if (!this.isRunning) return;`. Dust, `secret.dust` and the owl now share one definition, and `DUST_SPEED` stays private.
  3. **`ridePose.ts`.** Add `'listening'` to `RidePosture`, and `applyListeningPose(model, elapsed)` dispatched beside `'dining'`, before the seated fallthrough. It is the dining pose's skeleton with the eating taken out:
     - `root.rotation.x = 0`;
     - **both legs `rotation.x = 0`** (the load-bearing line: a knee-less rig with feet on the floor from a `KID_HIP_HEIGHT` seat);
     - `body.rotation.x = DINING_LEAN`, `body.rotation.z = 0`;
     - arms `rotation.x = LISTEN_ARM_X + sin(elapsed·1.3 or ·1.1+1)·0.04`, `rotation.z = ±0.3`;
     - `head.rotation.x = LISTEN_CHIN + sin(elapsed·1.3)·0.03` with `LISTEN_CHIN = −0.08` (negative is chin up; the dining pose's +0.16 is chin down);
     - `head.rotation.z = 0`.
     `LISTEN_ARM_X` starts at −0.95 and is **measured**. Build a kid in a scratch script, apply the pose, and read both hands' lowest vertices. They must sit forward of the hip pivot (z > +0.05) and between `KID_HIP_HEIGHT` and `KID_HIP_HEIGHT + 0.25` high. Write the measured y and z into the doc comment, as the dining pose does. `elapsed` is expected to carry the sitter's own phase.
  4. **`Collision.ts`.** Add `restoreWall(wall)`: if the wall is already present, return; otherwise push the **same** object and bump `revisionCounter`. Export `JUMP_CLEARANCE_GRACE`. In the `removeWall` and `removeCircle` docs, name the library's two toggles: the owl's capsule while she flies, and the secret leaf.
  5. **`props.ts`.**
     - `box()` returns its three `WallCollider`s (body, left end, right end).
     - Add `detach(walls)` (calls `removeWall` on each) and `attach(walls)` (calls `restoreWall` on each).
     - `KeepOut` gains `den?: true`, and so does `StandSpot` in `layout.ts`. `libraryKeepOuts()` copies it.
     - `wall(what, a, a, r, top)` with `a == b` is the zero-length capsule the owl uses. `segmentDistance` and the collision world already handle length 0.
  6. **`spritePuffs.ts`.** Lift `ReptileHouse`'s private `HeartPuffs` verbatim as `SpritePuffs(parent, count, colour = PALETTE.markerPink, scale = 0.35)`, with `puff(x, y, z, rng, count = 3)` and `update(dt)`. Keep the **same two `rng.range` draws per sprite, in the same order**. `ReptileHouse` constructs `new SpritePuffs(this.hallRoot, 12)`.
  7. **`measure.ts`.** Add `visibleReachXZ(root)`: the largest `hypot(x, z)` over `visiblePoints` in root's frame.
- **Check:** `check:hotel`, `check:reptile-house`, `check:climb-wave`, `check:library`, `check:assets` and tsc all green, with **identical clause counts to Step 0**. Pure refactors.
- **Red:** none to add. Pasting the before/after counts is the proof that nothing moved.

### Step 2 — Who owns the words, and who owns "has she got the card"
- **Files:** `src/state/types.ts`, `src/state/store.ts`, `src/world/library/libraryCard.ts` (new), `src/world/library/libraryLines.ts` (new), `scripts/check-copy-brevity.mts`, `test/store/library-card.test.ts` (new), `test/procgenShards.ts`.
- **Changes:**
  - **`types.ts`.**
    - Append `'card'` to `INVENTORY_KINDS`. Doc: a keepsake she is given, never worn, carried, eaten or paraded. `wearableSlot` → null, `isEdible` → false, not in `PARADE_KINDS`.
    - Append `'card'` to `CUTE_CATEGORIES`, after `'book'`. Doc: filed so its collection entry survives a load. There is no Cute-o-dex section for it, so the dex total does not change (the dex counts CATALOGUE + flowers + BOOKS + SECRETS only).
    - Make these state edits in one commit.
  - **`store.ts`.** Add `grantKeepsakeOnce(spec: PurchaseSpec): InventoryItem` beside `catchWildPetOnce`: `grantFreeOnce(spec, false)`, then `notify()`. It is idempotent by catalogue id, and `acquiredAt` stays the first day she got it.
  - **`libraryCard.ts`.**
    - `LIBRARY_CARD: PurchaseSpec = { id: 'card.library', kind: 'card', displayName: 'Library card', icon: '🪪', category: 'card', shopId: 'library', price: 0, carryable: false }`.
    - `hasLibraryCard(state)` is true when `state.inventory` has an item with id `card.library`. **The inventory is the one owner; there is no `flags.ts` field.**
    - `giveLibraryCard()` calls `gameStore.grantKeepsakeOnce(LIBRARY_CARD)`.
  - **`libraryLines.ts`.** The one table of every word both parts say. Every entry is one sentence of at most 50 characters (lines) or at most 24 (titles), and every book title in a template is wrapped in “ ” so a title's own "!" never reads as a sentence end.
    ```ts
    export const LIBRARY_LINES = {
      owl: {
        welcome: 'Come to my desk for your library card!',
        shush: 'Shhh!',
        card: ['Hello, little reader!', 'Walk softly and treat the books kindly.',
               'Here is your very own library card!', 'Every book here is yours to read.'],
        cardCheerAt: 2,
        helloAgain: 'Hello again, little reader!',
        recommendLead: 'Looking for a story?',
        recommend: (title: string) => `Try “${title}” next!`,
        recommendGlow: 'It is glowing on its shelf!',
        allRead: ['You have read every book here!', 'Come back for story time!'],
        storyCall: 'Come and sit on the rug for story time!',
        storyBegin: (title: string) => `Today's story is “${title}”.`,
        storyEnd: ['The end!', 'Off you go, little bookworms!'],
      },
      dragon: { firstHello: 'Oh, a visitor for me!', hello: 'Hello again, friend!',
                hi: ['I love my books!', 'I keep books, not gold!', 'Do you like stories too?'] },
      cat: { purr: ['Prrrrr…', 'Mrrrp!'] },
    } as const;
    export const LIBRARY_CHIPS = { getCard: 'Get a library card!', hello: 'Say hello!', read: 'Read it!',
      readGlowing: 'Read me!', sit: 'Sit down', getUp: 'Get up', pull: 'Pull the book!',
      sayHi: 'Say hi!', pet: 'Pet the cat!' } as const;
    export function libraryCopyForBrevity(): { key: string; shape: 'title' | 'line'; text: string }[];
    ```
    `libraryCopyForBrevity()` returns:
    - every fixed line as `line`;
    - every template rendered with **every** `BOOKS` title as `line` (`libraryLine:owl.recommend:<bookId>`);
    - every chip as `title`;
    - `LIBRARY_CARD.displayName` as `title`.
    Story narration itself is the books' own pages, which are already walked.
  - **`check-copy-brevity.mts`.** In `collect()`, add a loop over `libraryCopyForBrevity()` and a loop over `SECRETS` (each `name` as title, each `done` as line; their longest today is 41 characters, so nothing is new on the ratchet).
  - **The vitest** (MemoryStorage window, lazy `import()` of `save.ts`, in the `save-flags-round-trip` shape), registered in the `PROCGEN_SHARDS` entry that already lists `test/store/save-flags-round-trip.test.ts`. Four cases:
    1. `grantKeepsakeOnce(LIBRARY_CARD)` twice gives exactly one `card.library`, with `acquiredAt` unchanged, kind and category `card`, stowed true and paradeable false.
    2. `writeSave`/`loadSave` keeps that item and its `collection` entry.
    3. A save from before the library loads with `hasLibraryCard` false.
    4. An item with kind `'cardz'` is dropped while the rest of the inventory survives.
- **Check:** `check:brevity` lists the new `libraryLine:` keys (quote the count); `pnpm exec vitest run test/store/library-card.test.ts` passes; `check:seed-coverage` passes.
- **Red:**
  - Make `owl.welcome` read `'Welcome! Come to my desk.'`: brevity red on `libraryLine:owl.welcome`.
  - Delete `'card'` from `INVENTORY_KINDS`: cases 1 and 2 go red (the item is dropped on load).
  - Paste both, then revert.

### Step 3 — The library's creatures as assets: owl, dragon, nest, cat, book pile
- **Files:** `src/art/models/libraryAssets.ts`, `src/art/models/libraryFaces.ts` (new), `src/art/models/libraryCreatures.ts` (new), `src/world/library/reader/readerAssets.ts`, `scripts/check-asset-contract.mts`, `scripts/check-library.mts`.
- **Changes:**
  - **`libraryAssets.ts`.**
    - Add `export const LIBRARY_GLB_STYLES: Record<string, PartStyle>`, keyed by **glb node name** and written with literal `PALETTE.`/`ART.` keys, so `art/blend/library_render.py`'s regex renders the game's own colours. The colours are the Artist's PROPOSED table in that script, with one change: `dragon-wings` is `ART.miniLilac`, the storybook dragon's wings.
      - owl: `owl-body` markerLilac, `owl-bib` ART.biscuitMuzzle, `owl-buttons` liftFrame, `owl-head` ART.biscuitFur (outline 0.016; face `map` set by the factory), `owl-beak` ART.chickenBeak, `owl-glasses` liftFrame (0.012), `owl-wingL`/`owl-wingR` ART.biscuitFurDark (0.016), `owl-feet` ART.chickenBeak, `owl-heldBook` ART.jumperRed.
      - dragon: `dragon-body`/`dragon-head`/`dragon-tail` ART.snakeMint (0.016), `dragon-belly` ART.snakeBelly (with an emissive set by the factory), `dragon-horns`/`dragon-spines` ART.miniHorn, `dragon-wings` ART.miniLilac.
      - nest: `dragonNest-pad` ART.heartPink, `dragonNest-coversA/B/C` markerSky / markerLemon / ART.jumperRed (0.012), `dragonNest-pages` ART.cream.
      - cat: `cat-*` ART.corgiTan (0.016).
      - pile: `bookPile-cover1..5` markerSky, ART.jumperRed, markerMint, markerLemon, markerLilac (0.012); `bookPile-pages` ART.cream.
      - The `secretShelf-*` and `shelf-*` rows are added in Step 12, only if the cases come from the glb.
    - Add `libraryKit()`: a memoised `loadReptileKit('library.glb', LIBRARY_GLB_BASE64, LIBRARY_GLB_STYLES)`. If `libraryAssets.ts` already decodes the glb at integration, extend that decode instead. **One decode, one table.**
  - **`readerAssets.ts`.** `createStoryDragon` takes its body, belly, horn and wing colours from `LIBRARY_GLB_STYLES['dragon-*'].colour`, replacing its own `ART` literals. The values are identical, so the pictures do not change. Its other details (`PALETTE.leafLight` scales) stay. One dragon, one look.
  - **`libraryFaces.ts`.** Three cached, `markShared` face sets, painted the `snakeFace.ts` way: ink on an opaque white fill, so the head's material colour tints it, uploaded with `planarUvCanvasTexture` (flipY true; **never `glbCanvasTexture`**). The top row and the top-left 8% are plain fill, for the parked back faces. **All geometry comes from `LIBRARY_FACES`:**
    - canvas W = 512 and H = `round(512 × window_m[1] / window_m[0])`, which gives owl 412, dragon 346, cat 408;
    - the square `paintFace` patch is painted at `size: H` and blitted at x = (W − H)/2, never stretched, so eyes stay taller than wide;
    - `eyeY = face_eyes_uv[1]` and `eyeGap = |uL − uR| × W / H`.
    - **Owl:** `eyeH = 0.8 × face_rim_uv[1]`, `eyeW = 0.8 × eyeH`. At module load, throw unless `eyeW·H ≤ 0.9 × face_rim_uv[0]·W` (the eyes sit inside her glasses). `mouth: 'none'`, because the beak is her mouth. Faces: `neutral` (open), `blink` (closedHappy), `happy` (archHappy), `shush` (wide + brows).
    - **Dragon:** eyeW 0.10, eyeH 0.13, `smile`, mouthW 0.09, mouthDrop 0.22, soft `ART.blush`. Faces: `neutral`, `blink`, `happy` (archHappy + bigSmile), `puff` (wide + `oh`).
    - **Cat:** eyeW 0.11, eyeH 0.14, `cat` mouth, mouthW 0.07, mouthDrop 0.22. Faces: `asleep` (closedHappy, small mouth), `happy` (archHappy).
    - These eye sizes are the painter's style numbers and are owned here.
    - Export `LIBRARY_FACE_ROWS = { owl: { eye }, dragon: { eye, mouth }, cat: { eye, mouth } }`, with `mouth = eye + mouthDrop`, computed rather than typed.
  - **`libraryCreatures.ts`.** Every pivot is read from `kit.part(name).position`, never typed. Every height is `visibleBounds(root).top`, and `root.scale` is never touched.
    - `createLibraryOwl(): OwlHandle`:
      - `root` (origin at the feet, facing +Z) → `body` Group (the breathing target), holding `owl-feet`, `owl-body`, `owl-bib`, `owl-buttons`;
      - `head` Group at `owl-head`'s translation, holding `owl-head`, `owl-beak` and `owl-glasses`, each at its translation minus the head's (zero today);
      - `wingL` Group at `owl-wingL`'s translation, holding its mesh at the origin;
      - `wingR` Group at `owl-wingR`'s translation, holding `owl-wingR` and `owl-heldBook` (translation minus wingR's), so the book rides the wing;
      - `setFace(OwlFace)` swaps `headMaterial.map`; `setExpression(Expression)` maps surprised → shush and sad/frown → neutral;
      - an `AssetHandle` with `height`; she never walks, so she has no walk phase.
    - `createLibraryDragon(): DragonHandle (CreatureHandle)`:
      - `body` Group holding `dragon-body`, `dragon-belly`, `dragon-spines`, `dragon-wings` and the tail;
      - `head` Group at `dragon-head`'s translation, holding `dragon-head` and `dragon-horns` (same pivot);
      - `tail` = the `dragon-tail` mesh at its pivot;
      - `belly` = its own `toonMaterial(ART.snakeBelly, { emissive: PALETTE.fairyWarm, emissiveIntensity: 0.2 })`;
      - `mouth` = `dragon-head`'s front-most vertex in the root frame (measured);
      - `limbs: null`; `setWalkPhase` is a no-op.
    - `createLibraryDragonNest()` → `{ root, height, padTop: partBox('dragonNest-pad').maxY, radius: visibleReachXZ(root) }`.
    - `createLibraryCat()`: `body`; `head` Group at `cat-head`'s translation, with **both ears reparented under it** (`position.sub(headPivot)`, because the file is flat); `earL`, `earR`, `tail`, `setFace`, `setExpression`.
    - `createLibraryBookPile()` → `{ root, height, plan: { minX, maxX, minZ, maxZ } }`, measured off the visible vertices.
  - **`check-asset-contract.mts`.** `add('library.owl' | 'library.dragon' | 'library.dragonNest' | 'library.cat' | 'library.bookPile', …)`, with no `KNOWN_DRIFT` entries.
  - **`check-library.mts`.** Add the `LIBRARY_CHECK_MUTATE` allow-list: `['', 'faces-upside-down', 'shift-books', 'card-twice', 'block-route', 'block-cushion', 'no-story', 'no-lintel', 'seal-den', 'open-leaf-hollow', 'resident-in-den']`. An unknown value throws.
- **Check:** **PAINTED FACES**, copied from `check-reptile-house.mts` lines 748–830, run on freshly built handles. For `owl-head`, `dragon-head` and `cat-head`:
  - read the front vertices' UV v against the texture's own `flipY`; the canvas row must **fall** as height rises;
  - the vertex nearest `LIBRARY_FACE_ROWS.eye` must sit higher than the vertex nearest the mouth row (dragon, cat), or higher than the top of `owl-beak`'s box in the head frame (owl);
  - stderr notes: the slope and both heights; also the count of distinct `CanvasTexture`s under the five handles (the informal under-40 budget, made visible).
  - `check:assets` measures the five handles.
- **Red:** `LIBRARY_CHECK_MUTATE=faces-upside-down` flips `flipY` on all three sets and must go red on all three heads. Declaring a wrong owl height once by hand must turn `check:assets` red.

### Step 4 — `/library` becomes a parsed deep link (so every later step has a link)
- **Files:** `src/main.ts`, `src/Game.ts`, `scripts/check-deep-links.mts`.
- **Changes:**
  - Remove `'/library'` from `RIDE_DEEP_LINKS` and keep `'/library-door'`. `RIDE_DEEP_LINKS` is checked first in `parseDeepLink`.
  - Add `DeepLink` kind `{ kind: 'library'; at?: { x; z; facing? } }`, parsed by `parseLibraryLink(search)` (a copy of `parseReptileLink`), and dispatch `pathname === '/library'` to it.
  - In `finishLaunch`, add `case 'library': if (!game.enterLibrarySpawn(deepLink.at)) console.error(…)`, loud like the reptile case.
  - Add `Game.enterLibrarySpawn(at?)`, which calls `world.library.requestEnter(at)`, beside `enterReptileSpawn`.
  - In `Game.ts`'s `miniGames.boardRide` handler, delete the `stallId === 'library'` branch and keep `'libraryDoor'`.
- **Check:** new `check-deep-links` entry `/library?at=6,8.7&facing=180`: she is inside, her XZ is within `CASTLE_TOLERANCE` of world(`LIBRARY_DESK_STAND`), and she faces π. Read every number from the layout constants. Run it served (`check:served-deep-links`). The existing `/library` entry still lands at the arrival.
- **Red:** point the new case at `requestEnter()` with no `at`; the entry must fail and print the measured position.

### Step 5 — The twelve readable books on their shelves
- **Files:** `src/world/library/shelfBooks.ts` (new), `src/art/models/libraryAssets.ts`, `src/world/library/furnish.ts`, `src/world/library/Library.ts`, `src/Game.ts`, `scripts/check-library.mts`, `scripts/check-book-reader.mts`.
- **Changes:**
  - **`shelfBooks.ts`.** `SHELF_BOOKS = BOOKS.map((book, i) => ({ book, slot: LIBRARY_READABLE_SLOTS[i]! }))`, guarded at module load by `throw` if the lengths differ (the message names both counts). Pairing is **by index, decided here and nowhere else**.
  - **`libraryAssets.ts`.** Add `createShelfBook(colour)`. It uses the `libraryBookShapes()` entry with the largest height and then the largest thickness (selected by measurement, never by index), with its own `toonMaterial(colour, { emissive: colour, emissiveIntensity: 0 })` and `addOutline(mesh, 0.012)`.
  - **`furnish.ts`** (the only owner of `placement`, `SPINE_INSET` and `SLOT_HALF`). For each `SHELF_BOOKS` entry on the case being built:
    - mesh `library.book.<bookId>` in `PALETTE[book.cover]`;
    - case-local position: x `slot.along`, y `shelfTops[slot.shelf]`, z `depth/2 − SPINE_INSET − shape.depth/2 + READABLE_PROUD` (0.03);
    - `rotation.x = READABLE_LEAN` (0.1): the top leans toward her, and the front-bottom edge sinks 1.3 cm into the board, hidden;
    - a **stack** case: parent it under the stack's group and append its body **and** outline materials to that stack's `StackFader` list, so it fades with the stack;
    - a **wall** case: under `root`, with the case transform composed;
    - return `Furnished.shelfBooks: { book, slot, mesh, material, local }[]`.
  - **`Library.ts`.**
    - `attachBookReader(opener: { open(bookId): boolean; isOpen(): boolean })`, with a null opener tolerated (headless).
    - While inside and **not riding**, one zone per shelf book: id `library-book:<id>`, label the title, x/z the mesh's world position, y floor + 1, `pickRadius` 0.7, stand = `slot.stand` (world), verb `Read`, `highlight: highlightObject(mesh)`, actions `pressAction(LIBRARY_CHIPS.read, () => opener?.open(book.id), '📖')`.
  - **`Game.ts`.** Create one `opener` object right after `new BookReader(…)` and pass the same object to `cuteODex.setBookReader` and to `world.library.attachBookReader`.
- **Check:** **READABLE** in check-library.
  - Exactly 12 `library.book.*` meshes, whose ids are the set of `BOOKS` ids.
  - Each mesh's world XZ lies **inside** its case's drawn box (`outsideBox < 0`). Drawn implies solid: the case's capsules cover it.
  - Each mesh's base is within 0.02 of its shelf top.
  - 12 zones while inside and 0 outside.
  - A stub opener records the id each primary action opened, and those must equal the zones' ids.
  - Each zone's stand equals its slot's stand.
  - Standing behind the stack that holds a readable book, that book's material alpha drops below 0.5 with the stack.
  - **Served `check:book-reader`, new item 6:** load `/library?at=<SHELF_BOOKS[0].slot.stand>&facing=<slot facing>`, run the zone's primary action through `page.evaluate`, then assert the reader is open on that book id, `frameContext.dt` is 0, and `.hud-menu` is hidden.
  - Re-run `check:tap-spacing` and quote its new pair counts.
- **Red:**
  - `LIBRARY_CHECK_MUTATE=shift-books` makes the check expect slot i ↔ BOOKS[i+1]; the clause must go red naming the id.
  - `LIBRARY_CHECK_REMOVE='bookcase north-2'` must turn REACHABILITY red: the book is drawn, the case is not solid.

### Step 6 — The owl at her desk: solid, alive, the card, the recommendation, the shush
- **Files:** `src/world/library/LibraryOwl.ts` (new), `src/world/library/recommendation.ts` (new), `src/world/library/layout.ts`, `src/world/library/Library.ts`, `scripts/check-library.mts`, `scripts/check-labels.mts`, `docs/design/LABELS.md`.
- **Changes:**
  - **`layout.ts`.** Remove `LIBRARY_LIBRARIAN_SPOT` from `libraryStandSpots()`. Doc: it is her solid spot now, no longer a keep-out. Keep the constant as her position.
  - **`recommendation.ts`.**
    - `ORDER` = a seeded Fisher–Yates of `BOOKS` with `new Rng(LIBRARY_RECOMMEND_SEED = 0x0b00c9)`: for i from n−1 down to 1, `j = rng.int(0, i)`, swap.
    - `recommendFor(state)` = the first book in `ORDER` that is not `isBookRead`, or null. Stateless and deterministic: it changes only when a book is read.
  - **`LibraryOwl.ts`** (`class LibraryOwl`, fields declared and not parameter properties; built in `Library`'s constructor **after furnishing and before `props.assertClear()`**):
    - **Body.** `createLibraryOwl()` at `LIBRARY_LIBRARIAN_SPOT`, facing 0, under `roomRoot`.
    - **Solid.** `this.capsule = props.wall('the owl', spot, spot, OWL_RADIUS, 'wall')`, a zero-length capsule, with `OWL_RADIUS = visibleReachXZ(owl.root)`, measured with her head included. This is the owner-'library' object that `removeWall` and `restoreWall` toggle in Step 9.
    - **Bubble.** A field `readonly bubble = new SpeechBubble({ id: 'library-owl-says', item: 'library-owl', kind: 'actionFeedback' }, PALETTE.markerLilac)`, its sprite in `roomRoot`, re-anchored each speaking frame at (owl x, owl y + height + 0.42, owl z) with `updateScreenSize(camera)`.
    - **Speech.** `say(lines, cheerAt)` and `updateSpeech(dt)` in the `Hotel` shape, using `lineSeconds`. `lastSaid` and `speaking` are exposed. Speech is cleared when she leaves.
    - **Life.**
      - Breathing on `body.scale` as (1+0.6b, 1−b, 1+0.6b), with `b = sin(elapsed·1.7 + phase)·0.02` and the phase drawn from `new Rng(LIBRARY_OWL_SEED = 0x0b00c4)`.
      - `createFaceLife`, resting `shushFor > 0 ? 'surprised' : speaking ? 'happy' : 'neutral'`.
      - **Head-turn** (at the desk, player within 9 m): `head.rotation.y` damps (0.12) toward the bearing to her minus her facing, clamped to ±1.0 rad; otherwise back to 0.
    - **`talk()`** does nothing while speaking. Without the card it calls `giveCard()`; with it, `hello()`.
    - **`giveCard()`.**
      - Call `giveLibraryCard()` **on the press**, set `player.model.setExpression('happy')`, and `say(LIBRARY_LINES.owl.card, cardCheerAt)`.
      - **On the cheer line:** `controls.flash()`, `playSurpriseChime()`, 6 warm sparkles over her (`SpritePuffs(roomRoot, 12, PALETTE.fairyWarm, 0.3)`, rng `0x0b00d5`), and two quick flaps of `wingR.rotation.z`.
      - On entering without the card, she says `welcome` once per visit.
    - **`hello()`.** `pick = recommendFor(state)`. If null, `say(allRead)`. Otherwise set `recommended = pick.id` and `say([helloAgain, recommendLead, recommend(title), recommendGlow])`.
    - **Glow** (every frame inside):
      - the recommended, unread book: `emissiveIntensity = 0.25 + 0.35·(0.5 + 0.5·sin(elapsed·2.4))`;
      - every other book: 0, written only on change;
      - `recommended` clears the frame `isBookRead` turns true;
      - while glowing, 2 warm twinkle sprites at the book every 1.4 s;
      - its Read chip label becomes `LIBRARY_CHIPS.readGlowing`;
      - **never the rainbow**, which means "selected".
    - **Shush.** `noticeShush(player, dt)`:
      - **Conditions:**
        - she is inside, `!spaces.isChanging`, `!player.riding`, the owl is at her desk or perched, and (from Step 12) she is not in the den;
        - `runningFor` accumulates while `player.isRunning` and resets otherwise;
        - a jump is `!wasAirborne && player.isAirborne && player.verticalSpeed > 0`, so standing up from a cushion (airborne at speed 0) never counts.
      - **Fire** when `(runningFor ≥ 0.35 || jumped) && cooldown ≤ 0`:
        - the face goes `surprised` for 1.2 s and `wingL.rotation.x` eases to −1.3 (her free wing; the right holds her book);
        - **if she is mid-script, wing and face only, never interrupting** the card or a story;
        - otherwise `say([shush], -1)`;
        - then `cooldown = 6`.
      - **No penalty of any kind.**
  - **`Library.ts`.**
    - The zone `library-owl` exists **only while the owl is at her desk**, because Selection caches her Box3: label `'the librarian'`, x/z her position, y floor + 1, `pickRadius` 1.2, stand world(`LIBRARY_DESK_STAND`), verb `Talk`, highlight `owl.root`, actions `hasLibraryCard ? pressAction(chips.hello, talk, '🦉') : pressAction(chips.getCard, talk, '🪪')`.
    - `screenLabels` returns `[owl.bubble]`.
    - `update`: `owl.update(dt, elapsed, player, input)` while inside.
    - In check-library, give the DOORS probe context `input: new InputSystem()`, and give the probe `isRunning: false, isAirborne: false, verticalSpeed: 0`.
  - **`docs/design/LABELS.md`.** Add the row: "The owl's lines — Shhh!, the card, the recommendation, story time | `world/library/LibraryOwl.ts` → `SpeechBubble` | actionFeedback | `library-owl`".
- **Checks, in a new check-library section "WITH A REAL CHILD".** Use check-labels' recipe: `quietly(() => new Player(world.collision, camera, spawn))`, `scene.add(player.group)`, `world.attachPlayer(player)`, an `InputSystem`, and a `step()` that runs `input.update → player.update → camera.update → library.update`, plus `world.npcs.update` from Step 8, at 1/60. Attach it **after** the DOORS, FADE and LIGHT probe clauses.
  - **OWL:**
    - `library.solids` has `'the owl'` and her middle is **not** flood-reached;
    - AISLES and MARCHED still pass, with the owl added as a drawn disc of `OWL_RADIUS`;
    - **blink:** over 15 s at the desk stand the head's `map` changes, and is never held changed longer than `ceil(BLINK_DURATION·60) + 2` frames;
    - **head-turn:** stand her 3 m to the owl's left for 2 s, then to her right; `head.rotation.y` must take opposite signs with magnitude > 0.4. The sign is measured, never assumed.
  - **CARD:**
    - on a fresh store, `hasLibraryCard` is false;
    - pressing the zone's primary action makes it true at once, with exactly one `card.library`;
    - `lastSaid` steps through all four card lines;
    - a second press offers `Say hello!` and the count is still 1.
  - **RECOMMEND:**
    - after the card, a press gives `recommend(title)` for the first unread title in `ORDER`;
    - within 1 s that book's emissive is > 0.2 and the other eleven read 0;
    - after `markBookRead(that book)` and 2 frames, all are 0;
    - the next press names a different title;
    - calling `recommendFor` twice on the same state returns the same id.
  - **SHUSH:**
    - standing at (0, 4) on the entrance-hall aisle, steer her along it with `input.setNavigationMove` (the sign that carries her west) plus `setNavigationSprint(true)` for 3 s;
    - `player.isRunning` must become true (otherwise fail loudly, never vacuously);
    - `lastSaid === 'Shhh!'`, `riding` stays false, she travelled ≥ 5 m (no penalty), and the bubble's sprite was granted on some frame (call `world.labels.resolve` in the step);
    - **CONTROL:** after the cooldown, 3 s of walking without sprint never shushes;
    - `pressVirtual('jump')` then shushes;
    - mid-card-script, a sprint leaves `lastSaid` on the card line while the wing still rises.
  - **`check-labels.mts`.** Add `['the library', world.library.screenLabels]` to the registration control.
- **Red:**
  - `LIBRARY_CHECK_REMOVE='the owl'` → OWL red (her middle is reachable).
  - `LIBRARY_CHECK_MUTATE=card-twice` → the check itself calls the non-idempotent `gameStore.catchWildPet(LIBRARY_CARD)` before asserting → CARD red, count 2.
  - By hand: make `isRunning` ignore `DUST_SPEED` → SHUSH CONTROL red.
  - By hand: skip the `isBookRead` reset → RECOMMEND red.

### Step 7 — Sitting on the story cushions (the player)
- **Files:** `src/world/library/layout.ts`, `src/art/models/libraryAssets.ts`, `src/world/library/Library.ts`, `src/Game.ts`, `scripts/lib/seatedPose.mts` (new), `scripts/check-castle.mts`, `scripts/check-library.mts`.
- **Changes:**
  - **`layout.ts`.**
    - `LIBRARY_PLAYER_SEATS = ['cushion-1', 'cushion-3'] as const`.
    - `libraryCushion(id)` looks the spot up from `LIBRARY_FURNITURE`.
    - `libraryStandSpots()` gains **all five cushion centres** (`"cushion-N's seat"`), each facing the story chair. The seat is the stand: walking onto the soft cushion and sitting where she stands keeps every snap ≤ 0.5 m and needs no step-back.
    - Arithmetic check: the cushion keep-outs clear the story chair's capsules by 0.20–0.34 m and the stacks by at least 0.8 m. `props.assertClear()` is the check.
  - **`libraryAssets.ts`.**
    - If `libraryCushionSize().top` is not within 0.02 of `KID_HIP_HEIGHT` (the building branch's primitive is 0.22), rebuild `createLibraryCushion` with its top at `KID_HIP_HEIGHT`, imported from `art/models/kid`. The glb cushion is already 0.36.
    - `libraryArmchairSize(big)` gains `seatCentre: LocalPoint`, measured off its seat part, for the owl's perch in Step 9.
  - **`Library.ts`.**
    - The constructor throws, naming the fix, unless the cushion top is within 0.02 of `KID_HIP_HEIGHT`.
    - One Sit zone per player seat, **always on** while inside: id `library-sit:<cushion>`, label `'a story cushion'`, x/z the cushion, y floor + 1, `pickRadius` 0.8, stand = the cushion centre, `standRadius` 1.6, `selectableWhileRiding: true`, verb `Sit`, `highlight: highlightObject(furnished.pieces.get(cushion))`.
    - Its actions: when she is seated here, `[{ id: 'get-up', label: chips.getUp, run: standUp }]`; otherwise `pressAction(chips.sit, sit, '🧘')`.
    - **`sit(id)`:** `player.beginRide()`, then `setRidePose(cx, LIBRARY_FLOOR_Y, cz, bearing to the story chair)`, then `player.ridePosture = 'listening'`. The posture is set **after** `beginRide`, which resets it.
    - **`standUp()`:** `player.endRide()`. She pops onto the cushion plate and walks off; cushions have no collider.
    - In `update`, while seated, `input.justPressed('jump')` calls `standUp`. Read chips are hidden while riding. Pets keep following.
    - Expose `get playerIsSeated`.
  - **`Game.ts`.** In `onTap`, after the nap, tree and tortoise checks: `if (world.library.playerIsSeated) { world.library.standUp(); return; }`. A tap anywhere gets her up, Jim's nap rule.
  - **`scripts/lib/seatedPose.mts`.** Lift `FLOOR_TOLERANCE` (0.015) and `SEAT_TOLERANCE` (0.003) out of check-castle, which now imports them. Also export `seatedErrors(model, floorY, seatTop)`: the lowest **non-outline** vertex (the `measurePlan` rule) and the hip pivot (`rig.leftLeg` world y).
- **Check: SIT.**
  - Pressing `library-sit:cushion-1` gives `riding`, posture `'listening'`, position within 1 mm of the cushion centre, and y = floor.
  - Feet within `FLOOR_TOLERANCE` of the floor, hip within `SEAT_TOLERANCE` of the cushion top.
  - No `library-book:*` zone is offered.
  - The zone now offers `get-up`; running it gives `riding` false and `isClearCircle` true where she stands.
  - Sit again; `pressVirtual('jump')` plus one update also stands her up.
- **Red:** by hand, set a leg to −0.7 in `applyListeningPose`; SIT must fail with the measured foot height. Paste it and revert.

### Step 8 — The library's three children
- **Files:** `src/entities/npc/residentLooks.ts` (new), `src/world/hotel/HotelGuests.ts`, `src/entities/npc/NpcSystem.ts`, `src/entities/npc/NpcCharacter.ts`, `src/world/library/layout.ts`, `src/world/library/libraryKidDriver.ts` (new), `src/world/library/LibraryKids.ts` (new), `src/world/library/Library.ts`, `src/world/World.ts`, `test/procgen/parkFacts.ts`, `scripts/check-library.mts`.
- **Changes:**
  - **`residentLooks.ts`.** Lift `OUTFITS`, `HAIRS`, `HAIR_STYLES` (no ponytails) and `GUEST_PACE` (0.45) out of `HotelGuests.ts`, which imports them. One owner.
  - **`NpcSystem.ts`.**
    - Export `PLAYER_SEPARATION`.
    - `ResidentSpec` gains `readonly driver?: (rng: Rng) => CharacterDriver`, and the residents loop uses `spec.driver ? spec.driver(rng) : new WaypointDriver({…})`. The hotel is untouched.
    - In `separateFromPlayer`, after the climbing/scripted skip:
      - both `character.seated` and `player.riding`: `continue`;
      - only `character.seated`: the **player** takes the whole capped push (`player.nudge`);
      - only `player.riding`: the **character** takes the whole capped push. A riding player is furniture, so a child walking past can never slide her off a cushion (`Player.nudge` has no riding guard). This applies park-wide.
  - **`NpcCharacter.ts`.**
    - Add `seatedFlag` and `seatedPhase`.
    - `beginSeated(x, y, z, facing, phase)` zeroes velocity and airborne, writes `position` and `previousPosition`, copies them to the root, and calls `faceOnGround`.
    - `endSeated()` clears the flag and leaves `move()` to resample the ground, so she steps up onto the cushion plate and off it, a visible "getting up". Add `get seated()`.
    - In `update`, a branch `else if (seatedFlag) gait = damp(gait, 0, 0.07, dt)` comes before the carried branch: no `move()` and no gravity.
    - `animate(elapsed, posture: RidePosture | null)`: the seated branch resets body and head as today, then calls `applyRidePose(rig, 0, elapsed + seatedPhase, posture)`. `update` passes `'listening'` for seated, `'seated'` for carried, null otherwise.
    - In `separateFrom`, treat seated like scripted: both seated → return; one seated → the other takes the whole push at `SCRIPTED_ENCOUNTER_SPEED_FACTOR`.
  - **`layout.ts`.** `LIBRARY_KID_PLANS`, read by aisle id and node index and never retyped:
    ```ts
    // circuit: ping-pong node indices on ONE aisle, first = the exit node; toSeat: after the exit node.
    { name: 'Juno', aisle: 'west-aisle-1', circuit: [3, 2, 1, 2], seat: 'cushion-4',
      toSeat: [aisleNode('central', 4) /* (0.6,-5.6) */, { x: 0.5, z: -8.3 }, { x: 1.0, z: -9.9 }] },
    { name: 'Lark', aisle: 'north', circuit: [2, 1, 0, 1], seat: 'cushion-2',
      toSeat: [aisleNode('central', 4), { x: 3.0, z: -6.6 }] },
    { name: 'Fenn', aisle: 'east-aisle-2', circuit: [2, 1, 0, 1], seat: 'cushion-5',
      toSeat: [aisleNode('east', 1), aisleNode('east', 2), aisleNode('east', 3), aisleNode('east', 4),
               { x: 7.8, z: -7.3 }, { x: 7.0, z: -10.0 }] },
    ```
    - These routes keep at least `PLAYER_SEPARATION` from cushions 1 and 3, and at least `SEPARATION` from the other children's seats, measured when they were drawn up (minimum 1.59 m from a player seat; 2.0 m between child seats).
    - Lark's circuit stops at `north[2]` (−4, −7.4). `north[3]` (2, −7.4) is 0.61 m from cushion 1, and a child there would shove a seated player.
    - (0.5, −8.3) passes the west story armchair's corner with 0.09 m to spare at `NPC_RADIUS + 0.05` (0.03 m with the glb armchair). If KIDS fails there, move it east in 5 cm steps; the − 0.1 margin allows up to 0.1 m.
  - **`libraryKidDriver.ts`.** `class LibraryKidDriver implements CharacterDriver, ActivityHost`:
    - `name = 'library-kid'` (never `'wander'`, never a `WanderDriver`);
    - it owns a `WaypointDriver` for the stroll and one `Errand` per route target, with `{ arriveRadius: 0.45, or 0.5 at the seat; timeout: 30; abandonRadius: NO_LIMIT; unstick: true }` at `pace` 0.7;
    - modes `stroll | walking | arrived | seated | gaveUp | returning`;
    - **`summon(seatWorld, facing)`** builds the route: the circuit's distinct nodes strictly between her and the exit node (along the aisle, toward the exit), then the exit node, then `toSeat`, then the seat (world = local + origin);
    - **`markSeated()`**;
    - **`dismiss()`** walks the route reversed back to the exit node, then makes a **fresh** `new WaypointDriver({ rng, points: circuitWorld, pace: GUEST_PACE })`, which works because every circuit starts at its exit node;
    - it writes **every** intent field every frame and allocates nothing;
    - blink comes from its own `createBlinkClock(() => rng.unit())`; when arrived, gave up or seated it looks at the owl's perch.
  - **`LibraryKids.ts`.** `libraryResidents(parent /* identity */): { specs; drivers }`:
    - seed `0x0b00c5 + i·997`, and draw skin, hair, outfit, hairStyle, backpack and backpackColour in the hotel's fixed order;
    - `new CharacterModel(...)`, parented to `parent`;
    - `characterModelAvatar`, waypoints = the circuit in world metres, `pace: GUEST_PACE`, `floorY: LIBRARY_FLOOR_Y`, `driver: (rng) => registry.add(new LibraryKidDriver(rng, plan))` (the driver draws from the resident's own seeded stream; the registry is how `attachNpcs` recognises its bodies);
    - **at module load, assert** every child-seat pair is ≥ `SEPARATION` and every child-seat / player-seat pair is ≥ `PLAYER_SEPARATION`; throw naming the pair.
  - **`Library.ts`.**
    - `readonly kidsRoot = new Group()`, with an identity transform, named `'the-library-children'`. Its `visible` is toggled everywhere `roomRoot.visible` is set.
    - `get residents()`.
    - `attachNpcs(all)` picks the bodies whose driver is one of its drivers.
  - **`World.ts`.**
    - `new NpcSystem(…, [...hotel.residents, ...library.residents], …)`;
    - after it, `library.attachNpcs(npcs.all)`;
    - `library.kidsRoot` in the `scene.add` list.
  - **`parkFacts.ts`.** Add `world.library.kidsRoot` to the drawn-reach `excluded` roots. **Without this every seed fails**, the 2 Oct trap.
- **Check: KIDS.**
  - Every circuit leg (including the wrap), every summon leg and every dismiss leg is swept every 0.1 m with `isClearCircle` at `NPC_RADIUS + 0.05` against the real world.
  - Every leg keeps ≥ `PLAYER_SEPARATION` − 0.1 from cushions 1 and 3 (a brush, never a block; as drawn the minimum is 1.59), and ≥ `SEPARATION` from the other children's seats except at its own seat.
  - At every node, `collision.resolve(probe, NPC_RADIUS)` pushes ≤ 0.01.
  - After 60 s stepping with the player inside, every child has moved and stands within 0.02 of the floor. With the player in the garden, they move exactly 0.
  - Stderr note: leg counts and seeds.
  - `check:hotel` (fall detector over `npcs.all`), `check:npc-presence`, `check:jitter (scripts/check-npc-jitter.mts)`, `check:npc-separation`, `check:npc-perch` and `check:cat-bus` stay green.
  - The new riding rule touches every ride, so also run `check:rail-race`, `check:climb-wave` and `check:slide-rider`.
- **Red:** `LIBRARY_CHECK_MUTATE=block-route` drops a 0.8 m disc on Lark's (3.0, −6.6); KIDS must go red naming that leg.

### Step 9 — Story time: clock, flight, gathering, reading, Story listener
- **Files:** `src/world/library/storyTime.ts` (new), `src/world/library/LibraryOwl.ts`, `src/world/library/Library.ts`, `src/state/secrets.ts`, `src/main.ts`, `src/Game.ts`, `scripts/check-library.mts`, `scripts/check-deep-links.mts`.
- **Changes:**
  - **`secrets.ts`.** Add `{ id: 'secret.storyTime', name: 'Story listener', icon: '📖', done: 'You sat and listened to a whole story!' }`. It is in the park closure; make it its own commit.
  - **`LibraryOwl.flyTo(target: {x,y,z}, facing)`.**
    - At take-off, `props.detach([capsule])`; on landing back at the desk, `props.attach([capsule])` (the same object; owner 'library' kept).
    - The flight follows the exported pure function `owlFlightPose(from, to, t)`, with t = elapsed / 3.2 s:
      - `s = smoothstep(0, 1, t)`; x and z are lerped by s;
      - `base = lerp(from.y, to.y, s)` and `y = base + (CRUISE − base)·bump`, where `bump = smoothstep(0, 0.2, t)·(1 − smoothstep(0.8, 1, t))` and `CRUISE = libraryBookcaseSize('stack').height + 0.6`;
      - she faces her travel; wings flap with `rotation.z = ±sin(elapsed·9)·0.6`; the book stays in the right wing.
    - **The perch:** the story chair's spot plus `libraryArmchairSize(true).seatCentre` rotated by its facing, at y `.seat`, facing 0 (toward the rug). The chair's own box is her collider there.
    - The bubble follows her.
  - **`storyTime.ts`** (`class StoryTime`, stepped first in `Library.update`; World runs it before `npcs.update`). Constants owned here: `STORY_FIRST_AFTER = 40`, `STORY_EVERY = 150`, `GATHER_TIMEOUT = 40`.
    - **idle:** the clock counts only while inside. When it fires, or on `requestStoryTime()`, call `begin()`.
    - **`begin()`:** pick the book (`recommended ?? ORDER[storiesTold % 12]`); `owl.say([storyCall])`; `owl.flyTo(perch)`; then `driver.summon(...)` for every child.
    - **gathering:** each frame, a child whose driver has `arrived` gets `body.beginSeated(seat.x, LIBRARY_FLOOR_Y, seat.z, bearing to the perch, i·1.7)` and `markSeated()`. The snap is ≤ 0.5 m. Root at the **floor**, never the cushion top (the dining rule).
    - **gathering → reading:** when every child is seated or gave up **and** the owl has perched, or after `GATHER_TIMEOUT`, go to reading: `owl.say([storyBegin(title), ...book.pages.map(p => p.text), ...storyEnd])`. Those are the book's own words, already brevity-checked.
    - **dispersing**, when she stops speaking:
      - if she was seated on a cushion since before reading began, `discoverSecret('secret.storyTime')` and warm sparkles over her;
      - every child gets `endSeated()` and `dismiss()`;
      - `owl.flyTo(desk)`;
      - once landed: idle, `storiesTold += 1`, clock = `STORY_EVERY`.
    - **`abort()`**, from `standOutside`: children `endSeated` and `dismiss` (frozen standing, never mid-sit); the owl snaps to her desk and her capsule is attached; speech cleared; clock = `STORY_FIRST_AFTER`.
    - Expose `phase` and `requestStoryTime()`.
  - **Deep link.** `parseLibraryLink` accepts `story=now` → `story: true`. `Game.enterLibrarySpawn(at, story)` calls `requestStoryTime()` after `requestEnter`, and StoryTime starts on the first inside frame.
- **Check: STORY.**
  - Set-up: the real child walks to cushion 1 and presses Sit, then `library.requestStoryTime()`; step for up to 75 s. Read gathering through dismissal off the instruments below:
  - **Vacuity guard:** the phase must reach `reading`, or the clause fails "ASSERTS NOTHING".
  - **The children:** all three seated within `GATHER_TIMEOUT`, each within 0.05 of its own cushion; `seatedErrors` within tolerance; no child's own XZ step in any frame exceeds `NPC_RADIUS·2`; while reading, no seated child moves more than 0.05.
  - **The owl:** within 0.1 of the perch; the owl's desk spot is clear (`isClearCircle`) while she is away.
  - **The words:** the set of `lastSaid` values contains `storyBegin(title)`, every page text, and `'The end!'`.
  - **The card:** `collection['secret.storyTime'].discovered`.
  - **Afterwards:** within 20 s every child is unseated and ≥ 1 m from its cushion; within 10 s the owl is back, with her middle unreachable again.
  - **FLIGHT:** sample `owlFlightPose` both ways at 400 steps. Wherever the plan point, grown by `OWL_RADIUS`, is over a stack's footprint, her feet must be ≥ stack height + 0.3. During the STORY run, the live owl matches `owlFlightPose` within 1 cm.
  - `check-deep-links`: `/library?at=2.1,-8&facing=150&story=now` puts her inside, and `world.library.storyPhase !== 'idle'` within 5 s.
- **Red:**
  - `LIBRARY_CHECK_MUTATE=no-story` → the vacuity guard goes red.
  - `block-cushion` (a 0.9 m disc on cushion 4) → "every child seated" goes red, while the story still reads.
  - By hand: set the cruise to stack height − 1 → FLIGHT red.

### Step 10 — Part 4 gate: labels, tap spacing, full gate, browser QA
- **Files:** `scripts/check-labels.mts`, `HANDOFF-library-owl-den.md`.
- **Changes:**
  - check-labels gets scene 5, 'library': `quietly(() => world.library.requestEnter()); run(1)`, then:
    - `visit(owl, true, 10)` (the card);
    - `visit(owl, true, 8)` (hello);
    - `visit(firstReadZone, false, 3)`;
    - a coverage gap is raised if the owl was never selected.
  - Run `check:tap-spacing` and quote the library pair counts (15 new zones: Talk, 12 Read, 2 Sit).
- **Gate:** the full gate (Ground rule 4), dispatching CI if the parks miss.
- **Browser QA** (if owned):
  - Run `pnpm run build`, then `pnpm exec vite preview --port <yours> --strictPort`.
  - Look at the desk, rug and shelf links (see "Preview paths") and take screenshots of: the card ceremony, the glow, the shush, a seated row with feet on the floor, and the owl over the stacks.
  - Close each page as soon as it is read, and kill the server by PID.
  - Without the browser, write the same list as "visual QA needed".

### Step 11 — The den's walls: a gap in the west wall, a lintel, a walled pocket (west-2 still seals it)
- **Files:** `src/world/library/layout.ts`, `src/world/library/shell.ts`, `src/world/library/Library.ts`, `scripts/check-library.mts`.
- **Changes:**
  - **`layout.ts`** (a leaf; literals with reasons):
    - `LIBRARY_DEN_DEPTH = 5.6`;
    - `LIBRARY_DEN_DOOR_HALF = 2` (the art contract's case length / 2, asserted against the measured case in `shell.ts`);
    - `LIBRARY_DEN_INNER = { west: −(LIBRARY_HALF_X + LIBRARY_WALL_HALF + LIBRARY_DEN_DEPTH) (−23.9), north: secret.at.z − DOOR_HALF − 1.6 (−7.6), south: secret.at.z + DOOR_HALF (−2.0) }`. The far corner (−24.5, −8.2) is 25.8 m out, inside `LIBRARY_PLAY_RADIUS` 28; the comment says so.
    - `libraryDenContains(x, z)`: x < −LIBRARY_INNER_X and x ≥ west − WALL_HALF and north − WALL_HALF ≤ z ≤ south + WALL_HALF. **The one owner of "she is in the den"**: the guard, entry, restore, the fill, the marches, the fades and the shush all ask it.
    - Den stand spots tagged `den: true`: `LIBRARY_DEN_DOORWAY_STAND (−19.6, −4.3, facing 270)` and `LIBRARY_DRAGON_STAND (−21.3, −5.0, facing 225)`, both added to `libraryStandSpots()`.
    - `LIBRARY_DRAGON_NEST = { x: −22.6, z: −6.3, facing: 45 }` (facing the doorway and the camera).
    - `LIBRARY_SECRET_BOOK = { shelf: 1, along: 0 }` (the 0.70 m shelf, centred, where `LIBRARY_SECRET_STAND` already faces).
    - Move `sconce-west-1` from z −6 to −8. It sat on the new north jamb; it is not a pool, so the light rig is unchanged.
  - **`shell.ts`.**
    - `libraryDenGap()` = `secret.at.z ± libraryBookcaseSize('wall').length / 2`, measured; it throws unless it equals `LIBRARY_DEN_DOOR_HALF` within 0.02.
    - `buildReadingRoomShell` gives the west side `gaps: [libraryDenGap()]`, giving two spans. The west spans **and the lintel** share one **cloned** `interiorMaterial`, so they can fade without fading the north wall, and sit in a `westWall` Group.
    - It returns `{ walls, westWall, westMaterial, lintel }`. Update `Library` and check-library's CONTROL to that shape.
    - **The lintel:** a drawn box at x −18.3..−17.7, y `H`..`LIBRARY_WALL_HEIGHT`, z over the gap, with `H = libraryBookcaseSize('wall').height` (never typed). Its collider is `addWall(OX−18, OZ+gapN, OX−18, OZ+gapS, LIBRARY_WALL_HALF, Infinity, false, false, LIBRARY_FLOOR_Y + H − JUMP_CLEARANCE_GRACE − 0.05)`: absent to feet below it, so walkers and jumps pass under and the ground fill sees a doorway; solid to a jet pack (12 m ceiling indoors). The base sits under the case top by more than the jump grace, so no flier slips between the case and the lintel. It is registered raw, like the room walls, because a 2-D keep-out check would misread a banded collider.
    - **`buildLibraryDenShell(denRoot, props, surfaces)`:**
      - floor box x −24.5..−18.6 (abutting the room floor's apron edge, so no coplanar overlap), z −8.2..−1.4, y −0.25, in the room floor's material;
      - `Plate(LIBRARY_FLOOR_Y, OX−24.5, OX−17.7, OZ−8.2, OZ−1.4)`;
      - three walls through `props.wall('den wall (west|north|south)', a, b, LIBRARY_WALL_HALF, 'wall')` (keep-out checked, removable by name):
        - west: centre x −24.2, z −7.9..−1.7; drawn box z −8.2..−1.4 (it takes the corners);
        - north: centre z −7.9, x −24.2..−18.0; drawn box x −23.9..−18.3, **abutting** (not buried in) the room wall, so no coplanar top faces;
        - south: centre z −1.7, same run, drawn hidden (the camera's near side, the room's own rule);
      - all walls `LIBRARY_WALL_HEIGHT`.
  - **`Library.ts`.** `readonly denRoot = new Group()` as a child of `roomRoot`, so it is already excluded from drawn reach. Build the den shell before furnishing. `denRoot.visible = false` until Step 12's rule. Expose `denWalls`, `lintel`, `westWall`. `furnish.ts` is **unchanged**: west-2 is still an ordinary instanced case with its collider, so the gap is sealed.
- **Checks:**
  - **Fill domain:** `onFloor = onPlate ∪ libraryDenContains`, with the scan reaching `LIBRARY_DEN_INNER.west − 1`. CONTROL 1 builds both shells (still floods more than 10000 cells and still sees the hollow rectangle as a pocket).
  - **REACHABILITY (closed):** every non-den keep-out is reached and **every `den` keep-out is not** (the control that the instrument sees the sealed gap). The unreached clear cells are more than 50 and **all** inside `libraryDenContains`: the den is the one intended pocket, and any other pocket fails as today.
  - **DEN WALLS:** 12 bodies placed inside the den, marched at `PLAYER_LONGEST_STEP` toward −X, −Z and +Z; none ends outside `libraryDenContains ∪ onPlate`.
  - **LINTEL:** a probe at y = H + 0.8 marched west along z = secret.at.z from x −16 stops at x ≥ −17.7 + `PLAYER_RADIUS` − 0.03.
  - **LIGHT:** the never-black sweep also covers den cells (x −23..−19, z −7..−3); the darkest den cell goes to stderr. The fill and key light it, and no new `PointLight` is added.
- **Red:**
  - `LIBRARY_CHECK_REMOVE='den wall (west)'` → DEN WALLS red.
  - `LIBRARY_CHECK_MUTATE=no-lintel` (removes `library.lintel`) → LINTEL red.
  - `LIBRARY_CHECK_REMOVE='bookcase west-2'` → closed REACHABILITY red (den spots reached).

### Step 12 — The secret leaf: pull, swing, two collider states, guard, fades
- **Files:** `src/art/models/libraryAssets.ts`, `src/world/library/furnish.ts`, `src/world/library/secretShelf.ts` (new), `src/world/library/Library.ts`, `src/ui/chime.ts`, `scripts/check-library.mts`.
- **Changes:**
  - **`libraryAssets.ts`: `createLibrarySecretLeaf()`.** It returns `{ root, size, materials }`, its origin on the case's **back-left** vertical edge, its own materials (so it can fade), and the leaf spanning x 0..L, z 0..D with its front at z = D. **It is drawn from the same source as its four neighbours:**
    - if the wall cases come from the glb, use `secretShelf-carcass`/`-shelves`, shifted by `−minZ` of the carcass (measured, 0.6), and add their two `LIBRARY_GLB_STYLES` rows;
    - otherwise use `libraryBookcaseBaked('wall')`, shifted by (L/2, 0, D/2).
    - Either way, assert at load that its own-frame bounds match `libraryBookcaseSize('wall')` within 5 mm.
  - **`furnish.ts`.** For `spec.secret`:
    - still call `shelveFace` in the same rng position, so no other case's books change;
    - add the `LIBRARY_SECRET_BOOK` gap on that face;
    - do **not** instance the case and do **not** call `props.box` for it;
    - return `Furnished.secret = { spec, books }`.
  - **`secretShelf.ts`: `class SecretLeaf`.**
    - **Hierarchy:** a `hinge` Group at (−LIBRARY_INNER_X, 0, gapS), `rotation.y = spec.facing` in radians. Asset +X maps to room −Z (the length runs north from the hinge) and asset +Z to room +X (books face the room). It holds a `leaf` Group with `rotation.y = angle ∈ [0, π/2]`, containing:
      - the leaf model;
      - its books, one `InstancedMesh` with a cloned `libraryBookMaterial()`, each matrix shifted from the case-centred frame by (L/2, 0, D/2);
      - the **pull book**: the tallest, thickest shape, `toonMaterial(ART.helmetGold)` plus an outline, 3 cm proud of its row, named `library.secretBook`;
      - a twinkle `Sprite(glowTexture(PALETTE.fairyWarm))` at the book, with opacity `max(0, sin(elapsed·2π/4.5))^8` while shut.
    - **Colliders, both registered through props at construction** (so the keep-out assertion covers both footprints):
      - `closed = props.box('bookcase west-2', closedFootprint, H)` (the name every existing hook knows);
      - `open = props.box('the secret shelf, open', { x: −LIBRARY_INNER_X − L/2, z: gapS − D/2, facing: 180, halfLength: L/2, halfDepth: D/2 }, H)`, which is (−19.7, −2.3), flush against the den's south wall;
      - then `props.detach(open)`.
    - **`pull()`:**
      - ignored if open or swinging;
      - `playSecretDoor()` (a creak);
      - the book slides 0.12 m out over 0.3 s;
      - then the swing: `angle = (π/2)·(1 − (1 − u)³)`, with u = (τ − 0.3)/1.6, monotone and never past π/2;
      - **the closed capsules hold for the whole swing**, so she can never walk through a half-open leaf;
      - on u ≥ 1: angle = π/2 exactly, `detach(closed)`, `attach(open)`, `playSecretThunk()`, and the book eases home.
    - `openInstantly()` swaps with no sound. `closeInstantly()` sets angle 0, `detach(open)`, `attach(closed)`. Expose `open`, `swinging`, `angle`.
    - The swing sweeps only the closed footprint and the den's quarter-disc. The front-free corner clips the north jamb's **drawn** edge by at most 4.5 cm at about 8.5°, for about 0.1 s. That is accepted, not widened, because a slit beside the shut case would give it away.
    - `leafFader = new StackFader('secret-shelf-open', leaf, openCentre, 180, size, materials)`. It is built on the **open** footprint, so it can never fire while the leaf is shut.
  - **`Library.ts`.**
    - The **pull zone:** id `library-secret-book`, label `'the special book'`, x/z the book's world position when shut, y floor + 1, `pickRadius` 0.7, stand world(`LIBRARY_SECRET_STAND`), `standRadius` 2.0, verb `Pull`, `highlight: highlightObject(pullBook)`. Its actions are `pressAction(chips.pull, pullSecretBook, '📕')` while shut and not swinging, and `[]` otherwise: unselectable, so Selection's cached box for a book that has moved is never consulted.
    - **The guard** (every frame inside): if the leaf is shut, not swinging, and `libraryDenContains(player)`, call `leaf.openInstantly()` plus `console.warn`. **Never animated through her.**
    - **Entering and leaving:**
      - `enterRoom(at)`: `libraryDenContains(spot) ? openInstantly() : closeInstantly()`;
      - `adoptRestoredPlayer`: the same test on the restored position;
      - `standOutside`: `closeInstantly()`, so every visit from the park starts shut and the trick is there to find again.
    - **Den visibility:** `denRoot.visible = leaf.angle > 0 || libraryDenContains(player)`. Shut, the dragon's horns and the den walls would otherwise show over the 5.2 m wall.
    - **Fades:**
      - `westWallFader = new StackFader('west-wall', westWall, { x: −LIBRARY_HALF_X, z: 0 }, 90, { length: 2·LIBRARY_HALF_Z, depth: 2·LIBRARY_WALL_HALF, height: LIBRARY_WALL_HEIGHT }, [westMaterial])`, driven only by `fadeTowards(libraryDenContains(player) ? STACK_FADED_ALPHA : 1, dt)`;
      - `leafFader` joins the `fadeStacks` hides() loop;
      - both `setAlpha(1)` on entry.
    - **Shush:** suppressed while `libraryDenContains(player)`. The owl cannot see into the hidden room.
    - `doorBands()` returns `[entry, exit, libraryDenDoorway()]`. The third band is `{ what: "the secret den's doorway", centreX: OX − LIBRARY_HALF_X, centreZ: OZ + (gapN + gapS − D)/2, halfAlong: LIBRARY_WALL_HALF, halfAcross: (gapS − D − gapN)/2, yaw: π/2, y: LIBRARY_FLOOR_Y, ownZoneId: 'library-secret-book' }`. It **fires nothing**; it only tells tap-spacing that no other chip may sit in the doorway.
    - Public: `pullSecretBook()`, `openDenInstantly()`, `requestEnterDen()` (= `requestEnter(LIBRARY_DEN_DOORWAY_STAND)`), and getters `denOpen`, `secretShelfAngle`, `secretShelf`.
  - **`chime.ts`.** `playSecretDoor()` = `note(130.81, 0, 0.55, 0.05)`; `playSecretThunk()` = `note(98, 0, 0.2, 0.06)`. One AudioContext; silent headless.
- **Check: SECRET SHELF.**
  - Pull via the zone's primary action; step 150 frames.
  - **Swing:** the angle is monotone, each frame's step ≤ (π/2)·3/1.6·dt + 1e−6, and it ends at π/2 ± 1e−6, 1.8–2.0 s after the press. **During** the swing the closed footprint's middle is still not clear.
  - **OPEN:**
    - the fill from the arrival reaches **every** keep-out, den ones included;
    - **zero** pockets anywhere;
    - the closed footprint's middle **is** clear and the open footprint's middle is **not** (in the open-state run, the existing "a box's middle is not reached" loop and the MARCHED list swap west-2's closed box for the open footprint, so nothing goes falsely red);
    - a fill seeded at `LIBRARY_DRAGON_STAND` reaches the arrival and the exit band (**enterable and leavable**);
    - MARCHED at the open leaf from 16 bearings at 5 cm and at `PLAYER_LONGEST_STEP`;
    - the 48 walls-hold marches end in room ∪ den or through the door;
    - the LINTEL y = 0 control now passes under it;
    - the pull zone offers no action.
  - **Sweep:** the quarter-disc of radius `hypot(L, D)` about the hinge (x ≤ −17.1, z ≤ gapS) contains no `LibrarySolid` other than the leaf's own, and no keep-out that is not den-tagged.
  - **FRESH VISIT:** `requestEnterDoor()`, then a sprint across the front band, gives a shut leaf with den spots unreached again.
  - **GUARD:** teleport the probe into the den with the leaf shut; after one update the leaf is open. `requestEnter({ x: −21, z: −5 })` opens it the same frame.
  - **FADE:** in the den, the west wall's alpha falls below 0.5 within 60 frames, and the leaf fader too wherever it hides her. CONTROL: in the central aisle, both stay at 1.
  - Re-run `check:tap-spacing`.
- **Red:**
  - `LIBRARY_CHECK_REMOVE='bookcase west-2'` → the den is reachable while shut.
  - `seal-den` (after landing, the check adds a 0.3 m wall across the doorway) → the open-state den spots and the leavable fill go red.
  - `open-leaf-hollow` (after landing, the check detaches the open set) → the open leaf's middle is reachable.
  - By hand: delete the guard line → GUARD red.

### Step 13 — The baby dragon and the sleeping cat
- **Files:** `src/world/library/LibraryDen.ts` (new), `src/world/library/LibraryCat.ts` (new), `src/world/library/layout.ts`, `src/world/library/Library.ts`, `src/state/secrets.ts`, `src/ui/chime.ts`, `docs/design/LABELS.md`, `scripts/check-labels.mts`, `scripts/check-library.mts`.
- **Changes:**
  - **`layout.ts`.** `LIBRARY_CAT_PILE = { x: 9.6, z: 7.2, facing: 45 }`: in the desk lamp's pool, on the camera's near side, facing it, 1.7 m clear of the desk and 3.1 m from the entrance-hall aisle. `LIBRARY_CAT_STAND = { what: 'beside the library cat', x: 9.6, z: 8.8, facing: 180 }`, in `libraryStandSpots()`.
  - **`secrets.ts`.** `{ id: 'secret.babyDragon', name: 'Dragon friend', icon: '🐉', done: 'You found the baby dragon in the den!' }`, in its own commit.
  - **`LibraryDen.ts`** (the dragon; built before `assertClear`):
    - **Placement and solid:** the nest at `LIBRARY_DRAGON_NEST` under `denRoot`, facing 45, and the dragon at y = `nest.padTop`. **One solid:** `props.disc('the dragon on its nest', x, z, max(nest.radius, visibleReachXZ(dragon.root)), 'wall')`. Nobody jumps onto a dragon.
    - **Life:**
      - breathing on `body.scale`, `b = sin(elapsed·1.7 + phase)·0.03`, with the phase from `new Rng(0x0b00d1)`;
      - a tail flick every `rng.range(5, 9)` s (`tail.rotation.y` ±0.25 over 0.8 s);
      - **head:** while she is in the den within 3 m, `head.rotation.y` damps toward her bearing, clamped ±0.6, with a small nod; the horns ride the head now;
      - `createFaceLife`, resting happy within 3 m and neutral otherwise.
    - **Puff:** idle every `rng.range(9, 14)` s, and on `sayHi()`. It lasts 1.2 s: face `puff`; `belly.emissiveIntensity = 0.2 + 1.0·sin(π·u)`; 4 warm sprites from the measured mouth (`SpritePuffs(denRoot, 10, PALETTE.fairyWarm, 0.3)`). **No `PointLight`**: the budget is 8 of 8.
    - **Meeting:** the first frame of a visit she is in the den, the leaf is open and she is within `MEET_RADIUS = 2.2` of the nest: `discoverSecret('secret.babyDragon')` (idempotent), then say `firstHello` if not yet discovered or `hello` otherwise, plus a puff.
    - **`sayHi()`:** a puff, the next of `dragon.hi` (cycled), and `discoverSecret`.
  - **`LibraryCat.ts`:**
    - **Placement and solid:** the pile and the cat in one group at `LIBRARY_CAT_PILE`, facing 45, with the cat at y = the pile's top. **Solid:** `props.box('the library cat on her book pile', { the measured plan centre rotated by 45°, facing: 45, halfLength: (maxX − minX)/2, halfDepth: (maxZ − minZ)/2 }, 'wall')`. Nobody jumps onto a sleeping cat.
    - **At rest:** the `asleep` face, breathing (1.1 Hz, 0.025), and a tail-tip sway of 0.08.
    - **`pet()`:** ignored within 0.5 s of the last one. Otherwise it lasts 2.2 s:
      - the ears twitch (`rotation.z` ±0.3·sin(u·5π) for the first 0.6 s);
      - the head lifts (`rotation.x` → −0.25 over 0.3 s, held, then eased back; the sign is measured by the check);
      - the face goes `happy`, then back to `asleep`;
      - 3 pink hearts, `playPurr()`, and a purr line.
  - **`chime.ts`.** `playPurr()` = `note(88, 0, 1.4, 0.04)`, `note(92, 0.05, 1.4, 0.035)`, `note(97, 0.1, 1.3, 0.03)`.
  - **`Library.ts`.**
    - `private readonly creatureBubble = new SpeechBubble({ id: 'library-creature-says', item: '', kind: 'actionFeedback' }, PALETTE.markerLemon)`, a constructor-time field in `roomRoot`.
    - `sayCreature(item, text, at, y)` in the `ReptileHouse.say` shape: `identity.item = item`, a 1.6 + 0.07·characters hold, `lastCreatureLine`.
    - `screenLabels = [owl.bubble, creatureBubble]`.
    - **Zones:**
      - `library-cat`, always offered inside: label `'the library cat'`, `pickRadius` 0.8, stand `LIBRARY_CAT_STAND`, `standRadius` 1.6, verb `Pet`, highlight the pile+cat group;
      - `library-dragon`, **only while the leaf is open**: label `'the baby dragon'`, `pickRadius` 1.0, stand `LIBRARY_DRAGON_STAND`, `standRadius` 2.2, verb `Say hi`, highlight `dragon.root`.
  - **`LABELS.md`.** Add the row: "The den's answers — the dragon's lines, the cat's purr | `world/library/Library.ts` (`sayCreature`) → `SpeechBubble` | actionFeedback | the pressed zone's id (`library-dragon`, `library-cat`)".
  - **check-labels scene 5** adds `visit(cat, true, 3)`, then `world.library.openDenInstantly(); run(1); visit(dragon, true, 3)`.
- **Check: CREATURES** (open state).
  - **Solid:** the nest's and the pile's middles are not reached; MARCHED at both from 16 bearings at both strides.
  - **DEX:**
    - CONTROL first: with the probe at the arrival, after 60 frames `secret.babyDragon` is not discovered;
    - then at `LIBRARY_DRAGON_STAND`, one update gives discovered, with `lastCreatureLine === firstHello`;
    - Say hi twice: still one discovery, and a `hi` line.
  - **PUFF:**
    - within 20 s there is at least one idle puff (vacuity);
    - the belly emissive rises above 1.0 within 0.7 s of a puff and is back to 0.2 ± 0.01 within 3 s;
    - a sprite is visible during it;
    - the head-turn sign follows her left and right within 3 m.
  - **CAT:**
    - press: within 0.5 s an ear's `rotation.z` differs from rest by more than 0.1, and the head's top rises by more than 2 cm;
    - the face is happy at 1.0 s and asleep by 3 s;
    - `lastCreatureLine` is one of the purr lines;
    - a second press within 0.5 s changes nothing.
  - `check:labels` registration and scene; `check:brevity` (SECRETS row).
- **Red:**
  - `LIBRARY_CHECK_REMOVE='the dragon on its nest'` or `'the library cat on her book pile'` → that middle is reachable.
  - By hand: `MEET_RADIUS = 0.5` → DEX red.
  - By hand: `PET_SECONDS = 0` → CAT red.

### Step 14 — Part 5 links, tap spacing, the children keep out of the den, docs
- **Files:** `src/main.ts`, `src/Game.ts`, `scripts/check-deep-links.mts`, `scripts/check-tap-spacing.mts`, `scripts/check-library.mts`, `ASSET_MANIFEST.md`, `art/blend/library_build.py` (docstring only), `HANDOFF-library-owl-den.md`.
- **Changes:**
  - **Deep links:**
    - add `'/library-den': 'libraryDen'` to `RIDE_DEEP_LINKS`; in `Game.ts`'s `miniGames.boardRide` handler, `if (stallId === 'libraryDen') return this.world.library.requestEnterDen();`;
    - in `launchGame` (main.ts), `makeSessionUnsavable()` when the link is `/library-den`, **or** a `/library?at=` whose spot is `libraryDenContains`. These links skip the find, and one typed on Eleri's machine must not hand her the Dragon friend card: the `?pets` and `/book` rule.
  - **`check-tap-spacing.mts`:**
    - the library block's bands become `library.doorBands().slice(1)`;
    - add a second snapshot, `'the library, secret shelf open'`: `library.openDenInstantly()`, then zones plus bands (the dragon zone included), then close it again.
  - **check-library KIDS** gains den avoidance: every circuit, summon and dismiss leg keeps `NPC_RADIUS + 0.2` from `libraryDenContains` and from the leaf's sweep quarter-disc. It prints "asserts N legs".
  - **`ASSET_MANIFEST.md`.** A Library creatures section: the nodes used, the measured sizes, the face sets (owl 4, dragon 4, cat 2 canvases), and the hinge decision.
  - **`library_build.py`.** In `build_secret_shelf`'s docstring, one sentence: the game re-originates the leaf on its back-left edge by the measured depth and swings it +π/2 **into** the den. This is the stale-comment rule; the glb is unchanged. Leave `HANDOFF-library-art.md` alone; it is another role's working file.
- **Checks:**
  - check-deep-links:
    - `/library?at=-15.8,-4&facing=270` gives inside, at the pull stand, `denOpen === false`;
    - `/library-den` gives inside, local x < −17.7, `denOpen === true`;
    - `/library?at=9.6,8.8&facing=180` gives inside, at the cat stand;
    - every number comes from the layout constants.
  - Run `check:tap-spacing` and quote both library snapshots.
- **Red:**
  - `LIBRARY_CHECK_MUTATE=resident-in-den` injects a waypoint at the den's centre into the measured list → KIDS red. This proves the clause.
  - By hand: remove `ownZoneId` from the den band → tap-spacing names `library-secret-book` within a finger of the doorway.

### Step 15 — Final gate, QA, handback
- **Scripts:** confirm by **parsing** the scripts object that every shard's step set equals Step 0's. No script is added: every clause lives in `check:library`, `check:labels`, `check:tap-spacing`, `check:brevity`, `check:assets`, `check:served-deep-links`, `check:served-book-reader` and the shard-6 vitest. Run `pnpm run check:chain-coverage` and `check:seed-coverage`.
- **Diff:** `git fetch origin && git rebase origin/<integration>` (rebuild any `check:shard` resolution from the parsed step set; never trust a rerere replay), then `git diff --stat origin/<integration>...HEAD` with three dots, and account for every file.
- **Gate:** the full gate (Ground rule 4) with exit codes, plus CI dispatch on the head commit, reading every job.
- **QA:** if owned, browser QA on a `vite preview` build (paths below), with one screenshot per path, sent up. Otherwise list exactly those frames as "visual QA needed".
- **Handback, in the handoff and to the caller:** the integration branch head; the full-gate and CI results; every red transcript with its geometry; the stderr coverage notes; the texture count; and the five preview paths with their one-line sentences. **Do not raise a PR**: the workflow raises the single Library PR. Remove the worktree when done.

---

## Check catalogue (all new or extended clauses)

| clause (script) | measures | proved red by |
|---|---|---|
| PAINTED FACES (check:library) | owl, dragon and cat UV row falls with height; eyes above the mouth or beak | `LIBRARY_CHECK_MUTATE=faces-upside-down` |
| check:assets ×5 | owl, dragon, nest, cat, pile: height, origin, scale | a wrong declared height (by hand) |
| READABLE (check:library) | 12 meshes ↔ BOOKS ids, inside their case box, on their shelf; zones only inside; stub opener ids; stack books fade | `shift-books`; `REMOVE='bookcase north-2'` |
| item 6 (check:served-book-reader) | a shelf Read chip opens that book, park paused, menu hidden | point the chip at the wrong id (by hand) |
| deep links (check:served-deep-links) | `/library?at=` desk, rug + `story=now`, pull stand (shut), cat stand; `/library-den` (open, in the den) | the `at`-less `requestEnter` (by hand) |
| OWL (check:library) | solid (middle unreachable), aisles and marches clear, blink cadence, head-turn sign | `REMOVE='the owl'` |
| CARD | granted on the press, exactly one, four lines, idempotent | `card-twice` |
| RECOMMEND | deterministic pick, one glowing book, cleared on read, next title differs | skip the reset (by hand) |
| SHUSH (+ CONTROL) | a sprint shushes with no penalty; a walk never does; a jump does; mid-script only the wing moves | `isRunning` without `DUST_SPEED` (by hand) |
| vitest `library-card.test.ts` | idempotent grant; save round trip; old save; unknown kind dropped | remove `'card'` from `INVENTORY_KINDS` |
| check:brevity | every library line and chip, every template × every title, the card's name, SECRETS | a two-sentence line |
| SIT | listening posture, feet ≤ 15 mm, hip ≤ 3 mm, get up by chip and by jump, Read hidden while seated | legs −0.7 (by hand) |
| KIDS | legs swept at `NPC_RADIUS` + 0.05; distances to the seats; resolve ≤ 0.01; moving inside, frozen outside; den avoidance | `block-route`; `resident-in-den` |
| STORY (vacuity guard) | all seated on their own cushions, feet and hip, no jitter, owl perched, every page said, Story listener, dispersal | `no-story`; `block-cushion` |
| FLIGHT | feet ≥ stack top + 0.3 over every stack; the live owl follows `owlFlightPose` | cruise − 1 (by hand) |
| REACHABILITY closed (extended) | den spots unreachable; the only pocket is inside the den | `REMOVE='bookcase west-2'` |
| DEN WALLS, LINTEL | nobody leaves the den but by the doorway; fliers stop at the lintel; walkers pass under | `REMOVE='den wall (west)'`; `no-lintel` |
| SECRET SHELF | monotone swing, swap only on landing, open fills, leavable, marches, sweep clearance, fresh visit shut, guard, fades | `seal-den`; `open-leaf-hollow`; the guard removed (by hand) |
| CREATURES | solid and marched; dex with control; puff with vacuity; dragon head; cat reactions | `REMOVE` of either; radius or seconds (by hand) |
| LIGHT (extended) | the darkest den cell is brighter than `PALETTE.ink` | the existing dark-rig control |
| check:labels | the library registered; scene: card, hello, read, cat, dragon | drop a bubble from `screenLabels` |
| check:tap-spacing | 18 library zones (Talk, 12 Read, 2 Sit, Pull, Pet, Say hi), 3 bands, open-den snapshot | den band without `ownZoneId` (by hand) |
| HOUSEKEEPING (check:library) | `kidsRoot` in the scene; texture count note; "the librarian's spot is a solid" note | — |
| check:castle (refactor) | tolerances imported from `scripts/lib/seatedPose.mts`; unchanged | — |

Every clause writes its coverage note to **`process.stderr`** (what was measured, how many, which book or seed). A green line must never imply cover it does not give.

---

## Decisions (decided here, with reasons)

1. **Bases:** part 4 is built on design 1 (delight, 85 points); part 5 on design 1 (the leaf swings into a walled pocket), the declared winner of an 83–83 tie. The judges' grafts listed under "How this plan was chosen" are taken. Where a graft conflicted with a base, the house rule decided.
2. **One build, one branch, no part-PR.** Parts 4 then 5, in 16 steps, on the integration branch. Jim's 13 Oct ruling (one PR for the Library) and the art handoff say the workflow raises it.
3. **Gate cadence.** Targeted checks every step; the full gate at the end of each part and before handback, with CI dispatched when local parks miss the hash. WIP pushes are allowed because the branch has no PR, so no CI runs and nothing can merge. Reason: almost every file is in the park-source closure, so a local full gate per commit means park acceptance loops per commit (the art agent's documented precedent).
4. **The owl is a prop owned by `LibraryOwl`, not an NpcSystem resident.** She never walks. A resident's own `move()` would resolve her out of her own collider, its push-apart is capped at 3 m/s against a 7.4 m/s walk (walkable through), and NpcSystem gives residents random facings. Every delight item (head-turn, blink, breath, wings, flight) lives in one class.
5. **The owl is solid** with a zero-length `'wall'` capsule whose radius is her measured plan reach, head included. It is `detach`ed (removeWall) when she flies and `attach`ed (restoreWall) when she lands: the same object, so `LIBRARY_CHECK_REMOVE` and the owner tag stay true. `LIBRARY_LIBRARIAN_SPOT` leaves the keep-outs. If AISLES fails, the spot moves south toward the desk; the radius is never shrunk.
6. **The library card is an inventory item** (kind and category `card`, `grantKeepsakeOnce`), not a `flags.ts` flag. The brief asks for "shown in the inventory"; `hotelKey` is shown nowhere; a flag plus an item would be two owners of one fact; and the inventory is already saved, restored, drawn and tolerant of old builds.
7. **The card is handed over on the first Talk press**, granted on the press and celebrated on the hand-over line (flash, chime, sparkles, wing flaps), as the hotel does. A welcome line invites her. Nothing is gated on the card.
8. **Shush rules:** `Player.isRunning` held for 0.35 s, or a real take-off (rising edge with `verticalSpeed > 0`), never a stand-up. Not while riding, not mid-space-change, not in the den. Wing and face only while the owl is mid-script, so it never interrupts the card or a story. 6 s cooldown. No penalty. An `actionFeedback` bubble on item `library-owl`, so it beats her own chip.
9. **Recommendation:** stateless, the first unread book in one seeded order. The glow is the book's own emissive plus twinkles, with a `Read me!` chip. Never the rainbow, which means "selected".
10. **Readable books:** their own meshes, the tallest and thickest shape, 3 cm proud and leaning 0.1 rad, so a child can spot them. Paired by index in `shelfBooks.ts` with a length throw. Books in stacks fade with their stack.
11. **The reader** is reached through a late-bound `attachBookReader`, with the **one** opener object shared with the Cute-o-dex. `InteriorControls` is not grown.
12. **The owl flies:** a straight plan line with smoothstep easing, a cruise height of the measured stack height + 0.6 held from t 0.2 to 0.8. Design 1's Bézier peaked at 0.75 of its control height and went through stack-3-4. A FLIGHT clause measures the clearance. She perches on the chair's measured seat centre, facing the rug.
13. **Story seats:** children on cushions 2, 4 and 5; the player is offered 1 and 3, always on. The seat is the stand. All five centres are keep-outs. Pair distances are asserted at load against `SEPARATION` and `PLAYER_SEPARATION` (now exported).
14. **Cushions are cut to `KID_HIP_HEIGHT`** if the integration still has the 0.22 m primitive (the glb's is 0.36), and asserted in the constructor. Seated roots sit at the floor, and legs hang vertical on the knee-less rig.
15. **One `'listening'` `RidePosture`** for player and children. `NpcCharacter.animate` takes a posture, so 'seated' and 'listening' go through one switch.
16. **Three children,** each a `CharacterModel` resident with a `LibraryKidDriver`: a WaypointDriver stroll on one aisle, plus Errand summons along routes declared in `layout.ts` and swept by KIDS. Three rather than four, for the canvas budget. Seeds are disjoint from the hotel, diners, books and park. Looks are lifted to `residentLooks.ts`.
17. **Seated children are furniture,** one way. **A riding player is furniture** in `separateFromPlayer`, a park-wide change, because `Player.nudge` ignores riding and a passing child must never slide her off a seat. The ride checks are re-run.
18. **Story clock:** 40 s, then every 150 s, counting while she is inside the library (the room or the den); it aborts on leaving, and children are never frozen mid-sit. It reads the recommended book, else the next in the seeded order. The **Story listener** secret is awarded for sitting through a whole story: cheap, and a six-year-old enjoys earning it.
19. **One parsed `/library` deep link** (`at`, `facing`, `story=now`) replaces the stall-id entry. `/library-den` is a ride-table entry. Links that skip the den's discovery are unsavable.
20. **The den is a walled pocket inside `SPACE_LIBRARY`,** not a new space. `LIBRARY_PLAY_RADIUS` 28 was reserved for it. No iris for a room three steps away; no save plumbing.
21. **The leaf swings into the den about its back-left edge.** The art's front-left −π/2 swing into the room cannot be built: a 2.1 m corridor for a 4 m leaf, which would lie 1.9 m across stack-2-1 and sweep the puller. It is re-originated in TS by measured size, and drawn from the same source as its neighbours, the glb's `secretShelf-*` when the cases are glb. Visible choice: name it to Jim.
22. **A drawn lintel** over the gap, with a banded collider whose base is the case height − jump grace − 0.05. The shut case and lintel read as solid wall, fliers are stopped, and walkers and the fill see a doorway.
23. **Both leaf collider states** are registered through props at construction (both keep-out-checked). The open set is detached. The shut set holds through the whole swing and swaps on landing, so a drawn leaf is never hollow.
24. **The leaf is open only if she enters or restores into the den,** and shut when she leaves the library. A guard opens it **instantly** if she is ever found in the den with it shut. Never sealed; never swept through her.
25. **Den contents are hidden while the leaf is shut** (no horns over the wall to spoil the secret). The west wall fades while she is in the den, and the open leaf fades through its own fader built on its open footprint.
26. **No new `PointLight`** (8 of 8). The puff is an emissive belly plus sprites; LIGHT covers the den cells.
27. **Dragon friend** is a SECRETS row awarded on **meeting** (within 2.2 m, in the den), with Say hi as an idempotent second road. No new category, no save field.
28. **Nobody jumps onto a dragon or a cat:** one `'wall'` disc for the nest and dragon, a `'wall'` box from the cat pile's measured plan. A stated exception to the knee-high rule.
29. **The dragon's head turns** (its horns ride the head pivot now). One dragon look: the storybook's dragon reads its colours from `LIBRARY_GLB_STYLES`. The book pictures keep their limbed dragon, so part 3's poses survive.
30. **The cat** sleeps on a pile by the desk, in the lamp's pool, facing the camera, with its stand 1.6 m south (re-measured; design 1's 1.4 m failed the keep-out with the true pile size).
31. **All creature colours in one table,** `LIBRARY_GLB_STYLES` in `libraryAssets.ts`, keyed by glb node name with literal keys, because the Artist's render script reads that file.
32. **Faces from `LIBRARY_FACES` only** (never typed). The owl's eyes are sized inside her measured rims.
33. **One lines table** (`libraryLines.ts`) for both parts, walked by check:brevity with every title rendered into every template. Titles are quoted with “ ” so a title's "!" never splits a sentence. The designs' two-sentence lines were rewritten.
34. **`HeartPuffs` is lifted to `SpritePuffs`** (one owner), and `lineSeconds` to `ui/speechTiming.ts`.
35. **Selection's Box3 cache is left alone.** Every moving highlight target offers its zone only at its cached pose (the owl at her desk, the pull book on the shut leaf), and the checks assert it.
36. **The den doorway is a `PortalBand` that fires nothing,** third in `doorBands()`, guarding tap spacing; consumers that destructure index 0 or 1 are unaffected.
37. **`kidsRoot`** (identity transform) is added to the scene and excluded from drawn reach. The den lives in `roomRoot`, which is already excluded.
38. **Every new clause lives in `check:library`,** with check-side mutations only (no test branches in game code) and `LIBRARY_CHECK_REMOVE`. No script is added to the chain. Seated-pose tolerances have one owner, `scripts/lib/seatedPose.mts`.
39. **Sitting:** 'Get up', jump, or a tap anywhere gets her up (Jim's nap rule). Read chips are hidden while seated. Pets keep following (no pets' table).
40. **The owl shushes with her left wing,** because the right holds her book. Story time continues while she is in the den; the owl does not shush there.
41. **Dragon and cat lines** come from design 2 ("I keep books, not gold!"): personality is what she will enjoy.
42. **The art docstring is corrected** for the game's hinge (stale-comment rule). The art handoff file is not edited.

## Risks to watch (with the lever for each)

- **What the integration really contains.** Step 0 records it, and the plan has a branch for primitive and for glb cases, cushions and armchairs.
- **CI time.** Park-closure changes re-solve 16 parks (30–45 min) per CI run. Batch to the three gate points.
- **The owl's clearance to the z = 4 aisle** is 0.03–0.05 m at a measured reach of about 0.65. The lever is to move her spot south by up to 0.2 m.
- **Children who give up** (a player standing on a child's cushion, a blocked route) stand and listen. That is graceful by design; QA watches it once.
- **Canvas count:** 15 (children) + 10 (creatures) on top of the hotel's 20 and the player's 5, beyond the informal "under 40". It is printed, not enforced. The lever is to drop to 2 children by deleting one plan line.
- **`LIBRARY_GLB_BASE64`** (about 600 KB of base64) joins the main bundle if this is the first import, as the reptile kits do.
- **Near the doorway inside the den, west-3** (an instanced case) can hide her legs from the camera; her head and body stay visible. QA judges it; the lever is a fader for west-3.
- **The leaf's transient 4.5 cm jamb clip** at about 8.5° of swing. Accepted; QA confirms it is invisible.
- **check:coplanar** must see the den shell and lintel. If it skips invisible meshes, make the den visible for the sweep.
- **The art branch is still live.** Re-read node names and `LIBRARY_FACES` at Step 0; a renamed node throws at load (loud, not silent).

## Preview paths and Jim's one-line sentences (take the host from the PR's newest preview comment)

| path | you will see X when you do Y |
|---|---|
| `/library?at=6,8.7&facing=180` | The owl turns to you; press **Get a library card!** and she hands you a card (it is in your backpack), press again and a book across the room starts to glow. |
| `/library?at=2.1,-8&facing=150&story=now` | Press **Sit down**: the owl flies over the shelves to the big chair, three children come and sit, and she reads a whole book aloud. |
| `/library?at=-15.8,-4&facing=270` | Press **Pull the book!** on the twinkling gold book: the bookcase swings away into a hidden room. |
| `/library-den` | Inside the secret room, the baby dragon on its nest of books puffs a warm glow; press **Say hi!** |
| `/library?at=9.6,8.8&facing=180` | Press **Pet the cat!** and she lifts her head, twitches her ears and purrs. |
