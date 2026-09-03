# HANDOFF — issue #486, a talking child's name pill

Branch `fix/name-label-486`, worktree `.claude/worktrees/name-label-486`.

**Jim:** "when children talk, the speech bubble overlaps the name over their
head - instead, hide their name while they are talking."

## What was done

- `src/entities/npc/NpcSystem.ts`
  - New private `speechTextOf(i)` — **the single owner** of "is this child
    speaking". `updateBubbles` draws its text; `updateLabels` skips the pill
    while it is non-null, in the same `continue` that already handles
    `VISIBLE_LABEL_CAP`. No latch: on a silent frame `updateScreenSize` sets
    `sprite.visible` by distance again, so the name returns by itself.
  - `get speechBubbles` now yields `{ character, bubble, label }` so the check
    can see both sprites without re-pairing them.
- `scripts/check-speech-bubbles.mts` — assertion 4 (a drawn bubble never
  co-exists with its owner's drawn pill) plus its other half (someone seen
  talking must later wear her name again), a stderr coverage line that says
  "asserts nothing this run" on a silent park, and `--mutate-label` to prove
  it red.

## Review round 1 (changes requested — the check, not the fix)

Clause 4b was a **total** latch (`spoken.size > 0 && namesReturned.size === 0`),
so a patch stopping the *first* child ever to speak from getting her pill back
printed "4 talked, 3 got their name back" and exited 0. Now per child:

- `NpcSystem.speechBubbles` also hands over `labelRank`, `labelDistance` and
  `speaking` — facts `updateLabels` already computed this frame.
- `VISIBLE_LABEL_CAP` and `LABEL_MAX_DISTANCE` are now exported and imported
  by the check, so it re-derives **nothing**. (The reviewer's own probe
  re-sorted the crowd; that would have been a second copy of a rule
  `NpcSystem` owns, which is the fault the check guards.)
- `--mutate-latch` added, so the one-child case stays re-provable: 1 child,
  1844 frames, clause 4a quiet — the halves isolate.
- `--mutate-label` is now faithful: it keeps the cap, which its comment always
  claimed and it did not.
- The 40-46 m band (`BUBBLE_MAX_DISTANCE` 40 vs `LABEL_MAX_DISTANCE` 46) is
  counted and printed, not asserted. 0 frames on canonical.

**Found while re-proving, pre-existing, not ours:** `--mutate` no longer
reaches assertion 1. On this branch *and* on `origin/main` `7a1d81f9` it fails
**assertion 3 only**, 0 off-screen speakers, 1984 sightings — identical to the
unmutated run, so blinding the gate draws no extra bubble. Every speaker stays
in shot for the whole run. Assertion 1 is armed but unproven; restoring its
reach means stranding a speaker off screen deliberately. Written into the
file's header where the stale transcript was. Worth a ticket.

## Review round 2 (approved, one condition + two nits — all in)

- **Condition:** assertion-1 gap filed as **#494**, and its number now sits in
  the header comment that promises it (was "worth a ticket, not done here").
