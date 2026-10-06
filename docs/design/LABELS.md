# Labels over the world — one owner

Jim, 6 October 2026:

> each item needs to have at most one text label — the call to action is
> sometimes still shown while the action is happening, and covers up any labels
> that the action wants to show. We need to design a system where text labels
> are managed and guaranteed non-overlapping, and also have a precedence number
> so that two that would have been overlapping, the higher precedence is shown
> only. For two of equal precedence, either can be shown so long as the choice
> is stable.

The worked example was the Reptile House: press "Say hi! E" at an exhibit and
the exhibit answers with a bubble ("peep!", or its one-line blurb on the first
hello) — over the same exhibit the chip is still floating over, so the chip
sits on top of the answer.

## What a label is here

Anything that puts **words on the screen over a place in the world** and tracks
that place as the camera moves. Painted signage that is part of the geometry
(the gate arch, the hotel's sign, the cat bus's destination board, the reptile
nameplates) is not: it is depth-tested scenery, drawn in perspective, and
cannot float over anything.

### Inventory (every one of these is now managed)

| label | file | kind | item |
|---|---|---|---|
| Action chips — "Say hi! E", "Hop on!", "Tickle tail!", "Check in here!" | `ui/ActionChips.ts` (DOM) | `callToAction` | the selected zone's id |
| The player's name pill | `entities/Player.ts` → `ui/NameLabel.ts` | `playerName` | `player` |
| Park children's name pills | `entities/npc/NpcSystem.ts` → `NameLabel` | `name` | `npc:<name>` |
| Park children's chat bubbles ("I'm going to The Castle") | `NpcSystem.ts` → `ui/SpeechBubble.ts` | `speech` | `npc:<name>` |
| The hotel receptionist's script | `world/hotel/Hotel.ts` → `SpeechBubble` | `actionFeedback` | `hotel-reception` |
| The Reptile House's answers — blurbs, "peep!", "ribbit!", "Hisss-ello!", "3 of 5 babies found!", the Noodle-o-meter reading | `world/reptileHouse/ReptileHouse.ts` (`say`) → `SpeechBubble` | `actionFeedback` | the pressed zone's id (`reptile:<exhibit>`, `reptile:baby:<n>`, `reptile:meter`) |
| "a wild bunny appears!" on the castle roof | `world/building/WildPets.ts` → `SpeechBubble` | `speech` | `wildPet:<uid>` (its catch chip's item) |
| Dodgems: "TWEET!?" | `minigames/dodgems/tree.ts` → `SpriteLabel` | `actionFeedback` | `dodgems:tree` |
| Dodgems: giggles ("hee hee!", "bonk!") | `minigames/dodgems/giggles.ts` → `SpriteLabel` | `actionFeedback` | `dodgems:giggle:<n>` |
| Water fight: "YOU" | `minigames/waterFight/child.ts` → `NameLabel` | `playerName` | `player` |

Looked at and left out, with the reason: the Spooky House's hotspots (invisible
tap targets, no words); `art/effects/puffSong.ts` (music-note glyphs, no
words); `ui/TapBurst.ts` (a press flash over a button); the HUD, panels, map
and race HUD (screen UI, not anchored in the world).

## The rules

`ui/LabelManager.ts` owns them; one instance per rendered view — `World.labels`
for the park, and one each in the dodgems and the water fight.

**A label never decides whether it is drawn.** It says whether it *wants* to be
(it has text, its speaker is near and in shot, something is selected) and where
it would be laid out. Once a frame, after every system and immediately before
the render (`Game.tick`), the manager decides. Drawn = wanted **and** granted;
a label nobody registered is never granted, so a new label that forgets to
register is invisible on sight rather than an overlap found by a child.

Applied in this order:

1. **At most one label per item.** Every label names its item. Of an item's
   wanted labels, only the highest-precedence one is a candidate. This is the
   whole of Jim's first sentence: the reptile's "peep!" and the "Say hi!" chip
   are both `reptile:skink`, the answer outranks the call to action, so while
   the exhibit is answering the chip is put away — and comes straight back
   when the answer ends. The same rule replaces #486's hand-written "hide a
   talking child's name" gate in `NpcSystem`.
   A candidate that is then crowded out (rule 2) is **not** replaced by its
   item's next label: the item has something more important to say, and a
   lesser label stepping in for a frame is exactly the flicker rule 3 forbids.
