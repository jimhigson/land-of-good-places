# Frame drops, November 2026: what causes them and the plan

Jim, 11 Nov 2026: *"we get a lot of dropped frames, maybe from gc (too much
memory churn) maybe from the rendering being too complicated."*

This is an investigation. No shipped code changed. Every number below was
measured on `main` at `dd23766c` (#736). The harness that produced them is in
[`frame-drops-2026-11-harness/`](frame-drops-2026-11-harness/), and how to
re-run it is at the end.

## The answer in four lines

1. **It is not GC.** Minor GCs cost **1.5–3.1 ms per second** in every scene,
   the longest pause measured was **6.0 ms**, there were **0 major GCs** in any
   window, and GC was the main cause of **0** dropped frames on desktop and on
   the throttled phone. Allocation is high (**113–170 MB/s, about 1.1 MB a
   frame**), so it is worth cutting for its own sake, but it is not what drops
   the frames.
2. **The steady drops are CPU in the frame.** On a phone-class CPU (4× throttle)
   the park runs at **30 fps**: **99.9 %** of frames are over 16.7 ms and
   **44 %** are over 33 ms, with **31 ms** of JavaScript per frame. On Jim's
   M4 Pro the same frame takes **7.4 ms of an 8.3 ms budget**, which is why it
   looks fine there. The largest single cost is three.js updating the world
   matrices of **6,400 objects that are not drawn**: the hidden hotel, castle,
   reptile-house and library interiors make up **71 % of the scene graph**.
3. **The big freezes are a nav-grid rebuild.** The "story time freeze" QA
   measured is a synchronous `NavGrid` lattice rebuild. It takes **483–541 ms**
   on the M4 Pro and **1,958–2,027 ms** at 4× throttle, and it runs because the
   owl's collider going in and out at story time bumps the global collision
   revision. Entering the castle triggers the same rebuild (**158–191 ms**).
4. **The GPU is the limit in one place: the reptile house.** 36 of its 38
   dropped frames came with the main thread idle and the GPU process blocked on
   present. Hiding its **11 point lights** cut GPU time from **4.53 to 2.83 ms**
   and removed every GPU-bound drop. Rendering at pixel ratio 1 did the same.

## Contents

- [How it was measured](#how-it-was-measured), including the controls
- [Results by scene](#results-by-scene)
- [Causes, attributed](#causes-attributed)
- [The plan, ranked](#the-plan-ranked): quick wins, then structural work
- [Holding the gains](#holding-the-gains): the checks
- [What was not measured](#what-was-not-measured)
- [Re-running it](#re-running-it)

---

## How it was measured

- **Build:** `pnpm run build` (the shipped, minified bundle, served by
  `vite preview`) for every timing number. For function names, a second build
  of the same commit, `vite build --minify false --sourcemap --outDir dist-perf`,
  was used for the attribution runs. Both builds ship the prebuilt parks.
- **Browser:** Playwright's full Chrome for Testing (build 1234), headless.
  **This is not software rendering.** `WEBGL_debug_renderer_info` reports
  `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`. The display runs at
  **120 Hz** (vsync 8.3 ms). Desktop runs used a 1440×900 viewport at DPR 2
  (2880×1800 canvas).
- **Phone stand-in:** a 390×844 viewport at DPR 3 (the game caps it to 2, so the
  canvas is 780×1688), touch, plus `Emulation.setCPUThrottlingRate(4)`.
  **The GPU is still the M4 Pro**, so this stands in for a phone's CPU only. A
  phone's GPU is not modelled at all (see [What was not measured](#what-was-not-measured)).
- **Service worker** blocked, so it cannot add noise.
- **In-page probe** (`probe.js`, injected before any page script). It records:
  - one entry per presented frame: the rAF interval, CPU time inside the rAF
    callback, and the JS heap;
  - every draw call and the triangles it drew, framebuffer binds, program links,
    texture uploads and `bufferData` bytes, by wrapping the WebGL prototype;
  - any WebGL call that blocked for more than 2 ms;
  - the `WebGLRenderer` and scenes, through three.js's own `__THREE_DEVTOOLS__`
    hook, which works on a production build.
- **CDP tracing** (`devtools.timeline`, `v8.gc`, `gpu`, plus
  `v8.cpu_profiler` for the attribution runs). It is aligned to the page clock
  through a `performance.mark`. Every frame over 16.7 ms is then opened up. The
  analyser sums GC, rAF script, layout and paint, script loading and other tasks
  on the renderer main thread, sums the GPU-process tasks in the same window,
  and adds the in-trace CPU samples.
- **CPU profiles** (`Profiler`, 200 µs sampling) and **allocation sampling**
  (`HeapProfiler.startSampling`, including objects already collected by minor
  and major GC) on the unminified build.

### Controls: the instrument was checked before it was trusted

| control | expected | measured |
|---|---|---|
| a 30 ms busy loop injected every 60th frame, 20 s of park | ~38 frames attributed to the injection | **38 of 41** long frames attributed `INJECTED`. The other 3 were the park's own. |
| "10 MB/s" of garbage (64 B nominal objects) | the objects are really about 36 B, so **≈5.6 MB/s** at the probe's own line | allocation sampling: **5.76 MB/s at `probe.js:83`**. The heap-delta lower bound rose by 3.7 MB/s. |
| GPU timer query (`EXT_disjoint_timer_query_webgl2`), main scene drawn twice | GPU time about 2× | **+46 % only** (3.74 → 5.40 ms). **The timer under-reads, so GPU ms below are relative only.** |
| `gl.finish()` drain time | non-zero | **0.00 ms on every frame.** Chrome does not block on it, so **that instrument is invalid and none of its numbers are quoted.** |

One more bias to know about: a frame's long interval is recorded on the frame
*after* the expensive callback. The analyser opens the window `[previous rAF,
this rAF]` and reads the previous frame's CPU, which is the one that did the
work.

---

## Results by scene

Shipped build, measured windows only (boot excluded), real Metal GPU. The ">16.7"
and ">33" columns are frame intervals. "CPU" is the p50 time inside the rAF
callback.

| scene | link | s | fps | p99 ms | worst ms | >16.7 ms | >33 ms | CPU p50 | draws | tris | alloc MB/s* | GC ms/s | GC max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| park, walking | `/spawn` | 25 | 119.6 | 10.2 | 42.4 | 4 (0.1 %) | 1 | 7.4 | 596 | 3.7 M | 132 | 1.9 | 1.4 |
| long straight run** | `/spawn` | 45 | 119.8 | 10.1 | 25.1 | 4 (0.1 %) | 0 | 7.4 | 614 | 3.7 M | 125 | 1.9 | 5.8 |
| library, story time | `/library?sit=1&story=now` | 40 | 116.8 | 10.3 | **483.3** | 16 (0.3 %) | 3 | 5.9 | 287 | 2.0 M | 118 | 1.8 | 0.6 |
| reptile house | `/reptile-house` | 25 | 115.1 | **31.9** | 50.4 | **38 (1.3 %)** | **21** | 6.9 | 394 | 2.1 M | 149 | 2.3 | 1.5 |
| castle | `/castle` | 25 | 118.7 | 10.1 | **158.4** | 3 (0.1 %) | 2 | 6.9 | 407 | 2.6 M | 127 | 1.9 | 4.4 |
| Rail Race | `/rail-race` | 30 | 104.8 | 17.5 | 25.1 | **218 (6.9 %)** | 0 | **9.1** | **1,328** | 3.9 M | 144 | 2.2 | 6.0 |
| Sky Cruiser | `/sky-cruiser` | 30 | 120.0 | 10.1 | 18.1 | 1 (0 %) | 0 | 6.3 | 261 | 3.7 M | 113 | 1.5 | 0.5 |
| **phone, park** | `/spawn` | 25 | **30.4** | 43.4 | 66.0 | **776 (99.9 %)** | **342 (44 %)** | **31.0** | 641 | 3.7 M | 36* | 1.9 | 2.4 |
| **phone, library** | `/library?sit=1&story=now` | 41 | **29.0** | 84.8 | **2,027** | **1,198 (99.4 %)** | **317 (26 %)** | 27.8 | 280 | 2.0 M | 36* | 3.1 | 4.5 |

\* Lower bound from heap deltas between frames. Sampled allocation on the
unminified build gives the true rate: **137 MB/s** in the park, **170** in the
reptile house and **152** in the Rail Race. On the phone the rate per second
falls because there are four times fewer frames, but the cost per frame is the
same, about **1.1 MB**.
\*\* There is no super-speed on `main`. `tap-superspeed` exists only as an
unmerged worktree. The stand-in is a 9 s straight run in each direction, the
most new ground per second the game allows.

**There were 0 major GCs in any window of any scene.** The heap saws between
about 150 and 200 MB, with about 25 MB freed per minor GC, 5–6 times a second
on desktop.

---

## Causes, attributed

### Share of dropped frames by cause

Every frame over 16.7 ms was opened up by trace (see the method above). "JS"
means the main thread was busy inside our rAF callback, and the CPU samples say
on what.

| scene | >16.7 ms | GC | JS in frame | GPU (main idle) | GL sync (shader link) | layout / DOM | script load |
|---|---|---|---|---|---|---|---|
| park | 4 | 0 | 4 | 0 | 0 | 0 | 0 |
| long run | 4 | 0 | 3 | 0 | 1 | 0 | 0 |
| library | 16 | 0 | 15 (incl. the 483 ms nav-grid rebuild and the 141 ms frame, probably AudioContext) | 0 | 1 (150 ms) | 0 | 0 |
| reptile house | 38 | 0 | 2 | **36 (95 %)** | 0 | 0 | 0 |
| castle | 3 | 0 | 2 (incl. 1 nav-grid rebuild) | 0 | 1 (107 ms) | 0 | 0 |
| Rail Race | 218 | 0 | **218 (100 %)** | 0 | 0 | 0 | 0 |
| phone park | 776 | 0 | **776 (100 %)** | 0 | 0 | 0 | 0 |
| phone library | 1,198 | 0 | **1,194** | 0 | 0 | 4 | 0 |

**No dropped frame in any scene had GC as its main cost**, and no lazy import
or script compile landed in a measured window. HUD and label DOM work is
negligible: `labels.resolve` costs 1.5 ms/s and `updateHud` 0.9 ms/s.

### 1. The steady CPU cost of a frame (it drops every frame on a phone)

CPU profile of 30 s of park walking on the M4 Pro, unminified build. Figures are
ms of main-thread time per second of wall time; 1,000 would be a saturated
thread. The rAF callback took **897 ms/s**: the main thread is 90 % busy at
120 Hz.

```
tick                                         892
├─ render → WebGLRenderer.render             579
│   ├─ scene.updateMatrixWorld               241   (24 % of the main thread)
│   ├─ WebGLShadowMap.render                 117
│   ├─ renderScene (main pass)               115
│   ├─ projectObject (cull + sort lists)      96
│   └─ setProgram / uniforms                  88
└─ World.update                              259
    ├─ Building.update → GreatHallBanquet    115   ← 24 diners animated every frame
    │     (InstancedCrowd.commit → updateMatrixWorld(true): 78)
    ├─ NpcSystem.update                       69
    ├─ Flowers.update (placeOnSphere, sin)    17
    └─ (Player 13, Selection 20, …)
top self time: multiplyMatrices 184, updateMatrixWorld 159, projectObject 66,
               renderBufferDirect 35, renderObject 27, sin 21, setMaterial 19,
               intersectsObject 18, remPio2 17, commit 16, getParameters 14, cos 12
```

At 4× throttle (`a-phone-park-cpu`) the proportions are the same:
`updateMatrixWorld` in render **231**, the banquet **121–138**, the shadow pass
**138**, the main pass **113**, `projectObject` **85**, `NpcSystem` **89**, and
the deterministic `sin`/`cos` about **60**. The phone frame is **32.8 ms** p50.

Five specific causes inside that:

- **a. 71 % of the scene graph is hidden interiors, and three.js updates it
  anyway.** `scene.updateMatrixWorld()` recurses into invisible subtrees. The
  scene has 8,943 objects, and while she is in the park these are all invisible:
  `the-land-hotel-inside` 3,035, `the-big-building-inside` 1,837,
  `the-reptile-house-inside` 1,083, `the-library-inside` 280 and
  `the-library-children` 117. That is **6,411**. Two experiments measured the
  fix, in place, on the shipped build:

  | experiment (park, standing) | desktop CPU p50 | phone (4×) CPU p50 | phone fps |
  |---|---|---|---|
  | baseline | 7.7 ms | 31.1 ms | 30 |
  | hidden interiors **detached** from the scene | **5.8 ms (−25 %)** | **25.3 ms (−19 %)** | 37 |
  | … and the shadow map not re-rendered | **4.8 ms** | **21.9 ms** | 42 |

  Setting `matrixWorldAutoUpdate = false` on those roots changed **nothing**
  (7.8 → 7.8 ms), because `Object3D.updateMatrixWorld` still recurses into the
  children. The flag is not the mechanism. Detaching the subtree is, and so is
  not traversing it at all.

- **b. The castle banquet animates 24 diners every frame, wherever she is.**
  `GreatHallBanquet.update` runs `applyRidePose` plus
  `InstancedCrowd.commit(member)` (which calls `updateMatrixWorld(true)` on each
  diner's proxy rig) whether or not the great hall is drawn. That is **115 ms/s
  on desktop and 121–138 ms/s at 4×, about 13 % of the phone frame**. It runs in
  the park, the reptile house (118 ms/s) and the library (113 ms/s). It also
  allocates 2.2 MB/s (`greatHallSeats`) and 3 MB/s (`setFromEuler` →
  deterministic `sin`).

- **c. The shadow map is re-rendered every frame.** One 2048² VSM, radius 3,
  10 blur samples. It is **117–138 ms/s** of CPU and **about 300 of the 600
  draw calls**. Freezing it (`shadowMap.autoUpdate = false`) saved **1.0 ms
  desktop / 3.4 ms phone** per frame, measured on top of (a).

- **d. Materials re-flagged `needsUpdate` every frame.** These make three.js
  re-derive program parameters on every frame (`getParameters` 14.6 ms/s, plus
  8.2 MB/s allocation). Material `version` was counted over one second:
  - the fountain's `effect.waterDroplets`: **238/s**, twice a frame;
  - the Reptile House roof head `rh-head`: **121/s**, from
    `reptileHouseAssets.ts` `apply()`, which swaps `map` and sets `needsUpdate`;
  - kid `skull` face materials: **121/s each**, from
    `faces.ts`/`sharedFace.ts` `setExpression`, called every frame with the
    same face;
  - in the reptile house, `case:rainbowBoa`: **484/s**, four times a frame.

  Swapping one map for another of the same format never needs a program change.

- **e. The deterministic `Math` costs CPU and allocates.** `installDeterministicMath`
  replaces `Math.sin`/`cos`/`pow`… globally with fdlibm in JavaScript, so
  three.js's `Euler`/`Quaternion` code and every tick pay for it. `sin` + `cos`
  are **~56 ms/s** inclusive on desktop. The reduced argument lives in
  module-level `let y0, y1`, which V8 boxes as a fresh HeapNumber on every
  write: `remPio2` is the **#1 allocator in the game at 23 MB/s (17 %)**, and
  `sin`/`cos`/kernels add another 18 MB/s. That is **about 30 % of all
  allocation** from the one file.

### 2. One-off freezes (the "hitches")

| hitch | where | desktop | phone (4×) | cause, from the in-trace CPU samples |
|---|---|---|---|---|
| **nav-grid rebuild** | library story time (twice in a 40 s run); on entering the castle | **483, 516, 541, 649 ms**; castle **158–191 ms** | **1,958 ms and 2,027 ms** | `NpcSystem → NpcCharacter.update → wanderDriver.updateJourney → journey.steer → plan → NavGrid.findRoute → ensureLattice → rebuild`. 94 % of the frame is in `rebuild`, mostly `surfaces.sample` (64 %), `Hotel.covers` (25–29 %), another `covers` (17–23 %) and `bridgeHeightAt` (7–9 %). |
| first-use shader link in an interior | castle 107 ms, library 150 ms | 107–150 ms | — | `getProgramParameter` in `onFirstUse`, 1–3 links. `boot/shaderWarmup.ts` warms only the park during the bus ride. Interiors are compiled on first sight. |
| AudioContext creation | library, first puff melody | **168 ms** (and probably the 141 ms frame) | — | `WildPets.advance → playPuffMelody → singNote → ensureContext → new AudioContext()` inside a frame. Measured headless; confirm on a device. |
| A* search alone | castle | 30–34 ms | — | `NavGrid.findRoute` → `forEachStep`/`relaxStep`, with no rebuild. |

**This is the story-time freeze, and why it happens then.** `NavGrid.ensureLattice`
rebuilds the whole lattice whenever `collision.revision` or the play boundary
changes. At story time the owl leaves her desk and her body box is restored,
then removed again when she comes back (`LibraryOwl.ts:644/654/836`, both via
`CollisionWorld.restoreBox`/`removeBox`, which do `revisionCounter += 1`). The
revision is **global**, so a moving collider in the library makes the next
NPC route plan rebuild a lattice. On the phone stand-in that is a **2-second
freeze, and it happened twice in one 40 s story-time run** (that the second is the owl going back to her desk is inferred from the code, not traced). The 0.4–0.5 s QA measured on desktop is the same
thing.

### 3. GPU

- **The reptile house is GPU-bound in bursts.** During the drops the GPU
  process's main thread was in `ImageTransportSurfaceOverlayMac::Present /
  CommitPresentedFrameToCA` for **72 ms**, while the renderer was idle with
  7.6 ms of CPU. That is back-pressure from a saturated GPU, in bursts of about
  0.4 s at 24 fps. The room has **11 visible point lights** on 1,024
  `MeshToonMaterial`s, and in a forward renderer every lit fragment loops over
  all of them. A/B over the same 25 s walk:

  | reptile house | GPU-bound drops | GPU timer p50 (relative) |
  |---|---|---|
  | baseline | 11 | 4.53 ms |
  | point lights hidden | **0** | **2.83 ms** |
  | pixel ratio 1 | **0** | **2.78 ms** |

  The point-light run also showed 63 JS drops. They are the experiment's own
  doing: it traverses every scene every frame to hide the lights, which adds
  about 1 ms to a frame with 0.9 ms of headroom. They are not a property of the
  room.
- **The park is not GPU-bound on the M4 Pro.** The GPU timer reads about 4 ms
  against 7.4 ms of CPU. Dropping to pixel ratio 1 or hiding transparents
  barely moved it, so the desktop park is not fill-bound.
- **Triangles: 3.7 M per frame**, against the 400 k worst case ARCHITECTURE.md
  documents. **The NPC crowd alone is 1.67 M (45 %)**: 111 instanced meshes.
  Next come `anchor-plots` (316 k), `scenery` (268 k) and the Rail Race track
  (203 k). This does not hurt the M4 Pro. On a phone GPU it is the first thing
  to cut.
- **Draw calls:** about 600 in the park (about half of them shadow) and **1,328
  in the Rail Race**, the scene that misses its 8.3 ms budget at 120 Hz on every
  fifteenth frame. Its render is 726 ms/s, `setProgram` 198 ms/s, and three.js
  uniform uploads allocate 36 MB/s (`setValueM4`).
- **Shader warm-up works for the park.** The 45 s run made 4 program links and
  no frame over 33 ms.

### 4. Allocation (secondary)

Park, 137 MB/s sampled, about 1.1 MB per frame:

| source | MB/s | share |
|---|---|---|
| deterministic `Math`: `remPio2` 23.3, `sin` 10.8, `cos` 3.0, kernels 4.2 | 41.3 | 30 % |
| three.js uniform setters: `setValueM4` 11.0, `V3f` 3.8, `M3` 1.5 | 16.3 | 12 % |
| ground sampling: `Hotel.covers` 8.5, native `Math.hypot` (varargs) 7.2 | 15.7 | 11 % |
| per-frame `needsUpdate`: `getParameters` 8.2, `getProgramCacheKeyParameters` 1.3 | 9.5 | 7 % |
| Flowers: `placeOnSphere` 3.4, `interactZones` 3.0 | 6.4 | 5 % |
| banquet: `greatHallSeats` 2.2, `setFromEuler` 3.0 | 5.2 | 4 % |
| reptile house only: `Curve.getPoint` 18.6, `initNonuniformCatmullRom` 8.5 | (27.1) | (16 % there) |

---

## The plan, ranked

Ranked by **dropped frames removed per unit of risk**. The gains in ms are for
the phone stand-in (31 ms baseline in the park) unless they say otherwise.
"Measured" means an in-place experiment on the shipped build. "Estimated" means
read off the profile share.

### Quick wins (days, low risk, nothing a child would see)

**Q1. Stop the nav-grid rebuild freezing story time and the castle.**
- *Cause:* a global `collision.revision` bump from the owl's moving box (and the
  boundary change on entering a space) makes `NavGrid.ensureLattice` rebuild the
  whole lattice synchronously.
- *Evidence:* the hitch table above. 483–649 ms desktop, **2.0 s ×2 on the
  phone**, 158–191 ms entering the castle.
- *Fix:* any of these, cheapest first.
  1. Moving boxes (`addMovingBox` users: the owl, trains) do not bump the
     revision `NavGrid` keys on. Give `CollisionWorld` a static revision
     separate from the moving one.
  2. Make the revision per space, so the library cannot invalidate the park's
     lattice.
  3. Rebuild only the cells under the changed collider's bounding box.
  4. Time-slice `rebuild` over frames, the way `ShaderWarmup` is sliced, and
     keep routing on the old lattice meanwhile.
- *Gain:* removes every frame over 100 ms measured in the library and castle.
  That is the **2 s freeze on the phone**, gone.
- *Risk:* low for (1)–(2). The lattice is a walkability map, and a moving owl
  was never meant to reshape it. (3) needs care at cell borders.
- *Hold it:* a `check:` that drives story time headlessly and asserts **0
  lattice rebuilds** between "story begins" and "story ends", counted by an
  instrumentation counter, not by timing. No GPU needed.

**Q2. Don't animate what isn't drawn: the banquet first.**
- *Cause:* `GreatHallBanquet.update` runs every frame in every space.
- *Evidence:* 115 ms/s desktop, ~13 % of the phone frame, plus 5 MB/s
  allocation.
- *Fix:* return early unless the great hall's storey is the drawn space. Run one
  `update` on entry so the pose is fresh. Then audit every `update` for the same
  pattern (`WildPets`, reptile-case animation, library children).
- *Gain:* **~3.5–4 ms per phone frame (estimated)**; ~1 ms desktop.
- *Risk:* very low.
- *Hold it:* a frame-budget check that counts `InstancedCrowd.commit` calls per
  frame while she is in the park, and requires 0 from crowds whose space is not
  drawn.

**Q3. Detach hidden interiors from the scene graph.**
- *Cause:* 6,411 of 8,943 objects are invisible interiors that
  `updateMatrixWorld` and `projectObject` still walk.
- *Evidence:* **measured −25 % desktop CPU (7.7 → 5.8 ms), −19 % phone
  (31.1 → 25.3 ms, 30 → 37 fps).**
- *Fix:* the one owner of "which space is drawn" (`Building`/`Hotel`/`Library`/
  `ReptileHouse` already hide `interiorRoot`) removes the root from its parent
  instead of setting `visible = false`. It re-adds it, then calls
  `updateMatrixWorld(true)`, on entry.
- *Gain:* **~5.8 ms per phone frame**, **~1.9 ms per desktop frame**.
- *Risk:* low to medium. Anything that reads an interior's `matrixWorld` while
  she is outdoors (colliders built from world matrices, labels, warm-up) must
  either not do so or refresh it. Whether anything does is unverified and must be proved before shipping. The
  shader warm-up must still see interiors (see Q5).
- *Hold it:* `check:scene-budget`: in the park, the number of objects reachable
  from the scene is at most N, where N is the measured value plus 10 %.
  Deterministic, no GPU.

**Q4. Stop setting `material.needsUpdate` every frame.**
- *Cause:* `setExpression`/`apply` swap `map` and set `needsUpdate`
  unconditionally, every frame (faces, reptile head, rainbow boa case, fountain
  droplets).
- *Evidence:* `version` churn of 121–484/s per material. `getParameters`
  14.6 ms/s plus 9.5 MB/s.
- *Fix:* return early when the requested texture is already the map. Never set
  `needsUpdate` for a map-to-map swap between two non-null textures; only a
  null↔texture change needs it.
- *Gain:* about **1.5 % of the frame and 7 % of allocation**.
- *Risk:* very low.
- *Hold it:* `check:material-churn`: over 2 s in each scene, no material's
  `version` increases by more than 2 (with an allowlist). No GPU needed; a
  SwiftShader runner is enough.

**Q5. Warm interior shaders before she walks in.**
- *Cause:* `ShaderWarmup` covers the park during the bus. The castle, library,
  reptile house and hotel compile on first sight.
- *Evidence:* 107 ms (castle) and 150 ms (library) GL-sync frames, 1–3 links
  each.
- *Fix:* run the same sliced `ShaderWarmup` over each interior root after the
  park warm-up, still behind the bus, or while she stands on the doormat.
- *Gain:* removes the 100–150 ms first-entry stall per interior.
- *Risk:* low. This is the mechanism #246 already proved.
- *Hold it:* extend `gpu:frame-time` (real GPU) to enter each interior and
  assert 0 program links after the hand-over.

**Q6. Create the AudioContext on the first tap, not mid-frame.**
- *Evidence:* a 168 ms frame was `new AudioContext()` inside
  `WildPets.advance → playPuffMelody`.
- *Fix:* create and resume it in the first user-gesture handler (browsers want
  that anyway). `ensureContext` then only reads it.
- *Gain:* removes one 140–170 ms hitch per session. Headless measurement;
  confirm on a phone.
- *Risk:* very low.

**Q7. Make the deterministic `Math` allocation-free.**
- *Cause:* the module-level `let y0, y1` in `deterministicMath.ts` are boxed on
  every write.
- *Evidence:* 41 MB/s, **30 % of all allocation**.
- *Fix:* keep `y0`/`y1` in a module `Float64Array(2)`. The bits are identical:
  IEEE doubles in, IEEE doubles out. `test/deterministicMath.test.ts` and the
  park-identity hashes prove that it still matches.
- *Gain:* ~30 % less garbage, and some CPU (estimated 10–20 % of `sin`/`cos`,
  ~0.5 ms phone).
- *Risk:* low, and the existing tests cover exactly the risk.
- *Hold it:* see the allocation budget below.

**Q8. Cheaper ground sampling.**
- *Fix:* `Hotel.covers` uses `Math.hypot`, which takes varargs and allocates.
  Use `Math.sqrt(dx*dx + dz*dz)` (deterministic, per the file's own notes) and
  compare squared radii before any `atan2`. This also speeds up the Q1 rebuild,
  where `covers` is 25–29 %.
- *Gain:* ~11 % of allocation; a faster nav rebuild.
- *Risk:* very low.

### Structural work (weeks, needs Jim's eye where it can change the look)

**S1. Shadow-map cadence.** A static shadow, with moving casters drawn only near
her.
- *Evidence:* measured **−1.0 ms desktop, −3.4 ms phone** per frame when the map
  is not re-rendered, and about half of all draw calls.
- *Fix:* re-render the sun's map only when the sun has moved more than ε or
  when a static caster changes (`shadowMap.needsUpdate`). Draw moving casters
  (her, pets, NPCs, rides) into a small second map near the player, or into
  cheap blob shadows.
- *Risk:* medium to high, and **visible**. Shadow quality and lag on moving
  things are Jim's call. Prototype behind a URL flag and show him.

**S2. Static scenery stops recomputing matrices.** After Q3 the park still has
~2,500 objects. Props placed once get `matrixAutoUpdate = false` plus one
`updateMatrix()` at placement.
- *Gain:* estimated 30–50 % of what is left of `updateMatrixWorld`,
  ~1.5–2.5 ms phone.
- *Risk:* low per prop, but wide. Anything that animates later must opt back
  in. A dev-only assert can catch a static prop whose `position` changed.

**S3. NPC crowd LOD and per-instance culling.** 1.67 M triangles (45 %) are the
crowd.
- *Fix:* a lower-poly kid beyond about 15 m, built from the same model file.
  Skip `commit` for members outside the frustum or beyond a distance.
- *Gain:* ~1 M fewer triangles per frame (phone GPU), plus less `NpcSystem` CPU
  (69–89 ms/s).
- *Risk:* medium, and **visible at the LOD switch**. ART_DIRECTION.md
  applies.

**S4. A point-light budget per space, and adaptive resolution.**
- *Evidence:* reptile house, 11 lights → GPU-bound. Hiding them or rendering at
  DPR 1 both removed **every** GPU-bound drop.
- *Fix:* at most about 4 dynamic point lights in view. Replace the rest with
  emissive and baked light pools, which the hotel and library already use
  partly. Separately, scale the pixel ratio dynamically (2 → 1.5 → 1) when the
  frame interval stays over budget.
- *Risk:* medium, and **visible** (lighting look). Dynamic resolution is
  invisible when it works and must not oscillate.

**S5. The Rail Race's draw calls.** 1,328 draws, 9.1 ms of CPU against an
8.3 ms budget at 120 Hz.
- *Fix:* merge or instance the static track and spark-zone pieces (one draw
  per material).
- *Gain:* estimated halved draws and ~2 ms desktop CPU, so the 6.9 % of frames
  it drops should go to ~0.
- *Risk:* medium.

**S6. Allocation-free hot paths.** After Q4, Q7 and Q8, the next targets are
`Curve.getPoint` in the reptile house (18.6 MB/s: pass a target `Vector3`),
Flowers (`placeOnSphere`, `interactZones` returning fresh arrays), the
banquet's `greatHallSeats` (built per call, should be cached) and three.js
uniform setters fed plain arrays.
- *Gain:* steady state under 30 MB/s. GC is not today's frame-dropper, but a
  real phone's GC is several times slower than the M4 Pro's 1.4 ms.

**S7. A phone quality tier.** `isLowEndDevice()` today chooses only the shadow
map size. Extend it to the S1 cadence, DPR 1.5, the S3 crowd LOD distance and
the S4 light budget. This is the lever for the family's actual phones, once
someone has measured one.

### Expected result, phone stand-in, park

| step | frame (ms) | fps (60 Hz phone) |
|---|---|---|
| today | 31 | 30 |
| + Q3 (measured) | 25.3 | ~37 |
| + S1 (measured on top of Q3) | 21.9 | ~42 |
| + Q2, Q4, Q7 (estimated from the profile) | ~17 | ~55 |
| + S2, S3 | ~14–15 | **60** |

Story time on the phone goes from **two 2 s freezes** to none (Q1). The reptile
house goes from 1.3 % GPU-bound drops to 0 (S4, measured).

---

## Holding the gains

The existing `gpu:frame-time` (real GPU, local only) asserts the park's tail.
Most of the causes above are **countable without a GPU**, and so can gate in CI
on the SwiftShader runner:

| check | asserts | needs GPU? |
|---|---|---|
| `check:scene-budget` | objects reachable from the scene while in the park ≤ budget (Q3); `InstancedCrowd.commit` calls per frame from undrawn spaces = 0 (Q2) | no |
| `check:material-churn` | no material `version` grows by more than 2 in 2 s, per scene (Q4) | no |
| `check:story-time-hitch` | 0 `NavGrid` lattice rebuilds during a scripted story time; the rebuild counter is read, not a timing (Q1) | no |
| `check:alloc-budget` | sampled allocation per frame in the park ≤ budget (`HeapProfiler.startSampling`; deterministic enough to ratchet at +20 %) | no |
| `gpu:frame-time` (extend) | per scene (park, library story, reptile, castle, Rail Race): p99.9, 0 frames over 100 ms, 0 program links after warm-up; a `PHONE=1` mode with 4× CPU throttle and frames over 33 ms at most X % | **yes**, so it cannot gate CI until there is a GPU runner (a billing decision, not code) |

Per CLAUDE.md, each must be proved red first. The harness here already gives a
red input for each: today's build has the churn, the rebuild, the banquet
commits and the scene size.

---

## What was not measured

- **A real phone.** The 4× CPU throttle is the only phone stand-in. The GPU,
  thermal throttling, real GC speed and Safari/WebKit are all unmodelled. The
  phone numbers are a CPU lower bound on cost. S4, S3 and S7 are the GPU-side
  guesses and need a device to confirm.
- **Busy NPC areas as their own scene.** The `/spawn` park walk starts among
  the crowd, which is in view (1.67 M crowd triangles drawn). NPC CPU is in the
  park profile (`NpcSystem` 69 ms/s desktop, 89 ms/s at 4×). No denser spot
  was sought.
- **Super-speed.** It is not on `main`. The long straight run stands in.
- **The service worker and `version.txt` poll.** The service worker was blocked
  for clean measurement. The poll is one small fetch every two minutes, and
  nothing in any trace was attributable to it.
- **Absolute GPU milliseconds.** The timer-query control under-read (+46 % for
  2× work), and `gl.finish()` does not block in Chrome. GPU figures here are
  relative (A vs B in the same run) only.

---

## Re-running it

```
pnpm run build                                   # needs .parks/ (pnpm run build:parks)
vite build --minify false --sourcemap --outDir dist-perf   # for names; fails at the PWA step, bundle is fine
vite preview --port 5741 --strictPort &          # shipped build
vite preview --outDir dist-perf --port 5742 --strictPort & # named build
cd docs/perf/frame-drops-2026-11-harness
./batch.sh t http://127.0.0.1:5741 ''            # timing pass, all scenes
./batch2.sh                                      # attribution pass (trace CPU, profiles, GPU A/B)
node analyse.mjs t-park && node summ.mjs t-park  # per-run report
node callers.mjs park-attr updateMatrixWorld 3   # who calls a function, ms/s
node diag.mjs d-park http://127.0.0.1:5741 /spawn          # scene facts + live A/B
node static.mjs 1 ; node static.mjs 4            # the Q3/S1 experiment (CPU throttle 1× / 4×)
```

Output goes to `$PERF_OUT` (default `$TMPDIR/lgp-perf`). The Chrome is
Playwright's `chromium-1234` *full* build, not the headless shell. That build
is what gets the Metal GPU.
