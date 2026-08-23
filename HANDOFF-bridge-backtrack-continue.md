# HANDOFF — continuing PR #330's bridge-backtrack fix

**Status: the four QA items are addressed in code; the branch does not
currently build any real bridge on canonical/seed2/seed18, and CI is not
fully green. Read the "Open question for Jim" section before doing
anything else with this branch.**

Picked up after the previous agent went unreachable mid-task. Their last
five commits (`7241abb`..`780373d`) already fixed QA items 1 (both-sides
`Math.min` acceptance), 2 (ground-to-ground marched invariant, proven
red-then-green in `778d2b7`'s own message), and 3 (risers, `91ff9f2`). This
session's own work is two more real bugs found while trying to verify those
fixes actually produce a walkable bridge on the canonical seed, plus item 4
(the ratio report).

## What this session changed

`src/world/train/bridgeFootprint.ts`, two fixes:

1. **`idealRampRunFor`'s own ceiling was capped below the acceptance floor
   it had to clear.** `68af5fc` (previous session) added `WALKABLE_MARGIN`
   (0.5 m) on top of `WALKABLE_FLOOR` for acceptance, but never raised
   `idealRampRunFor`'s `rampRunCap` floor to match — that floor stayed at
   bare `WALKABLE_FLOOR` (`BRIDGE_RISE / MAX_RAMP_GRADIENT`). Since a ramp's
   probed reach is capped at `idealRampRunFor`'s own answer, any crossing
   whose spacing pinned that cap to its floor could **never** reach
   `WALKABLE_FLOOR + WALKABLE_MARGIN` — the ceiling sat a half-metre under
   the bar. Measured live: every one of the canonical seed's 7 crossings
   with a close neighbour had `idealRampRun` landing exactly on 7.87 m while
   acceptance demanded 8.37 m. Fixed by raising the floor to
   `WALKABLE_FLOOR + WALKABLE_MARGIN`.
2. **The width search preferred the *widest* legal deck, not the
   narrowest.** QA's item 3 ("reconsider deck width... reads as a giant
   plywood table") traces to this: the loop started at
   `crossing.halfGap + ACROSS_MARGIN` (full 2 m collision-safety margin,
   both sides) and returned the *first* candidate that cleared, so a deck
   only ever came out narrower than the widest offer by accident. Flipped
   the loop to start at `USABLE_HALF_WIDTH_FLOOR` (`crossing.halfGap`
   itself — the real, self-measured path corridor) and widen only when a
   narrower candidate at that shift fails real collision.

**Also tried and reverted**: `LAMP_BRIDGE_MARGIN` in `LampPosts.ts` used
`PLAYER_RADIUS + 0.3` (0.92 m) where the bridge search's own `isClearCircle`
probe demands `REAL_PROBE_RADIUS` (1.12 m) — a real, live, "two definitions
of one thing" mismatch (a lamp legitimately placed 0.92 m clear of the
conservative reservation still reads as "not clear" to the real search 0.2 m
short of what it needs) and the dominant single cause of blocked reach on
several crossings when I traced specific block points back to their nearest
collider (small `r=0.22` circles — lamp bases). Tying `LAMP_BRIDGE_MARGIN`
to the search's own `REAL_PROBE_RADIUS` is very likely still the right fix
in principle, but wiring it in as I first tried **regressed `check:park` on
the canonical seed** (3 new stranded waypoints, "no allowance — this is
new") for zero bridges recovered — the lamp that used to fit near
`(-41, -0.6)` no longer did, got tried at other candidate offsets, and one
of those blocked a path waypoint. Reverted rather than ship a regression for
no measured benefit. **Confirmed by isolation**: `LampPosts.ts` reverted
alone, `bridgeFootprint.ts` changes kept, `check:park` clean again. Whoever
picks this up next should re-attempt the lamp-margin fix together with
whatever eventually unblocks real bridge-building (see below) — fixing it
in isolation, with nothing for it to unblock, isn't worth its own risk.

## Open question for Jim: bridges are not currently buildable at all

**Before this session's fixes: 0 of 7 crossings on canonical, 0 of 7 on
seed 2, 0 of 5 on seed 18 got a real bridge — all fell back to level
crossings.** This is worse than the QA report's original finding (canonical
4/7, seed 18 4/5 falling back) — every crossing on all three seeds now
falls back, because the walkability requirement QA correctly demanded
(`Math.min` of both sides, no `rampRun=0` accepted) turns out to be
**very hard to satisfy anywhere in this park** once genuinely enforced.

I fixed the two real bugs above (items you'd naturally suspect first — a
too-tight ceiling, a search that never tried to be narrow) and **the ratio
did not move**: still 0/7, 0/7, 0/5 after both fixes. I traced this as
deep as I reasonably could in the time available:

