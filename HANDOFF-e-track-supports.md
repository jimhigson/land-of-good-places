# HANDOFF — e-track-supports

Branch `e/track-supports`, cut from `origin/chore/rail-race-pr-triage` (PR #223,
which already reworked the droppers — do **not** rebase onto `main`).
Worktree `.claude/worktrees/e-track-supports`. Dev port **5477**.

**Status: all four pieces built, built green, and watched in the browser.**
`npm run build` exit 0. `npm run test:procgen` 241 passed / 9 files / 0 skipped
(was 221). Screenshots in
`/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/68ade46a-c81d-46a8-8676-003ebeeaa648/scratchpad/shots/`.

## What was asked, and what is built

1. **Rail Race trestles are branching trees.** Base post 0.52/0.68 m (2x the old
   0.26/0.34), splitting into two branches and then four, one top under each
   lane. One grey — `ART.statueStone`.
2. **Sky Cruiser has vertical supports.** 16 pylons where there were **4**, same
   thickness as the Rail Race base post, imported not copied.
3. **Sleepers at 1 m on both rides.** Rail Race 2400 a ring; Sky Cruiser
   `TIE_STEP` 1.4 -> 1, so 217 ties against 155.
4. **Duck bars one per lane, spread round the lap, legs in the lane's colour.**

## Measured, canonical seed

| | before | after |
| --- | --- | --- |
| Sky Cruiser pylons on 217 m | 4 | 16 |
| Rail Race trestle foot radius | 0.34 m | 0.68 m |
| dropper radius | 0.08 m | 0.124 m |
| duck bars per lane per lap | 10 (all lanes at one point) | 10 (all different points) |
| closest two bars | 0 m (stacked) | 12.00 m, vs 5.75 m bar width |
| whole scene triangles | 2,367,240 | 2,443,968 (+3.2%) |

Fork angle is solved per ring by `forkPlan`: walk-past **30.0°** exactly, race
ring **41.6°**. 30° everywhere is geometrically impossible on the race ring —
reaching four lane centres needs 4.125 m of sideways reach, which at 30° wants
7.14 m of fork inside the 6.60 m between ground and tops, before any trunk. The
floor, with a zero trunk, is 32.0°.

## Three rulings from Jim, all final

1. **Fairness is the equal bar count**, not equal positions. The pack breaking up
   mid-race is accepted behaviour: *"so long as it is fair overall it doesn't
   matter if some go faster or slower for small sections of the ride"*.
2. **Bars may cross the black bits.** *"yes they can be over the black bits -
   I'm reversing that decision, with no argument asked for"*.
3. **The competent-player margin bound is deleted**, not raised: *"I never signed
   off that check as a requirement... otherwise delete it"*. It was added the
   same morning by the Overseer, guarded a staging consequence nobody had
   observed, and `RIVAL_SKILL` was **not** touched. The child-facing bound below
   it is a different assertion and stays.

With the shipped layout and `RIVAL_SKILL` untouched at 0.51/0.60/0.69: child
pace at level 3 wins **17/24** against a baseline 11/24; levels 1 and 2 are
unchanged to the metre at 24/24, means 41.2 m and 44.4 m.

## Root causes found

- **Sky Cruiser's 4 pylons.** `Coaster.buildTrack` rejected any candidate within
  `entry.boundingRadius + 2.4` of a `PARK_LAYOUT` entry. That is 19 m for the
  castle, 15 m for the dodgems — plots this ride exists to fly over. 28 of 38
  candidates died to that test alone. `slide/supports.ts` hit the identical bug
  two days earlier and fixed it with a hand-kept `JOINED_PLOTS`;
  `coaster/pylons.ts` asks the route instead, so it cannot go stale.
- **Duck bars intersected as arithmetic, not accident.** A bar reaches 2.875 m
  either side of its lane centre; lanes are 2.750 m apart. Four at one arc
  distance *had* to overlap, by 3.00 m.
- **A check that could not fail.** The sleeper-spacing assertion compared the
  built spacing to `SLEEPER_SPACING`, the constant the builder used, so
  `SLEEPER_SPACING = 2` passed cleanly. Now asserts a literal metre.
- **`duckBarsSlowYouWhereTheyStand` silently became wrong**, deduping bars by arc
  position on the reasoning that "all four lanes of one bar share it". Extended
  to work out each bar's real lane.

## Mutations, all proved red

branch tops sent to one lane · post back to old thickness · fork ratio changed ·
sleepers at 2 m · sleepers rolled by minimal rotation (#112) · bars restacked at
a shared point · one lane starved of bars · cruiser's old plot keep-out restored.

## Notes for whoever is next

- `railRace/trestleGeometry.ts` is a **leaf module** — imports nothing. It exists
  because `track.ts` reaches `parkLayout.ts`, and a static import of that into
  `test/` fixes the park seed before the harness sets it (the 76-silent-skips
  failure). Same answer as `train/trainDimensions.ts`.
- `coaster/pylons.ts` exports `PATH_CLEARANCE`; `slide/supports.ts` still keeps
  its own copy of 2.8 with a comment calling it "the coaster's pylon figure".
  Worth pointing the slide at the owner — not done here, out of scope.
- **Finish-shot question**: rivals *are* visible in frame near the finish rainbow
  (`21-race-t144s.png`). Not a rigorous celebration-camera measurement; the
  automated run finished 4th and the celebration passed between interval shots.
  Informational only — Jim deleted the bound this was going to inform.
