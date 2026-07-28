# RideCamera — Decision 4 §8 C1

Branch `feat/ride-camera`, worktree `.claude/worktrees/ride-camera`.

**Job:** extract the ferris wheel's look-around into one shared `core/RideCamera`,
ferris as first consumer, **pixel-for-pixel parity**. Never write a second
look-around. Train (C2) and coaster (C4/C5) adopt it next.

## The parity gate — do not skip it

`npm run check:ride-camera` (`scripts/trace-ride-camera.mts`, wired into
`npm run build`, 0.3 s). It builds the **real** `SpaceFerrisWheel` in Node behind
`scripts/headless-dom.mjs` and drives a 94 s scripted look sweep at fixed dt,
hashing the camera's world position + quaternion + fov + aspect **as exact IEEE
bits** every frame.

**Baseline hash (origin/main 62ab6de, before any extraction): `26a241cc`**

Proved it bites, on the unmodified ride:

| change | hash |
| --- | --- |
| none (baseline) | `26a241cc` |
| yaw sign flipped (`-look.x` → `look.x`) | `8a22cf68` |
| `YAW_RATE` 1.7 → 1.7001 | `1fada18a` |

## Findings

- **`npm run build` is broken on `origin/main` b4143f0 (#96), before this branch.**
  `scripts/check-waypoints.mts:47` imports `BUILDING_CENTRE_X` from
  `src/core/constants.ts`, which no longer exports it — the winding-railway PR
  moved it. Nothing on this branch touches either file. Every *other* build step
  passes here: `check:text`, `check:shop-spacing`, `check:gondola-sightline`,
  `check:hop-clearance`, `tsc --noEmit`, `check:brevity`, `check:assets`,
  `check:crowd`, `check:ride-camera`, `check:park`, `vite build`. Somebody owns
  that fix; it is not this PR.
- **Live QA outstanding.** `window.game` is not reachable in the running dev
  build (the `import.meta.env.DEV` hook in `main.ts:125` did not appear on
  `window`), so the ride could not be opened from the console and the browser
  check was abandoned rather than circled. The park itself boots and renders
  fine. The parity trace is the stronger evidence anyway — it is the real ride,
  bit-exact — but somebody should still sit in the gondola once.

- **`Game.cameraOverride` does not exist on `origin/main`.** The brief says it
  does (~10 lines in `Game.ts`). Grep for `cameraOverride` across `src/` returns
  nothing. Decision 4 §8.2 lists it as its own piece of work; it is *not* in this
  PR's scope (C1 is the extraction). The train PR (C2) will have to land it.
- Ferris look-around, exactly as approved: `targetYawVelocity = -look.x *
  YAW_RATE` (three.js turns *left* as `rotation.y` grows — hence the negation),
  `targetPitchVelocity = +look.y * PITCH_RATE` (no flip needed), `rotation.order
  = 'YXZ'`, `rotation.set(pitch, yaw + idleYaw, 0)`.
- Nothing in `minigames/ferrisWheel/` uses `Math.random`/`Date.now`, which is why
  a bit-exact trace is possible at all.

## State

1. ✅ trace harness + `check:ride-camera` wired into the build — committed first,
   so the gate exists before the change it gates.
2. ✅ `src/core/rideLook.ts` (verbatim move of `ferrisWheel/look.ts`) +
   `src/core/RideCamera.ts`; ferris is first consumer. Hash unchanged.
3. ✅ PR raised.
