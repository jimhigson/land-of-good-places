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

## State — build-green, awaiting instructions

- [x] #155 both commits cherry-picked, two conflicts resolved to main's APIs
- [x] #157's one live piece landed: `8e1ebbf`, a dropper under each rail
- [x] New invariant `droppersHangUnderRealRails` — **teeth verified** by
      reverting the placement and watching it fail on all five seeds, both
      rings, before trusting it. (It passed silently at first: `Invariant` is
      `(facts) => void`, so a returned complaints array is discarded — it must
      `expect(...)` internally. Worth knowing if you add one.)
- [x] `npm run build` exit 0; `npm run test:procgen` exit 0, 90 tests, 5 seeds.
      Both run unpiped — `$status` after a pipe in fish is the *last* command's.
- [x] #157 **closed** with a full per-claim account; #190 opened for the one
      uncarried item (`setSparking` re-uploads all 8 rail buffers every frame)
- [x] #155 **left open on purpose** — its work is on this branch with no PR of
      its own yet, so closing it would leave no open trace. Close it the moment
      this branch merges.
- [ ] No PR raised (engineer brief item 10). **Nothing merged.**

Note: this worktree needed its own `npm ci` (worktrees do not share
`node_modules`). Dev server on 5315 was never started — no browser this session.

## Needs visual QA

1. Does `'frown'` read as distinct from `'sad'`/`'surprised'` at gameplay
   distance? This is the one real judgement call in #155 and nothing but eyes
   settles it. Check on a **rival** (bonk, and holding through a black
   stretch) and on the **player's own face**, which the race never drove
   before.
2. Frown clears on dismount — `RailRace.arrive()` resets it; confirm no face
   rides home frowning.
3. Blink still visibly interrupts a held frown (guaranteed by construction via
   `faceLife`, but worth one look).
4. Do the paired droppers read as holding each rail, from the ground and from a
   cart? Count doubles (~272 per ring on the walk-past ring), so also worth a
   glance for visual noise/frame cost on a phone.
