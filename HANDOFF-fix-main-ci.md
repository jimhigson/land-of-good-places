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
- [x] main's CI run 40024042181 read: **completed failure — 86 success, 1 skipped, 2 failed: `Checks shard 4`
      (`check:library` "1 clause(s) FAILED.", the beacon clause) and the `Checks` aggregator**; Procgen
      invariants success; Deploy success. Shard 4 stopped at check:library, so its 11 later steps never ran
      on main (the PR's CI ran them: all green). Update adoption 40024042300: success.
- [x] the beacon: fixed (below), reds re-proved on the final code, seen in headless Chrome locally
- [x] local (16 parks = CI's `parks-752998c3…` artifact in `.parks/`): tsc 0, typecheck:test 0,
      check:library 0 (300 ✓), check:labels 0, check:tap-spacing 0, check:jitter 0, check:exits 0,
      flat-primitives 0; **test:procgen exit 0, 271 s, 48 files, 2168 tests, 0 skipped**
- [x] **PR #735**; CI run 40032476645 on ae2b08f9: **25 success, 6 skipped (Deploy, the parks matrix on a
      cache hit) — Checks pass, Procgen invariants pass**; Update adoption 40032476641 pass
- [x] **check:served-walking red locally under load — root-caused and fixed** (section below)
- [x] **full `pnpm run check` alone on 98226e17: exit 0, 2106 s** (105 `$` lines, 0 ELIFECYCLE; 84 distinct
      steps by parsing package.json); **test:procgen alone on 98226e17: exit 0, 374 s, 48 files, 2168 tests,
      0 skipped** (`runs/full5-check.log`, `runs/final-procgen.log`)
- [x] **PR #735 head 98226e17: CI run 40038029208 success (25 success, 6 skipped: Deploy and the parks
      matrix on a cache hit) — `Checks` pass, `Procgen invariants` pass; Update adoption 40038029250 pass**
- [x] the beacon seen on the newest preview, https://pr-735-98226e1-land-of-good-places.blockstack.workers.dev
      (build 680b4685 = main 49e1351e + 98226e17, tree identical to 98226e17), headless Chrome, a fresh
      context per size (`look/preview-98226e1/`, sheets `sheet-laptop.png`, `sheet-phone.png`): laptop — the
      whole picture (owl, child, north-8 and its beacon) from 5.6 to 9.8 s, home at 12.2 s; phone — the
      north-east corner case centred with its beacon, no chip, home at 12.2 s; no page errors.
- PR head kept at 98226e17 (green, previewed); this handoff's last commit lives on
  `fix/main-ci-after-library-handoff` so pushing it does not restart the PR's CI or change its preview.

## REVIEW ROUND 1 (24 Oct, "Verdict: changes requested", issuecomment-6382015987) — done

