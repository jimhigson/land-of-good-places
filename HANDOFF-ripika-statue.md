# HANDOFF — ripika-statue (E5-statue)

Branch `feat/ripika-fountain-statue`, worktree `.claude/worktrees/ripika-statue`,
dev server port **5314**. Issue **#121** — large grey-stone RiPika statue in the
fountain's middle. Browser NOT owned; build-verified only.

**Status: build green (exit 0), ready for QA. No PR raised (per brief).**

---

## The decision that shaped everything

**The statue is not a model of RiPika. It is RiPika, built in a stone
colourway.** `createRipika()` now takes a `RipikaPalette`; the statue passes a
stone one.

A hand-authored statue would be a second RiPika, and a second RiPika has to be
kept in step with the first by hand forever — retune her head, change her ears,
repaint her face, and the statue silently becomes a statue of a mouse the park
no longer contains. Same failure class as the hood faces and the sky dome.

The brief called this "the most art-heavy item in the wave" and told me to
queue the Blender artist. I pushed back and the Overseer agreed after checking:
ART_DIRECTION.md:329 makes primitive composition *preferred*, not merely
default, and the Blender exemption at :334 is scoped to organic continuous
forms with hair as the paradigm case. A statue of an already-primitive-built
mouse is not that. **The artist was released from this item.**

---

## The research handoff you were given is WRONG on its key point

`HANDOFF-flowers-stars.md` says: *"The painted face is the one mesh whose
material has a `map`. Hide/dispose it and carve features as geometry instead."*

**That was true when written and is not true now.** The 31 July baked-face
rework moved RiPika's face into the **skull's own material and UV map**
(`ripika.ts`, `face.applyTo(skull)`). There is no separate face mesh.

Consequences if you follow the old note:
- you cannot hide the face — hiding it hides the skull;
- re-materialling the skull to grey **deletes the face entirely**, leaving a
  blank stone ball with remapped UVs pointing at nothing.

The Overseer has posted this correction onto issue #121 so it outlives us.

**The right answer** — and the one CLAUDE.md's own rule already demands — is to
**repaint the face in stone**, in the surface's own UV texture. Every face
colour now comes from the palette (`fill`, `nose`, `blush`), so a stone RiPika
gets a stone face. Not tinted (that leaves tomato cheeks), not hidden.

### The BackSide/`addOutline` trap never arises

The old note warns about hitting `addOutline`'s inverted-hull `BackSide` shells
when re-materialling. **That danger only exists if you build a yellow mouse and
then walk the tree recolouring it.** Building in stone from the start means
`addOutline` reads each mesh's own stone colour as it goes and ink-tints it
correctly. There is no second pass, so there is nothing to fall out of sync.
This is why the palette approach is not just tidier but structurally safer.

---

## Two live traps found on the way

1. **`ART.blush` pink tongue.** The `happy` expression's `bigSmile` mouth fills
   a tongue with `ART.blush` (`faces.ts:259`). **A stone statue must never use
   it.** The statue uses the neutral `cat` mouth, which strokes in ink only.

