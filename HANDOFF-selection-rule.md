# HANDOFF — the SELECTION RULE

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
  `selectableWhileRiding?`. **`pressInteract` deleted.** `setInteractPress()` /
  `pressAction()` / `pressZone()` are the module-level hook (the idiom
  `train/service.ts` already uses) so a zone builder with no `InputSystem` can
  still say "this action is what E does here".
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

## Decisions, and why

- **Selection requires ≥1 action**, so "outlined" strictly means "selectable".
  Walk-onto-it zones (trampoline, bubble, slides, front door) have no actions
  and are no longer outlined. Accepted: it is what makes the rule one thing.
- **`standRadius`** defaults to 3 m (the old `ACTION_REACH`); zones whose owner
  gates tighter declare their own (flowers 1.3, trees `trunkRadius + 2.4`), so a
  chip is never offered where the press it names would be ignored.
- **`selectRank`**: stations +1, signs and flowers -1, everything else 0. QA
  found "Pick!" beating "Get on" because a flower had seeded on the platform.
- **E is not consumed by `Selection` when the thing is in reach** — the owning
  system already handled that press this frame, so running it again would
  double-fire (and on a tree, immediately un-climb). In reach: flash only. Out
  of reach: walk-then-act. The chip only shows a key hint when in reach.
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
- `MiniGameHost.boardRide(stallId)` rename: nothing here needs changing. Stall
  chips fire the virtual `interact` press, so the host still owns boarding.
- Not exercised in the browser: shops, toilets, the grown-up, the stairs, the
  lift's new "Call" chip, face painting. All migrated mechanically through
  `pressZone`, all still reaching their owners by the same virtual E press.
