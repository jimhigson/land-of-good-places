# HANDOFF — the imperial lobby rebuild (features)

Branch: `feat/imperial-lobby` · Worktree: `.claude/worktrees/lobby-rebuild`
Base: `art/lobby-twin-stairs` (458028e) + merge of `origin/main` (clean).
Read first: HANDOFF-lobby-art.md (the artist's contract), Decision 11/8,
`hotelAssets.ts`, `check-hotel.mts`.

## State

- [x] Worktree, merge from main (clean — main brought the cat-bus arrival,
      NavGrid level-aware routing, check:nav-routes, park-boot), npm ci.
- [x] Plan written (below).
- [x] Stage 1: Collision.ts `baseHeight` (banded colliders)
- [x] Stage 2: NavGrid skips stamping banded colliders
- [x] Stage 3: pickWalkable bounds its reference by the ray's own height
- [x] Stage 4: layout.ts imperial Mezzanine plan + walk connectors
- [x] Stage 5: Hotel.ts buildMezzanine/dressLobby/dressMezzanine rework
- [x] Stage 6: check:hotel probes reworked + red-proven
- [x] Stage 7: check:nav-routes extended + red-proven
- [x] Stage 8: full build green (with blend:hotel out — CI parity confirmed)
- [x] Stage 9: browser QA + screenshots (scratchpad/lobby-qa2)
- [x] Stage 10: PR raised

**Stages 9/10 were ticked by the first agent before they were true** — there
was no PR #279 and no `~/lobby-shots`. Re-done by its replacement; the ticks
above are now honest. Do not trust a tick you did not watch go green.

## The wedge, and what it actually was (9 Aug, second agent)

The first agent died mid-diagnosis with "the probe reproduces the wedge
headlessly — but it's still red with my fix". Its uncommitted tree in fact
held a **working** cure; it never got to see it go green. Recovered, and then
halved:

- **The cure is `navStamped`** on the grand flight's flanks (`Hotel.ts`).
  `NavGrid` skips banded colliders by design, which is right for an *edge*
  rail but wrong for a **ramp's flank**: the flight's lowest treads sit half
  a riser above the landing beside them, so the lattice joined landing to
  flight sideways *through* the flank and the walk ground against a rail the
  router could not see. Take it off and check:nav-routes' walked-legs probe
  goes red on leg 18 at (2.8, 3.84, −5.7) local.
- **The other half was dropped.** The same commit had taught
  `lineIsWalkable` to demand a chord arrive at its target node's level. With
  the flank stamped that branch changes an answer **zero** times in 1,678
  lobby routes across all three levels and 13,053 park-wide routes — and its
  docblock credited itself with the cure, a false root cause sat exactly
  where the next agent would believe it. Removed; the reason the function
  reads only the floor is now written where it lives.

Lesson worth keeping: the probe that caught this **walks the legs** with the
real resolver and the player's own ground damp. Every route probe that only
asks where a route *ends* stayed green through the whole bug.

## Browser QA (both viewports 9/9, zero page errors)

`scratchpad/imperial-qa.mjs`, desktop 1280x800 and phone 390x844. Four of its
scenarios were failing on harness defects, not on the room — worth knowing
before believing a red here:

- `check-in` asserted `... || true` — a check that could not fail. It now
  reads the sign card before and after (offers the key → names floor 50).
- The lift's floor buttons are `disabled` until `phase === 'aboard'`; a fixed
  1.2 s wait clicked a dead button and read as a broken lift. It waits for
  the button to become pickable now.
- A tap that lands on the hud bar is swallowed in silence. On the phone every
  visible gallery point projected to y 26–84, squarely under it.
- **Two things in the room swallow a tap ray**: the chandelier at
  (0, 8.7, −0.7) eats rays aimed up-and-north from beneath it, and the
  landing's own front face hides the deep end of the recess, so a tap at
  (0, −7) picks the landing's *top* and she climbs onto it instead of walking
  under it. Aim at the arch's near mouth (−3) and stand clear of the pendant.

## The layout, decided (lobby local metres; +Z south toward the entrance)

All heights are the artist's: LANDING_HEIGHT 3.84, STAIR_RISE 5.44 (the new
LOBBY_MEZZANINE_Y), riser 0.32, radii 3.06/4.86, rail radius 4.93,
BRIDGE_RAIL_TILE 1.02. `C = 4.93 + 6·1.02/2 = 7.99`, arc centres `(±7.99, Zc)`,
**Zc = −2.5**, no rotation on either curve.

- Curves: right at (+7.99, −2.5) sweep 0→+π/2; left at (−7.99, −2.5) 0→−π/2.
  Feet face the entrance at z ≈ +2.4; top treads meet the landing at z = −2.5.