- Measured, per crossing, the best achievable "both sides clear" reach
  across every width and lateral shift the search tries. On the canonical
  seed, 6 of 7 crossings come nowhere close (best min-reach 0–2.45 m against
  a ~8.4 m requirement); one crossing (39.9, -31.5) gets within 0.64 m.
- The dominant blocker, at the points I traced back to a specific collider,
  is real hard collision very close to the ramp's own probed line — most
  often small (`r≈0.2–0.9`) objects (lamp bases, single bush trunks) inside
  the ~1.1 m clearance the search's own `REAL_PROBE_RADIUS` demands, not
  the park boundary (only 13 of 1714 sampled block points were boundary-
  limited) and not un-fellable big structures either.
- Widening the lateral-shift search (13 fractions instead of 5, full ±1.0
  instead of ±0.7) did not recover a single crossing — the shortfall is not
  search coarseness.

**The deeper reason, already flagged by the feature's own original author
and never resolved**: `HANDOFF-railway-bridges.md`'s last section records
`BRIDGE_RISE` (4.72 m — a standing NPC rider's headroom, not the funnel
alone) as an **open family question**: *"should everyone on the train sit"*
would shorten `BRIDGE_RISE` and, with it, every ramp's required reach
(`WALKABLE_FLOOR = BRIDGE_RISE / MAX_RAMP_GRADIENT`). That question was
explicitly left "untouched" before bridge geometry was ever built. Given
how close several crossings come (39.9,-31.5 misses by 0.64 m; several
others by a few metres, not tens), a shorter `BRIDGE_RISE` is very plausibly
enough to make real bridges buildable at several of these crossings without
touching the search algorithm at all.

**This needs Jim's decision, not mine, on at least one and possibly both
of:**

1. Is a park where every railway crossing is a level crossing (not a
   bridge) acceptable, contradicting Decision 8 ("a path crosses the
   railway on a bridge, never a level crossing") as currently written? Or
   does Decision 8 need updating to allow a level-crossing fallback as the
   normal case, not just a rare exception?
2. Should train riders (NPCs, and/or the player) sit rather than stand,
   shortening `BRIDGE_RISE` and very plausibly unlocking real bridges at
   several of these crossings? This was flagged as a family art-direction
   call when the feature was first speced out and was never made.

I have **not** picked an answer to either — per this task's own
instructions, this belongs to Jim.

## CI is not fully green — two pre-existing, unrelated failures

Confirmed **not** introduced by this session (present, byte-identical, on
this branch's tip `780373d` before I touched anything):

- `test/procgen/seed-11.test.ts > the Sky Cruiser stands on its own
  supports` — 37.0 m unsupported span, issue #301.
- `test/procgen/scatterDecoupling.test.ts` — 4 bushes still coupled to an
  unrelated stall's spur move, beyond `LOCALITY_LIMIT`.

Both were already flagged by earlier PR review comments as regressions from
this same branch's own history (commit `2ebdc31` attempted a fix; it
reduced but did not eliminate either). Root-causing and fixing these is a
separate, substantial investigation in its own right (I did enough digging
to confirm they're real and pre-existing, not enough to fix them safely in
the time available) and is **not** part of the bridge ramp-generation scope
this session was asked to cover. Per CLAUDE.md's zero-tolerance CI policy
this blocks merge and, read strictly, blocks other engineering on the
project too — flagging prominently rather than disclosing-and-shipping.

`check:park` is clean on canonical and seed 18. Seed 2 has a pre-existing,
already-disclosed `poi.stranded: 5` (garden waypoint pocket near
(57–69, 15–18), nothing to do with the railway) — confirmed byte-identical
to the branch's state before this session too.

## Verification run this session

- `tsc --noEmit`: clean.
- `check:park`: canonical clean (17/17, 169/169), seed 18 clean (17/17,
  166/166), seed 2 has the pre-existing unrelated `poi.stranded: 5`.
- `test:procgen`: 2 failed / 12 passed (files), both pre-existing per above.
- `npm run build`: see PR comment / final report for the result — this
  sandbox is under heavy concurrent load from other agents' worktrees
  (10 min timeouts on individual commands), so it ran in the background;
  check its actual outcome before trusting "build passes."

## If you pick this up next

1. Get Jim's answer on the two questions above before spending more time on
   the search algorithm — a `BRIDGE_RISE` change (if he says yes to seating)
   changes the required reach for every crossing and invalidates re-tuning
   done against the current 4.72 m figure.
2. Once bridges exist again on at least one seed, add the deck-width
   invariant I drafted and then removed (a built deck's `deckHalfAcross`
   should not run far past `crossing.halfGap + ACROSS_MARGIN`) — I couldn't
   honestly prove it red-then-green with zero bridges anywhere to exercise
   it, which is exactly the "check that cannot fail" trap CLAUDE.md warns
   against, so I left it out rather than ship it unproven.
3. Re-attempt the `LAMP_BRIDGE_MARGIN` fix (see above) once there's an
   actual bridge for it to unblock, so its effect can be measured rather
   than assumed.
