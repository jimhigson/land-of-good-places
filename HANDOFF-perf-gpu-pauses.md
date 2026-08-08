# HANDOFF — perf/gpu-pauses

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
