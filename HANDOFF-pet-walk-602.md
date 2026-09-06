# HANDOFF — pets walk to bed on a route, not through the wall (#602)

- **Model**: Opus 5 (1M context). Chosen by the Overseer when it dispatched this
  ticket; a replacement must run the same model (CLAUDE.md).
- **Branch**: `fix/pet-walk-602`, branched from `origin/feat/pet-beds-582` (#592),
  **not** `main`. Worktree `.claude/worktrees/pet-walk-602`.
- **Issue**: #602. Jim, on the `?pets=5` preview: *"the pets linearly zoom into
  their beds, including through walls - make them use the normal pathfinding algo
  like player and npcs use instead."*

## What was wrong

`Parade.update` pointed a bed-bound member's follow-spring target straight at
`bed.runUpX/Y/Z`. The spring knows nothing about walls, and a member's own body
is never collision-resolved (only its *target* is), so the animal slid through
the partition. Worst indoors, where a companion with no bed in the room she
chose is sent to the **middle** bedroom (#582) and therefore always has a wall
in the way.

## What was done

- `src/entities/parade/bedRoute.ts` (new) — plans one `NavGrid` route per pet at
  bedtime and hands out its waypoints. No avoidance logic of its own.
- `src/entities/parade/petNavGrid.ts` (new) — `createPetNavGrid(world)`, the one
  owner of what a companion's grid is made of (`PARADE_MEMBER_RADIUS` 0.22, hop
  apex 0, the same connector/bridge providers the player's grid reads). `Game.ts`
  and `scripts/check-hotel.mts` both call it; there is deliberately no second
  `new NavGrid(...)`.
- `Parade.aimAtBed` follows the route; falls back to the old straight line when
  there is no router or the route is spent (the last leg, inside one room).
- Routes are dropped on `wakePetFromBed` and when a member leaves the line.
- `scripts/check-hotel.mts` **probe 3d** — the regression check.

## Key findings, so they are not re-derived

- **`Player.groundSampler` is installed by `Building.attachPlayer`, not by
  `Hotel.attachPlayer`.** A headless probe that only attaches the hotel leaves it
  `null`, `NavGrid` has no floor to bake, and `findRoute` is never even called —
  the fix looks broken and the check goes green on the bug. Probe 3d attaches the
  building for exactly this reason.
- `typeof null === 'object'`, which is how that was nearly missed.
- Waypoint advance radius is 0.3 m, not `TapNavigator`'s 0.7: a parade member has
  no collision on its body, so a cut corner is a corner cut *through*.

## Proof

Probe 3d, proved red by disabling routing in `Parade.aimAtBed`
(`if (false && navGrid && sampler)`), on a cast of 3 companions napping in
bedroom 0 of the built headless suite, 1 of them sent to the middle bedroom:

- **red**: 2 partition crossings over 65 measured steps against 14 built suite
  partitions; first `(-612.89, 1378.50) -> (-612.90, 1378.22)`; exit 1.
- **green**: 0 crossings over 187 steps; control (the deleted straight line)
  still 2; exit 0.

Browser, `http://localhost:<port>/hotel-suite?pets=5`, nap in the west bedroom:
5 companions, 3 of them sent to the middle bedroom; 935 measured steps against
14 partitions, **0 crossings**, all 5 `asleep`. Screenshot of the recorded
breadcrumb path in `/tmp/pet602-path.png` shows the dog-leg out of the door,
along the hall and in through the middle bedroom's door.

## Not this ticket

- Pets stack on one square metre when the player has not walked (#598) — visible
  in the traces as identical coordinates before the line forms up.
- The middle bedroom being out of shot during the nap is #582's recorded cost.
