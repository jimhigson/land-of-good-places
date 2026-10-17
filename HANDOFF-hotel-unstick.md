# HANDOFF — hotel breakfast soft-lock: three fixes (fix/hotel-breakfast-unstick)

Engineer, Claude Opus 5.5. Worktree `.claude/worktrees/hotel-unstick`, branch
`fix/hotel-breakfast-unstick` from origin/main 58165723. One PR, not merged by me.

## The brief (as changed by the coordinator, 17 Oct — the stuck-detector is DROPPED)
1. **Safe put-down on every exit.** Every `Player.endRide` lands her clear, solid underfoot and
   connected to the space's way out. ONE owner beside endRide. ONE check that enumerates every
   exit (enter, leave, reachability flood with a control). Red on old breakfast behaviour.
   Unenumerable exits: stderr + PR list.
2. **Breakfast tables she can jump on** — minimal and local (topIsAbsolute). Prove a jump from
   the old trapped spot gets her onto the table and out. No surfaces on other props (a separate
   investigator owns the general "low scenery isn't standable" mechanism).
3. **"Next day" in the ☰ Menu**: end whatever she is doing, iris, clock to next morning, her
   suite (Floor 50) lying in bed, iris opens, existing nap wake-up plays. Pets come; bounds,
   space, camera, save all the suite's. Checks from every space and mid-ride; control; reds.

## Environment
- Node v26.5.0, pnpm 12.1.0. `.parks/` copied from `library-714-owl/.parks` (sourceHash c6596b45…
  == base). After any closure edit (Hotel.ts, Player.ts, Collision.ts, dismount.ts …) the hash
  moves: scratch runs then need `LGP_PARK_FILE=.parks/5.json`.
