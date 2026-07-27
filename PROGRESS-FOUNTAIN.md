# Fountain splash — progress

Branch `feat/fountain-splash` off `origin/main`. Deleted before opening the PR.

## Plan

1. **Collider**: replace the single `collision.addCircle(x, z, rimRadius+0.25)`
   (which makes the whole interior solid — a circle collider has no "hollow
   middle") with a ring of ~28 short `addWall` segments approximating a circle
   at `rimRadius`, `topHeight ≈ 1.1` (basin wall is 1.05 m tall — jumpable,
   comfortably under the 1.4 m jump ceiling documented in Player.ts). Grounded
   movers (player, NPCs, parade — all call `resolve()` with the default
   `clearance = 0`) bounce off the ring from any angle exactly as before.
   Jumpers whose `hopClearance` clears `topHeight` sail over whichever segment
   they're above, and once inside there is no collider left to push them back
   out, so the interior is free to walk in. No Collision.ts changes.

2. **Ground level inside**: `Fountain.groundLevel(x, z, fallback)` returns a
   fixed shallow-water height (`waterLevel - WADE_SINK`) inside a
   `waterRadius` disc, else passes `fallback` through untouched. Composed in
   `World.attachPlayer` on top of whatever the building/terrain sampler
   already returns, so indoor floors are untouched — a couple of lines in
   World.ts, no Player.ts ground logic changes.

3. **Wading + splashes, read from Fountain.update()**: `Fountain.attachPlayer`
   stores a `Player` reference; `update()` reads `player.position`,
   `player.velocity`, `player.isAirborne` (all already public) to drive:
   - continuous small foot splashes + ripple rings while wading
   - a proper splash (droplets + wave ring) on landing in water from a jump
   - a smaller splash on takeoff from water
   - `player.speedMultiplier` (new, default 1) set to ~0.6 while wading
   - `player.waterHappy` (new, default false) set while in the water

   These two are the only Player.ts additions — both simple fields read once
   per frame, one frame stale by construction (same tolerance the existing
   `hopClearance` already documents). `speedMultiplier` folds into the
   existing speed-limit line; `waterHappy` folds into the existing
   blink-expression edge-detect (renamed `blinking` bool → `currentExpression`
   so happy doesn't get fought by the blink transition writing 'neutral').

4. **New `src/art/effects/waterSplash.ts`**: pooled droplets (InstancedMesh,
   confetti.ts's pattern) + a small pooled ring-wave (rainbowRing.ts's
   pattern, two-tone vertex-coloured gradient instead of six-band rainbow).
   Plus two standalone tiny WebAudio noise-burst functions (`playPlip`,
   `playPloosh`) — not reusing `ui/chime.ts` since `ui/` is out of scope;
   same lazy-AudioContext technique, self-contained.

5. **Coins**: a handful of static toon-shaded coin meshes on the fountain
   floor, `ART.helmetGold` + `inkTint` — no wishing/coin-toss logic touched.

## File ownership

- `src/world/Fountain.ts` — main work
- `src/art/effects/waterSplash.ts` — new
- `src/entities/Player.ts` — two new fields + two one-line edits only
- `src/world/World.ts` — `attachPlayer` composes the ground sampler + wires
  `fountain.attachPlayer`

Not touched: Collision.ts internals, npc/parade/minigames/ui/state,
package.json.

## Status

- [x] Collider ring
- [x] groundLevel + World wiring
- [x] Player hooks (speedMultiplier, waterHappy)
- [x] waterSplash.ts
- [x] Fountain wading/splash logic + coins
- [x] Build green
- [x] Browser verification: jump clears rim, player lands inside water
      (confirmed via debug overlay, x 0.0 z 3.1, well inside waterRadius);
      screenshot captured. Splash-in-progress screenshot still pending —
      shared browser environment (many concurrent agent sessions) makes
      precise-timing screenshots hard; retrying.
- [ ] Wading/ripple + jump-out + grounded-block + parade screenshots
- [ ] Commit + PR

## Notes on the shared browser environment

This box runs a whole fleet of concurrent agents against ONE real Chrome
instance (`chrome-devtools` MCP). `select_page` sets a *global* "currently
selected page" that other agents' concurrent `select_page` calls can and do
overwrite between my `select_page` and the next tool call — every
`evaluate_script` here starts with a `window.location.href` guard and
retries the select+act pair on a mismatch. Also: the game's own
`InputSystem.onBlur` clears held keys on window blur, which fires often
when other agents keep stealing OS focus — worth spamming `keydown` every
~50ms through a hold rather than firing it once. Dev server + browser page
get periodically culled (~20 min) by a housekeeping process; restart both
if a page/script suddenly can't be found.
