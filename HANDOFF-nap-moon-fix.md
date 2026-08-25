# HANDOFF: nap-moon-fix

PR #279. Two rounds on this branch:

1. **Superseded** — a geometric fix to the hand-built moon disc's position
   (raising it further above the wall line). Findings kept below for the
   record, but the code from this round is gone.
2. **Current** — replaced the hand-built moon+star meshes entirely with the
   park's own real `Sky` shader, driven at night-time uniforms while a nap
   is running. This is what's on the branch now.

## Current approach (round 2)

Jim, PR #279 comment, 18 Aug 2026: *"while sleeping, the sky background
outside the room doesn't look like nighttime at all in that screenshot - it
should use the same sky shader as the park outside uses, but with nighttime
uniforms."*

**Root cause.** `Sky` is one full-screen backdrop quad, shared by the whole
game, drawn before the 3D world every frame (`src/world/Sky.ts`). Every
hotel room is open-topped specifically so the iso camera can see over the
wall line — which means the shared sky backdrop was *already* visible there,
exactly the way it shows above the park's own treeline. The bug was never a
missing view: `DayNight.update()` skips `applyLook` (the method that writes
the sky's colour/star/moon uniforms from the real clock) entirely while
`indoors` is true, so the backdrop simply holds whatever look it had the
instant she walked in. A daytime nap therefore showed a frozen daytime sky
through an ostensibly night-time room — and the previous round's hand-built
moon+star meshes were floating in front of that same wrong-coloured
backdrop, which is why they read as wrong regardless of their own placement.

**Fix.** `DayNight.setNapSkyOverride(active)` — a new sky-only override,
deliberately *not* a second `setIndoors`. `World.update` calls it with
`hotel.isNapping` (`Hotel`'s new public getter over its existing `napping`
timer) right before `dayNight.update()`. While both `indoors` and the
override are true, `DayNight.applyNapNightSky()` paints the sky quad's
uniforms with `SKY_KEYS[0]` ("deep night" — the same colours/star-strength
the park uses at midnight, reused rather than re-invented) and a fixed,
pleasant moon screen position (`NAP_MOON_AZIMUTH`/`NAP_MOON_ALTITUDE` — the
*real* midnight moon sits close enough to overhead that the orthographic
mapping puts it at the very top edge of frame, fine outdoors, cramped
through one room's wall line).

**Deliberately does not touch**: the real clock, `sunDirection`/
`moonDirection`, `nightFactorValue` (what the park's lamps/fireflies/
fountain/train key off of), or any of the four world lights — all stay
exactly where the actual outdoor time of day left them. A three-metre
bedroom going dark at noon must not turn the whole park's evening lighting
on. Only the sky *quad*'s own uniforms move.

**Removed**: `napMoon` (`dressing.ts`), `buildNapSky`/`updateNapSky`/
`napStars`/`napSkyGroup` (`Hotel.ts`), and the `CircleGeometry` import that
only `napMoon` used. The dim-lighting (`updateNapDim`/`HotelLighting.
setNapDim`) and the per-sleeper "Z" glyphs (`updateNapGlyphs`) are untouched
— QA passed those clean and this round doesn't go near them.

**No browser access this session.** Verified `npx tsc --noEmit`,
`npm run check:hotel`, `npm run build` all pass. **What QA should check**:
open a nap in any bedroom during the day and confirm the sky visible over
the wall line switches to a real dark night (deep-blue gradient, stars,
one moon high in frame) rather than staying daytime-blue, and that it
switches back to the correct real time-of-day sky the instant the nap ends
or she wakes early. Also confirm the previously-reported clipping (a notch
in the wall's silhouette cutting into the moon) is gone now that there is no
separate 3D moon mesh near the wall to clip against — the moon is painted
into the screen-space backdrop itself, occluded only by whatever real 3D
geometry the world pass draws in front of it, the same as the sun and the
real night moon always have been outdoors.

## Round 1's findings (superseded, kept for the record)

Positioned the moon mesh further above `SUITE.wallHeight` (`+1.7` → `+3.4`)
and further from the wall on `z` (`1.1` → `2.2`). Verified headlessly with a
script that imports `three` directly and reconstructs the real camera
(`CAMERA_PITCH_DEGREES=38`, `CAMERA_YAW_DEGREES=45`, `CAMERA_DISTANCE=90`)
and the real wall `BoxGeometry`. Two measurements:

1. A ray-cast against the actual wall/partition geometry found **zero**
   occlusion even at the *original* placement (1.53 m real gap) — did not
   reproduce the report against static geometry alone.
2. A screen-space measurement (ARCHITECTURE.md's own `d·sin(pitch) +
   h·cos(pitch)`) found the disc's lowest silhouette point sat `-0.013`
   screen-units below the wall's own highest point at the original
   placement — a graze, not a margin, and a plausible explanation for a
   render-only near-miss that a perfectly centred headless raycast doesn't
   catch (anti-aliasing, or the small camera shift between bedrooms).

This numeric split is *why* round 2 replaced the mesh instead of continuing
to nudge its position: even a well-margined disc was still a second,
hand-maintained "what does night look like" living beside the real one in
`DayNight`/`Sky`, which is exactly the class of bug CLAUDE.md's "two
definitions of one thing" section opens with.

## Verification run in this branch

- `npx tsc --noEmit`
- `npm run check:hotel`
- `npm run build`