2. **`setWalkPhase` flattens RiPika's tail.** `ripika.ts`'s
   `setWalkPhase` ends with `tail.rotation.z = sin(...) * 0.18 * speed`, which
   at `speed = 0` sets the tail's rotation to **0** — destroying the authored
   `1.05` rad cant set at build time. That cant is deliberate and documented
   ("a tail tucked behind the body is invisible at every camera angle the game
   ever uses, and RiPika without its flash is just a yellow mouse").

   So every RiPika in the park loses her tail flash the moment she stands
   still. **This looks like a live bug in the shipped mouse, not just my
   problem.** Fix is one line — `tail.rotation.z = 1.05 + sin(...)`— but I left
   it alone: fixing live animation inside a statue PR muddies the review.
   Reported to the Overseer for assignment. The statue sidesteps it by not
   calling `setWalkPhase` at all (a fresh `createRipika` is already neutral).

---

## What was built

| File | Change |
| --- | --- |
| `src/art/models/ripikaStatue.ts` | **new** — `createRipikaStatue()`, the whole statue |
| `src/art/models/ripika.ts` | `RipikaPalette` + `RIPIKA_PALETTE`; `palette` and `expressions` options |
| `src/art/style/faces.ts` | **new** `applyStaticBakedFace()` — one-canvas baked face |
| `src/art/style/artPalette.ts` | `ART.statueStone` + its four tonal steps |
| `src/world/Fountain.ts` | statue replaces the finial + spout; disposed in `dispose()` |
| `scripts/check-baked-face.mts` | statue registered (the list is hardcoded — no auto-discovery) |
| `art/samples/main.ts` | off-lineup exhibit, `?only=statue` |

### The stone colour: `ART.statueStone` = **`0xd3cacb`**

One named colour, with four tonal steps derived from it — not seven greys.
Full reasoning is in the comment at the definition; the short version:

- **Not neutral, on purpose.** A neutral grey next to `PALETTE.stonePink`
  (0xffc2d8) reads as a hole punched in the picture — nothing else in this park
  is desaturated, so a desaturated object looks like missing texture rather than
  stone. R 211 / G 202 / B 203: a nine-point red lift carries the park's warmth,
  and blue one point over green tips it to the faintest **rose** rather than
  cream. It reads unmistakably grey, while belonging to a park whose masonry is
  pink.
- **Light, not dark**, checked against §6's authoring light. The toon ramp's
  darkest band is ~68% perceived, so starting dark leaves the shaded side muddy;
  and at night the statue's only real light is the fountain's cyan `PointLight`
  *below* it, which a light stone takes as pale carved rock and a dark stone
  swallows.
- The plinth reuses `statueStoneMid`/`statueStoneDeep` rather than its own pair.
  Same rock, cut into blocks — one fewer place to acquire a second, slightly
  different stone.

### Why the stone is a ladder, not one flat grey

`ART.statueStone*` is ordered by **the luminance of the colour each step
replaces** (belly → yellow → yellowDeep/bolt → tip). The cocoa ear tips, cream
tummy and amber tail tip survive the trip to stone as tonal steps. Collapse
them to one grey and the statue reads as a lump at play distance — the exact
failure the cream tummy exists to prevent on the live mouse. All five are warm
plum-greys, never blue-greys, and the darkest stays well clear of `PALETTE.ink`.

### Why `applyStaticBakedFace` exists

`createBakedFace` paints **five** 512² canvases so a character can blink and
beam. A statue does neither, and four unused textures is a tenth of the park's
entire budget ("under 40 distinct canvas textures", ART_DIRECTION §7). It is
the same two steps as `createBakedFace.applyTo` (`remapSphereFaceUv` +
`paintFaceOnFill`) with the expression set left off — not a second way of
putting a face on a head. It sets the same `bakedFace` flag, so it is checked
identically.

### Numbers (all measured against the fountain, not assumed)

- Plinth base sits on the **bowl water surface, y 2.17** (`bowlWater` spans
  2.11–2.17). Statue origin is the plinth base, so that one number is the whole
  placement — no fudge factor.
- Plinth 0.36 m tall, three dressed courses, widest radius **0.82 m** against
  the bowl water's 1.2 m disc.
- Figure **1.70 m** ear-tips, scale derived from `ripika.height` at runtime so a
  retune of RiPika cannot make the statue drift.
- Total handle height **2.06 m** → tops out near **y 4.23** world, level with
  the fairy poles. Taller starts occluding the plaza ring from the iso camera.
- Six jets occupy y 0.80–2.10 at r 1.22. Plinth starts 0.07 m above them and
  0.40 m inboard. **Clear.**
- **No collider.** Plinth base is 2.17 m up, well over `Player.ts`'s documented
  1.4 m jump ceiling. The central column below has never had one either.

### Pose

Right arm raised mid-wave (`rotation.z = 1.3`), head tipped 0.07 towards it and
turned −0.12 off dead-ahead. The asymmetric silhouette is what decides whether a
six-year-old recognises her from across the plaza, and ART_DIRECTION §4 wants
nothing plumb. **Not** `setWalkPhase(0, 0)` — see trap 2 above.

---

## Verification done

- `npm run build` → **exit 0** (full 26-check gauntlet + vite build). Not piped.
- `npm run check:baked-face` → statue passes the ray cast: skull hit first at
  both eyes and the mouth, back of head on the plain border. This also proves
  the raised arm does not occlude the face.
- **No procgen change**, so no invariant is owed: the statue is a fixed child of
  `Fountain`, `test/procgen/invariants.ts` has zero fountain references, and
  `check-park.mts:834` explicitly exempts the fountain from the reserved-plot
  rule.
- Nothing outside `Fountain.ts` referenced the finial or spout (both were
  unnamed locals) — verified by survey before removing them.

### Environment gap, pre-existing

`npm run test:procgen` fails with `vitest: command not found` — **vitest is in
`devDependencies` but not installed** in `/Users/jim/dev/landOfGoodPlaces/node_modules`.
The worktree has no `node_modules` of its own and resolves up to the shared
checkout's. Not caused by this branch; CI installs deps properly so it will run
there. I installed into my own worktree to verify rather than touching the
shared checkout.

---

## Dev server

`npx vite --port 5314 --strictPort`, started from this worktree.
**npx wrapper PID 3976, listening node PID 3995.** Kill only those two by PID —
never `pkill -f vite`, which took out Jim's own long-running servers on 28 July.
`lsof -nP -iTCP:5314 -sTCP:LISTEN` re-finds it if the PIDs go stale.

## What QA should look at (port 5314, private window)

The statue is **in the middle of the central plaza fountain**, standing on the
upper bowl of water where the stone ball used to be.

1. **Day.** Walk up to the fountain. She should read as RiPika instantly —
   yellow mouse silhouette, ears, tail flash, one arm waving — but in warm grey
   stone. Cheeks are grey discs, **not** tomato red. Face is present and
   painted, not a blank ball.
2. **Silhouette at play distance.** The real test: stand back across the plaza.
   Still recognisably RiPika?
3. **Night.** The fountain's existing `PointLight` sits at y 1.2, below her, so
   she should be gently **uplit in the water's cyan** — no new light was added.
   Check she reads after dark and the uplight looks deliberate.
4. **Jets.** Six water jets still arc from the bowl to the basin. Nothing should
   clip or pass through the plinth.
5. **Wade in and jump.** Wading, splashes and the jumpable rim are untouched;
   confirm the statue is not reachable or blocking.
6. **Walk a full circle.** The tail flash and the raised arm should stay legible
   from every angle; nothing pops or z-fights against the bowl water.
7. `art-samples.html?only=statue`, ideally beside `?only=ripika`.

---

## State

- [x] stone palette ladder
- [x] `RipikaPalette` plumbed through `createRipika` / `buildRipikaHead`
- [x] `applyStaticBakedFace` one-canvas path
- [x] statue asset, plinth, pose
- [x] fountain placement, finial + spout removed, disposal wired
- [x] `check:baked-face` + art gallery registered
- [x] `npm run build` exit 0
- [ ] visual QA (not owned — dev server left running on 5314)
- [ ] PR (deliberately not raised; Overseer's call)
- [ ] **separate issue**: RiPika's tail cant flattened by `setWalkPhase`

---

# UPDATE — 5 Aug, after Jim's review

**Jim saw v1 on 5314: "far too small, make it 4x this size, otherwise is ok."**
Everything else passed — stone colour, face, silhouette, placement. Only scale.

## What changed

- Figure **1.70 → 6.80 m**, plinth **0.36 → 1.44 m**, total **8.24 m**,
  topping out at world **y 10.53**.
- **The plinth could not scale 4x in radius.** It stands on the bowl's 1.2 m
  water disc; 4x of 0.82 m is 3.28 m, which overhangs into mid-air. So it is
  4x tall and ~1.4x wide, capped at `PLINTH_BASE_RADIUS = 1.15`.
  That turns out to be what the figure wants anyway — her feet span ~2.14 m and
  torso ~2.28 m against the plinth's 2.30 m. A true 4x plinth would have been
  far too wide.
- Courses are now **fractions** of `PLINTH_HEIGHT`/`PLINTH_BASE_RADIUS`, because
  the two grew by different factors.
- Plinth outline weight now derives from `figureScale` (`0.014 * figureScale`,
  ≈6.5 cm at 4x). A literal 0.02 would have looked like a pencil line bolted to
  a woodcut.

## Measured clearances at 4x (all re-measured, none assumed)

- Whole statue spans x ±2.48, z −3.23…+2.26 → greatest reach in plan **3.23 m**,
  **inside the fountain's own 4.2 m rim**. It overhangs the basin, not the plaza.
- **Jets unaffected at any scale**: statue base y 2.17, jets top out y 2.10. It
  never reaches them vertically, so their radius stopped mattering.
- Still no collider, still unreachable: base 2.17 m vs the 1.4 m jump ceiling.
- **It is now taller than the castle walls (8.8 m).** Follows from 4x; right for
  a mascot centrepiece, but a real skyline change Jim did not explicitly ask for.

## THIS BRANCH IS NOW REBASED ONTO `fix/ripika-tail-cant`

Not optional, and not incidental. The statue displays RiPika's **authored rest
pose**, so the tail change alters its silhouette. Resizing against the old
sideways tail would have had Jim approve a silhouette that then changed
underneath him. The `ripika.ts` conflict (palette block vs tail constants) was
purely additive and is already resolved — both sides kept.

**So this branch cannot merge before the tail branch.**

## Open visual question — flagged to the Overseer, not yet resolved

At 4x the old tail stuck out **3.49 m sideways** and was the widest thing on the
statue. The new rear tail projects, through the 38° iso camera, to screen height
~4.5 (head ~6.6, feet ~1.1) but only **0.12 m off-centre horizontally** — i.e.
almost directly behind the torso on screen. **It is a weaker silhouette cue than
the sideways version.** Shipped as Jim asked rather than quietly softened.

One-line knob if he wants some read back without going sideways again:
`TAIL_YAW` 0.12 → ~0.35 rad swings the tip ~0.93 m off-centre, still clearly
"behind her". In `src/art/models/ripika.ts`.

---

# PLAZA SURVEY — 5 Aug. Read this before touching the height.

Measured on the **built park** via `park-harness.mts`. Statue top is **y 10.68
world** (I previously said 10.53 — I conflated fountain-local with world by
`terrainHeight` 0.275).

## I was wrong about occlusion. The camera is ORTHOGONAL.

I justified the 4x height by arguing "the camera follows the player, so the
statue only ever hides the far side of a plaza the player is already standing
in". **False.** An orthographic projection has no parallax, so the occluded
wedge is **fixed in world space** — moving the camera changes whether that patch
is on screen, not *what* is hidden. The player can stand in it.

- A 2.12 m player is **fully hidden within 10.60 m of the fountain centre**,
  past the 9.4 m kerb — **32.8 m² of walkable ground** (x −3.0…5.0, z −0.2…7.8).
  At 1.70 m it was 2.70 m, i.e. inside the basin, i.e. never.
- **`FoliageFade` does not save us**: it accepts trees only
  (`src/world/FoliageFade.ts:44-46`). Its own header cites design feedback #16,
  "no more rotating round a tree that's in the way" — this is that complaint,
  returning.
- **Two pickable flowers permanently occluded**: `flower:88` (−1.2, −0.7),
  `flower:294` (−2.5, −1.0).
- **Name labels clip**: `src/ui/NameLabel.ts:60-73` leaves `depthTest` true.

The comment in `ripikaStatue.ts` has been **corrected, not deleted** (commit
`4e865a0`), because it is a tempting mistake.

## Ring road survives by 0.58 m — coincidence, not margin

Occluded wedge reaches 13.32 m; ring road's nearest approach is 13.90 m.
**~5% more height and the road goes behind the statue.** Otherwise clean: 0 of
14 routes occluded, all 11 doormats visible, all stalls/lamps/poles visible.
Chips and signs are DOM, never occludable.

## Sky Cruiser: the statue is now an obstacle nothing knows about

Track crosses the plaza at y 7.06–7.33, **4.78 m** from the statue axis. The
statue reaches 10.68 — it now stands **3.5 m above the track it used to sit
2.5 m below**. Measured min 3D distance, track centre line to statue geometry:
**2.76 m**, inside the generator's own `CORRIDOR_RADIUS = 3`. Passes
`CAR_HALF_WIDTH = 0.75`, so nothing fails today.

`test/procgen/invariants.ts:903-910` is now factually wrong:
`TOO_TALL_TO_FLY_OVER = ['building', 'ferrisWheel']`, commented as "those two
are therefore the only horizontal obstacles the loop actually has". The route
solver (`src/world/coaster/route.ts:178-185`) and the boot assert
(`route.ts:576-615`) share that hard-coded list. **Riders fly past the statue's
chest and nothing measures it.**

## Other measured effects

- **Zoom**: at `CAMERA_ZOOM_MAX` 2.4 the statue is **122% of the frame** and
  cannot fit on screen. 51% at zoom 1.
- **Shadow**: **19.1 m at the game's own start time**, across the ring road.
  Crosses the kerb whenever the sun is below 47.9° — most of the day. Shops
  unreached (nearest stall 17.2 m).
- Taller than the castle curtain wall (9.24) and battlements (10.29); only the
  towers (17.15), ferris wheel (18.82) and Rail Race rings (18.30) beat it.

## Recommendation (sent to the Overseer, NOT actioned)

Keep 4x — Jim asked for it and it is right for a mascot — and **make the statue
a `FoliageFade` occluder**. That fixes the only finding that actually hurts play
without shrinking what he asked for, and the flowers and name labels fall out of
the same fix. Separately, the Sky Cruiser wants an invariant measuring the
**built scene's** bounding volume rather than a hard-coded id list.

Neither started. Height is Jim's call; the Sky Cruiser invariant may belong to
whoever owns that ride.

---

# UPDATE — the statue now gets out of the way

Approved by the Overseer: keep 4×, fix the occlusion. Done.

## Widened to a category, not special-cased

`FoliageFade` now has **two** kinds of occluder, split by *how a thing fades*:

- **instanced foliage** — needs the existing stand-in pool, because an
  `InstancedMesh` has no per-instance opacity. Untouched.
- **`SightlineOccluder`** — anything owning its own meshes, which can just turn
  its own materials down. Registers via `FoliageFade.addOccluder`, is handed an
  alpha, and this file never learns what it is.

Wired in `Game.ts`, not `Fountain.ts` — the fountain has no business knowing
about the camera. `Fountain` just publishes `statueOccluder`.

`SightlineOccluder` is an upright **capsule**, not a tree's sphere. One sphere
round an 8.24 m statue needs ~4.4 m radius and would fade whenever anyone
walked near the fountain. A tree is the degenerate case (`halfHeight` 0).

## `check:statue-occlusion` — in the build, 0.25 s

Grid-sweeps 985 m² at 0.25 m, raycasts a 2.12 m player's head/chest/waist along
the camera axis into real geometry, and separately replicates the fade test.
**HIDDEN AND NOT FADED must be zero.**

Deliberately does **not** import the function under test — the HIDDEN side is a
raycast, the FADED side is rewritten from `FoliageFade`'s constants. A proof
that imported the thing it tests only proves it agrees with itself.

**Verified to bite**: at `SWEEP_R=1.2` it exits 1 and names the ground.

## Writing the proof found two bugs in the fade I had just committed

Neither was visible by reading it.

1. **Cheap reject too tight — 1.5 m² still vanished a child.** I had
   `reach = NEAR_PLAYER_RADIUS + radius`, generalising the tree path by *girth*.
   Girth is the wrong dimension: at a 38° camera, a point H above the player's
   head hides them from ~1.28·H further away. Statue top is ~8.3 m over a
   child's head ≈ 10.6 m reach, against the 11.4 m allowed; failures were all at
   11.7–12.7 m. Now `+ 2 * halfHeight`.
2. **`OCCLUDER_RADIUS` was nearly double what was needed.** I guessed 2.4.
   Swept: `0.8→3.5 m² · 1.0→1.3 · 1.2→0.4 · 1.4→0 · 1.6→0 · 1.8→0`.
   **1.4 is the true threshold; shipped 1.8** for ~29% headroom. Failure modes
   are asymmetric — too small vanishes a child, too large fades slightly early,
   which `SIGHTLINE_MARGIN` already does for every tree.

**Result: 28.1 m² hidden → 0 m² hidden-and-not-faded.**

## The two flowers and the name labels

- **`flower:88` (−1.2, −0.7) and `flower:294` (−2.5, −1.0): resolved.** Probed
  both: `fades=true` at each. They read as occluded from across the plaza
  (they are ground-height), but the moment the player walks to them the statue
  fades. The "Pick!" chip is DOM and was never occludable anyway.
- **Name labels: resolved as a side effect, reasoned but not visually
  confirmed.** `setFade` drops `depthWrite` with `transparent`, so a faded
  statue stops writing depth and the sprites behind it draw. While the statue
  is solid, a label behind it still clips — which is *correct* occlusion, not
  the bug. **QA should confirm visually.** `NameLabel.ts`'s `depthTest: true`
  was NOT changed — fixing it silently under a statue commit would have been
  wrong, and it is not needed.

## What I deliberately did NOT do

`setFade` does not touch `castShadow`. I wrote that version first and it was
wrong twice: `addOutline` authors its hulls `castShadow = false`, so a blanket
restore switches shadows **on** for meshes that must never cast one; and a 19 m
shadow blinking out as a child steps behind the statue is a worse artefact than
the shadow. Shadow behaviour is a separate question.

## Still open

- **Sky Cruiser clearance** — assigned to the engineer who owns `route.ts`.
  Track passes 4.78 m horizontally, min 3D distance **2.76 m** against
  `CORRIDOR_RADIUS = 3`; rider's eye ~8.07 m, level with the statue's chest.
  `invariants.ts:903-910`'s `['building', 'ferrisWheel']` comment is now false.
  **If their invariant lands and measures the built scene, this statue may fail
  it. That is the correct outcome.**
- `TAIL_YAW` holds at 0.12 pending Jim.
