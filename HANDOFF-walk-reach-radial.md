# HANDOFF — walk reach radial (#643)

Model: Claude Opus 5 (1M), chosen by the Overseer. Branch `eng/walk-reach-radial` off
`origin/feat/sphere-combined`; PR goes against `feat/sphere-combined`.

## Findings (measured, `scripts/measure-walk-reach.mts`, canonical seed, scale 1)

- Real park: no ramp/deck further out than ~53 m. Worst per-SUB-STEP climb while
  following a ramp/deck: world 0.238 / radial 0.165 against 0.62 -> 0.38 m margin.
  No fall-through possible today. (The issue's 0.641-vs-0.670 is a whole-stride
  floor model; shipping sub-steps are <= 0.37 m.)
- Where they disagree today: knee-high RISERS within ~±0.09 m of 0.62 (carriage
  floors, facade-step sides, bridge deck edges): 584 honest step-ups refused, 55
  over-tall ones admitted, depending on bearing and frame rate.
- Synthetic local-grade deck, sprinted uphill toward the park, current sampler:
  steepest safe local grade 1.4 @20 m, 1.0 @60, 0.67 @94, 0.6 @117, **0.4 @140**
  (a 0.5 ramp, inside the 0.512 planner budget, drops her 13.7 m at 15 fps).

## Done (committed + pushed)

- Cure implemented: `stepCeilingAt`/`stepReferenceFor`/`carryReference` in surfaces.ts; Player,
  playerSim, NavGrid peel. `check:walk-reach` (own workflow walk-reach.yml): red on base, green here.
- After: 0 refused / 0 admitted on the real park; synthetic up-ceiling 1.4/1.4/1.2/0.8/0.8/0.67 at r=20..140.
- check:deck-fallthrough: deck now local-frame, ramp at origin -> 0.512/0.512/0.670/1.670, OK.
- check:hotel OK (11 carried, worst 0.052); mutation (7 residents -3 m) -> 7 named, exit 1.
- Next: full `pnpm run check`, then `test:procgen`; then PR against feat/sphere-combined.

## Plan (the cure)

1. `surfaces.ts`: `stepCeilingAt(x,z,y)` radial outdoors (spaceAt garden), +Y indoors;
   inverse `stepReferenceFor`; `carryReference(fromX,fromZ,y,toX,toZ)` keeps radius.
2. Player + scripts/playerSim.mts: carry the reference by radius across sub-steps.
3. NavGrid level peel uses the inverse (its `cursor - MAX_STEP - eps` trick assumed y).
4. Re-run: measure-walk-reach, check:deck-fallthrough, check:hotel (+ its mutation:
   7 residents named, exit 1), check:park / nav-routes, test:procgen canonical.
