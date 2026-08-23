# HANDOFF — continuing PR #330's bridge-backtrack fix

**Status (2026-08-23): Jim answered the open seating question — both riders
sit. Implemented, re-derived, re-run. tsc/build/test:procgen all green
(only the pre-existing, unrelated Sky Cruiser seed-11 gap remains). Real
result: still 0/7 canonical, 0/7 seed 2, 0/5 seed 18 — a real, pre-existing
search bug the shorter rise exposed for the first time is fixed along the
way (see below), and the honest shortfall is bigger than seating alone can
close. Read "2026-08-23 update" below before doing anything else with this
branch.**

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

## 2026-08-23 update: Jim answered "yes, sit" — implemented, re-derived,
## re-run. Real result: still 0/7, 0/7, 0/5, for a new and different reason.

Jim's answer to question 2 above: yes, both riders sit. Implemented as:

- `entities/ridePose.ts`'s existing `applyRidePose('seated')` — already the
  game's one shared "seated ride" pose (ferris wheel, cat bus, hotel dining
  chairs) — is now what poses **both** train riders, not just the player.
  `ParkTrain.updateRider` seats her with feet on `CAR_FLOOR_Y` (not the
  bench `SEAT_Y` — the position bug this file's "buys only 0.42 m" note
  named). `NpcCharacter.animate` now takes a `seated` flag (read before
  `carriedFlag` is cleared each frame, since `animate` itself can't see it
  once cleared) and folds the same pose onto whoever `carryPassengers` is
  carrying, instead of leaving them at the walk-cycle's near-idle "standing"
  pose.
- `kid.ts`'s new `TALLEST_CHILD_SEATED_HEIGHT` (2.92 m, real
  `visibleTop`-measured hair × hat cross product in the posed rig, same
  method as `TALLEST_CHILD_HEIGHT`) replaces the standing constant in
  `train/clearance.ts`. **This rig has no knee** — a seated leg swings from
  a fixed hip and moves nothing else, so bending it alone measured **zero**
  height reduction on the built model (confirmed live, not assumed). The
  entire saving is `applyRidePose`'s forward body lean (0.054 m at the
  worst hair+hat) plus the position fix (0.42 m). `BRIDGE_RISE`: **4.72 m →
  4.25 m**.
- `test/procgen/invariants.ts`'s train-clearance invariant now measures the
  seated pose (`measureTallestSeatedChild`, extending the existing hair ×
  hat sweep with `applyRidePose('seated')`) instead of standing, and the
  swept-top calculation collapsed from two rider terms to one (both riders
  share the same floor reference now).

