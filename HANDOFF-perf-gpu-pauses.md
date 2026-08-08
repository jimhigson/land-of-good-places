# HANDOFF — perf/gpu-pauses

> **Round 2 (7 Aug) — the fixes are built and measured.** Jump to
> "Round 2: what was built" at the bottom for the A/B. Everything above it is
> the investigation that found the cause, kept because the *method* is the part
> worth reusing.


Investigating Jim's report: *"The frame rate is generally ok but there seem to
be large GPU pauses from time to time."* Jim's own hypothesis, via the Overseer:
*"I'm not sure the pauses are GPU related, may be GC"*.

Branch `perf/gpu-pauses`, cut from `e/cat-bus-stage-a` (PR #246) at `a43127f`.
Worktree `.claude/worktrees/perf-gpu-pauses`.

## The answer, in one line

**It is not GC, and it is not draw calls. It is synchronous shader-program
setup, blocking the main thread inside the rAF callback, as materials are first
drawn while the child walks about.** Worst single frame measured: **1,290 ms**.

## Headless Chromium gets the REAL GPU here — the old note is wrong

The previous session recorded that headless means SwiftShader at 1–2 fps. That
is true only of the flags it used. Playwright's bundled **full** Chromium (not
`chromium_headless_shell`), with **no GPU flags at all**, gives:

```
ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)
```

Binary (note the name — it is *not* `Chromium.app`):

```
/Users/jim/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/
  Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
```

So these are real numbers on Jim's class of hardware, not relative ones.

## Evidence

Chrome trace, inside a single 1,290 ms frame during ordinary walking:

```
RunTask 1297.4 ms
  FireAnimationFrame 1296.9 ms
    FunctionCall 1296.9 ms
      GLES2Implementation::GetProgramiv 133.7 ms
        ImplementationBase::WaitForCmd
          CommandBufferHelper::Finish
            CommandBufferProxyImpl::WaitForGetOffset
```

and on the GPU process side, concurrently: `GPUTask → WebGL →
CommandBuffer::Flush` 124.4 ms.

Timing every synchronous GL entry point individually named the blocking call
without inference: **`gl.getProgramInfoLog` — 88 calls, 827 ms total, single
worst 151.7 ms, 52 of them during ordinary play.**

Source: three.js `WebGLProgram.js:860-876`, `onFirstUse` →
`if (renderer.debug.checkShaderErrors) { gl.getProgramInfoLog(program) … }`.
`checkShaderErrors` defaults to `true` (`WebGLRenderer.js:182`). The call cannot
answer until the GPU process has finished linking, so it is a blocking
round-trip.

## GC: measured, and ruled out as the cause

Jim's hypothesis was reasonable and is **disproved by timestamp correlation**,
not by argument:

- **0 of 12 spikes contained a GC event longer than 1 ms.**
- MinorGC: 1,633 events, p50 **0.245 ms**, max **1.50 ms**.
- MajorGC: 11 events, max **2.77 ms**.
- 1,257 frames freed >0.2 MB (p50 25.9 MB) and their intervals were p50 8.30 ms
  — i.e. scavenges are happening constantly and costing nothing visible.

**But the allocation rate is genuinely bad and worth fixing on its own merits:
191 MB/s, 1.6 MB per frame, heap sawtoothing 107→153 MB.** It is not today's
pause, and on a weaker phone it would cost more than it does on an M4 Pro.

## Other measured facts

- **Frame profile (park, 20,175 frames):** p50 8.30, p90 8.50, p99 10.10,
  p99.9 10.40 ms; vsync-limited at 120 Hz. CPU inside rAF p50 only **2.6 ms**,
  so there is plenty of headroom — Jim's "generally ok" is exactly right.
- **Spikes: one every ~14 s** while walking; **none at all while standing
  still**. 308 / 184 / 117 / 117 / 83 / 83 / 83 / 82 / 82 / 75 / 33 / 33 ms.
- **Programs plateau.** 111 programs / 116 links, reached ~99 s in, then flat
  for the next 120 s. **This is a first-sight cost, not a leak** — but **64 of
  116 links happen after the arrival ends**, i.e. during play, which is the bug.
