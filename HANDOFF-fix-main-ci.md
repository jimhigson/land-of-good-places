# HANDOFF — fix main's CI after the library merge (#733 + #734 pushed red)

Engineer, Claude Opus 5.5, 23 Oct 2026. Branch `fix/main-ci-after-library` (worktree
`.claude/worktrees/fix-main-ci`), cut from origin/main @ 49e1351e. Scratch (logs, probes):
`.claude/library-build-scratch/fix-main-ci/` (`runs/<name>.log`, each ending `exit=N seconds=S`).

**The ask (Jim, 23 Oct ~22:05): "fix the ci issues".** #733 and #734 were pushed straight to main
without a green CI. Fix every red at its root, each fix with a check proved red without it and green
with it (geometry pasted). PR to main, every CI job green, beacon fix seen on the PR's newest preview.
Do NOT merge. Do not touch the den/part-5 or engine-follow-up work.

## Status

- [x] worktree + `pnpm install --frozen-lockfile` (pnpm 12.1.0, node 26.5.0)
- [ ] main's CI run 40024042181 (Update adoption 40024042300: **success**) on 49e1351e finished; every
      failed job's log read. At 21:45 UTC its parks were still solving (seeds 10 and 14 in their second
      wave, restarts 8+).
- [x] the beacon: fixed (below), red without / green with
- [ ] any other CI failure: fixed
- [x] local, exit codes read (seed 5 park = CI's `park-5-b0` block artifact for hash 752998c3, restart 1,
      digest 9c7a86e2b266ca08, copied to `.parks/`): tsc 0, typecheck:test 0, check:library 0 (298 ✓),
      check:labels 0, check:tap-spacing 0, check:jitter 0, check:exits 0
- [ ] full `pnpm run check` and `pnpm run test:procgen` (needs all 16 parks: CI's `parks-752998c3…`)
- [ ] PR opened; every CI job green on its head
- [ ] beacon seen on the newest preview (headless Chrome, throwaway profile)

## The beacon — root cause and the fix (decided)

**Root.** The owl's recommendation is a seeded shuffle of all 18 books; her first pick on main is
catBusDay on north-8. The reading room is 36 × 26 m and the camera frames ~27 × 15 m round her (zoom 1,
1280×720), so from the desk's front most shelves are off the screen: with each book made the glowing one,
only goodnightPark, keychainStall and fountainWish had a sparkle on a 1280×720 screen (4 of 18 on a
390×844 phone). The clause passed on part 4's own shelf only because its first pick was fountainWish.

**Fix: the owl shows her the book** — `src/world/library/bookGlance.ts` (new), wired in `Game.tick` as a
`focusClaim` (like the exhibit camera). While the owl names the book and says "It is glowing on its
shelf!", the camera slides across and draws back until the child, the owl (and her bubble) and the glowing
book with its beacon are all in shot; when she is done it comes home. It only opens on a child standing
still; any move (stick, key, jump, tap-walk, sit) hands the camera straight back and it stays hers for the
rest of that recommendation. Framing solved on the live camera's screen axes (`zoomToFit`, margin 0.2),
never closer than she had it; focus kept at the camera's own orbit height. **Outside the park closure**
(only Game and the checks import it): park hash unchanged, 752998c3.

Why this one: "only recommend books findable from the desk" leaves 3 of 18 books (fewer on a phone), so the
owl would run out of honest picks; a taller/brighter beacon cannot help a shelf that is off the side of the
screen; an edge-of-screen pointer is a new kind of HUD the game does not have. A camera move is the game's
existing vocabulary (exhibit camera, keychain rack, arrival), keeps "It is glowing on its shelf!" true and
shows it, and works on every screen.

**Checks** (all on the seed-5 park above):
- `check:library` (exit 0, 298 ✓): the real-child harness applies the glance as Game does; RECOMMEND's
  found-from-the-desk is measured on the glow line's frames (catBusDay: seen 170 of 170, case top drawn at
  (1084, 193)); she and the owl's bubble anchor in shot on all 170; the camera home 52 frames after the last
  line (0.237 m off its pre-glance orbit point); a step: let go on frame 1, zoom given back, 0 frames
  re-taken. **FOUND FROM THE DESK** (new): all 18 books × {1280×720, 390×844}: 36/36 seen 170 of 170,
  zoom 0.46..1.00, all in one shot (never the book-alone fallback).
- **Reds**: `LIBRARY_CHECK_MUTATE=no-glance` → exit 1, 266 ✓ 32 ✗ (catBusDay 0 of 170, case top at
  (1519, 159) OFF THE SCREEN; laptop 15 of 18 fail, phone 14 of 18) — the CI failure reproduced;
  `=glance-stays` → exit 1, 261 ✓ 37 ✗ (home 10.116 m off); by hand, the move-cancel removed from
  bookGlance.ts → exit 1, 297 ✓ 1 ✗ (let go NOT within 6 frames, re-took 310 frames).
- `check:labels` (exit 0): the glance wired in its step; the recommendation visit runs to the end;
  glance held 353 frames, no overlap/flicker in 16508 frames. By hand, glance unwired → exit 1, "FAIL E
  coverage: the owl's glance … never took the camera".

**Question for Jim (not changed):** the owl's order is catBusDay → goodnightPark → then four chapter books
(biscuitStorm, detectiveBiscuit, loudestShush, giantFootprints) for a six-year-old.

## Findings (not fixed here)

- **Indoors the camera's follow height is not her feet + `CAMERA_FOCUS_LIFT`**: in the reading room it
  settles at 4.87 m over the floor (probe `probe/home.mts`). `IsoCamera.update` runs `altitudeAt` /
  `yAtAltitude` (sphere formulas) for the follow even indoors, where they are "meaningless" (terrain.ts's
  own words); `isOutdoors` only guards the damping. Pre-existing, every interior; changing it moves every
  interior's framing and the park hash — reported, not touched.