- Scratch instruments (NOT committed) live in /tmp/hotel-unstick/*.mts; run from the worktree:
  `node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs /tmp/hotel-unstick/X.mts`
  (three must be imported by absolute path from node_modules/.pnpm/three@0.185.1/...).

## Measured on untouched main (seed 5, restart 1, hydrated)
- Lobby café (SW corner): tables lobby-a (-10.2, 10.6) spin 0.15, lobby-b (-10.3, 8.7) spin 1.35.
  Chair lobby-a-1 (-10.36, 9.56) is 0.86 m from table b (jammed between the tables).
- Pocket: a strip x≈-12.0..-11.2, z 9.1..12.5 between the tables and the west wall (inner face
  -12.7), sealed north by chair a-0 vs the reception partition (gap 1.21 m < 1.24 m child).
- `Hotel.standUp` ends the ride AT the seat. Leave breakfast puts her: a-1 → (-11.26, 9.74),
  b-1 → (-11.81, 9.25) — both in the strip; walking any of 8 ways for 3 s cannot leave (trapped).
  a-0 / b-0 leave her standing on the chair seat (y 0.42).
- A hop toward the room from the strip already clears the table on main (topIsAbsolute + plate
  from place.ts). She can stand on the table top, walk along it, step off. Hop with 0.25-0.3 s of
  push lands ON the top. So fix 2 is a proof, not a code change. (Touch: the hop button has no
  direction and tap-to-move never plans onto a table — that is the general investigator's.)
- probe 31 already declared this strip (KNOWN_UNREACHABLE_CELLS lobby 22) as "Jim's call".
- `world/dismount.ts` `resolveDismount` = "universal safety net" but copied into 5 callers only
  (coaster, ferris, rail race, train, tortoise); missing from hotel chair/nap/art/window, both
  lifts, banquet, tree climb, keychain zoom, cat bus. Only checks isClearCircle (no support, no
  connectivity).
- NavGrid lattice build: garden 524 ms, lobby 80 ms; whole flood 35 ms / 3 ms.

## THE MECHANISM — reproduced in headless Chrome on pristine main (control worktree
`.claude/worktrees/hotel-unstick-main` @58165723, vite dev :5871, /tmp/hotel-unstick/browser-repro2.mjs)
Real input: keys walk her (router's waypoints) round the south of the café; proximity offers
lobby-a-1; **E** sits her; a cereal chip; **Leave breakfast** → she stands at local
(-11.26, 9.74), y 0, riding=false — in the strip. Each arrow held 3 s: 0.35 / 0.87 / 3.53 /
1.81 m, never out. A tap on open floor (-3, 9): she walks to (-11.64, 10.09), deeper in. A hop
toward the room (Right+Down+Space): out at (-0.47, 9.75) — fix 2 already holds on main.
Shots: /tmp/hotel-unstick/shots/main-kbd-*.png.
Cause: `Hotel.standUp` → `endRide()` at the seat. She is inside the chair and 0.17 m inside her
table's reach; the resolver escorts her out the nearest face, which for a-1/b-1 is west, into a
strip sealed by chair a-0 vs the reception partition (1.21 m gap, she is 1.24 m) and by chair b-1
+ table b + the column. Not input held, not the cinematic, not the pet/bowl (visual only),
not an NPC: keys move her freely after b-0's stand-up (11-17 m), riding=false throughout.
Taps can never select a-1/b-1 (b-0's 1.6 m pick sphere is nearer the fixed camera on every ray);
the keyboard's proximity selection can, from south of table b — that is how a child gets there.
The jump investigator's "14 chair centres walked clear" were Floor 1's breakfast room
(BREAKFAST, 14 chairs), not the ground floor's lobby café, and "walked clear of the chair" is not
"reaches the room".

## Brief change 3 (coordinator, relaying Jim): fix 1 is a GENERAL RUNTIME RULE
"when we choose a point to put the player down, we need to check the reachability of the
location, not make it breakfast-specific". So: the rule lives inside Player's three placement
methods (endRide, teleportTo, teleport — the only writers of her position); breakfast's exit is
the seat itself and the rule moves her. No per-chair stand spot (reverted).

## Design (as built)
- `Player.beginRide(holder: RideHolder)` (required): `{ holding: string; letGo(): void }` — so a
  ride cannot take her without saying how to give her back (Next day, and check:exits' lever).
- `Player.endRide(exit: RideExit)` (required) `{x, y(floor), z, facing?, velocity?}`, and
  `teleportTo`/`teleport` too: all three run `putDownSpot` (world/dismount.ts, the one owner).
  It accepts a spot when: inside the play bounds; the floor there is within a step of the exit's
  floor (a seat is never her floor: SAME_FLOOR 5 cm); the body is clear at that height; and a
  bounded flood on the router's own lattice (navLattice.ts, 0.5 m cells, routeBlocked =
  NavGrid's stamp) reaches the space's open area — an anchor from `World.openAreaAt` (arrival,
  way out, keepOutsFor stand spots), or 6 m from the start, or the window's edge. Else 0.25 m
  rings out to 4 m for the nearest spot that passes. An exit that passes is left exactly as given.
  Cost: 43² = 1,849 cells at most; measured 1.8-2.0 ms average, slowest 13.5 ms, over 541.
- Chairs: no per-chair stand spot (reverted). standUp's exit is the seat; the rule moves her.
- Next day: Hud pill → Game.nextDay (closes UIs, abandons mini-game, letGo) → World.nextDay →
  Hotel.wakeTomorrowInSuite (changeTo; behind the iris: clock to DAY_START_TIME + day+1, every
  building lets her go, key given if none, Yours! star, bound to SUITE, middle bedroom's bed,
  nap; NEXT_DAY_WAKE_SECONDS later the existing wakeNap stands her up).
- `/hotel-cafe` deep link: `Hotel.requestEnterCafe` sits her at lobby-a-1 (falls back to the
  `/hotel` landing if that chair is ever gone or taken, never another chair).

## Red proofs (red worktree `.claude/worktrees/hotel-unstick-red`, /tmp/hotel-unstick/red/*.log)
A breakfast bypass (seat, airborne, as main) → a-1/b-1/b-0 judged trapped + the position write
flagged. B rule bypassed → clauses b/c/e + a-1, b-1, garden painting. C1 no clock → 16 ✗.
C2 corridor → 16 ✗. C3 never wakes → 16 ✗. C4 wrong bed → 16 ✗. C5 no key → keyless ✗.
D (check:hotel probe 32) table without a top → hop ends (-11.42, 0, 10.60), top y 0.000.

## Review of #721 (comment 6234387718, "changes requested") — answered on this branch
1. Key's reason was false: without it she is locked OUT of her suite once she leaves it (the
   suite's door out has no lock; the corridor's door in is suiteLock). Hotel comment + check
   clause (keyless Next day → out to the corridor → back in) — 6f76d4e2. Red: no key → locked out.
2. Pets unchecked: check:exits builds a real Parade like Game (hotel + castle wired, router set),
   buys two pets before the park; asserts asleep in their beds while she sleeps and at her heels
   3 s after she wakes — 6f76d4e2. Found Next day woke her before pets from the park reached bed:
   nap(bed, petsAsleep=true) enters their bedtime at its end. Red: M3 (standPetsDown after nap).
3. Flood ≠ router: NavGrid.around (same lattice over a window, same rebuild code) + floodFrom;
   copies (routeStamp, routeBlocked, navLattice.ts) deleted; World.routeConnectors/
   routeBridgeCovers/putDownSpace one owner — 7a948d2e. New clause 2b: 2,946 standable points the
   router walks out of, 0 moved; on the copy 38 of 322 bridge points moved (≤ 2.00 m).
Minors: hotel landings named (1aa734ae), window cells exported (7a948d2e), parkFacts passes
putDownSpace (7a948d2e), restore order (1aa734ae), /spawn logs a move (7ffe107e).
Finding: with 2 pets the suite's bedroom-0 pet bed sits 0.63 m from the painting's stand spot
(overlap 0.84 m); the rule moves her 1.00 m off it on "See the painting"'s exit.

## Round 3: QA "not approved" (6235898833) + re-review "changes requested" (6236273370)
Re-review — 2ca1efe6 (dismount: clause 4 starts only from a cell she walks to: nearest standable
within START_REACH 1.5 m, floor within a step, swept body clear; cost worded "about 6 ms, slowest
a frame or two"), b2323d20 (check:exits rule (g) sealed boxes 0.66/0.72/0.80; judge walks a real
Player away 8 ways 2.5 s ≥ 1.5 m; 2c sweep: edge band, stride 3 interiors / 6 park, ~10,600 exits,
every off-lattice put-down walked ≥ 1.5 m; each visit asserts she is really in that space — a
walk-away at the slide's mouth once carried her into the park), ef811603 (Hotel.nap one doc).
Red on 503bd56f (debug copy, sections 1+2c verbatim): rule (g) LEFT INSIDE ×3; 2c 5 exits
(Reptile House (576.9x,-617.0x) 0.10–0.12 m, park (-12.01,-2.04,28.71) 0.28 m).
QA — 787b324f (Player: a wedge lets go of her — overlap > 5 cm for 0.5 s → teleportTo, i.e. the
put-down rule; counter wedgeRescues), 25dfabc6 (café: CAFE_TABLE_A x -9.7 spin 1.35, chairs E/W:
strip 1.68 m, north channel 1.95 m; a trough was tried first and left wedges + a pocket north of
the table — abandoned), ecc3c800 (check:hotel probe 33 + probe 32 rework + probe 31 lobby 22→12).
Probe 33 without the rescue found wedges: bathrooms (breakfast/garden/ocean), gallery sofas on
the deck (z −24.5), lounge sofa+lamp (±8, 7), chair b-1 corner; with it: 0 traps, all rooms.
Menu: style.css — drawer max-height = screen − 5.5rem − insets, column-wraps (no scroll: a
six-year-old sees every pill at once); scripts/check-menu-reach.mts (+ check:served-menu-reach in
shard 9, CHECK_MENU_REACH_URL in with-dev-server).
Mutation runner /tmp/hotel-unstick/run-mutations.sh (A café revert, B rescue off, M9) →
/tmp/hotel-unstick/mut-*.log; red check:exits on 503bd56f → red-exits-full.log.

## Red proofs, round 3 (logs in /tmp/hotel-unstick)
- menu: red on 503bd56f (menu-red.log: dex y 379–427, Map y 437–484 OFF-SCREEN at 844x390 and 667x375);
  green here (menu-2.log: second column dex/Map y 90–196). Screens pr721/12–15 on qa-screenshots.
- check:exits on 503bd56f (red-exits-full.log): rule (g) LEFT INSIDE ×3; 2c 5 exits 0.10–0.28 m.
- check:hotel on 503bd56f (red-hotel-33.log, copy with 503bd56f's café constants): probe 33 lobby 246
  ways in, breakfast 10, garden 4, ocean 42; probe 31 22 > 12; probe 32 7 walks off the tables stuck.
- mutation A, old café + rescue (mut-A.log): probe 33 lobby 123 ways into the strip, overlap 0.000.
- mutation B, new café, no rescue (mut-B.log): lobby 122, breakfast 10, garden 4, ocean 42.
  Sites (mut-B-sites.log): gallery sofas both sides of the deck (z −24.5, overlap 0.51), lounge sofa
  + lamp table (±8, 7; 0.26), and the bathrooms of lobby (12, 11–13; 0.06), Floor 1 (11, 9; 0.07),
  garden (11, −2.5; 0.67), ocean (−10, 3/6; 0.34/0.57).
- M9 (bridgeCovers off): exit 1, 2b "moved 25 of 2947". M10 (connectors off): exit 0 — no sampled
  point needs a connector on seed 5 (not traced why); reported as measured.

## Status
- [x] all of QA's and the re-review's asks pushed; CI green on c8c059ba (31 jobs); local re-runs on this
  source's own park: check:hotel OK, check:exits OK.
- [x] preview passes found two stacking faults of my own, both fixed and checked: the shut ☰ button over
  the open Cute-o-dex (d3f17f6f) and the "Have breakfast" chip over the open drawer's Map (9d3c96b6);
  check:menu-reach runs beside the café, hit-tests five points a pill, and opens the dex (red on each
  old CSS: menu-mut-z.log ×4 sizes, menu-mut-z2.log at 667×375).
- [x] 9d3c96b's preview loaded at 844×390 + desktop; screens pr721/16–21 on qa-screenshots.
- [ ] CI green on this head; post the PR body (/tmp/hotel-unstick/pr-body.md) and the answer comment
  (/tmp/hotel-unstick/answer-3.md); hand back.
