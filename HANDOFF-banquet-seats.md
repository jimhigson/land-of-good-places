# HANDOFF — two tables, free places, and a table for the pets (#449)

Branch `feat/banquet-seats`, cut from **`origin/feat/great-hall-banquet`** (PR #422),
**not** `main`. Worktree `.claude/worktrees/banquet-seats`. Dev port **5509**
(`pnpm exec vite --port 5509 --strictPort`). PR goes against
`feat/great-hall-banquet`.

Jim, on #422's preview:

> *"Great hall only has one table and no free spaces for the player to sit. Make it
> two big tables, with a few spaces and the action to sit and eat on the blank
> spaces. There should also be a small pets table for the pets to eat at, and they
> go there when the player sits."*

## The deep link is `/castle?deck=1`, not `?deck=0`

The brief says 0. The hall is `HALL_DECK = CASTLE_HALL.index` = **1** since the
floor split (#377/#380); deck 0 is the mall. `main.ts`'s own doc comment for the
link ("defaults to the ground floor, which is the great hall") is stale for the
same reason.

## What is there before this branch (#422, measured off its handoff)

- **One run of three 6 m feast tables** butted end to end down the hall's axis,
  x = 10.636, z −9.83 … +8.17. `FEAST_TABLE_COUNT = 3` in `castleFurniture.ts`.
- **24 diners**, two per bench end, four benches per table, both sides.
  `greatHallSeats(deck)` is the one owner of where a diner sits;
  `greatHallBanquet.ts` seats an instanced `KidCrowd` on every seat it returns.
- Bench top `CASTLE_BENCH_SEAT` = 0.360 m = `KID_HIP_HEIGHT` exactly, because the
  kid rig **has no knee**: that is the one seat height at which a vertical leg
  lands a foot on the floor. Diners are scale 1 for the same reason. Do not
  reach for a lean — #422 measured a 37.6 mm toe-sink at 0.12 rad.

## The four pieces, and where each one goes

1. **Two runs, not one.** `castleFurniture.ts`. `greatHallPlan` already resolves
   the hall's axis; the run offsets either side of it. Everything (tables,
   benches, seats, the laid meal) already derives from `feastTableCentres` /
   `feastBenches`, so a second run is a loop, not a copy.
2. **Free places.** `greatHallSeats` grows a `free` flag. `greatHallBanquet`
   seats children only on the taken ones — it already reads that one list, so
   there is no second definition of "is anybody sitting here".
3. **The sit-and-eat action.** Modelled on the hotel breakfast room's chair zone
   (`Hotel.interactZones`, `sitAt`/`standUp`/`eat`): a zone per free place,
   `selectableWhileRiding: true` (without it, sitting eats every chip including
   the way back up — the hotel's own note), verb `Sit`, and once seated the chip
   row becomes the food list plus "Leave the table".
4. **The pets' table.** The pet-follow owner is **`entities/parade/Parade.ts`**,
   not `WildPets.ts` — `WildPets` is the roof garden's catchable animals (#406).
   `Parade.sendPetToBed(uid, bed)` → `ParadeMember.goToBed(bed)` is the exact
   precedent: the parade points `member.target` at the spot instead of at a trail
   sample and the member walks there on the ordinary follow spring, then runs its
   own settle. **One body, no stand-in** — that rule is the fix for Jim's 23 Aug
   *"morphs into a totally different pet"* and must not be broken here.

   Note the hotel breakfast room's pet **is** a stand-in (`Hotel.eat` builds its
   own `createPet`). Do not copy that half; copy the parade's.

## Constraints that bite (from the brief and the files)

- Castle props get **no colliders at all** — indoor collision is height-blind.
  Placement is the only protection a prop gets.
- Fixed isometric camera shows +X/+Z faces. The hall runs along Z, so a child
  west of a table faces the camera and a child east of it shows her back. Two
  runs doubles that count. #447 is the market's version of this fault; the free
  places at least must be on the camera-facing side so **she** is seen from the
  front when she sits.
- `check:castle`, `check:castle-floors` keep passing. Move the furniture, never
  widen an assertion.

## State

- Worktree cut, deps installed, dev server up on 5509 (killed by PID).
- Nothing implemented yet at the time of writing.
