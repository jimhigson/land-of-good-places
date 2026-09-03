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

## Remaining

- Rebase onto `origin/main` (moved to 7a1d81f9 after this branch was cut).
- `pnpm run check`, `test:procgen`, `check:coplanar`, `build`.
- Browser QA: watch a child chat, name goes, name returns. Screenshots to the
  Overseer. Dev server port **5287** (`--strictPort`), kill by PID.
- PR, do not merge. Preview link must land where a child talks.
