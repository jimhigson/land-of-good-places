# Real-phone baseline (120 fps plan, step 0a)

The plan's phone numbers (`docs/perf/FRAME-DROPS-2026-11.md`, #746) come from a
*stand-in*: desktop Chrome, 4× CPU throttle, an M4 Pro GPU. It says nothing
about a phone's GPU, thermals or Safari. Steps 12, 15, 16, 17 and 20 are sized
from **this** measurement, so take it before starting them.

Target: **8.3 ms a frame** (120 fps), CLAUDE.md.

## The cheap way: `?perf=1` on the phone itself

Append `perf=1` to any URL — the deployed site or a PR preview works, no dev
server or cable needed:

| scene | URL path |
|---|---|
| park | `/spawn?perf=1` |
| library, story time | `/library?sit=1&story=now&perf=1` |
| reptile house | `/reptile-house?perf=1` |
| castle | `/castle?perf=1` |
| hotel | `/hotel?perf=1` |
| Rail Race | `/rail-race?perf=1` |

The overlay (bottom-left) shows, over the last two seconds: fps, frame interval
p50/p99 and the **worst frame of the session**, main-thread CPU p50/p99 and the
share over 8.3 ms, the share that **missed a 120 Hz vsync** (> 12.5 ms) and that
were longer than a 60 Hz frame, draw calls and triangles per frame (all render
passes summed, shadow pass included), and JS heap with its growth in MB/s.

For each scene: load, **leave the phone untouched for 30 s**, press
**copy JSON**, paste the result somewhere (a note, a message). The JSON holds
the whole ~10 s ring summarised, the last two seconds, the GPU string, pixel
ratio, canvas size and user agent — enough to compare phones without a
screenshot. On a plain `http://` address the clipboard is refused; the button
then opens a text box to long-press and copy instead.

What it cannot see:

- **GPU time.** `cpu` is the main thread only. A frame that misses a vsync while
  `cpu` is low is GPU-bound — read the two together.
- **Heap on Safari / Firefox.** Only Chrome exposes `performance.memory`; the
  overlay says `n/a` rather than 0. Desktop Chrome quantises the value unless
  launched with `--enable-precise-memory-info`, and the overlay says so when
  the reading has not moved.

## iPhone first: is rAF capped at 60 Hz?

Safari has historically capped `requestAnimationFrame` at 60 Hz on ProMotion
iPhones. Check **Settings → Apps → Safari → Advanced → Feature Flags →
"Prefer Page Rendering Updates near 60fps"**. If it is on, the overlay's frame
p50 will sit at 16.7 ms whatever the game does — record that, because it decides
whether 120 fps is reachable on that phone from a web page at all. Measure once
with it on (what the family has) and once with it off (what the game can do).

## The thorough way, when the overlay raises a question

- **iPhone (Safari):** cable to the Mac; Mac Safari → Develop → *the phone* →
  the game's tab → Timelines; record *Rendering Frames*, *JavaScript & Events*
  and *CPU* for 30 s per scene above.
- **Android (Chrome):** USB debugging, then `chrome://inspect` on the Mac gives
  the full DevTools Performance panel. The #746 harness (`run.mjs`) can drive
  the same device over CDP with Playwright's Android support.
- **Cloud real devices** (BrowserStack, LambdaTest) are a paid account — Jim's
  call, not an agent's.

## Recording it

Put each phone's JSON on #746 (or the issue for the step it sizes), with the
phone model and iOS/Android version. A number without the device it came from
cannot size anything.

## What CI holds meanwhile

`check:render-budget` (shard 10) asserts draw calls and triangles per space
against ceilings measured when it landed. Those counts are what a phone pays
for regardless of its GPU, and they are identical on CI's software renderer and
on a phone, which is why they — and not milliseconds — are what CI asserts.
Frame time on a real GPU is `pnpm run gpu:frame-time`, run by hand.
