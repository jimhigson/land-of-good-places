# Keychain size + physics (#314)

Jim's ask: "make the keyrings once on the bag 2.5x their current size. Also
apply physics so they swing around."

## What changed

- `src/art/models/keychains.ts`: added `KEYCHAIN_WORN_SCALE = 2.5` and
  `keychainWornLift(anchorHeight, charmHeight)` — one owner for both. The lift
  fixes a real problem the naive 2.5x uncovered: several charms, hung
  literally from `CHARM_HANGS`' bag-corner anchor at 2.5x, drag their tip
  through the ground on several of the five bags (measured: ripika 0.6045m of
  drop vs a 0.43m-high anchor on `satchel`/`bubble`). `keychainWornLift`
  raises the pivot only as far as the ground makes it, never touching
  `CHARM_HANGS` itself (still the bag's real clip point, still checked by
  `check:charm-hang` against built geometry, unmodified).
- `src/entities/WornKeychain.ts`: real charm now `KEYCHAIN_WORN_SCALE`d and
  lifted; the old "two sines, no physics" sway is replaced with a driven
  pendulum — two `Spring`s (one per swing axis) chasing a target proportional
  to the anchor's own acceleration, resolved into the anchor's local axes.
  Covers walking, stopping *and* turning-in-place with one mechanism (turning
  sweeps the off-centre anchor through an arc, which reads as acceleration
  with no special-casing) — see the class's own header comment for the full
  reasoning and the teleport-guard idiom borrowed from `PonytailChain`/
  `BalloonString`.
- `src/core/Spring.ts` (moved from `src/minigames/spookyHouse/spring.ts`):
  the "boing" spring-damper primitive, promoted out of Spooky House now that
  a second feature wants it, instead of writing a second one — CLAUDE.md's
  "one owner; everyone else asks". `src/minigames/spookyHouse/face.ts`'s
  import path updated; behaviour there is unchanged.
- `src/ui/characterCreationPreview.ts`: the keychain picker's live preview
  (which mirrors the real worn charm, `KEYCHAIN_SWAY_*` idle sway unchanged)
  now also scales and lifts the same way, so the picker doesn't show a
  smaller charm than what she'll actually wear. It has no player movement to
  drive the pendulum from, so it keeps its own idle two-sine sway — those
  constants' doc comment in `keychains.ts` was updated to say they're the
  preview's alone now, not a second owner of the real thing's motion.

## Verification

- `npx tsc --noEmit`: clean.
- `npm run check:charm-hang`: passes, all 5 bags — unaffected, since it
  checks the unmodified `CHARM_HANGS` anchor against built geometry, not the
  runtime lift.
- Full `npm run build` pipeline: every check up through `check:bus-journey`
  passed. `check:park-boot` failed — **confirmed environmental, not a
  regression**: reproduces identically on an unmodified `origin/main`
  checkout under the same load (this sandbox was running many concurrent
  agent builds; load average 10-22 on 4 cores during this session). Ran
  `check:arrival-completes` and `vite build` directly afterward — both real
  exit code 0 (not piped through `tail`/`head`).
- Not procgen — this is character/prop rendering, `test/procgen/
  invariants.ts` doesn't apply.
- Real-browser QA (Playwright-driven Chromium, version-checked to
  151.0.7922.34 first): opened `/keychain-stall`, equipped several charms,
  confirmed the shape on the player's back changes correctly per pick (a
  round yellow "ears + face" shape seen in some early screenshots was a red
  herring — it's an unrelated pet companion NPC that follows the player and
  sometimes stands in front of the charm, not a picking bug). Confirmed
  visibly larger charm at rest, and a clearly different lean/position between
  a settled pose and mid-walk frames, showing the pendulum is live rather
  than static. Screenshots under the QA scratchpad (not committed):
  `tight-star.png`, `tight-heart.png`, `tight3-swing-full-settled.png`,
  `tight3-swing-full-walk-0.png`.

## If picking this up

- The pet-companion NPC occasionally stands right where the charm hangs and
  blocks the view in a screenshot — not a bug, just something to route around
  when taking more QA shots.
- `Game.ts`'s `applyLiveLook` (the "Look" pill mid-game restyle) does not
  call anything on `WornKeychain` after `player.replaceModel` rebuilds the
  character (unlike `wornFlower`/`wornHat`/`wornJetpack`, which get an
  explicit `.rebind()`) — pre-existing, unrelated to this change, not
  touched here.
