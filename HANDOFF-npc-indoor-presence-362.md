# HANDOFF — issue #362, indoor NPC presence rather than simulation

Branch `npc-indoor-presence`, cut from `npc-attraction-destinations` (#355, unmerged — the castle
portals live there).

## Jim's ask

> "check where children spawn inside the large castle building. I'd rather they had their position
> tracked, as in if they have entered the big building, we don't simulate inside rooms the player
> isn't in, we just mark which NPCs are in there"

## PART 1 — SETTLED (29 Aug): no child spawns inside the castle

Answered with a census of the running park, not by reading the spawn code. Every crossing goes
through `NpcCharacter.stepThroughDoor` (the #350 portal), so a child who is indoors and never
called it was *put* there rather than having walked in.

```
31 NPCs: 24 park children, 7 other
SPAWN census (t=0, before any update):
  [["garden",24],["hotel.lobby",3],["hotel.breakfast",3],["hotel.corridor",1]]

after 300s:
  children ever indoors: 4 ["Luca","Bodhi","Iris","Theo"]
  children who crossed a portal: 4 [["Luca",1],["Bodhi",1],["Iris",1],["Theo",1]]
  INDOORS WITHOUT EVER CROSSING: 0 []
  => nobody appears inside the castle except by walking in through the door.
```

**All 24 park children spawn in the garden**, and every one of the four who was ever inside the
castle crossed the door exactly once. There is no castle spawning to fix. `PoiGraph.spawnNodes()`
being garden-only is what guarantees it, and the census confirms the guarantee holds in the
running game.

### But the concern underneath it is real, and it is bigger than the castle

The seven NPCs that *do* spawn outside the garden are the **hotel residents** — 3 in
`hotel.lobby`, 3 in `hotel.breakfast`, 1 in `hotel.corridor`, all on `WaypointDriver`, ~600–1100 m
out. Those are deliberate (they live there), but they are exactly what Jim is describing: NPCs
being simulated every frame in rooms the player is not in.

So the ticket's premise is wrong in its specifics and right in its substance:

- nothing spawns in the castle; but
- **the castle's visitors are simulated indoors transiently, and the hotel's residents are
  simulated in unseen rooms permanently** — seven of the thirty-one, for the whole session.

This means the answer to the ticket's "check whether the hotel residents should be covered by the
same design" is almost certainly **yes** — they are the larger and more permanent case, not an
edge case.

### The correctness argument (my own #350 finding)

Indoor children as full agents in a distant coordinate space is what let the crowd RMS reach
**276 m at 476% of a uniform scatter while the check still passed**, and it is the same root as
`check:jitter`'s 810 m own-step. An impossible number passing means the metric had stopped meaning
anything. Marking presence removes the whole class rather than patching each measurement.

## PART 2 — not started

Next: measure what the simulation actually costs before designing around it.

## PART 2 — the cost, measured first (29 Aug)

`scripts/_offspacecost.mts`, wrapping each character's own `update` and attributing the time to
the space that character was standing in. No stubbing, so the park measured is the park that ships.
180 s of park, 31 NPCs, player in the garden:

```
  whole world.update      9026 ms
  character.update total  6263 ms (69.4% of world.update)
    in the player's space 4680 ms over 156693 calls (74.7%)
    NOT in it             1584 ms over  50251 calls (25.3%)
  separate() (O(n^2), all spaces) 20 ms (0.2% of world.update)

  per-frame: 0.836 ms world.update, of which 0.147 ms is spent on NPCs
             the player cannot see
```

### The honest reading: the performance case is weak, the correctness case is strong

**0.147 ms a frame is about 0.9% of a 60 Hz budget.** Proportionally it looks big — a quarter of
all character-update time — but absolutely it is nearly nothing, and `separate()` at 0.2% is
noise. **Nobody should build an elaborate level-of-detail system for 0.147 ms**, and this
measurement is the argument against gold-plating part 2.

The reason to do this ticket is the one #350 found the hard way: indoor NPCs existing as full
agents in a distant coordinate space is what let the crowd RMS reach **276 m at 476% of a uniform
scatter with the check still passing**, and it is the same root as `check:jitter`'s 810 m
own-step. Every measurement over "the crowd" has to remember to exclude them, and the day one
forgets, an impossible number passes. Presence-marking deletes that class.

So part 2 should be **small**: mark presence, stop stepping the agent, keep the body where it was,
and let every crowd measurement stop needing a special case. Not a scheduler, not an LOD tier.

### One caveat on the number

This counts `character.update` only. `syncTransform`, `crowd.commit`, `updateLabels` and
`updateBubbles` also loop over every character regardless of space, and in a browser they carry
render-side cost that Node does not show. So 0.147 ms is a **lower bound** on what presence-marking
saves, not the whole of it — but not by an order of magnitude.

## Constraint 2 — what the hotel depends on (29 Aug)

**One rule can serve both.** No split needed. The reasoning, and the one hazard that had to be
ruled out empirically:

`check:hotel` fails any character below `FLOOR_OF_THE_WORLD`, and its own header records that
regression firing with *"all seven residents at −16.5 m"*. Residents start at the park's terrain
height and `NpcCharacter.settle` walks them onto a floor plate 600 m away, so if settling needed
frames, freezing from frame 0 would strand them under their own floor. Measured:

```
t=0     Suki=0.00 Otto=0.00 Nell=0.00 Bram=0.00 Pip=0.00 Moss=0.00 Wisp=0.00
t=10s   Suki=0.00 Otto=0.00 Nell=0.00 Bram=0.00 Pip=0.00 Moss=0.00 Wisp=0.00
```

Already settled at t=0 and never move vertically — the hotel's floors are at y=0. So the hazard is
not live **today**, but it is live *in principle*: `ResidentSpec.floorY` exists precisely because a
space can put its floor somewhere else, and that comment warns a body starting below its floor
"falls for ever". So the freeze is gated on the character being **grounded**, not applied blindly
from frame 0. Cheap insurance against a hotel floor ever moving off zero.

Other consumers of NPC state, all checked: `World` hands `npcs.riders` to the train (in-space
concern), `TreeClimbing` iterates `npcs.all` (park only), `check-hotel` reads
`hotel.residents[].waypoints` — the **spec**, not the live body, so freezing the body cannot
affect it.

## PART 2 — the design

**Presence, not simulation.** Each frame `NpcSystem` derives the player's space with `spaceAt`.
A character in a different space is *present but not stepped*: no `character.update`, no
`avatar.tick`, and skipped in `separate()`. **The body is left exactly where it is** — nothing is
moved, so there is no teleport and no wall-pop when the player walks in; they resume from where
they stood. That is the acceptance test and the design satisfies it by construction rather than by
a correction step.

One thing the naive version gets wrong, and the fix:

> A frozen child inside the castle can never walk out, because walking out is simulation. With
> `MAX_INSIDE` counting presence, four children would go in, freeze, and the door would close for
> the rest of the session — the park slowly draining.

So a frozen child keeps **one number**: how long until they are done in there. When it expires they
are returned to the portal's far side in the garden — a presence-level event, not a simulated walk.
That is still "just mark which NPCs are in there"; it is what stops the marker being a black hole.

Hotel residents have no such timer: they *live* there, so being marked present indefinitely is the
correct behaviour for them and matches what the hotel already assumes.

### The invariant (`scripts/check-npc-presence.mts`)

1. **No character in a space the player is not in ever moves.** Position delta is exactly zero
   while off-space. Deleting the freeze makes this fail immediately — that is the `--mutate`.
2. **Presence counts are consistent across a crossing, both ways.** The number marked inside equals
   the number whose `spaceAt` says inside, every frame; and a child who crosses in and later out is
   counted exactly once in each direction, so the marker cannot leak or double-count.

## Scope narrowed from "any space" to "any INTERIOR space" (29 Aug)

The Overseer said go general — any space the player is not in. Built that, measured it, and
backed it out to **interiors only**. The park's own crowd is never frozen. Two reasons, both
found by measuring rather than by argument:

1. **It buys nothing.** The 0.147 ms/frame is essentially all seven hotel residents, who are
   off-space for the *whole session*. The garden crowd is only off-space for the minute or two
   somebody spends indoors.
2. **It is not free of risk.** `ParkTrain.carryPassengers` writes a rider's position from outside
   `NpcSystem` every frame. A frozen child on a moving train would be carried along while nothing
   else about them advanced — a body moving with no simulation behind it, which is the same class
   of inconsistency this change exists to remove.

Still general in the sense that matters: it is **not castle-only**, and it covers the hotel
residents, which are the larger and more permanent case. And it is Jim's words closely — *"we
don't simulate inside **rooms** the player isn't in"*; the garden is not a room.

## A QA measurement that was worthless, and how it was caught

The first acceptance run reported *"worst position jump across the crossing: 0.0000 m"*. That
number was junk: headless Chromium renders this park at well under a frame a second, and the
script waited a fixed 500 ms after moving the player — **less than one frame**, so nothing had
been stepped between the two snapshots. It was "proving" the property by measuring nothing, which
is the exact failure CLAUDE.md's "a check can pass without checking anything" section describes,
committed by me in my own QA script.

Caught because `marked=8` did not match the design (it should have been ~30 with the player
inside), which only showed up because the number was checked against what it *should* be rather
than accepted for being green.

Fixed: the script now polls until the mark actually responds, which is proof a frame ran.

## Final numbers

`check:npc-presence`, 300 s, player in the garden:

```
  frames with somebody marked elsewhere: 18000 of 18000
  crossings: 17 in, 15 out
  movement by characters in another space: 0 occurrences (none)
  mark/world disagreements: 0 character-frames
  park children spawned outside the garden: 0 (none)
```

`--mutate` (mark removed): **81005** movements, worst 0.2161 m — assertion 1 red.

Browser, real frames:

```
worst drift over 6s while frozen:            0.0000 m
the mark responded to the player moving in:  true
worst position jump across the crossing:     0.1250 m  (Aiko)
most any of them moved in the 6s after:      4.000 m
console errors:                              0
```

The 0.125 m is **one frame of ordinary walking** at `NPC_WALK_SPEED` — her first step after being
handed back to simulation, not a pop. There is no teleport and no wall-pop: she is exactly where
she was standing, and then she walks.
