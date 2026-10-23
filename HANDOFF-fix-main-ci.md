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
- [x] the beacon: fixed (below), red without / green with; seen in headless Chrome on a local production build
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
`focusClaim` (like the exhibit camera), plus `|| this.bookGlance.active` in `Game.selectionBlocked`. While
the owl names the book and says "It is glowing on its shelf!", the camera slides over: if the child, the owl
(and her bubble) and the glowing book with its beacon all fit at ≥ 0.75 of her zoom (`GLANCE_DRAW_BACK`), it
frames all of them; otherwise it looks at the book itself, centred, at her own zoom. When the owl is done it
comes home. It opens only on a child standing still; any move hands the camera straight back for the rest of
that recommendation. Nothing is selected while it holds (headless Chrome showed the owl's "Say hello!" chip
clamped to the bottom of a phone while she talked off-screen — a press that would do nothing). Framing solved
on the live camera's screen axes (`zoomToFit`, margin 0.2); focus kept at the camera's own orbit height.
**Outside the park closure** (only Game and the checks import it): park hash unchanged, 752998c3.

History of the design (each step measured): v1 "everything in shot at any zoom" was 36/36 green in the check
but in headless Chrome a phone held upright needed zoom 0.46 for the north wall's Cat Bus book — the whole
room a small island, the glow a dot; v2 capped the draw-back and slid "book first" to the frame's edge — the
book sat at the edge and the owl's chip came up at the bottom (mid-script); v3 (now): book itself, centred, at
her zoom, and the selection blocked while the glance holds.

Why this one: "only recommend books findable from the desk" leaves 3 of 18 books (4 on a phone), so the
owl would run out of honest picks; a taller/brighter beacon cannot help a shelf that is off the side of the
screen; an edge-of-screen pointer is a new kind of HUD the game does not have. A camera move is the game's
existing vocabulary (exhibit camera, keychain rack, arrival), keeps "It is glowing on its shelf!" true and
shows it, and works on every screen.

**Checks** (seed 5, restart 1, digest 9c7a86e2b266ca08; room at (−600, −600); desk front (6, 8.7) facing
180; every case top 3.20 m):
- `check:library` exit 0, **300 ✓** (log `runs/library-4.log`): the real-child harness applies the glance as
  Game does; RECOMMEND (catBusDay, landscape): seen 170 of 170 glow-line frames, case top drawn at (1084,
  193), everything in shot, she + bubble anchor in shot 170/170, sparkle 31.0 px (30.7 before), home 52
  frames after, a step lets go on frame 1 and it never re-takes. **FOUND FROM THE DESK** (new): 18 books ×
  {1280×720, 390×844}: 36/36 seen 170 of 170; everything-in-shot 14/18 landscape, 7/18 phone; the rest the
  book itself with its case top in the middle half of the screen 170/170 (drawn at (640, 325..336)
  landscape, (195, 396..404) phone); sparkles 19.5..32.3 px, never under 0.75 of before.
- **Reds** (logs in `runs/`): `LIBRARY_CHECK_MUTATE=no-glance` → exit 1, 266 ✓ 32 ✗ (catBusDay 0 of 170, case
  top at (1519, 159) OFF THE SCREEN; landscape 15/18 fail, phone 14/18 — CI's failure reproduced);
  `=glance-stays` → exit 1, 261 ✓ 37 ✗ (home 10.116 m off); by hand, the move-cancel removed → exit 1,
  297 ✓ 1 ✗. (These three were proved on the v1/v2 code; the instrument parts they break are unchanged.)
- `check:labels` exit 0: glance held 353 frames, a chip drawn on 0 of them, no overlap/flicker in 16508
  frames. Reds by hand: glance unwired → "FAIL E coverage … never took the camera"; selection not blocked →
  "FAIL C precedence: a chip was drawn on 347 of the 353 frames the owl's glance held the camera".
- Headless Chrome on a local production build (`look/owl-glance.mjs`, `look/local-3/`, sheets
  `sheet-laptop.png`, `sheet-phone.png`): laptop — whole shot, owl + child lower left, north-8 and its
  beacon upper right; phone — the north-east corner case centred with its beacon, no chip; home again at
  12.2 s with "Say hello!" back over the owl. The beacon reads as a pale blue cloud against the green wall.

**Question for Jim (not changed):** the owl's order is catBusDay → goodnightPark → then four chapter books
(biscuitStorm, detectiveBiscuit, loudestShush, giantFootprints) for a six-year-old.

## Findings (not fixed here)

- **Indoors the camera's follow height is not her feet + `CAMERA_FOCUS_LIFT`**: in the reading room it
  settles at 4.87 m over the floor (probe `probe/home.mts`). `IsoCamera.update` runs `altitudeAt` /
  `yAtAltitude` (sphere formulas) for the follow even indoors, where they are "meaningless" (terrain.ts's
  own words); `isOutdoors` only guards the damping. Pre-existing, every interior; changing it moves every
  interior's framing and the park hash — reported, not touched.
