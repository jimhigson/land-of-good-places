# HANDOFF — wild pets on the roof garden (issue #406, PR #410)

Branch `feat/wild-pets-roof-garden`, worktree
`.claude/worktrees/wild-pets-rebase`. Dev server port **5415**, killed by PID.
**Rebased onto `main` @ `eadf60eb`** — the three-floor castle split.

## Environment

Just type `pnpm`; check `npm_config_user_agent`, not `pnpm --version`.
`build` is `vite build` (2 s) and is a weak signal. The gate is
`pnpm run check` (47 steps, ~16 min, required via `checks.yml`).
`test:procgen` is in **neither** and is required via its own workflow.
This PR added **no new check script** — its tests are
`test/store/wild-pets-catch.test.ts`, picked up by `vitest.config.ts`'s
`include: ['test/**/*.test.ts']`, so they run inside `test:procgen`. Verified
by parsing `package.json`'s `scripts`, not by grep.

## What the rebase actually cost

`BUILDING_SHAFTS`, `DECK_HOLES` and `deckIsSolid` are **deleted** — the split
removed the concept. The meadow and the burrows both tested against them.
Rewritten, not replayed:

- `insideAnyShaft` and `SHAFT_PROBE` are gone.
- `deckIsSolid(deck, x, z)` → `insideInterior(x, z)`.
- The **trampoline** survives the split as a toy on the roof and is **not** in
  `keepOutsFor`, so `roofMeadow` names it directly. Without that, 0.85 m grass
  grows through a pad a child bounces on.

## Did the derived placement absorb the split? Partly — and say so

**The meadow: yes.** It scored the new clearance and moved. 168 cells, clear of
every keep-out, of the trampoline, and of the slide's boarding pad.

**The burrows: no.** `BURROW_SPACING` was a hard 6 m gate chosen against the
*old* plate. On the smaller one the farthest-point pass ran out of room and
returned **three** burrows where `BURROW_COUNT` asks for five. Nothing was red.
*Deriving the positions is only half of derived placement: a threshold beside
them measured against a floor that no longer exists is still a typed-in number,
and it fails by producing **less**, which no assertion about what was produced
can notice unless it is told how much to expect.*

Fixed by making the **count the requirement and the spacing what gives** —
relaxed a metre at a time down to `BURROW_MIN_SPACING` (4 m, twice
`burrowAwayFrom`'s "the hole underfoot" radius). Five burrows, closest pair
4.33 m.

## The bug that made the whole feature inoperable

**Standing a real player exactly on top of a real bunny, the running game
measured the gap at 1341.6 m.**

`playerXZ` was set from the player's **world** position and compared against
**floor-local** creature and meadow coordinates. Since #377/#380 the roof
garden's plate stands 600 m along +X of the mall, so every distance in
`WildPets.ts` carried that offset:

- `SAFE_DIVE_RANGE` was never satisfied, so the dive gate — the rule that makes
  "she cannot fail" literally true — **never engaged**;
- nothing fled, because it was fleeing a point a kilometre away;
- the catch zone stood 1341.6 m from her, so "Catch it!" could not appear at any
  distance and **no creature could ever be caught**.

Nothing was red. `tsc` sees two numbers. The check chain has no opinion. The
behavioural tests drove the class in local metres from *both* sides, so they
agreed with each other and with nothing else. **And the animals looked
perfect** — the meshes hang off the floor group and were always drawn in the
right place. Only the thing you tap was somewhere else, which is why looking at
a screenshot could never have found it and standing on one and printing the
distance did.

Fix: one subtraction on the way in, one addition on the way out, against a
single owner (`originX`/`originZ` from `CASTLE_FLOORS[deck]`).

## Mutation transcript (against this branch)

| Mutation | Result |
| --- | --- |
| Zones emitted floor-local again (the shipped bug) | 3 failed / 13 passed — `never lets one dive while she is right behind it`, `offers its tap targets in world metres`, `puts the tap target on the creature that is drawn` |
| Restored | 16 passed |

Geometry it was proved against: roof plate half-extents 21.21 x 15.56,
`CASTLE_ROOF.originX` 1200, `originZ` 600.

## Watched running, not just green

Headless `playwright-core` (`channel: 'chromium'`) against `/castle?deck=2`.

- Landed at world **(1200, 0.7, 609.1)**, floor reported **"The roof garden"**.
- **Chase**: closing on one gave gaps 7.6 → 5.4 → 3.3 → 1.7 → *2.4, 3.2* (it
  bolted) → 1.8 → 2.6 → 3.4 → 1.8 → 1.9 → 1.5 → 1.4. It runs, she closes.
- **Catch**: chip reads **`🫳 Catch it!`**; pressing it removed the creature and
  put `pet.puff#3` in the inventory, `pet.puff` in the collection at placement
  `parade`.
- **Wild RiPika** grants **`pet.ripikaWild`** — its own entry, distinct from the
  starting `pet.ripika`. Final collection: `pet.ripika`, `pet.puff`,
  `pet.ripikaWild`, all in the parade.
- **Announcement** on screen: *"a wild Little Bunny appears!"* — Jim's casing.
- **Ginormous slide**: its roof zone is at world (1220, 614.6); standing on its
  boarding spot boards the ride and the chute runs in open air. Numerically the
  nearest grass cell is **13.37 m** and the nearest burrow **18.81 m** from the
  entry, and `meadow.contains(entry)` is `false`.

**`/view` cannot see the castle floors** — per-space visibility replaced the
fader, so a free camera parked over the roof renders empty sky. Use
`/castle?deck=2`.

## Not done / open

- `petBlob.ts` still exists and is still used by `NpcSystem.ts:760`. Deleting it
  is #406's stated aim; separate change.
- Two pets of the same kind can be out at once. Not wrong; "prefer a kind not
  already out" would read better.
- The announcement bubble is world-anchored, so a creature near the top-left of
  the screen can put it behind the Menu button. Cosmetic, pre-existing.
- `keepOutsFor` still does not list the trampoline, so the roof's **benches**
  are sampled without knowing about it. The meadow works around it; the
  underlying list should probably own it.

## Status

- [x] Rebased onto `eadf60eb`; shaft-dependent placement rewritten
- [x] Burrow count restored to 5 on the new plate, with a test that knows the number
- [x] World/floor-local coordinate bug found by watching and fixed
- [x] `check` 0, `test:procgen` 0, `build` 0 on the actual head
- [x] Watched running: chase, catch, ownership, announcement, slide entry
- [ ] CI green on the pushed head, then merge (pre-approved)
