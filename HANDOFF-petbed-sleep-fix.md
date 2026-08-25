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

## Round 6 — the pet cuts to bed instead of walking there

Branch `pet-walks-to-bed`, worktree
`.claude/worktrees/pet-walks-to-bed`, off `origin/bedroom-size-pet-beds` at
`0967244` (this file's own round 5 head).

Jim, 23 Aug 2026, confirming the gap round 5 itself flagged: *"the pet
cuts — it vanishes from the parade and appears already in its bed the
instant 'Have a sleep' is tapped, rather than visibly walking there."*

**Root cause, exactly as round 5 diagnosed it**: `Hotel.sendPetsToBed` and
`Parade.setPetsHidden` never shared a walk target. The hotel's own
`petBedRoster` pet (a **second**, Hotel-owned body, positioned by
`standPetUp`/`updatePetBedtime`) has always been the one that trots the
short run-up-to-cushion distance; the real parade member — the one the
child is actually watching, following the trail behind her — was simply
hidden the same frame `hotel.isNapping` went true and un-hidden the same
frame it went false. Two bodies, and only one of them ever moved.

**Fix**: a small interface, `PetParadeLink` (`Hotel.ts`), that `Parade`
satisfies structurally and `Game.ts` wires up right next to where it already
reads `hotel.isNapping` for `setPetsHidden`. `Hotel.sendPetsToBed` now calls
`petParade.beginPetNapWalk(uid, x, y, z, onArrive)` for **each** bed in the
room she can actually see, keyed by the owned pet's own inventory uid (new:
`Hotel.ownedPets()` replaces `ownedPetKinds()`, carrying `uid` alongside
`kind`; `petBedRoster` and `Bed` both gained the `bedIndex` needed to know
which room is actually on screen). `Parade.beginPetNapWalk` points that
member's own `target` at the bed's run-up spot instead of a trail sample —
**the same critically-damped follow spring every other parade member already
uses**, not a second movement system — and keeps it visible until
`ParadeMember.root.position` (not `target`, which would call it "arrived" on
frame one) is within `NAP_WALK_ARRIVE_RADIUS` of the goal. Only then does it
hide the member and hand back to `Hotel`, which starts the existing
run-up-to-cushion trot at the exact spot the real body just vanished from —
an invisible hand-off, not a cut. The reverse (waking) is deliberately the
*old*, already-correct mechanism: a nap-routed member is taken out of
`Parade`'s `napWalks` map and hidden the instant it arrives, so for the rest
of the nap it quietly resumes following the trail **while hidden** (exactly
what every member has always done during a nap) and is simply un-hidden,
already caught up, when `hotel.isNapping` goes false.

**Falls back to the old instant appear-in-bed, unchanged, whenever there is
no live body to walk**: a stowed pet, a carried pet, a bed in a room she
isn't currently in (the bedroom-0/2 visibility duplicates round 5 added),
or the no-pets-yet fallback bunny (`uid: null`). `beginPetNapWalk` simply
returns `false` for all of these and `Hotel` does exactly what it always did.

**Multiple pets, independently** (Jim's own follow-up while this was in
flight): nothing here is single-pet special-cased. `ownedPets()` already
returns one entry per purchase; `dressPetBeds`/`petBedSlots` already gives
each a bed of its own; `sendPetsToBed` calls `beginPetNapWalk` once per bed,
so N owned pets get N independent walks, keyed by N different uids, in the
same frame.

### check:hotel — probe 16c

