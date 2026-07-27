# Handoff — bulb glow + dark night fog (branch `feat/bulb-glow`)

Worktree: `.claude/worktrees/bulb-glow`. Branched from `origin/main` @ ce04e8a.
**Status: complete, PR raised, not merged.** `npm run build` passes, exit 0.
Browser QA done (I owned it); page closed, dev server killed.

Two family requests, done together because they interact:
1. *"Needs more glow around the strings of lights."*
2. *"Yes, a dark fog so distant items are less visible while the foreground is
   well lit by street lamps."*

## What landed

| commit | what |
| --- | --- |
| `e6c51cb` | Halo quad per bulb, instanced, camera-facing, normal-blended. |
| `ae1e390` | Night fog: own near/far, dark indigo colour, interior kept clear. |
| `e4a5f50` | Fog colour tied to `nightFactor`; distances settled on screen. |
| (last) | Halos tuned on screen: less cream, tighter. |

Final numbers: `HALO_SIZE` 1.05 m, `HALO_CREAM` 0.4, `HALO_STRENGTH` 0.85,
`HALO_FADE_IN` 0.35. `NIGHT_FOG_NEAR = CAMERA_DISTANCE`,
`NIGHT_FOG_FAR = CAMERA_DISTANCE + 32`, `NIGHT_FOG_COLOUR = 0x1a2145`.

## Findings worth keeping

- **A stale service worker served old JS for most of a session.** The park is a
  PWA; a `workbox-precache` entry left over from *another agent's dev server on
  a different port* kept serving a cached bundle, so code changes silently did
  not appear and a `TreeLights` field looked like it had vanished. If the
  browser disagrees with the source, run this before anything else:
  ```js
  (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister());
  (await caches.keys()).forEach(n => caches.delete(n));
  ```
  then reload. Confirm with `world.treeLights.update.toString()`.
- **Fog colour was on the clock, not on the darkness.** `SKY_KEYS` interpolates
  from the midnight key at t=0 to "first light" at t=0.21, but the sun does not
  clear the horizon until ~06:00 — so at 03:18, night factor still 1, the fog
  was two thirds of the way to dawn peach and the distance was pink haze. Fixed
  by blending the keyframe colour towards the night colour by `nightFactor`.
- **`Object3D.traverse` reports each light's own `.visible`, not effective
  visibility.** I briefly "found" the castle's interior lights blazing away in
  the park; they were correctly hidden by their parent group. Walk up parents
  before concluding anything about lights.
- **The park has 14 effective lights at night, not the 9 I claimed in PR #64.**
  Missed `prop.ferrisWheel` (a `PointLight` at intensity **12**, the brightest
  in the park) and `train-locomotive`'s headlight. Both predate this work.
- **Camera zoom must be set via `zoomTarget` only.** `zoomValue` is damped
  towards it and `applyFrustum()` only fires when the value actually changes —
  setting both by hand means the frustum is never rebuilt and nothing happens.

## ⚠️ The open question this made unavoidable

**Midnight now reads as daylight.** Before the fog work, a midnight screenshot
was bright green grass and cream paths — the trebled pools plus moonlight plus
the lifted hemisphere. The dark fog fixes the *composition* (bright foreground,
dark distance = reads as night) but cannot darken the foreground. If the family
say it is still too bright, the knob is in PR #64's description: scale
`intensity` and `distance` together by the same factor on each light.

## Not verified

- Frame rate on a slow device (170 extra transparent quads, one draw call).
- Standing inside the castle at night: the *code path* is verified (fog opens to
  132/258 while `indoors` and restores on exit) but I did not walk in.