1. **The naming line in view.** Book-itself shots took the title away with the owl (bubble anchor in shot
   4–15 of 143–183 frames of "Try “…” next!", 0/170 of the glow line; phone 11/18 books incl. her first
   seven picks, landscape 4/18). **Fix:** the glance opens on the glow line only (`window()`). New clause
   (RECOMMEND + all 36 sweep cases): the bubble anchor in shot on every frame of the naming line — now
   143–183 of 143–183 everywhere. **Red** on 98226e17's glance and by hand (the title back in the window):
   exit 1, 286 ✓ 15 ✗, the reviewer's numbers exactly. The glow line's bubble in a book-itself shot is in
   shot for 3–14 of 170 frames, then gone — accepted: the line is "It is glowing on its shelf!", and the
   glowing shelf is what she is looking at (a 20 px sparkle seen on 153–164 of those 170 frames). Because
   the slide now happens in the glow line, centring is asked once the camera has arrived (focus within 1 m
   of the shot's): arrived on 124–134 of 169 frames, centred on all of them.
2. **A floor the glance does not own.** "Never draws back so far the glow is lost" now counts a sparkle only
   if drawn ≥ `GLOW_MIN_PX` = `FALLBACK_UNIT_PX` (20 px — the TEXT RULE's minimum; style.css's clamp sits on
   it at both screens), its width measured from the sprite's own world scale. **Red:** `GLANCE_DRAW_BACK =
   0.4` → exit 1, 292 ✓ 9 ✗ (phone catBusDay whole at zoom 0.46: a 20 px sparkle on 0 of 170 frames, the
   widest 14.0 px). `GLANCE_DRAW_BACK` is no longer imported by the check.
3. Non-blocking, now in the module doc and the PR body: the checks copy Game's two wiring lines; a tap
   during the glance walks her (selection blocked).

QA round 1 ("not approved", issuecomment-6382237467) saw the same defect in the game (phone: the title
slides off in ~0.2 s on Cat Bus, Goodnight Park, Biscuit and the Storm; laptop: The Dragon Who Reads). Added
**check:labels: the naming line drawn on every frame she says it** (label manager's own verdict, 390×844):
183 of 183; **red** with 98226e17's window: "FAIL F the owl's words … drawn on only 7 of the 183 frames".

**Final (head 786ab804):** full `pnpm run check` alone exit 0, 2120 s (`runs/full7-check.log`); test:procgen
alone exit 0, 259 s, 48 files, 2168 tests, 0 skipped (`runs/final2-procgen.log`); CI run 40080380417
success (25 success, 6 skipped) — Checks pass, Procgen invariants pass; Update adoption 40080380420 pass.
Newest preview https://pr-735-786ab80-land-of-good-places.blockstack.workers.dev (build 3d06f27f = main +
786ab804, tree identical), looked at in headless Chrome at both sizes (`look/preview-786ab80/`, sheets):
the title over the owl for its whole line on both; laptop whole picture on the glow line; phone the corner
case centred; home with "Say hello!". PR head kept at 786ab804; this handoff's last commit is on
`fix/main-ci-after-library-handoff`.

Reds re-run on the final code (`runs/reds3.out`): no-glance 268 ✓ 33 ✗; glance-stays 264 ✓ 37 ✗; draw-back
0.4 292 ✓ 9 ✗; title-in-window 286 ✓ 15 ✗; no-move-cancel 300 ✓ 1 ✗; book-off-centre 286 ✓ 15 ✗. Green:
check:library 301 ✓; check:labels exit 0 (glance 170 frames, chip on 0); typecheck:test, flat-primitives,
tap-spacing, jitter, exits all exit 0.

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

## check:served-walking — a latent flake, found by my own mistake, fixed

**How it was found.** My first "kill" of a stray full-check run killed only some of its processes (the zsh
script survived SIGTERM; kill by **process group** — `kill -TERM -<pgid>` — and check the group is empty), so
two full checks plus a test:procgen ran at once (load 22). In that run `check:served-walking` failed:
*"after keychain view: KeyW moved her 0.190 m in 5000 ms … from -0.80,17.94 to -0.94,17.81"*. The same code
passed idle 3/3 and on CI.

**Root.** Not the keys: the case's premise. The eight presses chained end to start, so where each began
depended on how far the last one carried her and coasted — frame-rate dependent. Under load `ArrowRight`
coasted her to (−0.80, 17.94), against the keychain stall, and `KeyW` points into it (probe: every point on
that line is inside the stall's clearance). Worse, even the spot the view hands her back on, (−2.46, 17.50),
has no room to the right: with every press started there, `ArrowRight` and `KeyD` got **0.027 m in 5100 ms**.

**Fix** (`scripts/check-walking.mts`): every case's presses start from the nearest spot with
`SAVE_SPOT_CLEARANCE` (5 m) of clear ground to where the case left her (`clearHome`, the returning save's own
ring search, now shared), and she is put back on it at rest before every press (`standAt`,
`Player.teleport`). The hand-back each case exists for is asserted before she is moved. Homes on seed 5:
spawn (3.13, −26.82), 27 m off (0, 0); keychain (3.58, 5.99), 13 m off; returning save unchanged.
`CHECK_WALKING_MUTATE=coast-to-stall` leaves her at (−0.80, 17.94) after the keychain case's `ArrowRight`.
- with the fix: plain exit 0 (27 OK), mutated exit 0 (27 OK)
- **red**, the fix taken out by hand + the mutation: exit 1, *"KeyW FAILED: 0.190 m after 5100 ms held (from
  -0.80,17.94 to -0.94,17.81)"* — the loaded run's numbers exactly. Logs `runs/walking-*.log`.

## Findings (not fixed here)

- **Indoors the camera's follow height is not her feet + `CAMERA_FOCUS_LIFT`**: in the reading room it
  settles at 4.87 m over the floor (probe `probe/home.mts`). `IsoCamera.update` runs `altitudeAt` /
  `yAtAltitude` (sphere formulas) for the follow even indoors, where they are "meaningless" (terrain.ts's
  own words); `isOutdoors` only guards the damping. Pre-existing, every interior; changing it moves every
  interior's framing and the park hash — reported, not touched.
