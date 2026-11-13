# HANDOFF — fix/dom-churn-ci

`check:dom-churn` (shard 12) timed out on the hosted runner (run 43439027681):
`frames(page, SETTLE_FRAMES)` never saw 360 frames in 240 s.

## Root cause (measured)

The check waits for 2 × (360 + 240) rAF frames of the full park. A frame's cost
under SwiftShader is the **GL draws** (≈600 draws / 1M tris + the VSM shadow
pass), not the DOM: seed 5 spawn, 1000×700, DPR 1:

| renderer | fps |
|---|---|
| M4 Pro GPU | 120 |
| SwiftShader, P-cores | 3.0 |
| SwiftShader, DSF 0.25 (fill cut 16×) | 3.3 — not fill-bound |
| SwiftShader, shadows not updated | 5.7 |
| SwiftShader, `scene.visible=false` (sky only) | 120 |
| SwiftShader, GL draw calls stubbed | 120 |
| SwiftShader + `taskpolicy -c background` (E-cores, runner-like) | 0.4–0.8 |
| same, GL draw calls stubbed | ~10 |

## Fix

Stub the WebGL draw entry points (`drawArrays/Elements[Instanced]`,
`WEBGL_multi_draw`) on the game's context after boot. Everything else a frame
does still runs (tick, HUD, three's traversal/culling/uniforms/`info` counts).
The check asserts nothing about pixels. Control: skipped GL draws must equal
three's own `info.render.calls` sum, and be > 0.

## State

- worktree `.claude/worktrees/fix-dom-churn-ci`, own vite on :5791
  (pnpm wrapper pid 49895, node pid 49908) — kill by PID when done.
- park: copied lazy-hotel's seed-5 park into `.parks/dev/738b367b6b15f730/5/`.
- Other at-risk checks: cull-audit FAILED on the same CI run (not a timeout:
  hotel disco-mote stale bound, sky cruiser / slide off-screen tris over
  ceiling). render-budget passed (3m33s). nav-warm, npc-sim-lod,
  hot-path-churn are Node-only.