- `speechBubbles` header says it is **O(n²)** via `labelOrder.indexOf`, beside
  the line that already said not-for-the-frame-path, plus what to do instead
  (keep `labelOrder`'s inverse) if the game ever wants it per frame. Also
  records that it has **no shipping consumer** — the check is the only caller.
- `silentBands` → `spokeWithNothingDrawn`. The condition
  (`speaking && !bubble.visible && labelDistance <= LABEL_MAX_DISTANCE`) also
  catches, at any distance, a speaker whose bubble was gated off screen by the
  #415 `isOnScreen` fix — the larger set, and not in the old name. 0 either
  way today, so no printed number was wrong; the label on it was.

Re-proved after the edits: unmutated exit 0 (10 talkers, longest nameless run
0, 0 frames with nothing drawn); `--mutate-latch` exit 1 (Finn, 1844 frames,
46.0 m, rank 9), clause 4a quiet.

## QA sign-off, and two numbers that correct this branch's own claims

Approved and QA-signed. QA measured 35,000 frames across two screen sizes: no
name drawn under its own bubble, none lost permanently, pill returns on the
same frame the bubble goes.

**1. `spokeWithNothingDrawn` reading 0 is a property of this check's camera
route, not of the game.** QA's equivalent counter over its own route read
**2203 frames**, which splits as:

- **0** in the 40–46 m band (the `BUBBLE_MAX_DISTANCE` 40 vs
  `LABEL_MAX_DISTANCE` 46 gap), and
- **131 frames (0.37%)** where a child on screen and inside
  `VISIBLE_LABEL_CAP` was mid-word wearing neither pill nor bubble — **all of
  them `isOnScreen` gating the bubble**, which is the second cause the counter
  was renamed to admit it catches.

So the header's "0 frames on the canonical seed" is true of the run it
describes and **must not be read as "this does not happen"**. The 0 comes from
where `check:speech-bubbles` walks its player, and a different route finds it
at once. The renaming was right and the number under it is route-specific;
whoever next touches that comment should say so in it. (Not amended on this
branch: the PR is approved and awaiting Jim, and a doc-only push would re-run
26 minutes of CI and re-open the review for nothing. It is a one-line change if
wanted.)

Direction it points: the pill hides for *text that exists*, and the honest fix
named in the header — hide it for a bubble that is *drawn* — would close all
131 of those frames, not just the band. That is a real follow-up, not a
hypothetical.

**2. The `check:pet-slide` flake (#496) is environmental, not timing noise.**
QA could not reproduce it in five consecutive local runs and got
**byte-identical numbers each time**. Byte-identical rules out accumulated
`dt`, frame counts and scheduling jitter, which is where I would have looked
first — it points at a code path that differs on the CI box. Recorded on #496.

## Residual, now measured properly

The player-pill overlap I flagged is **worse than I estimated**: QA measured
another child's bubble covering the player's own pill in about **10% of
frames, sometimes completely**. Jim has it as a design call; the merge waits on
his answer. My own evidence for it is `486-head-1.png` and `486-far-talker.png`.

## Findings

- **The player has a name label and cannot speak.** `Player.label` is a
  `NameLabel`; `Player.ts` never constructs a `SpeechBubble` and has no
  `say`/`speak` — she is only ever the listener (`ChatToPlayer` triggers on
  `playerStationaryFor`). Nothing to change; left alone.
- The other two bubble owners have no name labels to collide with: the hotel
  receptionist (`Hotel.receptionBubble`) and `WildPets`.

## Measurements (default seed, 390x844, SECONDS=120)

```
(unmutated)      1984 sightings; 4 talked, 4 names back; 0 overlaps   exit 0
--mutate-label   1984 sightings; 1984 pills under their own bubble.
                 First: Finn talking at (-2.78, -0.10, 51.88), fr 840 exit 1
origin/main 7a1d81f9, unmodified check: 1984 sightings                exit 0
```

## Watched in a running game (headless Chromium, dev server on 5287)

`/spawn?pos=-1.6,51.6`, sampling `window.game.world.npcs.speechBubbles` at
10 Hz for 180 s across 24 children:

- 0 pills drawn under their own bubble, in 1800 samples.
- 9 bubble episodes ended; 9 names came back; worst delay **0 ms** (same
  sample — the pill returns on the frame the bubble goes).
- Shortest episode 1166 ms, longest 6472 ms — nothing brief enough to flicker.
- Chat is sparse: one 150 s run saw no bubble at all. Budget several minutes
  before concluding anything from a silent run.

Screenshots in the session scratchpad: `486-before.png`, `486-during.png`
(Ines talking, her pill gone), `486-after.png` (her pill back),
`486-far-talker.png` (two children talking, neighbours' pills still up).

**Not fixed, on purpose:** a chatter walks right up to the player, so her
bubble can be drawn in front of the *player's* pill and hide it behind an
opaque sprite (`486-far-talker.png`). One character's bubble over another
character's name — not what Jim described, and hiding the player's name
whenever anyone speaks near her is a design call. Worth its own ticket.

## Remaining

- Rebased onto `origin/main` 7a1d81f9; three-dot diff is three files, all
  mine, no deletions, `package.json` untouched (script sets compared with
  `main`: 104 = 104, no adds, no drops, `check` chain byte-identical).
- PR #490 raised. **Do not merge.**
- Gates were running at last checkpoint on a box at load average 12–20; if
  `check:park-boot` or `check:arrival-completes` fails on timing, that is #456
  under contention, not this diff. Re-run before believing it.
- Dev server for Jim: port **5287** (`--strictPort`), land on
  `/spawn?pos=-1.6,51.6` and stand still — a child comes over within a minute
  or two. Kill by PID when he is done.
