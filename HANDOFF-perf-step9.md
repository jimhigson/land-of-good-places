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

## State
- Code done, tsc clean. Next: measure before/after (scratchpad harness
  measure.mjs + probe.js wrap the ctor, record inRaf + long frames on /spawn?seed=0),
  run check + test:procgen, open PR. Needs `LGP_SEEDS=0 pnpm run build:parks` for preview.
- main is red on precache limit until #749 lands; merge main then.
