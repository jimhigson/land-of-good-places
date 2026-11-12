# HANDOFF — perf step 9: AudioContext off the frame

Spec: docs/perf/FRAME-DROPS-2026-11.md (PR #746 branch), item 19 / step 9.

## Findings
- `new AudioContext()` costs ~150 ms of main thread on the M4 Pro (146–179 ms,
  8 constructions, muted or not, before/after gesture, autoplay policy on/off).
  Constructing it *in the gesture handler* would move the stall, not remove it.
- There were **six** private contexts (chime, spookyHouse/sounds, puffSong,
  waterSplash, trainSounds, entrance/sounds) — six separate 150 ms first-sound hitches.

## Decision
- `src/core/audio.ts` owns the one context. `prepareAudio()` from `main.ts`
  builds it at boot (behind the splash) and arms permanent capture listeners
  (pointerdown/up, touchend, mousedown, keydown, click) that `resume()` it and
  play one silent sample on first unlock (old iOS). Modules call `audioContext()`.

## Measured (headless Chrome 1234, M4 Pro, /spawn?seed=0, 45 s, key press at 20 s)
- before (local main build): worst frame 158.6 / 166.7 ms at 4.8 s = puff ctor 149.6 / 160.3 ms inRaf; prod 208.6 ms (ctor 203.7).
- after: ctor once at -3 s (before first park frame), not in rAF; worst frame 50.5 / 49.7 ms, 0 frames > 100 ms.
- autoplay policy on: after build ctx suspended pre-gesture, running for all 40 post-gesture sound starts (before build had some post-gesture starts on a still-suspended 2nd ctx).

## State
- Code + measurement done. Running `check`, then `test:procgen`, then PR.
- main red on precache limit until #749 lands; merge main then.
- Harness: scratchpad measure.mjs/probe.js/unlock.mjs (copied into PR body text).
