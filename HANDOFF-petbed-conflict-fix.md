# HANDOFF — one body per pet (PR #279, round 7)

Branch `petbed-conflict-fix-2`, merged into **`bedroom-size-pet-beds`** (PR #279).
Worktree `.claude/worktrees/petbed-conflict-fix-2`.

Jim, live play, 23 Aug 2026, verbatim:

> *"they don't fit in the bed; furthermore, when the player gets into bed, the
> pet phases in and out of existence on alternating frames, no smooth animation
> and then morphs into a totally different pet, who then clips out of the bed
> and floats half hanging off the edge."*

## Root cause: two bodies for every pet

`Hotel` built a `createPet()` **stand-in** per bed and cut it into view at
bedtime; `Parade` hid the animal the child had actually been watching. Round 6
(`099b8ca`) added a walk-then-hand-off *between* the two systems rather than
deleting one of them, so both were still live and both wrote "is this pet drawn,
and where" every frame. Every clause of Jim's report is a symptom of that one
thing, and all four were measured before anything was changed:

| what he saw | what was measured |
|---|---|
| *"morphs into a totally different pet"* | only the **first** owned pet got a bed in a side bedroom. Napping in bedroom 0 with a bunny and a kitten: the kitten (walking right behind her) was hidden on frame 0 with nowhere to go, and a *bunny* walked to the one bed there. |
| *"phases in and out of existence"* | in a real browser, pre-fix: `pet.kitten#2` **not drawn on 253 of 253 frames** of the nap, `pet.bunny#1` not drawn on 248 of 253 — while **4 hotel stand-in bodies were drawn at once**, three of them bunnies, in three different bedrooms. |
| *"clips out of the bed … half hanging off the edge"* | `layPetDown` put the pet's **feet** at the bed's centre: a bunny lay from bed-local z −0.10 to −1.57 against a bolster ending at −0.67 — **0.90 m of rabbit past the pillow end**. |
| *"they don't fit in the bed"* | the kitten, mouse and puff all had their lowest point **below the floor** (y −0.06, −0.04, −0.04 against a cushion top of 0.30), and lying flat on their backs the kitten stood 1.09 m and the puff 1.30 m tall inside a canopy that starts at 0.72 m. |

## The fix: delete the second body

`Hotel` builds pet beds as **furniture and nothing else** — it no longer
creates, poses, hides or moves an animal anywhere. It hands the parade a
`PetBedSpot` (run-up spot + cushion, in world metres) for each bed in the room
she actually lay down in. `ParadeMember` walks there on the same follow spring
it walks everywhere else with, climbs in over 0.8 s and holds the sleeping
pose. **`ParadeMember.updatePop` is now the one and only writer of a pet's
visibility in the whole game**, so a flicker has nowhere to come from, and
there is no second model that could be the wrong species.

Deleted rather than adjusted: `Parade.setPetsHidden`, `ParadeMember.hidden`,
`Hotel.updatePetBedtime`, `standPetUp`, `layPetDown`, `petArrivedAtBed`, the
`beginPetNapWalk`/`onArrive` hand-off, and `Game.tick`'s hide-the-pets line.

Also fixed, because deleting the stand-in made them answerable:

- **Every** owned pet gets a bed in **every** bedroom (`petBedSlots` per
  `bedIndex`), so whichever of the three she sleeps in, each pet has one to walk
  to. Only that room's beds are ever sent for, and a pet has one body, so
  exactly one of its three beds can be occupied — `petBedPhase(uid, spot)`
  matches on the spot **object**, not on coordinates.
- The sleeping pose is **measured, not written down**:
  `ParadeMember.measureSleepOffset` takes the model's own `Box3` in the
  sleeping rotation and lands its lowest point exactly on
  `PET_BED_CUSHION_TOP` with its plan footprint centred on the cushion. The
  four pets' y terms differ by 0.29 m, so no shared literal could have been
  right for all of them.
- The pet lies **on its side** (`rotation.set(-π/2, π/2, 0)`) rather than flat
  on its back — a quarter turn about its own Y as well as the quarter turn back
  about X. Flat, the pet's *depth* stood up (1.09–1.30 m) and went through the
  canopy; on its side it is the pet's *width* (0.67–0.90 m), which clears it.
  Y is `+π/2` rather than `−π/2` so its face rolls toward +X, the side the
  fixed iso camera looks from.
- A pet asleep in bed shuts its eyes, through the one expression mechanism it
  already had (`'blink'` held, exactly as `Player.sleeping` does for the child).

## check:hotel — probes 16b and 16c became one

Probe 16 keeps the child's own blanket and eyes; its pet clauses are gone
(that park owns no pets, so it now asserts the opposite: an unearned bed can
only ever be empty). The one pet-bed probe builds a second headless park with
two real pets bought **before** it is constructed and a real `Parade`, and
loops all three bedrooms. Per bedroom, per pet: empty before and after; a bed
of its own on that bedroom's real clear floor; it walks there; **its visibility
may not change once across the whole nap**; the body carries the catalogue id
she bought; and it fits, measured against the bed **as built** (the real
`petbed-bolster` rim and the real canopy top).

Proven red before trusted green, numbers quoted off the terminal:

| break | message |
|---|---|
| visibility toggled per frame | `the bunny changed from drawn to not-drawn (or back) 129 time(s) during a single nap in bedroom 0` |
| only pet 0 gets a side-bedroom bed (the shipped bug) | `the kitten has no bed at all in bedroom 0` |
| the shipped hand-picked lying pose | `sticks 0.89 m past its own bed's bolster in z`; `lowest point at y=-0.06 m against a cushion top of 0.30 m — it is sunk into the bed` |
| lying flat on its back | `the kitten … reaches y=1.39 m, up through its own bed's canopy at 1.27 m` |
| cut straight into the bed | `the bunny spent only 0 frame(s) walking to its bed in bedroom 0` |

**The trap building it**: every box is a **world** box and a room shell carries
its room's origin, so without `hotelRoot.updateMatrixWorld(true)` first they all
come out in room-local metres and quietly describe nothing. The probe's first
run found no bed under any bed.

## Browser QA — and how to redo it on a loaded box

`scripts/qa-petbed.mjs` (not in the build; run it by hand):

```
npx vite --port <yours> --strictPort
node scripts/qa-petbed.mjs <port> <outDir> [bedIndex] [camDx,camDy,camDz]
```

It seeds a save with two real pets **before** `goto` (the hotel snapshots the
inventory at construction — buying from the console after boot proves nothing,
and cost an earlier round an afternoon), opens `/hotel-suite`, stands her at a
bed, presses "Have a sleep" and records **every animation frame** through the
transition.

**It samples until the nap ends, never for a wall-clock window.** Round 6's QA
gave up on this measurement because the box was too loaded to paint inside a
2 s window. It does not matter: `MAX_FRAME_DELTA` (1/12 s) clamps every frame,
so a 2.6 s nap is **always at least 32 rendered frames** however slowly the box
paints. Then it freezes the park with the game's own `/view` mechanism
(`Game.enterDebugView` with a `timeOfDay`, which is what pauses) and puts a free
camera on the pet beds, because a 2.6 s nap is far too short to line a shot up
in otherwise.

Measured, real Chrome for Testing 151.0.7922.34, own dev server on 6137:

| | pre-fix (`c0720d0`) | this branch |
|---|---|---|
| `pet.bunny#1` frames not drawn | 248 / 253 | **0 / 196** |
| `pet.kitten#2` frames not drawn | 253 / 253 | **0 / 196** |
| visibility toggles | 1 / 0 | **0 / 0** |
| hotel stand-in bodies drawn at once | **4** | *(none exist)* |
| model seen | *(the real ones were never drawn)* | `pet.bunny` / `pet.kitten`, never anything else |
| phases | *(no such thing)* | `walking → climbing → asleep`, once each |
| console errors | none | none |

Screenshots on `qa-screenshots` under `pr279-round7/`. The pair worth looking
at is `before-empty-bed.png` (a "Z" glyph over an **empty** pet bed, the pet's
body hovering off the back of it behind the canopy) against
`after-pet-in-its-bed.png` (same camera, same bed, same seed: the bunny lying
inside the bolster under the canopy).

## Known, deliberately not changed

Two pets in **adjacent rows** of a side bedroom overlap by ~0.19 m at the
extremities (ear tips against tail). `PET_BED_PITCH` is 1.3 m, derived from the
*bed's* footprint (0.62 m × 2), and never considered the 1.46 m animal that
lies in it. This is **pre-existing** — the old pose overlapped by the same
0.17 m — and raising the pitch moves every pet bed in the hotel, which is a
much wider blast radius than this round should take. Worth a look on its own.