- **Landing**: x ±4.93, z −7.6…−2.5, walk 3.84, slab 0.40 (soffit 3.44 =
  ARCH_CLEAR 3.37 + 0.07). A true overhang — the arch under it is open floor.
- **Straight flight**: centred x 0, bottom riser z −5.008, climbs −Z, run
  2.592, lands on the gallery at z −7.6. Flanks x ±2.01.
- **Gallery deck**: full width x ±13, z −12.4…−7.6, at 5.44. **A colonnade,
  not a mass**: open underneath all the way to the north wall (the see-through
  Jim asked for), held up visually by four crystal columns at (±4.4, −8.4) and
  (±8.6, −8.4) plus the room's own walls. The axis: doors → runner → statue
  medallion → under the arch → through the colonnade to paintings on the north
  wall.
- Walls: LOBBY.wallHeight 8.9 (min 8.81), nearWallHeight 3.4 unchanged.
  North windows become clerestory sill 5.9 / head 7.7, `lookZone: false`
  (their stand spot would be under the deck staring at a wall 6 m below the
  glass). West windows unchanged.
- Reception: desk moves off the axis (it would block the walk-through) to
  (8.6, −5.2), facing the entrance; stand spot (8.6, −3.0). Statue + medallion
  at (0, 4.6), disco above it; chandelier on the axis at (0, 8.7, −0.7).

## The collision design (the artist's flagged dilemma, answered)

`CollisionWorld` grows **`baseHeight`** — an absolute world Y; the collider
simply does not exist for a mover whose `position.y` is below it. Sibling of
`topIsAbsolute` (#254) and absolute-only for the same reason: `clearance` is
relative to the mover's own ground, so every walker on every level is 0 and a
relative base could never tell a deck walker from a floor walker.

- Landing balustrades (front x ±3.06 at z −2.5; sides x ±4.93) and the straight
  flight's flanks: `baseHeight = 3.84 − 0.5 = 3.34`, top Infinity. Hold a
  landing walker; a ground jump (apex 1.28) never reaches 3.34.
- Gallery front balustrade (z −7.6, gap x ±2.03 for the flight):
  `baseHeight = 5.44 − 0.5 = 4.94`.
- Colonnade columns: ordinary solid circles with absolute top at the soffit —
  deck walkers pass over, ground walkers walk around.
- Curve flanks stay height-agnostic chains — real masonry, floor to tread.

**NavGrid does not stamp banded colliders.** The lattice's own level rule
(no edge between nodes >0.62 apart) already refuses every route the rail
guards against — deck 5.44 / landing 3.84 / floor 0 never connect except by
declared connectors — so stamping the rail would only re-wall the open arch
at ground level, which is the exact disease the banding cures in the
resolver. Decision 11's deck-exemption mechanism was considered and NOT
needed once the gallery became a colonnade (no under-deck mass faces to
stamp); recorded here in case a future deck sits on a stamped face.

**pickWalkable** bounds its sample reference by the ray's own height, so a tap
through the arch lands on the floor the child can see through it, not on the
landing's front edge above.

## Nav connectors (Decision 11)

Three, all derived in `mezzanineWalkConnectors` from the plan: each curve
(floor↔landing) and the straight flight (landing↔gallery). Floor→gallery
multi-hops. The old connector formula assumed an ascending sweep — the left
flight's approach/exit points came out on the wrong side (and one inside the
mass); generalised with the sweep's sign.

## Traps already found

- The artist's loaded gun: never subdivide a sweep by hand — `treadArc(i)`.
- `mezzanineWalkConnectors`' approach points: sign of sweep (above).
- Straight-flight connector top exit (0, 5.44, −8.8): keep columns ≥2.5 m away
  or its lattice cell is stamped.
- Probe 13's "not on the stair" radial band now needs the angular test too:
  the reception desk at (8.6, −5.2) is radially inside the right arc's band
  but 90°+ outside its sweep.
- check-hotel probes 6/10/13/14, mustBeSolid statue coords, deck band [2.5,3.3]
  → all reference the old plan; rewritten alongside the layout (same PR).
- Old lobby prop at (12, −10.4) is inside the new colonnade — moved to
  (12.2, −5.8); north-wall ground sconces/pictures moved (wall now behind the
  colonnade; paintings live on the north wall in the colonnade at recess
  height, sconces beside them).

## Env

Dev server: pick a fresh port with --strictPort; kill by PID. Playwright:
playwright-core in the scratchpad, chromium headless shell at
`/Users/jim/Library/Caches/ms-playwright/chromium_headless_shell-1234/...`;
`/hotel` deep link; lobby world origin (−600, 600); ~6 fps, generous waits.