2. **No two drawn labels overlap.** Candidates are taken most important first,
   each against every one already accepted, by their real laid-out rectangles
   on screen plus `LABEL_MARGIN_PX` (4 px) of clear air. Sprites are measured
   by their *painted* content box — the pill, its shadow, the bubble's tail —
   not the transparent canvas around it; the chips by the row's own layout.
3. **Ties are stable, and losing sticks.** Equal precedence goes to the one
   already shown, then to the one shown longest, then by id (then registration
   order), so nothing ever depends on sort order. A label that loses an
   overlap stays down for `LABEL_HOLD_SECONDS` (0.35 s) after the overlap last
   held — two pills drifting past each other change hands once, not every
   frame.

### The precedence table

One table, `LABEL_PRECEDENCE`. Higher wins.

| kind | value | why here |
|---|---|---|
| `actionFeedback` | 50 | The answer to a press she just made. She is waiting for it; it is short-lived by construction (every producer runs it on a timer of a few seconds); and it is the thing Jim saw being covered. |
| `callToAction` | 40 | The chip over what she has selected. Beats everything that is not the answer to her own press. |
| `speech` | 30 | Somebody else talking — a park child, a wild animal arriving. |
| `playerName` | 20 | Her own name. Above the crowd's, so she can find herself in a busy plaza. |
| `name` | 10 | Everyone else's name. The most numerous and least needed. |

**Rule 5 of the brief — what she needs is never lost to clutter.** The call to
action for what she is standing at is beaten only by `actionFeedback`, and
every `actionFeedback` is the answer to a press and gone within seconds:
`ReptileHouse.say` holds a line for `1.6 + 0.07 × length` s (about 3–5 s), the
receptionist's script runs line by line and stops if she leaves the lobby, the
dodgems' words last 1.15 s and the bird 2.9 s. Speech and names — the clutter —
are below it, so a crowd can never take the chip away. Inside one item the
answer winning is the point; across items, a neighbour's answer can cover her
chip only for the few seconds it is up, and only if they are on top of each
other on screen.

`speech` is below `callToAction` on purpose: a wild bunny's "appears!" and its
"Catch!" chip are one item, and the chip is what she needs to catch it.

## What `check:labels` proves

`scripts/check-labels.mts`, in `check:shard-4`. The real `World`, a real
`Player`, the real `Selection` and `ActionChips`, stepped in `Game.tick`'s
order through four scenes at 390×844 (the tightest portrait the game
supports): a walk from the gate into the busy middle of the garden and back,
stopping at the six nearest attractions; every Reptile House zone, each chip
pressed and its answer watched, twice; every castle shop counter on the ground
floor with its shoppers; and the hotel reception, checking in.

Every frame:

