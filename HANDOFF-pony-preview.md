# Handoff — Swishy Pony visible in the character creator

Branch `fix/pony-preview-framing`, from `origin/main` @ 37b4015.

## The problem, and what actually caused it

The floor-length ponytail (`longPonytail`, "Swishy Pony") could not be seen
in the character creator. Three separate causes, all measured from the code:

1. **Geometry.** The tail's anchor is at `(0, 1.289, -0.652)` — about 0.65 m
   behind the character's own axis (`hair.ts`'s `FALL_BACK * HEAD` = 0.54,
   plus the anchor's own `-0.12`). The skull is `0.44 * HEAD` = 0.66 m in
   radius, the hands reach ~0.5 m out, the feet ~0.33 m. From dead in front
   the tail is behind all of it. To clear the widest of those it needs
   `0.65 · sin θ > 0.5`, i.e. a turn of **θ > 50°**. The turntable's ±0.55 rad
   (31.5°) could never do it.
2. **Framing.** Picking a hair style called `refreshPreview('head')`, and the
   tail's eight segments hang off the model **root**, not the head — so the
   framing cropped 1.3 m of the very thing being chosen.
3. **The pet** stands at `(0.92, 0, 0.32)` — front-right — over the top.

## What was done

The **plinth** turns, not the camera. `VIEW_DIRECTION` is untouched on purpose:
the hat/eye-colour/pet close-ups were tuned tonight against a dead-on view.

- `TAIL_TURN = 1.1` rad, applied only when the built style is in
  `TRAILING_HAIR_STYLES` (`long`, `ponytail`, `longPonytail`, i.e. everything
  authored inside `HairRig`'s `fall` group) **and** the focus is one of
  `all` / `hair` / `body`. `head`, `face`, `pet` unwind it.
- While turned the rock narrows (0.55 → 0.25) and quickens (0.35 → 2.5 rad/s).
- New `hair` focus (head + every visible hair mesh). Hair colour and hair
  style both use it.
- `KidHandle.resetHair()` — new, called after the preview parents a fresh kid
  to the turned plinth.

## The motion finding (this is the bit worth keeping)

The claim that the tail already swishes because the plinth rocks is **wrong**,
and it is arithmetic, not opinion. Anchor acceleration under the resting rock
is `A ω² r = 0.55 × 0.35² × 0.65 ≈ 0.04 m/s²`. `ponytail.ts`'s `GRAVITY` is
16, so the tail deflects by `atan(0.04/16)` ≈ **0.14°**. Invisible.

The tail's own pendulum frequency is `√(GRAVITY / PONYTAIL_LENGTH)` =
`√(16/1.3)` ≈ **3.5 rad/s**. Driving at 2.5 rad/s sits under it and is
amplified (~2×), which is why `TAIL_ROCK_RATE` is what it is. Anything much
above ~3 rad/s risks resonance; anything below ~1.5 does nothing.

`TURN_RATE = 2.2` makes the 1.1 rad turn itself the big swish (peak ~2.4 rad/s,
so a character turning to show you something, not a spin).

## Status

`npm run build` passes (exit 0). **No visual QA** — the browser is not mine.
See the PR body for the list.
