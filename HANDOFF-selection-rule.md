# HANDOFF — the SELECTION RULE

Branch `selection-rule`, worktree `.claude/worktrees/selection-rule`, from
`origin/main` @ 66f71ba.

## What is being built

GAME_DESIGN.md's SELECTION RULE (28 Jul 2026): tap or stand close → the item is
**selected** (rainbow outline); its **actions appear as chips over the item**;
press the key or tap the chip to act. Two taps when distant, one when near.
Plus: the "?" help moves under the Menu button.

## Shape

- `src/world/interact.ts` — `ZoneAction`, `InteractZone.actions?`, `standRadius?`,
  `selectRank?`, `selectableWhileRiding?`. **`pressInteract` is deleted.**
  `setInteractPress()` / `pressAction()` are the module-level hook (same idiom as
  `train/service.ts`'s `setTrainService`) so a zone builder with no `InputSystem`
  to hand can still say "this action is what E does here".
- `src/world/Selection.ts` — one selected zone per frame. Sources: hover/tap
  (ray, sticky) and proximity (nearest stand point, hysteresis). Owns the
  pointer cursor and the walk-then-act commit.
- `src/ui/ActionChips.ts` — the chips, `<button>`s projected over the item.
- `src/world/Highlights.ts` — re-keyed on `Selection.selected`; one slot.
- `src/ui/ActionButton.ts` — **deleted** (the old "Ride E" pill).
- `SignReader` — keeps the overlay only; signs are now InteractZones (built in
  `Game`, NOT in `World.interactZones()` — check:park walks that list and sign
  stand points would trip invariant 1).
- `ParkTrain` — `requestBoard()` / `requestAlight()`; auto-board and
  alight-by-walking removed.

## Decisions worth keeping

- Selection requires **at least one action**, so "outlined" now strictly means
  "selectable". Walk-onto-it zones (trampoline, bubble, slides, front door) have
  no actions and are therefore no longer outlined. Accepted, and it is what
  makes the rule one thing rather than two.
- `standRadius` defaults to 3 m (the old `ACTION_REACH`); zones whose owner
  gates tighter (flowers, 1.3 m) declare their own.
- `selectRank` promotes the old "an action beats a sign" precedence.
- Chips project through `cameraOverride ?? camera.camera`, so they work in the
  first-person train.

## State

See git log on this branch.