**Re-running the search with the new `BRIDGE_RISE` found a second, real bug**
— not a consequence of a smaller constant, a latent defect the smaller
constant was the first thing ever to exercise. The canonical seed's closest
crossing (39.9, -31.5, missed by 0.64 m before) initially cleared — but
`everyBridgeIsWalkableAndReachable`'s ground-to-ground march (added by the
previous session specifically to catch exactly this class of thing) found it
**not standable, 5 m along its own centreline, on the bridge**. Traced to a
real lamp base 0.09 m inside a walker's clearance. Root cause:
`bridgeFootprint.ts`'s width search samples 9 fixed fractions of a
candidate's own width (`SAMPLE_TS`), all relative to that candidate's own
*(possibly laterally-shifted)* centre — **never relative to the crossing's
own real touch line**, which a shift is required to keep inside the deck
(`Math.abs(shift) > halfAcross - MIN_DECK_HALF_WIDTH` refuses it otherwise)
but which is *not* guaranteed to land on one of the 9 fixed fractions. On
this crossing the accepted shift put the real touch line at `t ≈ 0.38` —
between the list's `0` and `0.45`, tested by neither. Fixed by
`sampleTsFor()` (same file): always add the one point that is the crossing's
real line in the current candidate's frame, alongside the fixed list. Wired
into `deckClears`, `provisionalReach` and pass 2's `clearAt`/deck-commit
loop — everywhere `SAMPLE_TS` drove a real collision probe (left the
`planConservative` early-reservation pass alone: it is never shifted, so its
own centre already *is* the crossing's line).

**With that hole closed, the search correctly re-evaluated the same
crossing and found a second, larger real obstacle (r ≈ 0.85) a few metres
further down the same ramp, at a point no width or shift can dodge because
it sits on the crossing's own required line — and correctly fell back to a
level crossing rather than ship a bridge with a collision hole in it.**
Final, honest count on all three seeds, both fixes applied: **0/7 canonical,
0/7 seed 2, 0/5 seed 18** — unchanged in count from before this session, but
now for the right reason (the search never accepts a candidate it cannot
actually prove walkable) rather than the old reason (nothing had ever gotten
close enough to expose the sampling gap). See ARCHITECTURE-DECISIONS.md
Decision 8's new "Resolved" subsection for the full account including honest
numbers, and CLAUDE.md's "a check can pass without checking anything" —
this is exactly that pattern, on the generator side rather than the check
side: a generator whose own acceptance test can pass a state the built game
does not actually guarantee.

**New open item for whoever picks this up next**, replacing the closed
questions above (`test:procgen` verification: full re-run after both fixes
is 382/383 passing, 13/14 files clean — the only remaining failure is the
pre-existing, unrelated Sky Cruiser seed-11 support gap, issue #301, same
exact numbers as before this session touched anything; the scatterDecoupling
failure this file previously flagged as pre-existing did **not** reproduce
on this run — confirm it's still stable before relying on that): **why is
real scatter (this lamp, and the larger object found once it was fixed)
landing this close to a ramp's real, final reach at all?** `bridgeKeepout.ts`'s early, conservative reservation is
supposed to keep `Scenery`'s trees and `LampPosts`' lamps off exactly this
corridor before a real bridge exists to check against — and its own
`idealRampRun` (`BRIDGE_RISE / BRIDGE_RAMP_GRADIENT`, the shallow "ideal"
grade) is *longer* than the real search's minimum acceptable reach
(`BRIDGE_RISE / MAX_RAMP_GRADIENT`, the steep last-resort grade), so on
paper the reservation should already cover more ground than the real ramp
ever needs. It evidently is not doing so reliably in practice. This is the
same shape of question the previous session raised and deliberately
deferred with `LAMP_BRIDGE_MARGIN` ("fixing it in isolation, with nothing
for it to unblock, isn't worth its own risk") — now there is a real,
specific, reproducible case to fix it against (canonical seed, crossing
(39.9, -31.5)), which is exactly the condition that session asked for before
attempting it. Worth investigating together, not separately: they may be the
same root cause (the conservative reservation's own real-world reach not
actually matching what it believes it covers).

## Real-browser QA: what was checked and an environmental limit hit doing it

Chromium (`channel: 'chromium'`, matches this repo's own `playwright-core`
1.56.1 / revision 1194 — no version mismatch to fix this time) via a local
`vite --port 6217 --strictPort` dev server, canonical seed.

**Confirmed, with screenshots (`qa-screenshots` branch,
`pr330-riders-sit/`):**

- `/spawn?pos=52.2,-21.8` stands the player at the station; the train pulls
  in, the "Get on" chip appears (`02-train-at-platform.png`), clicking it
  boards her with zero console/page errors across every session this QA
  ran — confirmed by an attached `pageerror` listener on every run, never
  once fired.
- Boarded and riding: the first-person ride camera engages and the "Get
  off" chip appears (`03-just-boarded-firstperson.png`) — the functional
  boarding path this PR's pose change runs through is intact.
- `npm run build` (the full chain: every `check:*` script plus `tsc`,
  `typecheck:test`, `vite build`) is clean, exit 0, unpiped — includes
  `check:hotel`, `check:cat-bus`, `check:bus-journey`, all of which pose
  characters through shared machinery this change touches nowhere near, and
  none of them regressed.

**Not obtained, and why, honestly: an external screenshot of an NPC seated
mid-ride on the train specifically** (as opposed to the player's own
first-person view, or an NPC on an ordinary station bench — both of which
were captured and are *not* what was asked for). Traced to a real,
measured environmental limit, not a shortcut taken:

- This sandbox is shared with several other agents' concurrent worktrees
  at once (confirmed live — `ps aux` turned up another agent's own
  Playwright/Chromium invocation mid-session). Under that contention,
  headless Chromium falls back to `swiftshader-webgl` (software
  rendering), and **the park's own game clock runs at roughly 1/130th of
  real time** — measured directly: `window.game.elapsed` advanced 0.17 s
  against 21.8 s of real wall clock, repeatably, via a dedicated
  measurement script (`window.game.elapsed` is reachable from the console
  in dev builds; TypeScript's `private` does not exist at runtime).
- A background child only *considers* riding the train every 22-70 **game**
  seconds, at 55% odds (`trainTrip.ts`'s `TRAIN_INTERVAL_MIN/MAX`,
  `TRAIN_CHANCE`), then still has to walk to the station before boarding.
  At the measured ratio that is 47 minutes to several **real** hours of
  wall-clock waiting for one to actually be seated and catchable — not a
  budget any session should spend on one screenshot.
- Verified this is really about game-clock throttling and not a frozen
  page: `document.visibilityState` was `'visible'`/`hasFocus: true`
  throughout (ruled out background-tab rAF throttling specifically), and
  `window.game.npcs.riders` (all background children — the getter's name
  is misleading, it is not train-specific; the real per-rider signal is
  `character.driver.trainSeat`, non-null only for one genuinely mid-ride)
  was polled live via `page.evaluate`, cheaply, many times across several
  minutes of real time, and never once found a non-null `trainSeat`.
- **What this does not cover, and should be re-attempted properly** the
  next time this sandbox is not under this much concurrent load (or on a
  machine with real GPU acceleration): actually seeing an NPC's seated fold
  from outside the train, to visually confirm no clipping through the
  bench specifically for the *train's* seated pose (the same
  `applyRidePose('seated')` is already visually confirmed correct in this
  exact park, right now, on a station bench and via the ferris
  wheel/cat bus/hotel dining chairs it already ships on — but "the same
  function" is not quite "the same screenshot", and CLAUDE.md is right to
  want the latter). The mechanism to catch the moment reliably, once the
  clock runs at something closer to real time, is already written and
  works: poll `window.game.world.npcs.all.map(c => c.driver.trainSeat)`
  cheaply until one is non-null, then move `window.game.cameraOverride`
  (the live `/view` camera, mutable in place — no page reload, which would
  otherwise regenerate a fresh park and lose the very rider just found) to
  that rider's position and screenshot once.