- **A** — no two drawn labels overlap (area over 0.5 px²), by a rectangle this
  check measures **itself** from the drawn sprite (world position and scale
  through `IsoCamera.worldUnitsPerPixel`, a different calculation from the
  manager's corner projection) — and that measurement must agree with the
  manager's to a pixel on every drawn label, as a control on the instrument.
- **B** — at most one drawn label per item.
- **C** — precedence: the drawn label of an item is its most important wanted
  one; and a wanted label that is down is touching a drawn label at least as
  important, or was within the hold. Never hidden for nothing, never hidden by
  something lesser.
- **D** — no flicker: a label that wanted to be drawn throughout never changes
  drawn state twice within the hold.
- **E** — coverage, printed to stderr on every run, and failing below a floor:
  frames with two or more labels up, labels held back by a neighbour, frames a
  call to action was put away for its own action's answer, chips pressed in
  the Reptile House, shop counters reached, the receptionist reached.

The chips are DOM and Node lays nothing out, so their row size in this check is
a **layout model** (`chipRowModel`: words at the TEXT RULE minimum, padding,
key hint, gap) — said in the file and on stderr. The browser screenshot on the
PR is of the real layout.

### Proved red

Each mutation patches the one method its rule asks (`collides`, `itemOf`,
`rank`, `precedes` + `holdSeconds`), so everything else that runs is the
shipping code. See the transcripts section below — measured on canonical seed
5, 390×844, on this branch.

`check:speech-bubbles` keeps its own #486 assertions (4a–4c) and now asks the
manager *why* a pill is down: `overlap` and `hold` are excused, nothing else.
Its `--mutate-label` now breaks rule 1 (every label its own item).

## Transcripts

Measured on 6 October 2026, branch `feat/label-manager` at `eda3c922` +
the check refinements committed after it, canonical seed 5 (restart as
accepted for that source), `VIEW=390x844`, Node 26.5.0. Every scene, every
mutation, the same 12 570 frames.

```
(unmutated)                  exit 0
check:labels — 12570 frames at 390x844: plaza 4224, castle shops 1278,
  hotel lobby 708, reptile house 6360.
  53 labels registered; up to 5 drawn at once; 5815 frames with two or more up.
  3801 label-frames held back by a more important neighbour; 3483 frames a call
  to action was put away for its own action's answer; 4220 frames an answer
  was up over its item.
  Reptile House: 21 chips pressed; castle: 7 shop counters; hotel:
  receptionist talked. 19975 drawn rectangles measured twice.

LABELS_MUTATE=overlap        exit 1
  FAIL  A overlap: 3728 occasion(s). First: npc-name:Rosa at (390,240)–(429,271)
        and npc-name:Zara at (365,209)–(403,240) overlap, frame 512 (plaza)
  FAIL  E coverage: only 0 label-frames were held back by a neighbour

LABELS_MUTATE=item           exit 1
  FAIL  B one per item: 127 occasion(s). First: 2 labels drawn over npc:Noor:
        npc-name:Noor, npc-speech:Noor, frame 4653 (castle shops)
  FAIL  C precedence: 526 occasion(s). First: npc-name:Noor is drawn over
        npc:Noor while a more important label of the same item wants to be

LABELS_MUTATE=precedence     exit 1
  FAIL  C precedence: 6556 occasion(s). First: action-chips [callToAction over
        flower:6] at (59,336)–(327,384) is hidden under player [playerName],
        which is less important, frame 3000 (plaza)

LABELS_MUTATE=ties           exit 1
  FAIL  D flicker: 262 occasion(s). First: npc-name:Zara went down and back up
        2 frame(s) apart while wanting to be drawn throughout, frame 514 (plaza)
```

Two things those numbers taught, kept because they are the lesson:

- **The first instrument was wrong, and its control said so.** It sized
  sprites by `IsoCamera.worldUnitsPerPixel`, which is only true at the focus —
  the rig is a perspective camera — and disagreed with the manager by 3 px on
  5 945 drawn rectangles. Measured by the pinhole relation at each sprite's own
  depth, the two agree to a pixel on every one of 19 975.
- **`item` alone does not break #486 any more.** With rule 1 off the pill and
  bubble over one child still touch, so rule 2 hides the pill:
  `check:speech-bubbles -- --mutate-label` stayed green until it broke rule 2
  as well. One owner, two rules guarding the same thing — which is why this
  check's own `item` mutation fails B on the shop crowd, where pill and bubble
  happen not to touch.

`check:speech-bubbles:wide` (1920x1080, 420 s) first went red on this branch
— ten children "without their name while in shot" — and every one of them had
a pill rectangle wholly past an edge (Theo at x −54…−7, Iris at y 1082…1120 of
1080): the clause had judged "in shot" by `IsoCamera.isOnScreen`, a test at the
focus depth that is generous nearer the lens, and the manager rightly draws
nothing wholly off the screen. It now asks the drawing camera's own
projection. After: green at both viewports; `--mutate-text-gate` at 1920x1080
→ 124 frames of 4c, first Ola at frame 14690.

`check:speech-bubbles` at 390x844 (120 s): green; `--mutate-label` →
`FAIL A child's name pill was drawn under her own speech bubble, on 1224
occasion(s)… First: Cleo … frame 951`; `--mutate-latch` → `FAIL 1 child(ren)
went without their name while silent and in shot… Cleo … 68 frame(s)`.
