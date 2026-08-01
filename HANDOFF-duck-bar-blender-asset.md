# Duck bar Blender asset — handoff

Branch `feat/duck-bar-blender-asset` (PR #163). Status: **done, reviewed and
approved, a post-review regression from a merge of `origin/main` is now
fixed too, awaiting the Overseer's merge.**

## 2 August 2026 — post-review regression fix

PR #163 had already been reviewed and approved when Jim merged current
`origin/main` into the branch (`264985a`) to pick up an unrelated conflict
resolution in `test/procgen/invariants.ts`. `origin/main` had picked up
PR #162 (moved the rail-race stall to the rim) since #163 was last built,
and CI on the merged branch failed for real:

```
duck bar 8 at -49.2, -6.2 is 11.9 m from the nearest trestle leg, over the 8 m tolerance
duck bar 9 at -51.8, -6.5 is 9.3 m from the nearest trestle leg, over the 8 m tolerance
```

on both the canonical seed and seed-2, from
`duckBarsStandOnRealSupports` (`test/procgen/invariants.ts`).

**Root cause — confirmed exactly, not just suspected.** A duck bar always
renders at its lane's *fixed* radius (`route.ts`'s `LANE_RADII[lane]`, via
`route.pointAt`) — nothing ever nudges that. But `track.ts`'s
`trestleSpots()` can move a *mandatory* slot's support leg radially by up
to `±8` (the old `WIDE_RADIAL_NUDGES`) to dodge an obstruction on the
ground, and that radial nudge never fed back into where the duck bar
itself renders — only the shared `at` (arc position) did. `LANE_RADII`
offsets from nominal are `±3.9` (lane 0/3) and `±1.3` (lane 1/2)
(`LANE_SPAN / 2` etc., `route.ts`). The two failures are `|dr − laneOffset|`
exactly: `|8 − (−3.9)| = 11.9` (lane 0) and `|8 − (−1.3)| = 9.3` (lane 1) —
both pinned to the search's maximum radial nudge, `dr = 8`. PR #162's
stall move shifted the shared-RNG draw sequence (the butterfly effect that
PR documented) enough that the ground near these two mandatory slots
needed the full `±8` to clear, exposing a divergence bug that was always
latent.

This was also a genuine *visual* bug, not just a test artifact: the
trestle's beam and leg are drawn at the leg's nudged `x,z`
(`spots.forEach` in `track.ts`), while the droppers hanging down from the
actual rails are drawn, correctly, at the unnudged `x,z`
(`route.pointAt`). A large radial nudge would have stood the beam and leg
visibly beside the droppers, not under them.

**Fix, in `src/world/railRace/track.ts` only:**
1. `searchForClearGround` now searches radial-outer, arc-inner (was
   arc-outer, radial-inner) — arc nudges cost nothing (the bar and its leg
   share the same `at`, so shifting arc moves them together), radial
   nudges cost real alignment, so the search now spends its free arc room
   before growing the costly radial one.
2. New `MANDATORY_RADIAL_NUDGES` (`±4`, down from the old `±8`) is what a
   mandatory slot's wide search actually uses, paired with the existing
   `WIDE_ARC_NUDGES` (`±5`, unchanged) — `4 + 3.9 = 7.9 m` worst case,
   safely under the `8 m` `DUCK_BAR_SUPPORT_TOLERANCE`.
3. If that capped search finds nothing, `trestleSpots` falls back once
   more to the old uncapped `±8` (`WIDE_RADIAL_NUDGES`, kept for exactly
   this), logging a loud `console.warn` if it's the one that actually
   places a slot — a support that might exceed the tolerance is still
   better than a duck bar dropped with none at all.

Did **not** touch `DUCK_BAR_SUPPORT_TOLERANCE` or any other test
threshold — CLAUDE.md is explicit that thresholds come from the game, not
the generator, and this was a real placement bug, not a bad number.

**Verified:** `npm run build` exit 0. `npm run test:procgen` — 5/5 test
files (canonical + 4 sweep seeds), 80/80 tests, exit 0. Grepped the test
run's full output for `railRace/track.ts`/`warn` — nothing printed, so the
capped search + reordering found safe ground for every mandatory slot on
every seed without ever needing the uncapped last-resort fallback; the fix
holds structurally, not by luck. Pushed to `feat/duck-bar-blender-asset`;
`gh pr checks 163` confirmed green after the push.

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
