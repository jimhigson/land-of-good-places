# Duck bar Blender asset — handoff

Branch `feat/duck-bar-blender-asset`. Status: **done, PR open, awaiting review/merge.**

## What this branch does

Replaces the Rail Race duck bar's procedural `CylinderGeometry`/`BoxGeometry`
placeholder with a real Blender-authored asset (yellow/black hazard-stripe
texture), following the exact pipeline pattern the mine cart established
(`cart_export.py`/`cartAsset.ts`). Also fixed two real, severe bugs found
along the way:

1. **Trestle-leg placement was finding almost nowhere to stand.**
   `trestleSpots()` tried exactly one fixed candidate point per slot and gave
   up if blocked — 1 of 28 candidates survived against the real built park.
   Fixed with a small bounded local search; 25/28 now survive.
2. **Duck bars and trestle placement were unrelated systems** — a bar could
   land anywhere the hazard-schedule RNG cursor stopped, with nothing
   structural underneath. Fixed by snapping both onto the same trestle grid
   index (`hazards.ts`'s `snapToTrestleGrid`).

Both were committed by the previous agent (`a94cf73`, `e02e0ff`) before its
session died mid-task. I picked up from there — see full detail in their
commit messages, they're worth reading in full.

## What I did this session

- Verified the previous agent's uncommitted work (package.json,
  `textures.ts`'s `hazardTapeTexture()`, `hazards.ts`/`track.ts` further
  edits, the whole Blender pipeline: `duckbar.blend`, `duckbar_export.py`,
  `pack-duckbar-asset.mts`, `duckbar.glb`, `duckbarGlb.ts`,
  `duckBarAsset.ts`) — it was complete and already correctly wired
  (`track.ts` imports `duckBarAssetGeometry` and uses it for the
  post/bar `InstancedMesh` geometry, `hazardTapeTexture()` applied to the
  bar material). Nothing needed finishing beyond committing it.
- Committed as `7ef9e96` → after rebase `8b1782a` (see below). Left the
  iteration screenshots (`art/blend/live-v*.png`) untracked — no precedent
  for committing those (checked `cart`/`kid`'s history in `art/blend/`,
  neither kept iteration screenshots).
- Rebased onto `origin/main` (was 3 commits behind: `303adc4` Ethan skin
  tone, `6e7d510` exit-crowd feature, `53ad192` cart round 3). Clean rebase,
  **zero conflicts** — none of the three touch `track.ts`/`hazards.ts`/
  `textures.ts`/`package.json`. `test/procgen/invariants.ts` is touched by
  both sides (this branch's two commits and main's `6e7d510`) but merged
  cleanly.
- `npm run build`: exit 0, both before and after rebase.
- `npm run test:procgen`: 70/70 before rebase, **75/75 after** (main's
  `6e7d510` added 5 more invariants for the exit crowd; all green).
- Visually verified in a running dev server (port 5471, own instance,
  killed when done) via the shared chrome-devtools profile — used
  `background: true`, closed only my own page (51), left other agents'
  pages (7, 49, 50) untouched.
  - Screenshots show duck bars mounted directly above their trestle
    support posts (not floating), with the yellow/black diagonal
    hazard-tape stripe visible on the bar's exposed tips either side of
    the animated alert sleeve.
  - Confirmed at the engine level via `evaluate_script` against
    `window.game.world.railRace.track.group`:
    `railRace:duck-bars` is an `InstancedMesh`, 20 instances, **384
    vertices** (real authored geometry, not a 24-vertex box), material
    has `map` set to a **256×256** texture — exactly matches
    `hazardTapeTexture()`'s canvas size. `railRace:duck-bar-posts`
    likewise uses the asset's geometry. `railRace:trestle-legs` shows
    **25** instances, matching the earlier fix's "25/28 survive" figure.

## PR

Opened via `gh pr create`. **Not merged** — per CLAUDE.md, only the
Overseer merges, and only one review is needed per current policy.

**Important for the reviewer/Overseer:** this PR's `track.ts`
trestle-placement fix is a superset of / supersedes PR #161 (which only
fixed a scoping bug causing legs to under-render, landing ~26/67 slots).
This branch independently found and fixed the deeper root cause (single-
candidate search failing against real park density) and gets 25/28
candidates to succeed, plus makes duck bars structurally snap to those
same supports. Jim is holding #161 back from merging until this lands, so
the two don't fight each other in `track.ts`.

## Nothing left to do on this branch

Build, tests, rebase, and visual QA are all done. If picked up again, the
only likely follow-up would be addressing review comments.
