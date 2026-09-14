# Handoff — Architect, spherical domain design

**Branch:** `arch/sphere-domain`. **Deliverable:** `SPHERE-DOMAIN.md`, 939 lines,
committed and pushed. It is a design, not code. Nothing else on this branch.

## State: complete

All five questions in the brief are answered, plus Jim's two follow-up rulings
(deep rewrite not adaptation; interiors flat and off-sphere).

## The facts it turns on, so a replacement need not re-measure

- `R = GROUND_SPHERE_RADIUS = 220`. Park furniture reaches 157 m (45.5 deg lean),
  walkable garden 135.4 m (38 deg).
- **A flat patch is good to 4.69 m radius at 5 cm departure; 20.95 m at 1 m.**
  This is the finding that decides the design — no ride, route or path fits in a
  flat patch (coaster loop departs 2.80 m, train loop 9.41 m, rail-race ring
  29.47 m). Castle floor plate: 1.02 m on the side, 1.58 m on the half-diagonal.
- A 0.5 m lattice cell is 0.714 m radially at 157 m, against `MAX_STEP = 0.62`.
- Sizes: src 169,758 lines / 391 files; scripts 52,563; test 16,708.
- `Collision.ts`, `NavGrid.ts`, `spaces.ts`, `floors.ts` are **byte-identical**
  between `origin/main` and `feat/sphere-combined`.

## Open items a successor should carry

1. **Three live defects reported in section 12** — they are not this design's
   work and should not wait 9 weeks. The NavGrid `MAX_EXPANSIONS` one is the
   real one (budget now 4-5x below cell count after the park grew 2.33x).
2. **Section 13's three questions are with Jim**, and only the first (does a
   child ever walk right round the planet?) is blocking.
3. **Sequencing note for the Overseer** (section 8): `GroundClaims` already
   landed on main in #499 with flat `Disc`/`Capsule`, and `roadCorridor.ts` in
   #522 is the first placer on it. Every further placer built flat is another
   consumer to migrate. Phase A ought to land before Decision 12's stage 3 adds
   more.

## Method notes

Both subsystem surveys were done by Explore subagents and their findings
materially changed the document (they raised the estimate from 8+/-2 to 9-11).
Every number in the document was computed, not quoted; the appendix says how.
