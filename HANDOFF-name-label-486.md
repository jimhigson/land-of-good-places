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