- **Draw calls per frame: 234 colour + 306 shadow = ~540.** Measured by counting
  draws between framebuffer binds. **The shadow pass is 57% of all draw calls.**
- **The shadow map is rendered ONCE per frame, not twice.** An earlier claim in
  this session said the empty Sky scene would trigger a second shadow pass; the
  framebuffer-bind trace shows it does not. Do not repeat that claim.
- **Triangles: 3.64 M per frame** (`renderer.info`), 3.18 M in the scene graph.
  **ARCHITECTURE.md documents ~540 calls / 400k triangles worst case** — draw
  calls are on budget, triangles are ~9x over it.
- **Culling is NOT globally off.** Only 90 of 2,224 meshes set
  `frustumCulled = false`; 1,420 meshes are visible and only ~540 draws result.
  The brief's "nothing is frustum-culled" is overstated.
- `setSparking` (#190) confirmed: 8 rail colour buffers, ~473 KB, re-uploaded
  every frame unguarded, during ordinary play — but **it allocates nothing**, so
  it is a steady bandwidth cost, not a GC cause and not a spike.
- **`bufferSubData`: 87 calls, 637 KB every frame** (~76 MB/s at 120 fps).
- `NpcSystem.drawCallCost` has exactly one reference in the repo — its own
  definition. Its comment "Reported in the debug overlay" is false.
- **Nothing reads `renderer.info` at runtime.** No render-cost instrumentation
  exists at all.

## The one-line change made (and it is NOT the cure)

`src/core/Engine.ts`: `this.renderer.debug.checkShaderErrors = import.meta.env.DEV;`

Measured A/B on production `preview` builds, 170 s of walking each:

| | before | after |
|---|---|---|
| `getProgramInfoLog` blocking calls | 82 (428 ms) | **3 (15 ms)** |
| …of them during walking | 56 | **0** |
| frames > 30 ms | 3 | 3 |
| worst frame | 108 ms | 149.8 ms |

**It removes 428 ms of main-thread blocking and did not reduce the long frames.**
Re-tracing the fixed build shows `GetProgramiv` down from 133 ms to 7.3 ms, but
~100 ms rAF callbacks remain, with the residual spread across many small
`GetBucketContents` round-trips — uniform-name queries during program setup.
So it is still shader setup, just distributed. Keep the change (strictly better,
zero risk, keeps dev diagnostics); do not call it a fix.

**The structural fix is pre-warming**: `renderer.compileAsync(scene, camera)`
during the bus ride, which is already a loading screen and already amortises
park generation. Not implemented — needs Jim's go-ahead.

## Harness

`…/scratchpad/harness/` (scratchpad — copy out before it is swept):
`instrument.js` (GL + rAF + heap + GPU-timer wrapper), `capture.mjs` (full
session, phase-labelled, CDP GC trace + clock alignment), `analyse.mjs`,
`attribute.mjs` (opens a long task up), `shaders.mjs` (who links programs),
`scene.mjs` (scene facts + shadow-pass split), `bench.mjs` (A/B on preview).

Traps found the hard way:

- **Blocking `/@vite/client` breaks the dev page entirely** — the app never
  boots. Do not do it; use `vite preview` instead.
- The "Let's go!" button has a **curly** apostrophe; `getByText` matches it but
  will not click it. Use `page.locator('button', { hasText: /Let.s go/i })`.
- **`window.game` and `window.journey` are `import.meta.env.DEV` only** — they
  do not exist on a preview/production build.
- **`getContext` interception grabs the character-creation preview's canvas
  first, not the game's.** My GPU timer queries were attached to the wrong
  context, which is why every `gpuMs` reads 0.00 — **the GPU-time column in the
  capture output is invalid and must not be quoted.** Take the context from
  `renderer.getContext()` instead. The shader finding does not depend on it
  (prototype-level wrapping and the Chrome trace both catch every context).
- A frame-interval spike is recorded on the frame *after* the expensive
  callback, so the `cpu_ms` column beside a spike is the wrong frame's CPU.

## Standards

`npm run build` → **exit 0** (twice, before and after the change).
`npm run test:procgen` → **exit 0, 11 files passed, 231 tests passed**.
Ports: dev 5437, preview 5438 (both mine, `--strictPort`). Not pushed to
`e/cat-bus-stage-a`. No URL handed to Jim.

---

# Round 2: what was built, and what it actually bought

Three commits on `perf/gpu-pauses`, cut from `e/cat-bus-stage-a` at `a43127f`.

## The A/B, same harness, same 170 s walk, dev server both sides

Baseline is `316bb10` (the `checkShaderErrors` change alone), so this isolates
the **warm-up's** contribution rather than re-counting the earlier win.

| during ordinary play | before | after |
|---|---|---|
| frames > 30 ms | 6 (267, 167, 159, 100, 42, 33) | **2** (83, 75) |
| worst frame | 266.6 ms | **83.4 ms** |
| time lost to those frames | 767 ms | **159 ms** |
| p99.9 frame time | 16.70 ms | **9.40 ms** |
| worst blocking GL call | **120.3 ms** | **7.3 ms** |
| shader links after hand-over | 94 of 146 | 65 of 174 |

The mechanism line is the last but one: a single synchronous GL call blocking
the main thread went from **120.3 ms to 7.3 ms**. That is the pause, gone.

## The warm-up does not lengthen the ride

| | measured |
|---|---|
| park built at | 5.6 s |
| **warm-up finished at** | **5.7 s** |
| ride length | 20 s |
| frames it took work on | 10 |
| total time spent compiling | 77.2 ms |
| **worst single `compile()` call** | **3.7 ms** (budget 8 ms) |
| slices left over at hand-over | 0 |

So it finishes inside the *first third* of the ride with ~14 s to spare, and no
single slice came close to overrunning a frame. The ride's own frame profile did
not get worse (6 spikes vs 7; 1067 ms lost vs 1291 ms). **The ride's big spikes
are pre-existing and are not this**: they are `new Game(...)`, the 442 ms
synchronous `World` constructor that `main.ts` already documents.

The "bus idles at the gate" safety net now covers warm-up too, via **one**
definition — `JourneyDirector.parkFitToPlay` (built **and** warmed), read by
both `readyToHandOver` and `overrunning`, so they cannot drift apart. It never
fires today; it is a guard, not a mechanism in use.

## What is left, and it is honest

**65 links still happen after hand-over.** The warm-up did not catch them, and
the remaining two 75–83 ms frames are presumably them. Two known reasons:

1. **`compile()` does not prepare shadow-pass depth materials.** The shadow pass
   draws with its own `MeshDepthMaterial`/VSM variants, compiled when the shadow
   map first draws them.
2. **Materials that do not exist yet at warm-up time** — `floorFade` clones a
   material per floor, highlight shells, speech bubbles, foliage-fade
   look-alikes.

Total links went *up* (146 → 174) because the warm-up compiles things a 170 s
walk never reaches. That is the intended trade and it is paid behind the bus.

**Next lever if the residue matters**: warm the shadow materials too, by
rendering one throwaway shadow-map frame during the ride.

## The standing measurement

`npm run check:frame-time` (+ `scripts/frame-time-probe.js`). Asserts the
**tail**, not the mean: p99.9 against two refresh intervals *derived from the
run's own measured p50*, zero frames over 100 ms, and no single blocking GL call
over 25 ms.

**Deliberately not part of `npm run build`** — it drives a real browser against a
real GPU for minutes, and CI has neither; wiring it in would make it fail always
or be skipped always, and a check that is quietly skipped is worse than none.

**Proven red before trusted green**, per CLAUDE.md, using the two real captures:

```
FRAMES_JSON=<baseline capture> npm run check:frame-time   -> RED_EXIT=1
FRAMES_JSON=<fixed capture>    npm run check:frame-time   -> GREEN_EXIT=0
```

and the red message carries real numbers, not `NaN`:

```
- 4 frame(s) over 100 ms during play: 167, 159, 267, 100 ms
- a single getProgramInfoLog call blocked the main thread for 120.3 ms (limit 25 ms)
```

Note `FRAMES_JSON` exists precisely so the thresholds can be re-proved against a
recorded capture without a four-minute browser run.

## Deliberately not done — Jim's call, written up as a GitHub issue

The shadow pass at 57% of draw calls, and 3.64 M triangles against a documented
400 k budget. Both change how the park looks. The issue also carries the two
documentation corrections and the allocation figures (191 MB/s, 1.6 MB/frame).

---

# Round 3: rebased onto round 5 of the cat bus (`5c0d426`)

The base moved while this was in review — seven more faults, including **a
self-cutting inside/outside shot director on the very ride this hooks into**.
Rebased rather than merged, so the three commits stay readable.

## The one real conflict, and it was additive

`src/main.ts`, in the dev-only `window.journey` handle: round 5 added
`view: () => string`, this branch added the five `warm*` accessors. Both kept.
Nothing else conflicted — `journeyDirector.ts` was untouched by round 5, and
`scripts/check-bus-journey.mts` auto-merged (both sides' assertions verified
present afterwards rather than assumed).

## Is there still exactly one definition of "the ride may hand over"? Yes.

This was the thing most likely to have broken, and it did not:

- The shot list is `JOURNEY_BEAT_SECONDS = JOURNEY_SECONDS / JOURNEY_BEATS`
  — **derived from the same `JOURNEY_SECONDS` constant** that
  `JourneyDirector.rideOver` reads. It is not a second clock.
- Nothing in the shot director gates hand-over. `main.ts`'s ride loop still has
  exactly one exit: `if (director.readyToHandOver) finish();`
- `parkFitToPlay` (built **and** warmed) is still the single owner, read by both
  `readyToHandOver` and `overrunning`.

**And the overrun case now composes correctly**, which is worth writing down
because this branch is what made that state reachable at all: `shotAt()` falls
back to the last shot past the end of the ride, and the last beat is
**`outside`** (odd `JOURNEY_BEATS` opens and closes outside). So a bus idling at
the gate waiting for the warm-up idles on the outside shot — which is the one
the arrival's 0.00-degree hand-over depends on. Had `JOURNEY_BEATS` been even,
an overrun would have handed over from *inside* the bus. It is not, and round
5's own comment explains why, but the two features only agree by that
reasoning — **if anyone makes `JOURNEY_BEATS` even, this breaks.**

## The measurements after the rebase

Round 5's ride is heavier (an inside camera with children in shot, a detailed
road), so it was re-measured rather than assumed.

