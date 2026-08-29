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