The one probe in this file that needed a real `Parade` — nothing else here
ever had to move a pet's own body, only the hotel's stand-in. Builds a
**second**, independent headless park (`buildHeadlessPark` again) with two
real pets bought into the store *before* it is built (pet beds are
snapshotted once, at `Hotel` construction — buying after boot, as this
round's first browser-QA attempt did by mistake, leaves the beds still
built against an empty inventory and proves nothing; see "Browser QA
gotcha" below), wires `hotel.petParade = parade` (the one line `Game.ts`
adds), walks her a real trail toward a bed, triggers the real Sleep action,
and samples both pets' `Parade.petState(uid)` (new: position + visibility,
by uid) every stepped `dt=1/60` frame. Proven red before trusted green,
twice, by deliberately reintroducing the bug: hiding + firing `onArrive`
instantly in `beginPetNapWalk` (caught: "vanished after only 0 frame(s)"),
and `member.placeAt(goal)` before the arrival check (caught: same message,
`arriveIdx` still 0 since `placeAt` teleports straight inside the arrival
radius). Also re-proves probe 16's own empty-bed fix holds **through** the
new walk (the stand-in must stay invisible for every frame the real body is
still visibly travelling) and the reverse (both pets leave the bed and are
visible in the parade again once the nap ends).

### Browser QA gotcha — buy after boot proves nothing

`Hotel`'s pet beds are built once, in the constructor, from whatever
`gameStore.get().inventory` holds **at that instant** — same as `check:hotel`
already relied on for every other pet-bed probe, just never mattered before
because nothing else read a bed's `uid`. A first browser-QA pass called
`gameStore.buy(...)` from the console *after* `/hotel-suite` had already
booted: the hotel had already snapshotted an empty inventory (the
`uid: null` fallback bunny, three decoy beds), so neither bought pet had a
bed to walk to, and both immediately vanished as ordinary "not tied to any
routed walk" fallback — a false negative that looked exactly like the
original bug. Fixed by seeding two real pets into a **save file**
(`localStorage['lgp:save']`, written via `page.addInitScript` before
`goto`) so they exist in `gameStore` before `new Game()` — and therefore
before `Hotel` — is ever constructed. Confirmed against `hotel.petBeds`:
both uids present, one bed each, before touching anything else.

### Browser QA — done, on a heavily shared box

Real Chromium 151.0.7922.34 (`playwright-core`, already installed — no
version-mismatch fix needed this round), own dev server on **5947**
(`--strictPort`), a save seeded with two real pets (bunny + kitten) as
above. Screenshots on `qa-screenshots` under `pr279-round6/`: both pets
visible in the parade with the "Have a sleep" chip up
(`01-before-nap-two-pets-in-parade.png`), and asleep in bed with the room
dimmed and a "Z" glyph afterward (`02-asleep-in-bed.png`).

**What this round's QA could *not* pin down, and why**: this box was
running at a load average of 10–17 on 4 cores for the whole session (many
other agents' concurrent builds and QA — confirmed via `uptime`/`ps aux`,
not assumed), and an in-page `requestAnimationFrame` sampler measuring the
real walk over a real 2 s window sometimes only got **2 real paints**
in that window — the game itself was running in slow motion. A real,
continuous mid-walk screenshot needs to land inside a window that was, at
times, under a second wide, and a Node→browser round trip under this load
could itself take longer than that. `check:hotel` probe 16c is the
rigorous version of the same proof and is immune to this: it steps a fixed
`dt = 1/60` itself rather than depending on real frame delivery, which is
exactly why it — not a stopwatch on a screenshot — is what this handoff
leans on for "continuous, not teleporting."

**`check:park-boot` failed in the full `npm run build` chain, on this
branch and, checked side by side, identically (376.8 ms worst block vs.
this branch's 130–162 ms) on the unmodified `origin/bedroom-size-pet-beds`
baseline at the exact same commit this branch forked from** — proven with
a second worktree, same box, same few minutes. Nothing in this PR touches
procgen, the slide solver or the cruiser solver, which is everything that
check's own failure text names. This is the shared box's contention, not
this branch; worth a clean re-run (or CI) once the box is quieter rather
than chased further here. `check:hotel` and `tsc` were both re-run clean
standalone after this, and `npm run build`'s check chain got past every
other check (`check:climb-wave`, `check:cat-bus`, `check:bus-journey`,
etc.) before `check:park-boot`, all passing.
