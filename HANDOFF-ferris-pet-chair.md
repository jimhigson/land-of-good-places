# Handoff — ferris wheel pet chair (branch `feat/ferris-pet-chair`)

## State: done, PR raised. Nothing in flight.

Family ask: *"in the space ferris wheel, the pet should sit on a chair that is
lower than the player's so it is easier to see above their head, restructure
the car to fit."*

## What is on the branch

1. `src/art/models/pets.ts` — **root-cause fix.** `sizeToStandard` took the
   natural height as an argument and every recipe pet passed `0.52`, which was
   the top of the *skull*. Ears were left out and then scaled up with
   everything else, so the bunny rendered **2.12 m**, the mouse 1.80, the
   kitten 1.71 — against a `PET_RENDER_HEIGHT` of 1.46. Now the sizer is
   closed after the body is built, from a `Box3` of the finished creature. All
   four pets measure exactly 1.460. This is why no chair alone could have
   fixed the complaint.
2. `src/minigames/ferrisWheel/gondola.ts` — the restructure. Raised player
   seat at the back, three low pet chairs across the front, car grown to
   3.6 × 2.8 × 2.6, glass run higher, `GONDOLA_EYE` exported.
3. `src/minigames/ferrisWheel/SpaceFerrisWheel.ts` — camera takes its position
   from `GONDOLA_EYE`. **Position only**; no rotation touched, so the
   family-confirmed look-around directions are unchanged.
4. `scripts/checkGondolaSightline.mjs` — numeric proof, in the style of
   `checkShopSpacing.mjs`. Run it after changing any seat number.

## The numbers, and why

| | |
| --- | --- |
| Player cushion | 0.80 |
| Player eye | 1.80 (`GONDOLA_EYE`) |
| Pet cushion | 0.16 |
| Tallest rider's head | 1.64 (RiPika), pets 1.62, balloon 1.735 tied at floor |

Clearance under the eye: 0.16 m at worst. Everything above 6.4° below the
horizon is unobstructed.

## Measuring models without a browser

`git show` won't have it (the harness lived in an untracked `.measure/`), but
it is worth rebuilding if you need it: bundle an entry with
`vite build --ssr`, keep `three` external, and run it under Node with a
`document.createElement('canvas')` stub whose 2D context is a `Proxy` returning
no-op functions. `Box3.setFromObject` then gives you real measured sizes for
any model, and `createGondola()` runs headlessly — which also catches
construction-time exceptions the build cannot.

## Needs visual QA (I did not have the browser)

- Ride the wheel with 0, 1, 2 and 3 cute things owned. Empty chairs should look
  deliberate; one passenger takes the middle chair, two take the outside pair.
- Confirm the pet's head is genuinely below the horizon from the seat.
- Confirm look-around left/right/up/down are still correct (they should be
  untouched, but this ride has caught agents out before).
- Look up at the skylight and the wheel; look back at the player's seat back.
- Check the pen in the sticker & pet shop and the parade: the bunny is now
  ~30% shorter than it was.
