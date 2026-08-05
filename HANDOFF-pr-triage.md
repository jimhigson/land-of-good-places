# HANDOFF — pr-triage (task #12)

Branch `chore/rail-race-pr-triage`, worktree `.claude/worktrees/pr-triage`, off
`origin/main` @ `a68ed54`. Port 5315 if a dev server is needed (not started yet).

**Job:** triage the two open Rail Race PRs from 1 August (#155, #157), both
CONFLICTING. Land what is genuinely unlanded, close what is superseded, never
drop work without a written trace. Do NOT merge.

## Findings — measured against current main, not assumed

### PR #155 (frown expression) — ENTIRELY UNLANDED → landed on this branch

`grep -rn "frown\|browStyle" src/ scripts/ test/` returns **nothing** on main.
`Expression` is still the five-member union. Both commits cherry-picked:

- `4893dec` — `faces.ts`/`sharedFace.ts`/`ASSET_MANIFEST.md`. Applied **clean,
  no conflict**: main already has the `EXPRESSIONS` array + `expressionPaints()`
  split the PR was written against.
- `041671d` — `Player.ts` + `RailRace.ts`. **Two conflicts, both resolved to
  main's newer APIs:**
  - `Player.ts`: the PR carried its own inline blink state machine
    (`blinkTimer`/`blinkRemaining`/`currentExpression`). Main has since
    refactored that into `faceLife.ts`'s `createFaceLife`. Resolved by
    extending the *resting* expression only:
    `this.face.update(dt, this.railRaceFrown ? 'frown' : ... )`. This preserves
    the PR's intended priority exactly — `faceLife` punches a blink *through*
    whatever resting face it is handed, so blink still outranks the frown, the
    same way it outranks `waterHappy`.
  - `RailRace.ts`: PR had `this.ducking = !rider.holding`; main renamed that
    concept — `Rider.holding` **no longer exists**, ducking is its own input.
    Kept main's `this.ducking = rider.ducking` and added only the frown line.
  - Stale comment fixed: the PR claimed `sparking` is "only true while
    `holding` is". On main `sparking = inZone && rider.sparkGuard > 0`
    (`simulate.ts:310`) — in a black zone *and* still mashing. Different
    mechanism, **same behaviour the PR relied on**: easing off clears the
    frown by itself. Trigger is still correct.

`tsc --noEmit` exit 0 after both.

### PR #157 (polish round 2) — MOSTLY SUPERSEDED

Claims 1 (black rails), 3 (standings HUD), 4 (asymmetric band), 5 (SpotLight
headlamps) are **all on main already**, arrived by other routes. Main's own
comments cite PR #157 by number as the thing they implement
(`simulate.ts:441`, `track.ts:236-239`).

**The Overseer's steer — that claim 2's supports root-cause analysis is the
surviving value — is half right, and the half that matters is the other half.**

- Claim 2 *first half* (only 4 of 67 candidate spots survived
  `collision.isClearCircle`) — **already fixed on main by a different design.**
  Not the PR's `deckSpots()`/`footUnder()` split (neither identifier exists),
  but a three-stage nudge-escalation search in `trestleSpots`
  (`ARC_NUDGES` → `MANDATORY_RADIAL_NUDGES` → `WIDE_RADIAL_NUDGES`,
  `track.ts:1092-1109`) plus a shared bar/trestle grid index
  (`hazards.ts`'s `snapToTrestleGrid`). `test/procgen/invariants.ts`'s
  `railRaceFliesClear` records the same root cause in its own words — "1 of 28
  on the canonical seed before that search existed" — and now guards it with
  `TRESTLE_GAP_TOLERANCE = 40` m on all five seeds. So this is dead work.
- Claim 2 *second half* — **still live and unaddressed.** Droppers are still
  one per lane on the lane **centre line** (`track.ts:584-593`,
  `route.pointAt(lane, spot.at, point)`), while
  `RAIL_GAUGE = RAIL_GAUGE_AT_PARK_SCALE * RIDE_SCALE`, `RIDE_SCALE = 2.5`
  (`route.ts:157`) — exactly the geometry the PR described, where a lone post
  three quarters of a metre in from either rail visibly holds up nothing.
- Claim 1 *sub-claim* (repaint only what changed) — not on main;
  `setSparking` still resets and re-uploads all 8 rail colour buffers every
  frame (`track.ts:687-711`). Perf nit, not a defect.
- Claim 4 *"lapses"* (deliberate random coasting) — not on main. Main expresses
  rival fallibility differently (missed duck bars + skill-scaled mash rate) and
  `check:rail-race` already asserts rivals visibly make mistakes.

`TRESTLE_SPACING` is still 12 — but that was never the defect, as the PR
itself argued.

## State / next

- [x] #155 both commits landed, tsc green
- [ ] #157 dropper-pairs fix (the one live piece) — in progress
- [ ] `npm run build` + `npm run test:procgen` exit 0
- [ ] close #157 with an explanatory comment; open issues for the perf nit and
      anything else not carried
- [ ] report to Overseer. **Do not merge.**

Needs visual QA (no browser this session): whether `'frown'` reads as distinct
from `'sad'`/`'surprised'` at gameplay distance, on both a rival and the
player's own face; and that it clears on dismount.
