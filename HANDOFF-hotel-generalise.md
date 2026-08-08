# HANDOFF — generalising Jim's hotel feedback into systems

Branch: `feat/hotel-236` · Worktree: `.claude/worktrees/hotel-236`
Jim has a dev server on **5643** serving this tree live. Keep
`npx tsc --noEmit` green at every save — QA saw one transient where
`HotelGuests.ts` briefly exported nothing mid-edit. **Not committed** (as asked).

## State: DONE, all four generalisations landed and verified

Jim played the hotel and asked for four pieces of feedback to be turned into
**rules with one owner**, not per-symptom patches.

| # | Rule | Owner |
| - | ---- | ----- |
| 1 | **One crowd.** Hotel guests *are* park NPCs — same body, walk cycle, collision, ground sampler, push-apart. Only the *decision* layer differs. | `NpcSystem`'s `residents` array + `entities/npc/waypointDriver.ts`, fed by `Hotel.residents` |
| 2 | **Placement registers solidity.** One footprint per prop → `CollisionWorld` **and** the guest keep-outs. They cannot disagree. | `src/world/hotel/place.ts` |
| 3 | **Rooms declare windows; the builder builds them**, clipped to the wall's own solid spans. | `layout.ts`'s `WindowWall` (data) + `Hotel.glazeWall` (mechanism) |
| 4 | **Interiors don't run the sky's clock.** One question: *is the player in **any** interior?* | `World.playerInAnyInterior`; hotel's own fill in `world/hotel/lighting.ts` |

## Findings worth keeping

- **The soft play boundary teleports anything outside it, in one frame.**
  `CollisionWorld.resolve` pushes a mover up the boundary's gradient by the
  whole shortfall, and `NpcCharacter` calls it with the default
  `dt = Infinity`, so the escort budget is infinite. Measured: a body at the
  hotel lobby (−600, 600) with garden bounds set lands at (−75, 57) after
  **one** call. A **pre-existing bug** — every park child was yanked into the
  castle's bounds circle the moment the player stepped indoors — and it would
  have made residents impossible. Fixed by `BOUNDARY_LEASH_REACH` (100 m) in
  `Collision.ts`: more than 100 m outside the current boundary is not "outside
  the park", it is *somewhere else*. Confirmed working in browser QA.
- **Residents fell to y = −16.5 m, and the sampler was innocent.** QA measured
  it; so did my headless probe. They were *already* on the building's
  `WalkSurfaces` sampler. The fault was **where they asked from**:
  `sample(x, z, y)` only offers a platform within a step *up* of `y`, and
  `NpcCharacter`'s constructor seeds y from `terrainHeight`, which is −16.5 m
  out at the hotel. A body starting below its own floor is correctly told it
  has none. Fixed by `NpcCharacter.settle(from)` + `ResidentSpec.floorY`.
  Now y = 0.00 for all seven, walking 52–81 m per 90 s.
- **Beds are deliberately NOT solid.** `clearsTop` reads `Player.hopClearance`
  = height above *the sampler's* ground, and a mattress top is a platform — so
  a child stood on a bed has clearance 0 and a side collider would shove her
  off. Rule in `place.ts`: anything that is also a walk surface is placed soft.
  Jumpy-jumpy is Eleri's. Asserted explicitly in `check:hotel`.
- **A green that could not fail.** The first chair-solidity assertion probed
  the chair's *centre*, which is already inside the table's reach — making the
  chair soft left it green. Caught by mutating it; now probed 0.4 m out.

## New check: `npm run check:hotel` (also in `npm run build`)

`scripts/check-hotel.mts`, four assertions, **each proven red first**:
no child below y = −2 after 8 s (QA's own suggested regression, widened from
the residents to every child); nine props + a chair solid; three beds soft and
standable; every declared window pane actually built.

## Verification (all green, this tree)

`npx tsc --noEmit` · `npm run typecheck:test` · `npx vitest run
test/procgen/seed-canonical.test.ts` 39/39 · `npm run check:crowd`
**trace=639ad23c, byte-identical to the hash in that script's own header** ·
`npm run check:park` 172/172 · `check:waypoints` 172 · `check:jitter` ·
`check:assets` · `check:hotel`.

Park-unchanged proof: a scratch worktree at this branch's HEAD (no uncommitted
changes) reports the *same* `172/172 waypoints` and the same facade
coordinates as this tree. An earlier `171/171` reading was a transient of the
half-finished tree, not a divergence.

## Left for visual QA (no browser owned here)

Window look at play distance on all four floors; the warm fill at midnight vs
noon; guests bumping the player; the receptionist/server still reachable.
