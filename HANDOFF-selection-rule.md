# HANDOFF — the SELECTION RULE

> ## ⚠️ Partly superseded by `fix/interact-chip` (issue #122, 5 Aug 2026)
>
> The SELECTION RULE itself stands — this is still how selection works. What
> changed is **how a press reaches the thing it names**, and five claims below
> are now false. They are marked `SUPERSEDED` inline.
>
> **What was wrong.** The chips and the E key both produced an *unaddressed*
> broadcast: `pressAction`'s `run` was `() => interactPress?.()`, wired to
> `pressVirtual('interact')`. Twelve systems each read that edge and each decided
> from its own hand-written radius whether the press was theirs. Family QA, 28
> July: the chip over the platform said "Get on" and E picked a flower.
>
> Note that the `selectRank` decision below was the *first* attempt at that same
> bug, and the family's report is from **after** it. It was right, and it was at
> the wrong layer: it fixed which chip **shows**, and could not fix which handler
> **acts**, because those were two separate decisions. They are one decision now.
>
> **What replaced it.** `InputSystem.justPressed` no longer accepts `'interact'`
> (`InteractFreeAction`), so reading the key anywhere but one place is a compile
> error. `takeInteractPress()` is that place's sole, consuming reader, and
> `world/InteractRouter.ts` is its only caller — it routes each press to the zone
> the selection currently shows. `pressAction`/`pressZone` now take a **real
> closure**, so a zone calls one named thing.
>
> See `HANDOFF-interact-chip.md` for the full root cause.

Branch `selection-rule`, worktree `.claude/worktrees/selection-rule`, rebased
onto `origin/main` @ 53588ca (the two-coaster commit). **Build green, PR open.**

## What it is

GAME_DESIGN.md's SELECTION RULE (28 Jul 2026): tap or stand close → the item is
**selected** (rainbow outline); its **actions appear as chips over the item**;
press the key or tap the chip to act. Two taps when distant, one when near.
Plus: the "?" help moved under the Menu button.

## Shape

- `src/world/interact.ts` — `ZoneAction`, `InteractZone.actions?` (a *function*,
  so labels can be stateful), `standRadius?`, `selectRank?`,
  `selectableWhileRiding?`. **`pressInteract` deleted.**
  **SUPERSEDED** (#122): `setInteractPress()` and the module-level hook are gone.
  `pressAction(label, run, glyph?)` / `pressZone(zone, run, glyph?, label?)` take
  a real closure now — a zone builder names the function to call rather than
  firing a press for somebody to claim.
- `src/world/Selection.ts` — one selected zone. Sources: hover/tap (ray,
  *sticky*) and proximity (nearest stand point, ranked, hysteresis). Owns the
  pointer cursor, the activation flash and the walk-then-act commit.
- `src/ui/ActionChips.ts` — the chips. Projected over the item; **riding has a
  bottom-centre home** (see below).
- `src/world/Highlights.ts` — re-keyed on `Selection.selected`; one slot, no
  picking of its own.
- Deleted: `src/ui/ActionButton.ts`, the "Read" pill and proximity gate in
  `SignReader`, the press-E prompts in `Shopping` and `TreeClimbing`.
- `ParkTrain` — `requestBoard()` / `requestAlight()`; auto-board and
  alight-by-walking gone. `wantsOff` keeps E/jump as accelerators.
  **SUPERSEDED** (#122): `wantsOff` keeps **jump only**. E arrives through the
  platform zone's own "Get off" action, which is what makes it agree with the
  chip. `jump` stays because it has no chip and means the same thing wherever
  she is standing, so it cannot be aimed at the wrong thing.

## Decisions, and why

- **Selection requires ≥1 action**, so "outlined" strictly means "selectable".
  Walk-onto-it zones (trampoline, bubble, slides, front door) have no actions
  and are no longer outlined. Accepted: it is what makes the rule one thing.
- **`standRadius`** defaults to 3 m (the old `ACTION_REACH`); zones whose owner
  gates tighter declare their own (flowers 1.3, trees `trunkRadius + 2.4`), so a
  chip is never offered where the press it names would be ignored.
- **`selectRank`**: stations +1, signs and flowers -1, everything else 0. QA
  found "Pick!" beating "Get on" because a flower had seeded on the platform.
  Still true — but see the banner: this fixed the *chip*, not the *dispatch*, and
  the bug survived it.
- ~~**E is not consumed by `Selection` when the thing is in reach**~~ — the
  owning system already handled that press this frame, so running it again would
  double-fire (and on a tree, immediately un-climb). In reach: flash only. Out
  of reach: walk-then-act.
  **SUPERSEDED and reversed** (#122): `Selection.handleInteractPress` now always
  commits the primary action, in reach or not. This special case existed *solely*
  because of the rival readers, and it was deleted with them — there is nothing
  left to double-fire with, so the #103 tree climb/un-climb hazard is closed
  rather than worked around. The chip still only shows a key hint when in reach.
- **Signs are built in `Game`, not in `World.interactZones()`** — `check:park`
  walks that list as "every attraction's stand point" and forty sign stand
  points would be ratchet noise.
- **Chips while riding go to the bottom middle**, not over the item: from the
  first-person seat the platform projects to x≈0, and clamping to the nearest
  corner parks them under the Menu button.

## Verified in the browser (127.0.0.1:5199)

- Stand on Sunny Side platform, train in → "🚂 Get on" chip → boards, iris,
  first person.
- Riding, stopped at Bluebell Halt → "👋 Get off" chip at the bottom → alights
  onto the platform, first person off.
- Distant tap on the Rail Racer booth → selects, **does not walk**, chip shows
  "🎢 Ride!" with no key hint; tapping the chip walks her over and boards the
  coaster.
- No console errors.

## Known follow-ups

- The Sky Cruiser stall (second coaster, not yet on main) will fall through
  `DEFAULT_VERBS` to "Play!" — give it a `['stall:skyCruiser', 'Ride']` entry in
  `world/interact.ts` when it lands.
- `MiniGameHost.boardRide(stallId)` rename: nothing here needs changing.
  **SUPERSEDED** (#122): stall chips call `MiniGameHost.enter(stallId)` by name.
  `checkStalls` — which polled the key and swept every booth within its own
  `REACH` — is gone. The host still owns boarding.
- Not exercised in the browser: shops, toilets, the grown-up, the stairs, the
  lift's new "Call" chip, face painting. All migrated mechanically through
  `pressZone`.
  **SUPERSEDED** (#122): none of these reach their owner by a virtual E press any
  more. Each names its own function — this shop unit, this stairwell's deck, the
  loo, the grown-up — so all six were re-verified by the compiler when
  `justPressed('interact')` became a type error.
