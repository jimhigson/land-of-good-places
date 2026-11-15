# HANDOFF — simpler `?perf=1` box (branch `perf/simpler-perf-box`)

Jim, testing an iPhone freeze: "will I know right away I have the new build?"

Done:
- `src/build-identity.ts` — one owner of the build's short id and colour
  (`hsl(FNV-1a(version) % 360, 70%, 28%)`; white text >= 4.58:1 at every hue).
- `vite.config.ts` — new `__APP_BUILT_AT__` define (build time, display only;
  `version.txt` unchanged).
- `src/ui/PerfOverlay.ts` — box shows big fps (frames drawn per wall-second
  since the look before last, from `probe.frameCount`, looked at every 500 ms,
  text node written only on change), the sha + build time, and "Copy report"
  (same JSON as before plus `build: {sha, builtAt}`).
- Checked headless at 430x932: stall 120 -> 24 -> 120 fps; <= 2 writes/s
  throttled; report has slowestFrames etc.; nothing without the flag.

Deliberately NOT touched: `src/core/perfProbe.ts` — it is in the park source
hash closure (`node scripts/lib/park-source-hash.mjs --files`), so any edit,
even a comment, changes every served park's save stamp. Three comments there
still say "the overlay shows" the summary/heap; fix them with the next real
perfProbe change.

On a PR preview the box's sha is GitHub's merge commit (refs/pull/N/merge),
not the head sha in the preview URL.
