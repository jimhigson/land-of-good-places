# The 120 fps plan (frame drops, November 2026)

**The target is 120 fps: 8.3 ms per frame, everything included** — JS, render
and GPU, in every scene (CLAUDE.md, "The frame-rate target is 120 fps, not 60";
Jim, 12 Nov 2026). This document is the measured cause of every dropped frame
we could find, and a sequence of PR-sized steps to get under 8.3 ms, ranked
against that budget. It replaces the 11 Nov version of this file, which was
written against 60 fps.

Investigation only: no shipped code changed. Every number was measured on the
shipped build of `main` (at `dd23766c`, before #739/#745; the dash numbers are
from the build after #745, see [S-dash](#13-the-super-speed-dash-per-stride-collision)).
The harness is in [`frame-drops-2026-11-harness/`](frame-drops-2026-11-harness/).

## Where we are against 8.3 ms

| scene | CPU in frame, p50 / p99 (ms) | frames that missed a 120 Hz vsync | frames > 16.7 ms | verdict |
|---|---|---|---|---|
| park, walking (M4 Pro) | 7.4 / 8.3 | 0.2 % | 0.1 % | **0.9 ms of headroom — no room for any feature** |
| long run | 7.4 / 8.3 | 0.1 % | 0.1 % | same |
| library, story time | 5.9 / 10.8 | 0.7 % | 0.3 % | **483–649 ms freezes** (nav grid) |
| reptile house | 6.9 / 7.8 | 1.5 % | 1.3 % | **GPU-bound** bursts (11 point lights) |
| castle | 6.9 / 7.6 | 0.1 % | 0.1 % | 158–191 ms freeze on entry, 107 ms shader link |
| Rail Race | **9.1 / 10.1** | **14.4 %** | 4.0 % | **over budget every frame** (98.6 % of frames > 8.3 ms CPU) |
| Sky Cruiser | 6.3 / 7.4 | 0 % | 0 % | fine |
| *phone stand-in*, park | *31.0 / 43.0* | *100 %* | *99.9 %* | *3.7× over budget* |
| *phone stand-in*, library | *27.8 / 82.5* | *99.9 %* | *99.3 %* | *plus two 2 s freezes* |

"Missed a vsync" = frame interval > 12.5 ms on the 120 Hz display (a frame
that should have been 8.3 ms and was 16.7 or more). *Italic rows are a stand-in,
not a phone*: desktop Chrome, 390×844 viewport, **4× CPU throttle**, the GPU
still an M4 Pro. They say how far the CPU side is from budget on a slower CPU;
they say nothing about a phone's GPU, thermals, or Safari. A real-phone
baseline is step 0 below.

**Read the top row carefully.** The park does not drop frames on Jim's Mac
*today* only because it fits in 7.4 of 8.3 ms. Every feature since has had to
fit into the remaining 0.9 ms, and the next one will not. The plan's first job
is to buy that headroom back.

## The answer in five lines

1. **Not GC.** Minor GCs cost 1.5–3.1 ms per second, worst pause 6.0 ms, zero
   major GCs in any window; GC was the main cost of 0 dropped frames. Allocation
   (113–170 MB/s) is still worth cutting — it is ~1 % of the budget on an M4 and
   more on a phone.
2. **We draw and update a great deal nobody can see.** 71 % of the scene graph
   is hidden interiors that are matrix-updated every frame (−1.9 ms measured
   when detached); the castle banquet animates 24 diners in every space
   (~1.0 ms); the NPC crowd is `frustumCulled = false` and is drawn — 1.7 M
   triangles — when she is inside the reptile house 844 m away; one instanced
   mesh of 1,093 bushes has a 95 m bounding sphere, so **10,771 off-screen
   instances (2.2 M triangles) are drawn** every frame in the park.
3. **The big freezes are a synchronous NavGrid lattice rebuild**, triggered by
   the owl's *moving* collider bumping the global collision revision: 483–649 ms
   on the M4 Pro, ~2 s on the phone stand-in, twice per story time.
4. **The GPU limits the reptile house** (11 point lights; hiding them or
   rendering at pixel ratio 1 removed every GPU-bound drop) and, on a phone, will
   limit everything: 3.7 M triangles a frame where the crowd alone is 45 %, at
   ~70 k triangles per 23-pixel-tall child.
5. **The Rail Race is over budget on CPU** — 1,328–1,955 draw calls, mostly the
   park's stalls, fairy lights and props seen from the first-person camera, not
   the track itself.

---

## Contents

- [The sequence: PR-sized steps](#the-sequence-pr-sized-steps) — the plan, with ms per step
- [Dependencies and parallel work](#dependencies-and-parallel-work)
- [Item by item](#item-by-item) — cost, gain, risk, visibility, check
- [Measurement: phones, guardrails](#measurement-phones-and-guardrails)
- [How it was measured, and the controls](#how-it-was-measured)
- [Raw results](#raw-results)
- [Re-running it](#re-running-it)

---

## The sequence: PR-sized steps

Desktop gains are ms per frame at 120 fps on the M4 Pro (park unless named);
"stand-in" is the 4× throttled CPU, ≈ 4× the desktop ms. **M** = measured by an
in-place experiment on the shipped build; **E** = estimated from the profile
share. "Jim sees it?" — whether the change is visible to a player (CLAUDE.md:
visible changes wait for Jim; invisible ones merge after QA).

| # | step | gain (desktop) | where it bites | risk | Jim sees it? |
|---|---|---|---|---|---|
| **0** | **Measurement first**: `?perf=1` overlay + real-phone baseline; count-based CI budget checks (scene size, material churn, nav rebuilds, alloc/frame) | — | everything after it | none | no |
| **1** | **NavGrid: incremental rebuild; moving colliders never trigger a full rebuild** | removes 483–649 ms freezes (stand-in ~2 s) and the 158–191 ms castle-entry freeze | library, castle, any space change | low–medium | no (a freeze goes away) |
| **2** | **Detach hidden interiors from the scene graph** | **−1.9 ms M** (7.7→5.8); stand-in −5.8 ms M | every scene outdoors; each interior when the others are hidden | medium | no |
| **3** | **Don't update what isn't drawn (simulation LOD, part 1)**: banquet, wild pets, reptile cases, library children only while their space is drawn | **−1.0 ms E** (banquet 115 ms/s) | every scene | low | no |
| **4** | **The crowd is culled**: hide the park crowd when she is in another space; give crowd instanced meshes a live bounding sphere (or per-chunk meshes) so `frustumCulled` can be on | GPU: −1.7 M tris indoors (M, counted); −0.7 M tris in the park (38 crowd meshes wholly off-screen, M) | reptile house, library, castle, hotel; park | low–medium | no |
| **5** | **Stop per-frame `material.needsUpdate`** (faces, reptile head, rainbow boa case, fountain droplets) | −0.12 ms E, −9.5 MB/s M | everywhere | very low | no |
| **6** | **Deterministic `Math` allocation-free** (`Float64Array` for the reduced argument) | −0.1–0.2 ms E, −41 MB/s (30 % of garbage) M | everywhere | low | no |
| **7** | **Cheaper ground sampling** (`Hotel.covers` without `Math.hypot`, squared-radius reject) | −8 to −16 MB/s M; makes step 1's rebuild ~25 % cheaper E | NPC routing, dash | very low | no |
| **8** | **Shader precompile for every space** (castle, library, reptile house, hotel, rides) | removes 107–150 ms first-entry links M | first entry to each space | low | no |
| **9** | **Load hitches**: AudioContext on first gesture; GLB decode / texture upload off the frame | removes a 168 ms frame M; see item 19 | first sound, first entry | very low | no |
| **10** | **Chunk the big instanced meshes** (bushes, fairy bulbs, flowers) into spatial tiles so frustum culling works | GPU: −2.2 M tris in the park (10,771 off-screen instances, M); CPU ±0 | park, rides | low | no |
| **11** | **Simulation LOD, part 2: NPCs off-screen update less often** (pose every 4th frame, route steering every 2nd; no `commit` for off-screen members) | −0.3–0.4 ms E (NpcSystem 69 ms/s) | park | medium | barely (off-screen only) |
| **12** | **Shadows: cadence + caster budget** (re-render the sun's map when the sun has moved or a static caster changed; dynamic casters near her only; drop 455 casters under 35 cm) | **−1.0 to −1.2 ms CPU M**, ~half the draw calls M | every outdoor scene | medium–high | **yes** |
| **13** | **Static scenery matrices** (`matrixAutoUpdate = false` for props placed once) | −0.3–0.5 ms E (after step 2) | park | low per prop, wide | no |
| **14** | **Rail Race: merge static props per area** (stalls 333 draws, fairy lights 243, anchor plots 186, scenery 155 — all seen from the cart) | −2 to −3 ms E (to ~6 ms) | Rail Race, Sky Cruiser, all first-person rides | medium | no if pixel-identical |
| **15** | **Reptile House light budget** (≤ 4 dynamic point lights; the rest emissive / baked pools) | GPU-bound drops 11 → 0 M; GPU time −37 % M | reptile house | medium | **yes** (lighting) |
| **16** | **Crowd render LOD** (a low-poly crowd kid; ~70 k → ~8 k tris) — Blender-authored, see item 8 | GPU: −1.4 M tris per frame E | everywhere the crowd is | medium | **yes** |
| **17** | **Adaptive resolution** to hold 8.3 ms (DPR 2 → 1.5 → 1.25 when GPU-bound frames persist) | absorbs GPU spikes; reptile house at DPR 1: 0 drops M | GPU-bound scenes, phones | medium | subtly |
| **18** | **Allocation-free hot paths** (reptile `Curve.getPoint` 18.6 MB/s, Flowers, `greatHallSeats`, uniform arrays) | steady state < 30 MB/s | phones | low | no |
| **19** | **Frame pacing fixes** (ball physics' 60 Hz fixed step needs interpolation at 120 Hz) | judder, not ms | ball games | low | yes (smoother) |
| **20** | **Phone quality tier** (`isLowEndDevice` → shadow cadence, DPR, crowd LOD distance, light budget) | the lever for phones; size it from step 0's real-phone numbers | phones | medium | yes on phones |
| **21** | **Trees and props LOD, KTX2 / atlases** | small under the isometric camera (see items 8, 16) | memory, load time | medium | yes |

### What that buys, desktop park

| after step | CPU p50 (ms) | headroom to 8.3 |
|---|---|---|
| today | 7.4 | 0.9 |
| 2 (M) | 5.5–5.8 | 2.5 |
| 3 (E) | ~4.6 | 3.7 |
| 12 (M, on top of 2) | ~3.5 | 4.8 |
| 5, 6, 11, 13 (E) | **~2.8–3.0** | **~5.3** |

GPU side, park: from 3.7 M to ~1.0–1.5 M triangles per frame after steps 4,
10 and 16 (counts measured; ms not measurable here — see the GPU-timer control).

### What that buys, phone stand-in (CPU only)

| after step | stand-in ms | stand-in fps cap |
|---|---|---|
| today | 31 | 30 |
| 2 (M) | 25.3 | ~40 |
| 12 (M, on top of 2) | 21.9 | ~45 |
| 3, 5, 6, 11, 13 (E) | ~13–15 | ~70 |

**Honest conclusion for phones: the CPU plan alone does not reach 8.3 ms on the
stand-in**; it reaches ~13–15 ms. 120 fps on a phone additionally needs step 20
(a phone tier) and whatever step 0's real-device numbers say — and on an
iPhone it may not be reachable at all from the page: Safari has historically
capped `requestAnimationFrame` at 60 Hz on ProMotion iPhones by default
("Prefer Page Rendering Updates near 60fps"). Step 0 must check what the
family's phones actually deliver before anyone spends effort past 60 Hz there.

---

## Dependencies and parallel work

Which steps touch the same files (and so must be sequenced or done by one
engineer), and which can run at once:

| step | main files | depends on | conflicts with |
|---|---|---|---|
| 0 measurement | `scripts/check-*.mts`, `package.json` (check chain), `src/main.ts` (`?perf=1`) | — | any step adding a `check:` to `package.json` (resolve by parsing the chain, CLAUDE.md) |
| 1 NavGrid | `src/world/NavGrid.ts`, `src/world/Collision.ts` | — | 7 (`Hotel.covers` is the sampler NavGrid calls — different file, same hot path; measure 1 before 7) |
| 2 detach interiors | `Building.ts`, `hotel/Hotel.ts`, `library/Library.ts`, `reptileHouse/*` (the `interiorRoot` hide/show), `boot/shaderWarmup.ts` | — | **3** (Building.ts), **8** (shaderWarmup.ts), 7 (Hotel.ts, different function) |
| 3 undrawn updates | `building/greatHallBanquet.ts`, `Building.ts`, `WildPets.ts`, `reptileHouse/*`, `library/LibraryKids.ts` | best after 2 (same "which space is drawn" owner) | **2** |
| 4 crowd culling | `entities/npc/InstancedCrowd.ts`, `entities/npc/NpcSystem.ts` | — | **11, 16** (same files) |
| 5 needsUpdate | `art/style/faces.ts`, `art/style/sharedFace.ts`, `art/models/reptileHouseAssets.ts`, `art/effects/waterSplash.ts`, the reptile case | — | none |
| 6 deterministic Math | `src/core/deterministicMath.ts` | — | none |
| 7 ground sampling | `hotel/Hotel.ts` (`covers`), `building/surfaces.ts` | after 1 lands (so 1's gain is measured alone) | 2 (Hotel.ts, different function) |
| 8 shader warm-up | `boot/shaderWarmup.ts`, `journeyDirector`, interiors' entry | after **2** | **2** |
| 9 load hitches | `art/effects/puffSong.ts`, input layer; GLB loaders | — | none |
| 10 instanced chunking | `world/Foliage*`, `world/FairyLights.ts`, `world/Flowers.ts` | — | **14** (FairyLights.ts) |
| 11 NPC sim LOD | `NpcSystem.ts`, `NpcCharacter.ts`, `InstancedCrowd.ts` | after **4** | **4, 16** |
| 12 shadows | `world/DayNight.ts`, caster flags across art | — | none in code; visible → Jim |
| 13 static matrices | scenery placement (`Scenery.ts`, `AnchorPlots.ts`, stalls) | after **2** | **14** (stalls) |
| 14 Rail Race merge | stalls, `FairyLights.ts`, `AnchorPlots.ts`, `Scenery.ts` | after **10**, **13** | **10, 13** |
| 15 reptile lights | `reptileHouse/lighting.ts` | — | none; visible → Jim |
| 16 crowd LOD | `InstancedCrowd.ts`, Blender asset | after **4, 11**; needs the 3D Artist | **4, 11** |
| 17 adaptive DPR | `core/Engine.ts`, `core/device.ts`, `Game.ts` | best after 0 (needs the frame metric) | 20 |
| 18 alloc hot paths | `reptileHouse/*` curves, `Flowers.ts`, `greatHallBanquet.ts` | after **3** (banquet) | 3, 10 (Flowers.ts) |
| 19 frame pacing | `building/ballPhysics.ts` | — | none |
| 20 phone tier | `core/device.ts`, `DayNight.ts`, `Engine.ts` | after **0, 12, 16, 17** | 17 |
| 21 LOD / KTX2 | art pipeline | after 0 | — |

**Can start at once, one engineer each (no shared files):** 1, 2, 4, 5, 6, 9,
10, 12, 15, 19 — and 0. **Sequenced chains:** 2 → 3 → 18; 2 → 8; 2 → 13 → 14
(with 10 → 14); 4 → 11 → 16; 1 → 7; {0, 12, 16, 17} → 20.

---

## Item by item

Each item: **measured cost**, **expected gain**, **risk**, **does Jim see it**,
and **the check that holds it**. "ms/s" is main-thread ms per second of wall
time; divide by ~120 for ms per frame on the M4 Pro.

### 1. NavGrid freeze → incremental, never full, for moving colliders (step 1)

- **Measured.** In-trace CPU samples of the long frames: `NpcSystem →
  NpcCharacter.update → wanderDriver.updateJourney → journey.steer → plan →
  NavGrid.findRoute → ensureLattice → rebuild`, 93–95 % of the frame;
  inside it `surfaces.sample` 64 %, `Hotel.covers` 25–29 %, another `covers`
  17–23 %, `bridgeHeightAt` 7–9 %. **483, 516, 541, 649 ms** on the M4 Pro in
  the library; **1,958 and 2,027 ms** on the stand-in; **158–191 ms** on
  entering the castle; plus a 30–34 ms A* search on its own.
- **Why.** `ensureLattice` rebuilds when `collision.revision` or the play
  boundary changes. The owl's body box is `restoreBox`'d when she leaves her
  desk at story time and `removeBox`'d when she returns (`LibraryOwl.ts`), and
  each bumps the **global** revision — so a moving box in the library makes the
  next NPC route plan rebuild a whole lattice.
- **Fix.** Moving colliders (`addMovingBox` users: the owl, trains) do not
  invalidate the lattice at all; a static-collider change rebuilds only the
  cells under its footprint; a boundary change for a *different space* does not
  touch this space's lattice.
- **Gain.** Every frame over 100 ms measured in the library and castle.
- **Risk.** Low–medium: cell-border correctness of the partial rebuild.
- **Jim sees it?** No (a freeze stops).
- **Check.** `check:nav-rebuilds` (CI, no GPU): drive story time headlessly and
  assert **0 full lattice rebuilds**, counted by an instrumentation counter.
  Prove red on today's code first.
- **Later, if needed: a Web Worker.** The lattice is a pure function of the
  collision world and the ground sampler; it could be built in a worker from a
  serialised snapshot. Not needed once rebuilds are incremental; the ground
  sampler reads scene state, so a worker means duplicating it — keep as the
  fallback.

### 2. Hidden interiors detached (step 2)

- **Measured.** 6,411 of 8,943 scene objects (71 %) are invisible interiors
  while she is in the park: hotel 3,035, castle 1,837, reptile house 1,083,
  library 280 + 117 children. `scene.updateMatrixWorld` in render is **241 ms/s
  (2.0 ms/frame, 24 % of the main thread)**; three.js recurses into invisible
  subtrees.
- **Experiment.** Detaching those roots: **7.7 → 5.8 ms desktop (−25 %), 31.1
  → 25.3 ms stand-in (−19 %)**. Setting `matrixWorldAutoUpdate = false` on them
  instead changed nothing (7.8 → 7.8 ms) — the flag does not stop the recursion.
- **Fix.** The owner of "which space is drawn" removes the inactive roots from
  the graph and re-adds them (plus one `updateMatrixWorld(true)`) on entry.
- **Risk.** Medium: anything reading an interior's `matrixWorld` while she is
  elsewhere (colliders, labels, the shader warm-up) must be audited; unverified
  today.
- **Jim sees it?** No.
- **Check.** `check:scene-budget`: objects reachable from the scene in the park
  ≤ measured + 10 %; same per interior.

### 3. Not updating what isn't drawn — simulation LOD part 1 (step 3)

- **Measured.** `GreatHallBanquet.update` 115 ms/s desktop (0.96 ms/frame),
  121–138 ms/s stand-in (~13 % of the frame), in the park, reptile house (118)
  and library (113): `applyRidePose` + `InstancedCrowd.commit` (an
  `updateMatrixWorld(true)` per diner) for 24 diners nobody can see; plus
  5 MB/s allocation.
- **Fix.** Early-return unless the great hall's storey is drawn; one update on
  entry. Same audit for `WildPets`, reptile case animation, library children.
- **Risk.** Very low. **Jim sees it?** No.
- **Check.** In `check:scene-budget`: `InstancedCrowd.commit` calls per frame
  from undrawn spaces = 0.

### 4. Per-object frustum culling that actually works (steps 4, 10)

Audited on the shipped build: for every visible mesh, its world bounding
sphere against the game camera's frustum, and for instanced meshes every
instance individually.

| scene | meshes passing culling | of which `frustumCulled = false` | wholly off-screen but drawn | instances off-screen but drawn |
|---|---|---|---|---|
| park | 263 (2.38 M tris) | 82 (1.70 M tris) | **38 meshes, 0.69 M tris** | **10,771 instances, 2.17 M tris** |
| Rail Race | 1,671 (2.93 M) | 94 (1.71 M) | 1 | 3,506, 1.32 M tris |
| reptile house | 459 (2.12 M) | 82 (1.70 M) | **82 meshes, 1.70 M tris — the whole park crowd, 844 m away** | 5,115, 1.92 M tris |

- **The crowd** (`InstancedCrowd`, deliberately `frustumCulled = false` because
  its bounding sphere goes stale as children walk) is drawn in every space,
  including indoors. Fix: hide it when she is not in the park space; recompute
  each crowd mesh's bounding sphere when members move (cheap: 24 members) and
  turn culling on, or split the crowd into a few spatial groups.
- **Oversized instanced meshes**: `bushes` (1,093 instances, 95 m radius),
  `fairy-bulbs` (756, 81 m), the crowd parts (40–82 m), `rp-fern-frond` (348,
  28 m). One sphere covering the park cannot be culled. Fix: tile them (e.g.
  24 m chunks) — same draw count when all are in view, far fewer instances
  drawn otherwise.
- **Gain.** GPU vertex work: up to −2.2 M tris (park), −1.7 M (indoors).
  Absolute GPU ms is not measurable here (timer control under-reads); on a
  phone GPU this is the biggest single item. CPU ±0.
- **Risk.** Low–medium (pop-in if a chunk's bounds are wrong).
- **Jim sees it?** No, if bounds are right.
- **Check.** `check:cull-audit` (CI, no GPU): the audit above, as an
  assertion — off-screen-but-drawn triangles ≤ a ratcheted budget per scene.

### 5. Simulation LOD part 2 — off-screen NPCs (step 11)

- **Measured.** `NpcSystem.update` 69 ms/s desktop (0.58 ms/frame), 89 ms/s
  stand-in; `InstancedCrowd.commit` from it 16.7 ms/s. In the park view
  measured, 0 of the crowd kids were in the frustum.
- **Fix.** Off-screen members: steering every 2nd frame, pose every 4th, no
  `commit` (instances off-screen need no matrix). On-screen: unchanged.
- **Gain.** −0.3–0.4 ms E. **Risk.** Medium (a kid entering view mid-skip must
  snap to a fresh pose). **Jim sees it?** No (off-screen only).
- **Check.** A per-frame count of `commit`s for off-screen members = 0.

### 6. LOD — crowd, trees, props; imposters (steps 16, 21)

**Be honest about the isometric camera.** The park camera is a 9.5° FOV
perspective ~120 m away: the drawn triangles sit between **118 m (p10) and
144 m (p90)** from the lens. Distance-based LOD barely discriminates — almost
everything is at the same distance. What the camera *does* mean is that
**everything is small**: a crowd kid is **~23 px tall** at DPR 2, and is drawn
with **~70 k triangles** (crowd 1.67 M tris / 24 kids, the face patches alone
61 k per part mesh). So:

- **Crowd: one low-poly kid for the crowd, everywhere** (keep the full kid for
  her, close-ups, the story camera and first-person rides). That is
  screen-size LOD, not distance LOD — the gain is the full −1.4 M tris (E, at
  ~8 k tris per kid) on every frame. Author in Blender (3D Artist, headless
  script per CLAUDE.md) or decimate in code at load (`SimplifyModifier` on the
  prototype before instancing); the face patch must stay a UV texture, not a
  floating mesh. **Visible** → Jim.
- **Imposters for far crowds:** not worth it under this camera — there are no
  "far" crowds, and a billboard of a 23 px kid buys little over an 8 k-tri
  mesh. Revisit only for first-person rides (Rail Race, Sky Cruiser, FOV 44°),
  where depth range is real.
- **Trees and props:** `bushes` 197 k tris, `scenery` 268–324 k, `anchor-plots`
  256–316 k. Under the iso camera a uniform poly reduction is the only lever;
  under first-person rides, distance LOD works. Expected gain is small next
  to the crowd; do it after step 0 shows whether phones are vertex-bound.
- **Check.** Triangles per frame per scene ≤ budget (counted by the GL probe;
  no GPU timing needed).

### 7. Shadows: cadence, caster budget, map size (step 12)

- **Measured.** One 2048² VSM (radius 3, 10 blur samples, a 52 m × 52 m
  ortho frustum), re-rendered every frame: `WebGLShadowMap.render` 117 ms/s
  desktop (≈1.0 ms/frame), 138 ms/s stand-in; ~300 of the park's ~600 draw
  calls. 1,135 casters in the park, **455 of them under 35 cm** (158 k tris).
- **Experiments.** Map not re-rendered: **−1.0 to −1.2 ms CPU desktop, −3.4 ms
  stand-in** (on top of step 2). Map size 1024 and "small casters off" changed
  CPU by < 0.3 ms; their GPU effect was not resolvable (GPU timer noise during
  the run exceeded the difference) — so map size is a phone-GPU question for
  step 0.
- **Fix.** Re-render the sun's map only when the sun has moved more than ε or
  a static caster changes; dynamic casters (her, pets, NPCs, rides) into a
  small second map around the player; drop sub-35 cm casters from the shadow
  pass.
- **Risk.** Medium–high. **Jim sees it?** Yes (shadow quality and moving
  shadows) — prototype behind a URL flag and show him.
- **Check.** Shadow-pass draws per frame (GL probe counts framebuffer binds and
  draws per pass) ≤ budget; shadow re-renders per second ≤ N.

### 8. The rainbow outline pass and post-processing

- **Measured.** There is **no post-processing**: no `EffectComposer`, no
  full-screen pass; the frame is sky + scene + (ferris car) + book reader. The
  rainbow highlight is an inverted-hull shell, **one extra draw call** for the
  one selected thing (`world/Highlights.ts`), and `Selection.update` costs
  18–20 ms/s (0.15 ms/frame). Framebuffer binds per frame: 4 (all shadow/VSM).
- **Gain.** Nothing to win. **Check.** None needed beyond the draw-call budget.

### 9. Reptile House light budget, or baked lighting (step 15)

- **Measured.** 11 visible point lights on 1,024 toon materials; 36 of 38 drops
  GPU-bound (GPU process in `ImageTransportSurfaceOverlayMac::Present` for 72 ms
  while the renderer idled). A/B over the same walk: baseline 11 GPU-bound
  drops, GPU timer 4.53 ms; lights hidden **0 drops, 2.83 ms**; pixel ratio 1
  **0 drops, 2.78 ms**.
- **Fix.** ≤ 4 dynamic point lights in view; the rest as emissive surfaces and
  baked light pools in vertex colour or a light map.
- **Risk.** Medium. **Jim sees it?** Yes (the room's lighting).
- **Check.** Visible point lights per space ≤ 4 (counted).

### 10. Adaptive / dynamic resolution (step 17)

- **Measured.** At DPR 1 the reptile house's GPU-bound drops went 11 → 0; the
  park at DPR 1 saved 0.5–0.9 ms CPU (smaller buffers) and little GPU on the M4.
- **Fix.** A controller in `Engine` that steps DPR 2 → 1.5 → 1.25 when N of the
  last M frames missed vsync with the main thread idle (GPU-bound), and back up
  after a calm period, with hysteresis. Never below 1.
- **Risk.** Medium (oscillation, a visible softness). **Jim sees it?** Subtly.
- **Check.** Unit-test the controller on recorded frame traces; the real-GPU
  frame check below covers it end to end.

### 11. Static matrices (step 13)

- **Measured.** After step 2, ~2,500 objects remain; every one has
  `matrixAutoUpdate = true` (8,946 of 8,947 today). `multiplyMatrices` is the
  top self-time function (184 ms/s).
- **Fix.** Props placed once get `matrixAutoUpdate = false` + one
  `updateMatrix()`; a dev-mode assert catches a static prop whose position
  changed.
- **Gain.** −0.3–0.5 ms E. **Risk.** Low per prop, wide. **Jim sees it?** No.
- **Check.** Count of `matrixAutoUpdate` objects in the park ≤ budget.

### 12. Instancing and merging static geometry — the Rail Race (step 14)

- **Measured.** Rail Race: **1,328 draw calls** (timing run), 1,955 in the
  audit run; CPU **9.1 ms p50**, 98.6 % of frames over 8.3 ms, 14.4 % miss a
  vsync. Draws by group, from the cart's 44° camera: stalls 333, fairy lights
  243, the race itself 187, anchor plots 186, scenery 155, park train 114,
  crowd 112. **The track is not the problem; the park's per-mesh props seen in
  first person are.** `setProgram` 198 ms/s; uniform uploads allocate 36 MB/s.
- **Fix.** Merge static props per area by material (`BufferGeometryUtils.
  mergeGeometries` at build time of the park), instance repeated stall parts,
  one draw per fairy-light string.
- **Gain.** −2 to −3 ms E (→ ~6 ms; ~3 ms with step 2). Also helps the iso park
  (stalls 408 meshes).
- **Risk.** Medium (per-object culling and highlight shells must still work on
  merged props — the highlight needs a selected *thing*, so keep interactables
  separate). **Jim sees it?** No, if identical.
- **Check.** Draw calls per frame per scene ≤ budget (counted).

### 13. The super-speed dash: per-stride collision

DASH_RESULT_PLACEHOLDER

### 14. Shader precompile for every space (step 8)

- **Measured.** The park warm-up works (45 s run: 4 links, no frame > 33 ms).
  Interiors are not warmed: castle first entry 107 ms (1 link), library 150 ms
  (3 links), both `getProgramParameter` in `onFirstUse`.
- **Fix.** Extend `ShaderWarmup` to each interior root (and ride scenes) after
  the park, still behind the bus — after step 2 the roots are detached, so the
  warm-up must be handed them explicitly.
- **Risk.** Low. **Jim sees it?** No.
- **Check.** `gpu:frame-time` (real GPU): 0 program links after hand-over
  when entering each space.

### 15. Texture compression (KTX2) and atlases (step 21)

- **Measured.** 149 textures, **129 MB** uncompressed in GPU memory, **0
  compressed** — and nearly all are `HTMLCanvasElement` textures **generated at
  runtime** (faces, signs, labels), not image files. KTX2 applies only to
  authored images, and the frame does not spend measurable time sampling
  textures (texture uploads: 0–20 per run, all at first sight).
- **Verdict.** Not a frame-time item. It is a **memory and first-sight upload**
  item for phones (129 MB is a lot for an older iPhone's WebGL budget). Do
  after step 0, only if real phones show memory pressure or upload hitches.
  Atlases help draw calls only where materials differ just by texture — fold
  into step 14.

### 16. Allocation-free hot paths (steps 5, 6, 7, 18)

Park, 137 MB/s sampled (≈1.1 MB/frame):

| source | MB/s | share | step |
|---|---|---|---|
| deterministic `Math` (`remPio2` 23.3, `sin` 10.8, `cos` 3.0, kernels 4.2) | 41.3 | 30 % | 6 |
| three.js uniform setters (`setValueM4` 11.0, `V3f` 3.8, `M3` 1.5) | 16.3 | 12 % | 14 (fewer draws) |
| ground sampling (`Hotel.covers` 8.5, `Math.hypot` 7.2) | 15.7 | 11 % | 7 |
| per-frame `needsUpdate` (`getParameters` 8.2, cache key 1.3) | 9.5 | 7 % | 5 |
| Flowers (`placeOnSphere` 3.4, `interactZones` 3.0) | 6.4 | 5 % | 18 |
| banquet (`greatHallSeats` 2.2, `setFromEuler` 3.0) | 5.2 | 4 % | 3 |
| reptile house only: `Curve.getPoint` 18.6, `initNonuniformCatmullRom` 8.5 | 27.1 | 16 % there | 18 |

GC today: 1.5–3.1 ms/s, max pause 6.0 ms, 0 majors. Target < 30 MB/s steady.
**Check.** `check:alloc-budget` (CI, no GPU): sampled allocation per frame in
the park ≤ budget, ratcheted.

### 17. Labels, speech bubbles, HUD — DOM cost

- **Measured.** Style + layout + paint + commit on the main thread: **18–25
  ms/s** in every scene (0.15–0.2 ms/frame at 120 fps), on the stand-in 24.8
  ms/s. `labels.resolve` 1.5 ms/s, `updateHud` 0.9 ms/s. Labels and speech
  bubbles are 3D sprites; the HUD setters short-circuit. **No dropped frame was
  attributable to layout or paint** once the classifier used the right vsync.
- **Verdict.** ~2 % of the budget; no step. Keep it there with the same
  `check:scene-budget` run reporting layout ms/s.

### 18. Frame pacing: rAF at the display rate, no 60 Hz cap (step 19)

- **Measured.** `core/Loop.ts` is plain `requestAnimationFrame`, uncapped;
  measured p50 interval 8.3 ms on the 120 Hz display in every desktop scene.
  `MAX_FRAME_DELTA` is 1/12 s (a hitch clamp, not a cap). **No 60 Hz cap in the
  render loop.**
- **Found.** `building/ballPhysics.ts` steps at a fixed `1/60` with an
  accumulator and **no interpolation**: at 120 Hz the ball moves on alternate
  frames — visible judder, not a cost. Fix: render-interpolate between the last
  two physics states. (`railRace/simulate.ts`'s `1/60` is an offline
  simulation; `ArrivalSequence`'s `BEAT_STEP` and `Highlights`'s `FROZEN_DT`
  are not frame pacing.)
- **Phones.** iOS Safari has historically capped rAF at 60 Hz on ProMotion
  devices by default. Step 0 must measure what an iPhone actually delivers.
- **Check.** `gpu:frame-time` asserts the measured p50 interval equals the
  display's refresh interval (derived, not hard-coded).

### 19. Load hitches: GLB decode, texture upload, AudioContext (step 9)

BOOT_RESULT_PLACEHOLDER

---

## Measurement: phones and guardrails

### Step 0a — a real-phone baseline (the stand-in is not a phone)

Everything labelled *stand-in* above is desktop Chrome with a 4× CPU throttle
and an M4 Pro GPU. Before steps 12, 15, 16, 17 and 20 are sized, measure the
family's actual phones:

- **iPhone (Safari):** connect by cable; Mac Safari → Develop → *the phone* →
  the game tab → **Timelines** (record *Rendering Frames*, *JavaScript &
  Events*, *CPU*). Load `/spawn`, `/library?sit=1&story=now`, `/reptile-house`,
  `/rail-race`. Record 30 s each. Also check *Settings → Safari → Advanced →
  Feature Flags → "Prefer Page Rendering Updates near 60fps"* — on means rAF is
  capped at 60 Hz regardless of what we do.
- **Android (Chrome):** `chrome://inspect` over USB gives full DevTools,
  including the Performance panel and CDP, so the **same harness**
  (`run.mjs`) can drive a real device via `playwright`'s Android support
  (`_android`), with real GPU timings.
- **Cloud real devices** (BrowserStack / LambdaTest real-device Playwright):
  real Android with CDP; iOS Safari with less instrumentation. This is a paid
  account — **Jim's call**, not an agent's.
- **In-game probe:** a `?perf=1` URL (step 0, developer-typed like `/view`)
  that loads `probe.js`'s counters and shows p50/p99, frames over 8.3 / 16.7
  ms, draws, triangles, and heap on screen, with a "copy JSON" button — the
  cheapest way to get a number from a phone in a parent's hand.

### Step 0b — guardrails

| check | asserts | runs where |
|---|---|---|
| `check:nav-rebuilds` | 0 full NavGrid rebuilds during a scripted story time and on entering each space | CI (no GPU) |
| `check:scene-budget` | objects reachable from the scene in the park; crowd `commit`s from undrawn spaces = 0; layout ms/s | CI |
| `check:cull-audit` | off-screen-but-drawn triangles per scene ≤ budget | CI |
| `check:material-churn` | no material `version` grows by > 2 in 2 s, per scene | CI |
| `check:alloc-budget` | sampled allocation per frame ≤ budget | CI |
| draw / triangle budgets | GL-probe counts per scene ≤ budget | CI (SwiftShader counts draws correctly) |
| `gpu:frame-time` (extended) | per scene: CPU p50 ≤ budget, frames missing a vsync ≤ X %, 0 frames > 100 ms, 0 program links after warm-up, p50 interval = display refresh; `PHONE=1` mode with 4× throttle labelled stand-in | **a GPU runner** — local today; in CI only once there is a GPU runner (a billing decision, Jim's) |

Every count-based check is deterministic and runs on the ordinary CI runner.
Per CLAUDE.md each must be **proved red** on today's code before it is trusted:
today's build already has the rebuilds, the scene size, the churn, the
off-screen crowd and the allocation, so each has a natural red input. Every PR
in the sequence reports its measured ms against 8.3 ms, before and after.

---

## How it was measured

- **Builds.** `pnpm run build` (shipped, minified, `vite preview`) for timings;
  `vite build --minify false --sourcemap --outDir dist-perf` of the same commit
  for function names. Both ship prebuilt parks.
- **Browser.** Playwright's full Chrome for Testing 1234, headless — **not
  software rendering**: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`,
  120 Hz. Desktop 1440×900 @ DPR 2 (2880×1800 canvas). Service worker blocked.
- **Probe** (`probe.js`, injected before any page script): per presented frame
  the rAF interval, CPU in the callback, heap; every draw call and its
  triangles, framebuffer binds, program links, texture uploads, buffer bytes;
  WebGL calls blocking > 2 ms; optional `EXT_disjoint_timer_query_webgl2` GPU
  time; the renderer and scenes via three.js's `__THREE_DEVTOOLS__` hook.
- **CDP tracing** (timeline, `v8.gc`, `gpu`, `v8.cpu_profiler`), aligned to the
  page clock by a `performance.mark`; every frame over budget opened up.
- **Profiles.** `Profiler` (200 µs) and `HeapProfiler.startSampling`
  (including objects already collected) on the unminified build.
- **Audit** (`audit.mjs`): culling, crowd, depth range, textures, shadow A/B,
  draws by group, using the camera captured from the game's own `render` call.

### Controls

| control | expected | measured |
|---|---|---|
| 30 ms busy loop every 60th frame | ~38 attributed | **38 of 41** long frames attributed `INJECTED` |
| injected garbage (36 B objects) | ≈5.6 MB/s at the probe's line | **5.76 MB/s** at `probe.js:83` |
| GPU timer, main scene drawn twice | ≈2× | **+46 % only** → GPU ms are relative only |
| `gl.finish()` drain | non-zero | **0.00 ms always** → invalid, not quoted |
| `matrixWorldAutoUpdate = false` on interiors | if it skipped recursion, a drop | **no change** → the flag is not the mechanism; detaching is |

## Raw results

Shipped build, measured windows only:

| scene | link | s | fps | p99 | worst | >16.7 | >33 | CPU p50 | draws | tris | alloc* | GC ms/s | GC max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| park | `/spawn` | 25 | 119.6 | 10.2 | 42.4 | 4 | 1 | 7.4 | 596 | 3.7 M | 132 | 1.9 | 1.4 |
| long run | `/spawn` | 45 | 119.8 | 10.1 | 25.1 | 4 | 0 | 7.4 | 614 | 3.7 M | 125 | 1.9 | 5.8 |
| library story | `/library?sit=1&story=now` | 40 | 116.8 | 10.3 | 483.3 | 16 | 3 | 5.9 | 287 | 2.0 M | 118 | 1.8 | 0.6 |
| reptile house | `/reptile-house` | 25 | 115.1 | 31.9 | 50.4 | 38 | 21 | 6.9 | 394 | 2.1 M | 149 | 2.3 | 1.5 |
| castle | `/castle` | 25 | 118.7 | 10.1 | 158.4 | 3 | 2 | 6.9 | 407 | 2.6 M | 127 | 1.9 | 4.4 |
| Rail Race | `/rail-race` | 30 | 104.8 | 17.5 | 25.1 | 218 | 0 | 9.1 | 1,328 | 3.9 M | 144 | 2.2 | 6.0 |
| Sky Cruiser | `/sky-cruiser` | 30 | 120.0 | 10.1 | 18.1 | 1 | 0 | 6.3 | 261 | 3.7 M | 113 | 1.5 | 0.5 |
| *stand-in park* | `/spawn` | 25 | *30.4* | 43.4 | 66.0 | 776 | 342 | *31.0* | 641 | 3.7 M | 36* | 1.9 | 2.4 |
| *stand-in library* | `/library?…` | 41 | *29.0* | 84.8 | 2,027 | 1,198 | 317 | *27.8* | 280 | 2.0 M | 36* | 3.1 | 4.5 |

\* heap-delta lower bound; sampled allocation is 137 MB/s (park), 170
(reptile), 152 (Rail Race). Per frame it is ~1.1 MB everywhere.

CPU profile, park, desktop (ms/s; 897 ms/s inside rAF):

```
tick                                         892
├─ render → WebGLRenderer.render             579
│   ├─ scene.updateMatrixWorld               241   ← 71 % of it is hidden interiors (step 2)
│   ├─ WebGLShadowMap.render                 117   (step 12)
│   ├─ renderScene (main pass)               115
│   ├─ projectObject (cull + sort)            96
│   └─ setProgram / uniforms                  88
└─ World.update                              259
    ├─ Building.update → GreatHallBanquet    115   (step 3)
    ├─ NpcSystem.update                       69   (steps 4, 11)
    ├─ Selection.update                       20
    ├─ Flowers.update                         17
    └─ Player.update                          13
```

The pre-120 fps attribution of the dropped frames (share by cause per scene,
the hitch table, the GPU A/B) is unchanged and is in the PR history of this
file (commit `d0fcb609` on #746's branch).

## Re-running it

```
pnpm run build:parks && pnpm run build
pnpm exec vite build --minify false --sourcemap --outDir dist-perf   # names; fails at the PWA step, bundle is fine
pnpm exec vite preview --port 5741 --strictPort &
pnpm exec vite preview --outDir dist-perf --port 5742 --strictPort &
cd docs/perf/frame-drops-2026-11-harness
./batch.sh t http://127.0.0.1:5741 ''         # timing pass, every scene
./batch2.sh                                   # attribution pass
node analyse.mjs t-park && node summ.mjs t-park
node audit.mjs au-park http://127.0.0.1:5741 /spawn       # culling / LOD / textures / shadow A/B
node static.mjs 1 ; node static.mjs 4         # the step-2/step-12 experiment (CPU ×1 / ×4)
```

Output goes to `$PERF_OUT` (default `$TMPDIR/lgp-perf`). Kill both previews by
PID afterwards.
