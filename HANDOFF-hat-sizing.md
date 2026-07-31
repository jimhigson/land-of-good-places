# HANDOFF — hat-sizing (31 July 2026 re-open)

Branch `feat/hat-sizing`, off `origin/main` (986890d).

## The ask (from the family, quoted verbatim in the session transcript)

1. **"totally fine, but make all hats 50% bigger"** — every hat, ×1.5.
2. **"make crown and cherry cap 30% bigger again"** — an *additional* ×1.3 on
   the Sparkly Crown and the Cheery Cap only, so those two land at ~×1.95.
   RiPika Cap and Trilla Hat are **not** named: base ×1.5 only.

Implemented once as scratch (`// TEMPORARY: for testing`, a `hatGroups(name,
extra)` parameter) during a live-testing session, then lost when the Cheery Cap
and the two critter hoods were rebuilt on `hoodShell.ts`. This branch makes it
permanent.

## Finding 1 — a uniform scale about the hat anchor blinds the wearer

`hatGroups` puts every hat's geometry in a `fit` group scaled by
`FIT = KID_HEAD_SCALE`, and the group's origin **is the hat anchor** (the crown
of the skull). So multiplying `fit.scale` by `k` scales the hat about the crown:
it gets `k×` wider **and its hem descends `k×` further down the face**.

Measured (`scripts/probe-hat-scale.mts`, per-azimuth against `check:hair`'s own
eye model — eye top is 0.385 m below the anchor):

| hat | clearance now | after a naive ×1.5 / ×1.95 |
| --- | --- | --- |
| party | 0.221 | 0.138 |
| crown | 0.236 | **0.078** (×1.95) |
| bobble | 0.159 | **0.039** |
| sun | 0.253 | 0.182 |
| cap | 0.101 | **−0.169** (×1.95) |
| flower | 0.193 | 0.088 |
| ripikaHat | 0.109 | **−0.029** |
| puff | 0.107 | **−0.033** |

Negative = the hat is *over the eyes*. The Cheery Cap's peak would sit 17 cm
below the top of her eyes. That breaks GAME_DESIGN.md's rule that a critter
hood never comes down over the wearer's face, and `hoodShell.ts`'s own
"every peak clears the eyes by at least 0.15 head units".

**So "bigger" cannot mean "scaled about the crown".** A hat must grow *upward
and outward from the ring where it meets the head*, not sink into it.

## Finding 2 — the ×1.95 cap the family approved is not this cap

The scratch hack was approved by eye against the *old* Cheery Cap (a squashed
sphere with a half-cylinder peak) and the old critter hats (shrunken creature
heads). All three were rebuilt on `hoodShell.ts` afterwards, and the rebuilt
cap already sits far lower on the skull (0.067 head units of eye clearance vs
the crown's 0.157). The multiplier transfers; the visual result does not.
Flag for family QA.

## Status

- [x] Baseline measured, mechanism problem found
- [ ] Mechanism implemented
- [ ] `check:hat-fit` bounds re-derived + eye-clearance gate added
- [ ] `HAT_DISPLAY_SCALE` / shop stands checked
- [ ] build green, PR open

No browser: not confirmed as mine. PR will list what needs eyes on it.
