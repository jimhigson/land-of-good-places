# HANDOFF — slide run-out collider (#664)

Branch `fix/slide-collider` off `origin/feat/sphere-combined`. **Paused by Overseer (sphere procgen rewrite). No PR opened.**

## Done (all pushed)
- `src/world/slide/chuteCollider.ts`: `lowChuteStretches` / `registerChuteCollider` — capsule chain (addWall, halfThickness = CHUTE_ENVELOPE.halfWidth) along the built curve every 0.5 m wherever the trough underside's *altitude* (altitudeAt − below) < TALLEST_CHILD_HEIGHT; `topIsAbsolute`, top = rim world y (centre y + CHUTE_ENVELOPE.above). A chain of capsules has no hollow middle.
- `Building.ts`: registered right after `planSlideLegs`/`buildSlideSupports` (so legs' isClear is unchanged).
- `test/procgen/parkFacts.ts`: new `march` fact (real resolveMovement, feet on WalkSurfaces.sample).
- `test/procgen/invariants.ts`: `theGinormousSlideRunOutIsSolid` — (1) marches from both sides, 5 bearings, 0.05 m and PLAYER_LONGEST_STEP; centre must never get within halfWidth of low centre line; coverage guard (reached ≥ half) printed to stderr. (2) landing spot reachable from gate via nav. (3) every standable metre within 3.5 m of the run-out must walk (real mover, 16 bearings) 3 m further clear — i.e. no pocket.

## Proven
- Without collider (Building call commented out): RED on canonical, 11, 24, 131, 326 — every march walked through (canonical: 126/126 reached, closest 0.01 m).
- With collider: GREEN canonical, 11, 24, 131 (logged: 126/126, 174/174, 120/120, 124/124 marches; 71/71, 91/91, 54/54, 74/74 standable metres can leave). **Seed 326 new-pocket-clause run was killed mid-run by the pause**; its earlier run (with the nav-based pocket clause) was green, 126/126 and 68/68.
- Controls: ring round the landing spot → landing + pocket clauses red; nav reports chute centre line unreachable and open grass reachable; 0.8 m ring round one cell beside the run-out → exactly that cell reported as a pocket.
- Why pocket clause uses the real mover: seed 24 has 3 metres near (-49,38) that the nav lattice calls unreachable **with or without the collider** (bushes+tree+leg), yet the real mover walks out on 21–31 of 72 bearings. Pre-existing nav conservatism, not this change.

## Not yet done
- Re-run seed 326 for the invariant; full `test:procgen` diffed by failing names against the base; `pnpm run check` (esp. check:slide-rider, check:pet-slide, check:park, check:nav-routes).
- Screenshot of her stopped at the low chute (/spawn beside it) → `qa-screenshots` branch under `slide-collider/`.
- PR against feat/sphere-combined.
