# Engineering brief — stage 3, step 2: the trestles become a placer (sphere world)

**Status: HELD until (a) step 1 (road placer) is on `main`, (b) #511 (the
park off its hill, ground as a sphere) is on `main`, and (c) the five-seed
measurement in the design doc's "Stage 3, ruled" section is in.** Then
dispatchable as written. If the measurement contradicts the doc's
prediction, the Architect re-cuts first. Authority:
`docs/DESIGN-round-robin-generation.md`, "Stage 3, ruled (5 Sep, Jim)" and
"A feature's own supports are claims". One engineer, one worktree.

**Visible work**: the park changes on every seed (feet leave the road
corridor — #498 counted 2–8 per seed). Preview link with
`/spawn?pos=…` at the gate, one sentence ("the bus's road is clear of the
rail-race posts; the posts now stand outside it"), Jim's sign-off.

## The rule a reviewer looks for first

**The exploration query and the commit check must be the same function**,
and **a claim describes the drawn geometry** (#504 variant). For a trestle
that means the plan projection of everything below the road corridor's
headroom — the leaning trunk, not a foot disc. A search that pre-filters
with one predicate and commits with another, or a claim that is a foot
disc while the drawn post leans through the road, is wrong even while
green.

## What this step is

- **Legs are footprint claims** asked of the one production `GroundClaims`
  (step 1 created it; `World` receives it — do not make a second). The
  claim shape per trestle is the plan projection of the support below the
  road corridor's headroom; the corridor claim carries that headroom
  (from the bus's own owner + the clearance the step-2a instrument uses —
  one owner, read by both).
- **The three nudge ladders are deleted** — `RADIAL_NUDGES`,
  `MANDATORY_RADIAL_NUDGES`, `WIDE_RADIAL_NUDGES` (and judge `ARC_NUDGES`/
  `WIDE_ARC_NUDGES` by the same rule; say what you decided). One outward
  march from the ring, nearest-first, deterministic, asking the registry
  with the one function, stopping where a claim refuses or the ground
  ends — never at a typed reach. Ruled in the doc; do not re-argue it in
  the PR, measure it.
- **When the nearest allowed foot leaves today's trunk crossing the
  corridor at height**, the placer chooses a different support shape
  (`forkPlan`: vertical to headroom, then the fork; or a portal) — see
  the doc's ruling point 3. If the five-seed measurement shows the sphere
  alone clears posts at height, this bullet is dormant: say so, with the
  numbers, and leave the shape decision to step 4. Do not author new
  geometry without the Artist if it is needed — request it.
- **The construction-order trick dissolves**: both rings' legs become
  claims in one registry; the walk-past-first ordering becomes claim
  order; update the `RailRace.ts` comment to describe the claims.
- **Order inside `World`**: legs are built at `World.ts:214`, the entrance
  at `:268`, and the road's corridor is *re-committed* once paving is
  published. Either prove (measure, all seeds) that the spur end moving
  z 52.00 → 55.91 reaches no foot, or place the legs after the road's
  realised claim. State which and why.
- **No named road clause on `main`.** If #498 landed first and brought
  one into `groundIsClear`, delete it here — deleted, not tuned.

## What must not change

- The ring itself (`RAIL_RACE_PLAN`, the perimeter circle — family brief).
- Ring support: `test:procgen`'s 40 m widest-run invariant and the
  duck-bar fairness invariant stay green on all sixteen seeds — those are
  the invariants #498's clause turned red.
- No ladder loosening (step 3), no cross-feature negotiation beyond the
  refusal path (step 4), no new constants, no warp fields, no terrain
  constants.

## Acceptance — measured

1. Step 2a's ratchet reads **0 intrusions on every seed** (posts at
   height, not feet); baseline file deleted; the check now fails on any
   intrusion.
2. Registry sees every leg: claim count == built-leg count, both rings,
   all seeds.
3. One-function proof, broken deliberately (search uses a stale copy →
   red run pasted with geometry).
4. Leg-position hashes before/after per seed, every change accounted for
   as "left the corridor" — a moved foot with no corridor nearby is a bug.
5. Determinism: two builds per seed in separate processes, identical.
6. Full gates green; chain verified by parsing `scripts`.
