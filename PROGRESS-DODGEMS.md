# Dodgems mini-game — progress handoff

Branch `feat/dodgems`, worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/dodgems`
(the first worktree was culled mid-session; the branch survived and was re-checked-out
here — nothing was lost.)

## Done

- Read the design docs, the mini-game framework and RailRacer.
- Whole mini-game written and `npm run build` is green:
  - `dodgems/layout.ts` — arena dimensions and bounce constants.
  - `dodgems/arena.ts` — circular rink, sparkly floor (instanced discs, twinkle by
    scale), striped bumper wall, fairy lights, surrounding grass.
  - `dodgems/car.ts` — bumper ring + tub + pole; driver is the park's own
    `createKid` / `createRipika` on a scaled wrapper (root.scale left for squash).
  - `dodgems/tree.ts` — **the fake wooden tree**: wobble, apple pool (8, bounce off
    cars and floor, return to the canopy after 6 s), instanced leaf rain (90),
    startled bird with a "TWEET!?" sprite bubble. All four fire from one `bonk()`.
  - `dodgems/sparks.ts` — one instanced pool, sparks + confetti.
  - `dodgems/giggles.ts` — pooled sprite giggle bubbles ("hee hee!", "bonk!"…).
  - `dodgems/steering.ts` — keyboard / gamepad / thumb-stick, module-local.
  - `dodgems/hud.ts` — time, bump and tree-bonk pills, shouts, result card, stick.
  - `dodgems/Dodgems.ts` — the `MiniGame`: 78 s ride, 3-2-1, 5 rivals, elastic
    collisions, tree bonks, confetti finish for everyone.
  - `dodgems/plot.ts` — the ride as it stands in the park's anchor plot.
- Registration: one row in `minigames/stalls.ts` (id `dodgems`, kiosk at [24, 12]).
- Wiring: `world/World.ts` gets one import, one field, one constructor block, one
  update line and one dispose line — nothing else in that file is touched.

## Non-obvious decisions

- **Steering is module-local.** `MiniGameInput` is one-button by design and
  `types.ts` / `MiniGameHost.ts` / `overlay.ts` belong to other in-flight PRs, so
  `steering.ts` attaches its own `window` listeners (the overlay's pointer capture
  retargets events but they still bubble to `window`). Touch = virtual stick
  anchored where the finger went down; pressing a direction also counts as "go".
- **Circular arena**, not the classic rectangle: no corners to get wedged in,
  trivial wall maths, and it fills a portrait phone better.
- **Camera** is fixed-yaw pseudo-top-down. It fits the whole rink where it can and
  pans (clamped to the rink's edge) on narrow screens instead of zooming out past
  `MAX_VIEW_HEIGHT`.
- **Rivals aim at the tree a third of the time**, so the big gag fires even when
  the player is still learning to steer.
- The park-side tree is a separate static build in `plot.ts` — the rink's tree
  carries pools and a bird that should not sit in the park's scene graph.

## Next step

Browser verification: `npm run dev`, enter from the plot by click and by touch,
drive, bump, bonk the tree (check all four effects), finish, exit, portrait phone
check, console clean, screenshots to `art/renders/dodgems-*.png`. Then PR.

## Files I own

- `src/minigames/dodgems/**` (new)
- one row in `src/minigames/stalls.ts`
- the dodgems block in `src/world/World.ts`
