# HANDOFF — fix-188 (board task #14)

Fixing the review findings on PR #188 ("Live 'Look' pill"), pushed onto the
PR's own branch `claude/non-random-npc-customization-7j3vwf` so #188 updates
in place. **Do not merge; a different agent reviews this.**

## State: done, green

- `npm run build` — exit 0, unpiped.
- `npm run test:procgen` — exit 0, 91 tests / 6 files (5 procgen seeds + the
  new input test).
- Two commits on top of `ba280a0`.

## What was wrong and what was done

1. **Issue #189 — the big one.** `InputSystem.onKeyDown` is a `window`
   listener attached for the whole session with no `event.target` check, and
   it `preventDefault`s every bound code. Any text field over the running game
   therefore lost `w a s d e f i p`, `Space`, `Backspace`. Fixed centrally
   with `isTextEntryTarget` — **not** at the Look-pill call site, so every
   future dialog is covered (#119's keychain shop is next in line).
   - Duck-typed on `tagName`/`isContentEditable`, not `instanceof`, which is
     realm-bound and answers "no" for an iframe field.
   - `onKeyUp` left unguarded on purpose: it only releases, and guarding it
     would strand a key held while walking then released over a field.
2. **`notifiedWorn` latch** not reset in `WornHat.rebind`/`WornJetpack.rebind`
   → the new model never got `setJetpackWorn`/`setHatWorn`. Jet pack case was
   visible: her own backpack rendered through the pack.
3. **Look pill hidden while riding/climbing** (`Hud.setLookAvailable`, driven
   from `Game.tick`, plus a defensive guard in `reopenCharacterCreator`).
   `RailRace` writes `RIDE_SCALE` onto the model and `TreeClimbing` holds a
   list of the model's own children — neither survives a swap. Guarding the
   pill was much cheaper than making every ride re-apply itself.
4. **Park paused while the creator is open** — it kept running underneath.
   Previous paused state is restored, not cleared, so `/view` stays frozen.
5. **`grantFreeOnce`** in the store: `completeCharacterCreation` was minting a
   new hat + pet on every visit, so repeated Look taps stacked up duplicate
   pets. Matches on catalogue `id`; leaves a stowed pet stowed.

## Things worth knowing if you take this over

- **The worktree needs its own `node_modules`.** The shared checkout's has
  `vite`/`typescript` but **not `vitest`**, so `npm run test:procgen` cannot
  run from it. `npm install` inside the worktree (`.claude/` is gitignored, so
  this disturbs nobody). `package-lock.json` was *not* modified.
- **The regression test dispatches real events.** Playwright's `fill()` sets
  `.value` and fires only `input` — it never produces a `keydown`, which is
  exactly why the author's E2E pass did not catch #189. Any replacement test
  must keep dispatching real cancelable events and asserting
  `defaultPrevented`. I verified it genuinely fails without the fix (2 of 6).
- The test avoids "wasd" for the movement assertion: W/S and A/D are opposite
  axes and sum to a standstill, so an unguarded system would pass it. It types
  "Wren" instead.
- No jsdom in this project. The test uses a real `EventTarget` subclass
  carrying `tagName`/`isContentEditable`, which is why duck-typing the guard
  matters twice over.

## Not done / left for the Overseer

- Ordering nit from the review (finding 5) is **not** fixed:
  `applyLiveLook` still calls `completeCharacterCreation` (which notifies, so
  subscribers sync against the *old* model) before `replaceModel`. End state
  is correct — every `rebind()` repairs it — but it builds a hat, throws it
  away, and double-disposes it. Deliberately left: it is cosmetic, and moving
  the notify would be a wider change than this task asked for.
- No browser QA — I do not own the shared Chrome profile. Needs a human/QA
  pass on: typing a name with w/a/s/d/space/backspace in the Look overlay, the
  jet pack + backpack overlap, and the pill disappearing on a ride.
