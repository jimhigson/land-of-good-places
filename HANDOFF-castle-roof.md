# HANDOFF — the roof garden reads as a castle top, the castle wears its roof garden (#462)

Branch `feat/castle-roof-garden-outside`, worktree `.claude/worktrees/castle-roof`,
dev server port **5557** (`--strictPort`, killed by PID when not in use).

## The ask (Jim, verbatim on #462)

> "It needs the rooftop's near side to look like the external of the castle
> (far side being hidden can be ignored) — turrets in the corner, ramparts,
> walls reaching down, same colour as the castle viewed from the outside.
> Re-use code and/or models as much as possible.
>
> Then, when out in the park there should be a roof on the castle with a few
> of the features from the actual roof garden on top of it, if not a perfect
> reproduction. Maybe just the floor of the roof garden and the pavilion."

## What shipped

**One masonry kit, two castles.** `src/world/building/castleMasonry.ts` is the
new owner of a merlon (its width, depth, pitch and the 1.6 m each run holds back
from a corner) and of a corner turret (flared shaft, cone, mast, finial,
pennant). The facade's `buildCrenellations` and `buildCornerTowers` are built
from it, **with their mesh names unchanged** — `crenellations`, `tower-bodies`,
`tower-roofs` are what `test/procgen/parkFacts.ts` matches to measure the
castle's stonework for the ginormous slide's clearance invariants.

**Standing on the roof garden** (`buildRoofTerrace`):

- the parapet is a battlement — the kerb cut to `ROOF_CRENEL_BASE` (0.55 m) in
  the facade's own wall cream, with the facade's merlons standing on it in the
  facade's trim pink. Net effect: the top is 0.55 m higher than the old plain
  lip, and she sees **more** sky, because the crenels run down to 0.55 m where
  the old parapet was solid to 1.05 m;
- four corner turrets, the same builder as the facade's towers;
- the castle wall falling away 18 m below the **+X and +Z** faces only, with the
  turret shafts carried down it so it is not a flat cliff. Those are the two
  faces the fixed isometric shows — **verified on screen**, not assumed: from
  `/castle?deck=2&at=17,11` the wall drops away at bottom-right and bottom-left
  and the far runs are behind their own parapet.

**From the park** (`buildCastleRoofGarden`): a deck level with the top of the
curtain wall, in the roof garden's own `stonePinkLight` paving, carrying the
pavilion and the ring of mint planters — **the roof garden's own builders**, at
`FACADE_SCALE` (= `BUILDING_HALF_X / INTERIOR_HALF_X`, 0.566), positioned by
mapping the relative spot on the plate. The floors are disjoint spaces 300 m
apart, so a builder and a scale are shared and never a position.

## Three things the screen said and the code could not

1. **The turret's cone drew over the player from 8 m away.** Centred on the
   plate corner it stood on floor she walks on; the same "she disappears under
   the roof" defect that reverted the enterable pavilion. Fixed by pushing each
   turret out until its disc is tangent to the parapet's inner face, so the
   nearest floor to a turret is the far side of the rampart.
2. **The cone still hid her, and the cone was not the tallest part.** The mast
   and finial stand 1.9 m above the apex; the finial was measured drawn across
   her chest at **8.12 m**. The roof-garden turrets carry no mast now
   (`withMast: false`); the facade's towers keep theirs. The cone height is
   derived from the camera: nearest reachable floor × tan(38°) + `KID_HEIGHT`.
3. **A child's body reached 0.075 m inside the drawn parapet.** The roof's
   perimeter collision sat on the plate's half-extents, but the parapet is a
   0.6 m band against the storeys' 0.45 m wall, so it reached further inboard
   than the collider — generous-*heavy*, on the one edge #462 invites her to
   lean on. The roof's line is now derived from the parapet's own inner face.

## What is solid, what is soft, and why

| thing | state |
|---|---|
| corner turrets | **solid** — a circular collider each (`registerRoofTurretCollision`). A disc, not a rectangle: `CollisionWorld` pushes a mover out along the radius, so there is no hollow middle to be stuck in |
| the rampart | **solid** — the perimeter wall, now derived from the drawn parapet's inner face, and `check:benches` holds the two together |
| the curtain wall, the merlons | outside the parapet and below the deck; unreachable by construction |
| the pavilion | solid already (#459), unchanged |
| **the planting troughs** | **still soft — reported, not fixed.** Making them solid is *not* cheap: they ring the parapet at 2.3 m in with a 0.6 m gap between neighbours, and a child is 1.24 m across, so a solid trough ring would wall off the whole strip between the planting and the rampart — which is exactly the strip #462 exists to send her to. It needs gaps designed into the trough layout, which is its own ticket |
| **the sphere planters** (`roof-planters`) | **still soft — reported.** These *are* cheap (18 domes 5.7 m apart, `topIsAbsolute` like the roundel's planter ring) and were left out only to keep this diff to one feature |
| the long grass | **deliberately soft.** You walk *through* long grass — that is what makes it long grass — and `WildPets` moves its creatures through it |

## Gates

- `pnpm run check` — exit 0
- `pnpm run test:procgen` — **502 passed** (was 497; this PR adds one invariant,
  which runs on all five seeds)
- `pnpm run build` — exit 0

### Red runs, against the geometry as committed

- **the turret clause**: drop `registerRoofTurretCollision` from
  `check-benches.mts`'s `worldFor` → 4 failures, one per turret, on the inboard
  diagonal bearing, each ending 1.11 m from a turret's middle inside 2.45 m of
  drawn stone. (The two perimeter runs meet at a right angle and a body pushed
  into that corner slides along both.)
- **the parapet clause**: it was written red — it found the 0.075 m penetration
  described above on the +X and +Z faces before the collision line was fixed.
- **the procgen invariant**: scale the facade pavilion by 2.2 → 5 failures, one
  per seed.

### An invariant that asserted a proxy, and was replaced rather than weakened

The first draft asserted *"nothing on the castle's roof rises above the
battlements"*. Tidy, easy, and **the wrong question**: the pavilion's pyramid is
1.95 m proud of the parapet, which is precisely what makes it visible from the
park, while clearing the ride by 2.54 m. Passing that draft would have meant
shrinking the pavilion to a fifth of its size to satisfy a number nothing in the
game cares about. It now measures the real requirement — the built chute's
trough floor against the roof group's world box — and prints its sample count
every run (4–11 per seed) so a seed that covers nothing is visible rather than
silently green.

## Looked at

- roof garden: `/castle?deck=2&at=15,-9` and `&at=17,11` — battlement, turrets,
  the wall dropping away, clouds past the crenels.
- the castle from the park:
  `/view?camPos=76,28,42&camDir=-1,-0.52,-1&timeOfDay=11:00` — pink roof, the
  pavilion, the ring of planters, seen over the crenellations.

Screenshots in the session scratchpad (`roof-1.png`, `roof-corner-4.png`,
`castle-park-1.png`, `castle-park-2.png`).

## Follow-ups to file

- solid colliders for the roof garden's **sphere planters** (cheap) and its
  **planting troughs** (needs gaps designed in — see the table above);
- the enclosed storeys stop a child 0.075 m *short* of their drawn walls. That
  is the harmless direction and it is not a bug, but nothing keeps it that way
  either; the roof now has a mechanism and the other two decks do not.
