# HANDOFF — Library v2, track A: the owl at her desk (plan Step 6, #718)

Branch `feat/library-v2-owl`, cut from the integration head **33bcc361** (`feat/library-v2`;
the PR head `feat/library-v2-pr` is b438b695, one handoff-only commit behind). Worktree
`.claude/worktrees/library-v2-owl`. Engineer, Claude Fable 5.1, 22–23 Oct 2026. The plan is
`docs/library-build/PLAN-parts-4-5.md`, Step 6; the integration record is
`HANDOFF-library-v2.md`; the engine's is `HANDOFF-engine-solids.md`. Scratch logs:
`/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/owl6/` (every log named below is
there; each ends in an `exit=N` line written after the run).

## Status

- [x] Worktree at 33bcc361, `pnpm install --frozen-lockfile`, `pnpm/12.1.0`, node v26.5.0.
- [x] Baseline `check:library` on the honest seed-5 park copied from `.claude/worktrees/library-v2/.parks`
      (source hash 8644cfac… at 33bcc361, equal to the manifest's): **101 ✓, 0 ✗, exit 0**
      (`baseline-library.log`).
- [x] **Step 6 built and green**: `LibraryOwl.ts`, `recommendation.ts`, `layout.ts`, `props.ts`
      doc, `Library.ts`, `docs/design/LABELS.md`, `scripts/check-labels.mts`, `scripts/check-library.mts`.
      `check:library` **135 ✓, 0 ✗, exit 0** (`library-1.log`): +34 clauses (OWL 11, CARD 7,
      RECOMMEND 8, SHUSH 7, HOUSEKEEPING 1).
- [ ] Reds proved (section below is filled in as each runs).
- [ ] Gate: `tsc --noEmit` exit 0 (`tsc-1.log`); the rest below.

## What was built (commits 14bcb5cf, 2f5f286b, …)

- **`src/world/library/LibraryOwl.ts`** (new) — `class LibraryOwl`, fields declared (no parameter
  properties). Built by `Library`'s constructor after `furnishReadingRoom` and before
  `props.assertClear()`.
  - **Body**: `createLibraryOwl()` (`libraryCreatures.ts`, the Artist's `library.glb`) at
    `LIBRARY_LIBRARIAN_SPOT` (6, 5.3), facing 0 (+Z, the desk's front and the camera), under
    `roomRoot`.
  - **Solid**: `props.wall('the owl', spot, spot, radius, handle.height)` — a zero-length capsule,
    i.e. a filled disc, `radius = visibleReachXZ(handle.root)` measured **before** the root is
    moved (**0.655 m**, head and glasses included), top = her measured height (**1.619 m**). The
    engine has no `'wall'` top any more (PR #722), so the top is a real height: see Decisions 1–2.
    Exposed as `capsule` for Step 9's `detach`/`attach`.
  - **Bubble**: `new SpeechBubble({ id: 'library-owl-says', item: 'library-owl', kind:
    'actionFeedback' }, PALETTE.markerLilac)`, sprite in `roomRoot`, anchored over her head
    (height + 0.42) and `updateScreenSize(camera)` every speaking frame. `actionFeedback` on the
    zone's own item, so it is drawn over her chip, never under it (LabelManager rule 1).
  - **Speech**: `say(lines, cheerAt, interruptible)` / `updateSpeech(dt)` in `Hotel.ts`'s shape
    with `lineSeconds` (`ui/speechTiming.ts`). `speaking`, `midScript`, `lastSaid` exposed.
    A **script** (card, recommendation, story) is never interrupted; the welcome and the
    "Shhh!" are one-liners a press may cut short (Decision 3).
  - **Life**: breathing on `body.scale` = (1+0.6b, 1−b, 1+0.6b), b = sin(1.7t + phase)·0.02,
    phase from `new Rng(LIBRARY_OWL_SEED = 0x0b00c4)`; `createFaceLife` resting
    `shushFor > 0 ? 'surprised' : speaking ? 'happy' : 'neutral'`; head-turn toward the child
    within `OWL_LOOK_RANGE` 9 m, clamped ±`HEAD_TURN_LIMIT` 1.0 rad, eased with
    `damp(…, HEAD_TURN_HALF_LIFE 0.09 s)` — the plan's "0.12 a frame" at 60 fps made
    frame-rate independent (Decision 4); straight ahead beyond range.
  - **`talk(player)`**: nothing mid-script; without the card `giveCard`, with it `hello`.
  - **`giveCard`**: `giveLibraryCard()` **on the press**, `player.model.setExpression('happy')`,
    `say(LIBRARY_LINES.owl.card, cardCheerAt)`. On the hand-over line: `controls.flash()`,
    `playSurpriseChime()`, 6 warm sparkles over her (`SpritePuffs(roomRoot, 12, PALETTE.fairyWarm,
    0.3)`, rng `LIBRARY_FX_SEED = 0x0b00d5`), two quick flaps of `wingR.rotation.z` (the book
    rides that wing). `enter()` says the welcome once per visit if she has no card.
  - **`hello`**: `recommendFor(state)`; null → `allRead`; else `recommended = pick.id` and the
    four-line recommendation.
  - **Glow**: the recommended unread book's own material: `emissiveIntensity = 0.25 + 0.35·(½ +
    ½ sin 2.4t)`; every other book 0, written only on the frame a book stops glowing; the
    recommendation clears on the frame `isBookRead` turns true; 2 warm twinkles at the book
    every 1.4 s (the book's room-local spot read through `mesh.getWorldPosition` +
    `roomRoot.worldToLocal`); its Read chip says `LIBRARY_CHIPS.readGlowing` ("Read me!")
    through `Library.shelfBookZone`. Never the rainbow.
  - **Shush** (`noticeShush`): conditions `!changing && !player.riding && atDesk`; `runningFor`
    accumulates `player.isRunning` (Player's one definition) and resets otherwise; a jump is the
    rising edge of `isAirborne` with `verticalSpeed > 0`. Fires when `runningFor ≥ 0.35 ||
    jumped` and the cooldown is 0: face 'surprised' 1.2 s, `wingL.rotation.x` eases to −1.3;
    mid-script wing and face only, else `say(['Shhh!'], -1, interruptible)`; cooldown 6 s;
    `shushes` counts (a check needs a count: `lastSaid` stays "Shhh!"). **No penalty.**
    Not-in-the-den and not-while-perched are **for the join** (below).
  - Constants exported for the check: `OWL_ZONE_ID`, `SHUSH_RUN_SECONDS`,
    `SHUSH_COOLDOWN_SECONDS`, `SHUSH_WING_X`, `OWL_LOOK_RANGE`, `HEAD_TURN_LIMIT`, `GLOW_*`,
    `TWINKLE_EVERY`, the two seeds.
- **`src/world/library/recommendation.ts`** (new) — `LIBRARY_RECOMMEND_SEED = 0x0b00c9`,
  `RECOMMENDATION_ORDER` (BOOKS, Fisher–Yates with `rng.int(0, i)` from the last index down),
  `recommendFor(state)` = first not `isBookRead`, or null. The dealt order on this tree:
  fountainWish → fireflies → catBusDay → goodnightPark → trillaHigh → keychainStall →
  biscuitBreakfast → bookDragon → bigParade → foreverSlide → ripikaBalloon → duckBars (the six
  chapter books join `BOOKS` when track D lands them and re-deal it — Decision 6).
- **`src/world/library/layout.ts`** — `LIBRARY_LIBRARIAN_SPOT` removed from `libraryStandSpots()`
  (doc on the constant and the function: her solid spot, not a keep-out; still a `StandSpot`
  for Step 9's landing). **76 keep-outs** now (77 before: the den handoff's "room count drops by
  one; the den count stays 2" — 74 room + 2 den).
- **`src/world/library/props.ts`** — the keep-out doc no longer lists the librarian's spot.
- **`src/world/library/Library.ts`** — `readonly owl: LibraryOwl`; `owlZone` built once: id
  `library-owl`, label `'the librarian'`, x/z her spot, y floor + 1, `pickRadius`
  `OWL_PICK_RADIUS` 1.2, stand `LIBRARY_DESK_STAND` (6, 8.7), verb `Talk`, highlight
  `owl.handle.root`, actions `hasLibraryCard ? 'Say hello!' 🦉 : 'Get a library card!' 🪪`
  (both `owl.talk`). `interactZones()` offers it only while `owl.atDesk` and not riding, before
  the Read zones; `screenLabels` = `[nameLabel, owl.bubble]`; `update` runs `owl.update(dt,
  elapsed, player, spaces.isChanging, deps.camera)` while inside, **before** the seated jump
  (the plan's order); `enterRoom` greets only when arriving from outside (`!inside` before —
  a link typed from inside or the fall rescue does not re-greet), `adoptRestoredPlayer` greets,
  `standOutside`/`releasePlayer` call `owl.leave()`. Class doc updated (the owl is here; story
  time still to come).
- **`docs/design/LABELS.md`** — the owl's row (`world/library/LibraryOwl.ts` → `SpeechBubble`,
  `actionFeedback`, `library-owl`).
- **`scripts/check-labels.mts`** — `['the library', world.library.screenLabels]` in the
  registration control, and nothing else (scene 5 is Step 10).
- **`scripts/check-library.mts`** — a new WITH A REAL CHILD block after the track A marker
  (OWL, CARD, RECOMMEND, SHUSH, each with a stderr note), `card-twice` armed, the DOORS probe
  given `isRunning/isAirborne/verticalSpeed` and `input: new InputSystem()`, the REACHABILITY
  note no longer lists the librarian, HOUSEKEEPING asserts the bubble is among the room's labels
  as `actionFeedback` for `library-owl` and notes the owl's solid. The label manager is given a
  1280×720 screen (`camera.resize`) at the top of the block so a bubble can be measured and
  granted; the stick's basis (camera forward/right) does not depend on the frame, so SIT after
  it walks as before (its lines are unchanged in `library-1.log`).

## check:library at 2f5f286b — the new sections, off the screen (`library-1.log`)

Geometry: the reading room at (−600, −600); the owl at room (6, 5.3), r 0.655, top 1.619; the
desk at (6, 6.8) facing 0, top 1.02; the desk's front stand (6, 8.7) facing 180; the entrance-hall
aisle's z = 4 run; the shush start (0, 4) facing 270 (west); the camera 1280×720.

```
OWL — the librarian at her desk: solid, and alive:
  ✓ 'the owl' is registered as a zero-length capsule at (6, 5.3): a disc of r 0.655 (…), top 1.619 m (her measured height)
  ✓ her reach is a round owl's: 0.655 m (0.5..0.9 wanted; …)
  ✓ the librarian's spot is no longer a keep-out (76 keep-outs, none of them hers)
  ✓ the fill does not reach her middle at (6, 5.3) — she is solid (8725 cells reached from the arrival)
  ✓ 28 marches at her from 14 bearings (2 starts skipped: … the desk stands in front of her): the deepest a body's edge got into her drawn disc is 0.000 m (allowance 0.03)
  ✓ AISLES above swept every aisle with her in the world; the nearest, 'entrance-hall', passes 0.025 m clear of her disc at a player's radius
  ✓ coming in without her card (0 held), the owl invites her over: "Come to my desk for your library card!"
  ✓ quiet at the desk for 15 s (resting face 'neutral'; spoke meanwhile: false), her face changed 4 time(s) — she blinks — and was never held changed longer than 6 frame(s) (a blink: at most 9, from BLINK_DURATION 0.11 s)
  ✓ stood 3 m to either side of her for 2 s each (both spots clear floor: true), her head turns: rotation.y 1.000 with the child at +X, -1.000 at −X — opposite signs, each beyond 0.4 rad (the turn is clamped at ±1)
  ✓ and it turns TOWARD her, measured off the head's own axis: within 33° of the child on both sides (cos ≥ 0.8 wanted; …)
  ✓ CONTROL: stood 12.2 m away (clear: true; her look range 9), her head comes back to straight ahead: -0.000 rad
CARD — her library card, on the first press at the desk:
  ✓ on a fresh store she has no library card (0 held; hasLibraryCard false)
  ✓ at the desk's front (0.00 m from her zone's stand, reach 3) the owl offers 'Get a library card!' (…), verb 'Talk'
  ✓ pressing it gives her the card at once (true): 1 'card.library' in her inventory (exactly one wanted)
  ✓ and starts her script: "Hello, little reader!"
  ✓ her 4 card lines were said in turn and the bubble went away: "Hello, little reader!", "Walk softly and treat the books kindly.", "Here is your very own library card!", "Every book here is yours to read."
  ✓ on the hand-over line (#3) she flapped the wing that holds her book: rotation.z down to -0.90
  ✓ with the card she offers 'Say hello!' (…), and the count is still 1
RECOMMEND — 'Say hello!' names the first unread book of the owl's order, and it glows until it is read:
  ✓ before the press no book glows (0 over 0.2) and nothing is recommended
  ✓ within 1 s of the press 'fountainWish' glows: emissive 0.374 after 1 frame(s) (over 0.2 wanted; recommended: 'fountainWish')
  ✓ the other 11 read exactly 0 (11 do; BOOKS.length − 1 = 11 wanted)
  ✓ its Read chip says 'Read me!' (…); another book's ('ripikaBalloon') says 'Read it!'
  ✓ she said "Try “The Fountain Wish” next!" — the first unread title in RECOMMENDATION_ORDER — and "It is glowing on its shelf!" (4 lines, then quiet)
  ✓ read to the end (markBookRead) and two frames on, every book reads 0 (none lit), the recommendation is cleared ('none') and its chip says 'Read it!' again
  ✓ the next press names a different title: "Try “Fireflies at Night” next!" (said: true; before: 'fountainWish', now: 'fireflies')
  ✓ recommendFor, asked twice on the same state, answered 'fountainWish' and 'fountainWish'
SHUSH — a sprint through the room gets a "Shhh!", and nothing else:
  ✓ from (0, 4) (clear floor: true) she sprinted west for 3 s and got up to a run: isRunning on 86 of 180 frames
  ✓ the owl shushed once (1), on frame 31 (a run of 0.35 s wanted first): "Shhh!"
  ✓ and nothing else: never taken (riding false), she travelled 16.48 m (at least 5) and is still in the room (true)
  ✓ her bubble was drawn: the label manager granted its sprite a frame (visible on some frame: true)
  ✓ CONTROL: 3 s of walking the same way, no sprint, never shushes (0; isRunning ever true: false); she walked 16.48 m (at least 3)
  ✓ a jump (took off: true) shushes her: 1 more, "Shhh!"
  ✓ mid-card-script (measured in CARD): a 12.1 m sprint (running: true) shushed her 1 time(s) with her free wing (rotation.x down to -1.30; the full lift is -1.3) — her words stayed on the card's lines (true) and the script went on (true)
```

Both 16.48 m runs end at the west wall (x ≈ −16.5): the sprint gets there in ~1.5 s, the walk
in 3 s, so the walking CONTROL covers the same ground at a walk and never trips `isRunning`.

## Reds (each with the geometry above; exit codes read off the logs)

1. **`LIBRARY_CHECK_REMOVE='the owl'`** (`red-remove-owl.log`) → **exit 1, `2 clause(s) FAILED`**
   (133 ✓, 2 ✗). The owl's capsule (r 0.655 at (6, 5.3)) taken out by `takeOut` (`removeWall`):
   ```
   note: REMOVED the owl on purpose — this run must go red
   ✗ the fill does not reach her middle at (6, 5.3) — she is solid (8777 cells reached from the arrival)
   ✗ 28 marches at her from 14 bearings (2 starts skipped: off the plate or inside a solid — the desk stands in front of her): the deepest a body's edge got into her drawn disc is 0.895 m (allowance 0.03)
   ```
   (8725 cells reached with her in; 8777 without — her disc's cells.) The reach, keep-out,
   welcome, blink and head lines stay green, as they should: they measure the drawn owl, not
   her collider.
2. **`LIBRARY_CHECK_MUTATE=card-twice`** (`red-card-twice.log`) → **exit 1, `2 clause(s) FAILED`**
   (133 ✓, 2 ✗). The check hands her a second card through the non-idempotent
   `gameStore.catchWildPet(LIBRARY_CARD)` right after the press:
   ```
   note: GAVE her a second card through the non-idempotent catchWildPet on purpose — this run must go red
   ✗ pressing it gives her the card at once (true): 2 'card.library' in her inventory (exactly one wanted)
   ✗ with the card she offers 'Say hello!' (wanted 'Say hello!'), and the count is still 2
   ```
   The control: the real `grantKeepsakeOnce` road, pressed and then re-asked through
   `hasLibraryCard`, holds the count at 1 in the green run.
3. **By hand — `Player.isRunning` without its speed** (`red-byhand-isrunning.log`; the one line
   `Math.hypot(this.velocity.x, this.velocity.z) >= DUST_SPEED` made `> 0`, so any movement is a
   run; the manifest restamped to that tree's hash 19c2d14b…, then `git checkout -- src/entities/Player.ts`
   and restamped back; the script is `byhand.sh`) → **exit 1, `2 clause(s) FAILED`** (133 ✓, 2 ✗):
   ```
   ✗ CONTROL: 3 s of walking the same way, no sprint, never shushes (1; isRunning ever true: true); she walked 16.48 m (at least 3)
   ✗ a jump (took off: true) shushes her: 0 more, "Shhh!"
   ```
   The second is the first's consequence: the walk's shush put her in the 6 s cooldown, so the
   jump half a second later could not fire — the cooldown measured from the wrong side. The
   sprint lines stay green (a walk that counts as a run still runs).
4. **By hand — `LibraryOwl.glow` without its `isBookRead` reset** (`red-byhand-glow-reset.log`;
   the line `if (this.recommendedId !== null && isBookRead(…)) this.recommendedId = null;` removed;
   restamped to e7140973…, reverted, restamped back) → **exit 1, `1 clause(s) FAILED`** (134 ✓, 1 ✗):
   ```
   ✗ read to the end (markBookRead) and two frames on, every book reads 0 (still lit: fountainWish), the recommendation is cleared ('fountainWish') and its chip says 'Read me!' again
   ```
   Geometry for both: the same room, the recommended book 'fountainWish' on stack-3-3 (shelf 1,
   −0.6 m along; room (−5.600, 0.756, 1.629)), its material the glow target.

## Gate at 2f5f286b (exit codes off the logs; counts off the screen)

| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | `tsc-1.log` |
| `pnpm run typecheck:test` | 0 | `gate-typecheck-test.log` |
| `check:library` | 0 | **135 ✓, 0 ✗**, "All clauses passed." (101 at the base) |
| `check:tap-spacing` | 0 | 10 spaces, **146 zones** (145 at the base: +1, `library-owl` Talk), 27 portal bands; finger 1.13 m; 246 zone-band (+1) and 20 close zone-zone pairs; 20 same-action overlaps (warnings) |
| `check:labels` | 0 | 12570 frames at 390x844; **55 labels registered** (54 at the base: +1, the owl's bubble); no overlap, nothing flickered; the library is registered (the control line) — its scene is Step 10 |
| `check:brevity` | 0 | 354 pieces, 6 recorded exceptions (unchanged: the owl's words were already in `libraryLines.ts`) |
| `check:assets` | 0 | 135 assets, 48 creatures, 28 recorded drift (unchanged) |

## Decisions (with reasons) — Jim is away

1. **The owl's top is her measured height (1.619 m), not "to the ceiling".** The plan's `'wall'`
   top is gone with PR #722 (every solid has a real top, no flag — Jim, 17 Oct: "anything should
   be jumpable with no special 'floor' being marked"), and the integration handoff says to use
   her height. Consequence, measured: from the floor her head is out of a jump's reach (apex
   ≈ 1.23 m), but **from the desk's top (1.02 m) a jump can land on her head** — HOUSEKEEPING
   says so on every run. Physics, not a decision made here; listed for Jim below rather than
   fenced off (no new blocker without him).
2. **Her solid is a zero-length capsule, not a disc.** `CollisionWorld` restores only walls and
   boxes, and Step 9 must take her out as she flies and put the same object back as she lands.
   `props.wall(a, a, …)` is the documented route (`props.ts`).
3. **A press interrupts her one-line invitation; nothing interrupts a script.** The plan says
   "talk() does nothing while speaking"; applied to the welcome that would make the invited
   press do nothing for up to 3.8 s. The card and recommendation scripts (and story time) are
   never interrupted, as the plan asks; the "Shhh!" is a one-liner too. The chip is put away
   under her bubble while she talks (rule 1), so no chip she shows lies.
4. **The head turn is a half-life (0.09 s), not a per-frame factor.** `damp` in `mathUtils.ts`
   is half-life based ("always prefer this over `lerp(a, b, 0.1)` inside an update loop"); 0.09 s
   is the plan's 0.12 per 60 Hz frame. The check reads the result after 2 s, which both forms
   reach.
5. **The sign of the head turn is measured, not assumed**: the check reads the head's own +Z axis
   in the world (`getWorldDirection`) and asserts it points within 33° of the child on both
   sides (a head clamped at 1.0 rad to a child 90° round can get no closer); the signs are then
   reported as found (+1.000 at +X, −1.000 at −X).
6. **The recommendation order covers `BOOKS`**, picture and chapter books alike, as the plan
   says. Today `CHAPTER_BOOKS` is empty, so the dealt order is the twelve; when track D's six
   land, `BOOKS` grows and the same seed deals a different order (recorded, not a bug: nothing
   is saved about the order).
7. **The mid-script shush is measured during CARD and reported under SHUSH.** The card script
   runs once per store (the card is idempotent), so the only time it is running is right after
   the first press; the measurement is taken there and asserted in the SHUSH section where the
   plan lists it.
8. **The label manager is given a 1280×720 screen in the check.** The headless camera is
   un-resized (aspect 1, one pixel high), and a bubble's "wanted" asks `IsoCamera.isOnScreen`;
   a landscape phone's frame is what the game has. The stick's camera basis is unaffected.
9. **`shushes` is a count on the owl.** `lastSaid` stays "Shhh!" after the first one, so a
   walking CONTROL that must see *no new* shush needs a count, not a last line.

## For the join

- **Shush "not in the den"** (plan Step 6's condition from Step 12): `noticeShush` has no
  `libraryDenContains` test yet. When the den track lands, add `|| libraryDenContains(localX,
  localZ)` to the "no shush" conditions (one owner: `layout.ts`'s `libraryDenContains`).
- **Shush "at her desk or perched"** (Step 9): `atDeskFlag` is private and always true today;
  Step 9 flips it on take-off/landing and adds "or perched" to the shush condition. `capsule`
  is the object to `props.detach([capsule])` / `attach([capsule])`.
- **Step 12's shush suppression** while the leaf swings/in the den: same `libraryDenContains`.
- **Step 10's labels scene**: `check:labels` registers the library's labels now (the control
  line); scene 5 (card, hello, read) is Step 10's.
- **`check:tap-spacing`**: +1 zone (`library-owl`, Talk) — see the gate below for the count.
- **Story time** (Step 9) reads `RECOMMENDATION_ORDER` / `recommendedBookId` for its book
  (`recommended ?? ORDER[storiesTold % n]`), per the plan.

## Questions for Jim (no blockers added)

- **A child can stand on the owl's head** by jumping off the desk's top (1.02 m → her head at
  1.62 m). Her head turns under her feet. It is the engine's rule (every solid's real top is
  landable). If you would rather she could not, the honest options are a taller owl top (an
  invisible blocker — your call) or leaving it as a thing a six-year-old will enjoy.
- **The owl shushes a runner anywhere in the room** (no distance condition in the plan): a sprint
  at the far west wall still gets a "Shhh!" from the desk. Her bubble hides when she is off
  screen, so from far away the child sees nothing. Say if you want a range.

## Parks

Source hash after my src edits: **df96ae72…** (`.parks/manifest.json` restamped to it with
`.claude/library-build-scratch/owl6/restamp.mjs <worktree>` — the integration handoff's local
shortcut; the reading room is seed-independent and the owl changes nothing in the park). The
honest seed-5 file is the integration branch's (`features`/`measures`/`planOrder` identical to
the engine's seed 5). CI re-solves on the PR head.

## Taking over at zero notice

`cd .claude/worktrees/library-v2-owl` (branch `feat/library-v2-owl`), `pnpm install
--frozen-lockfile`, `pnpm exec node -e "console.log(process.env.npm_config_user_agent)"` →
pnpm/12.1.0. Restamp `.parks/manifest.json` after any src edit (`node
.claude/library-build-scratch/owl6/restamp.mjs $PWD`), then `pnpm run check:library`. Every red
below is reproducible from its mutation name or the one-line edit it names.