| | before rebase | after rebase |
|---|---|---|
| park built at | 5.6 s | 5.8 s |
| **warm-up finished at** | 5.7 s | **6.0 s** |
| frames it took work on | 10 | 10 |
| total compile time | 77.2 ms | 76.5 ms |
| worst single `compile()` | 3.7 ms | **3.7 ms** (budget 8) |
| slices left at hand-over | 0 | 0 |
| in-play frames > 30 ms | 2 (83, 75) | **2** (92, 83) |
| in-play p99.9 | 9.40 ms | **9.40 ms** |
| worst blocking GL call in play | 7.3 ms | **7.4 ms** |
| ride frames > 30 ms | 6 | 6 |

The warm-up now finishes during **beat 2** (4–8 s, the first *inside* shot),
still inside the first third of a 20 s ride with ~14 s spare. The ride's own
profile did not degrade.

## Re-proved after the rebase, not carried over

- mutation `parkFitToPlay` → `parkReadyFlag` alone: `check:bus-journey`
  **exit 1** on both new assertions; restored **exit 0**.
- `npm run build` **exit 0**, `npm run test:procgen` **exit 0**.
- **236 tests / 11 files / 0 skipped**, reconciled rather than accepted: 231 was
  this branch's own earlier baseline, round 5 added 97 lines to
  `test/procgen/invariants.ts` worth 5 tests, and this branch touches **0** files
  under `test/` (its guards are `scripts/` checks run by `build`). 231 + 5 = 236.
- `check:frame-time` **exit 0** on the post-rebase capture.

## Trap worth repeating

A backgrounded `npm run build` notification reports the *harness's* exit code,
not npm's. Every exit code in this handoff was read from an `echo "X_EXIT=$?"`
recorded into the log, never from a notification.
