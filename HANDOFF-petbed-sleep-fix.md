# HANDOFF — pet bedtime and the sleeping pose (PR #279, round 5)

Branch: `petbed-sleep-fix-3`, pushed to **`bedroom-size-pet-beds`** (PR #279).

Two bugs Jim found in live play on 21 Aug 2026, on top of #279's pet beds.

## Bug 1 — a pet was already in its bed before the player napped

`Hotel.placePetBed` built every bed's pet **standing on its own cushion** and
left it there for the life of the room. Under a canopy, at the park's camera
distance, that reads as a pet already asleep in bed — beside the *real* pet
still trotting round behind her in the parade.

Fix, all in `Hotel.ts` unless noted:

- `petBedRoster` entries carry a `bedtime` clock: `-1` (nobody going to bed,
  pet hidden) or seconds into `PET_BEDTIME_SECONDS` (0.8 s) of a trot from the
  floor up onto the cushion.
- `placePetBed` hides the pet (`visible = false`). A pet bed is **empty
  furniture** until she naps.
- `nap()` calls `sendPetsToBed()`; the nap's end calls `standPetsDown()`.
- `updatePetBedtime(dt, elapsed)` runs unconditionally from `update`, above the
  player-null return, so `check:hotel` can watch it headless. It also owns the
  pets' breathing idle now — the old separate `setWalkPhase` loop is gone, so
  there is one owner of a pet-bed pet's animation.
- The pet's own "Z" glyphs wait for `petIsAsleep(bed)` — a Z over an empty bed,
  or over a pet still trotting, is the *look* of the bug.
- `hotel.petBeds` gained `asleep`, because "not lying down" and "not there at
  all" were indistinguishable from outside.
- `Parade.setPetsHidden(hidden)` + `ParadeMember.hidden`/`kind`, driven from
  `Game.tick` off `hotel.isNapping`. **Pets only, not the whole line** — a
  teddy has no bed to have gone to, so it stands there while everyone sleeps.
  The flag is on the member because `ParadeMember.updatePop` assigns
  `root.visible` every frame from the pop-in animation.

Run-up point: `PET_BEDTIME_RUN_UP` = 0.7 m toward **+Z**, the doorway side of
every bedroom (`petBedRowsZ` tiles rows north→south toward the hall door), so a
pet arrives from the direction she walked in from. 0.7 m is just past
`PET_BED_FOOTPRINT_RADIUS` and over half `PET_BED_PITCH`, so the run-up starts
on clear floor rather than inside the next row's canopy.

## Bug 2 — *"doesn't close their eyes when in bed, and clips into the sheets"*

Both halves were the same mistake: a **bed** borrowing the **slide's** pose.

- **Eyes.** `Hotel.nap` called `player.model.setExpression('blink')` directly,
  bypassing `faceLife`. `faceLife` only swaps on a transition and its
  `showing` still said `'neutral'`, so the shut eyes survived only until the
  blink clock next fired (2.6–6.0 s) — i.e. they opened part-way through a
  2.6 s nap about half the time. Fixed with `Player.sleeping`, which feeds the
  blink clock its **resting** face: a blink *is* shut eyes, so resting on
  `'blink'` holds them shut and the clock's own blinks are a no-op. No second
  eye-closing mechanism. Reset by `beginRide`/`endRide` alongside
  `ridePosture`.
- **Sheets.** `'reclined'` (`entities/ridePose.ts`) is the slide's pose:
  propped at −1.35 with the arms thrown back and the knees bent. Measured on
  the real rig in the suite's own bed: forearms **1.28 m**, knees **1.05 m**
  against a quilt whose top face was **0.97 m**. New `'sleeping'` posture:
  flat at −π/2 (the same quarter turn `layPetDown` uses), arms at her sides,
  toes pointed (+x on the leg — the shoe sticks out in front of the shin, and
  flat on your back "in front" is straight up), waist unbent, head neutral
  with a small roll.
- **The quilt is two boxes now** (`dressing.ts`'s `napBlanket`): a **mound**
  over the torso and hips (top at `BED_MATTRESS_TOP + 0.57`) and a lower run
  over the legs (`+ 0.47`), with the white sheet folded over the mound at her
  chest. A uniformly thicker slab covers her too, but reads as a mattress laid
  on top of her; shaped like what is under it, it reads as a bed with somebody
  in it. Her chest measures 1.00 m, collar 1.02 m, shirt hem 1.07 m — the
  numbers the mound has to clear.

`NAP_LIE_HEIGHT` (0.16) and `NAP_FEET_Z` (0.61) are named in `Hotel.ts` and
asserted by probe 16 rather than restated anywhere.

## check:hotel

Probe 16 grew the two probes that could have caught either bug, plus the
pet-bed state either side of a nap. All four proven red before trusted green:

| break | message |
|---|---|
| `sleeping` never fed to the face | `a napping child's eyes were open on 90 of 90 frames` |
| posture back to `'reclined'` | `pokes out through the bedclothes at 7 of 153 points` |
| mound top back to `+0.42` | `... at 12 of 153 points` |
| pet built visible + pre-asleep | `a pet bed at local x=-2.39 already has its pet in it before the player naps` |
| `sendPetsToBed` no-op'd | `... is not lying in it while the player naps (visible false, asleep false)` |

The eye probe finds the blink texture **the way the game makes one** — ticks
her awake until the ordinary blink cycle swaps it in — rather than naming it,
so it cannot pass against a texture the game never shows. Probe 16b now ticks
90 frames after `sleep.run()` because a pet *walks* to its bed now.

## Also on this branch

Merged `origin/main` (`ba8a880`). It brings #327, which fixes `check:slide-rider`
and `check:cat-bus` — both were failing on this branch's older base and stopping
the build chain before it reached `check:hotel`. Confirmed by measurement:
`check:slide-rider` fails at `b2376e5` (this PR's own head, pre-merge) with
`body is 0.11% of the frame`, and passes on `origin/main` at `a8d33b8`.

## Browser QA

Real Chrome for Testing 151.0.7922.34, `/hotel-suite`, own dev server on
**5934** (`--strictPort`), before/after against a second worktree at `b2376e5`
on 5935. Screenshots on `qa-screenshots` under `pr279-round5/`.
