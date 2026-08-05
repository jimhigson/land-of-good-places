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

- Ordering nit from the review (finding 5) is **not** fixed, and **my original
  explanation of it here was wrong** — corrected so nobody is reassured by the
  wrong mechanism. I claimed `completeCharacterCreation`'s `notify()` made
  subscribers sync against the old model, building a hat that was then thrown
  away. It does not: `notify()` **coalesces onto a microtask**
  (`queueMicrotask`, `store.ts`), so no subscriber runs synchronously and no
  hat is ever built and discarded.

  What actually happens is smaller: `disposeTree(old.root)` frees the hat mesh
  along with the model, and then `rebind()`'s `clear()` disposes that same mesh
  a second time. three.js `dispose` is idempotent, so this is genuinely
  harmless — it is untidy, not a leak and not a correctness bug. Still left
  alone deliberately; the point of writing it down is that "double dispose"
  sounds alarming and is not.
- No browser QA — I do not own the shared Chrome profile. Needs a human/QA
  pass on: typing a name with w/a/s/d/space/backspace in the Look overlay, the
  jet pack + backpack overlap, and the pill disappearing on a ride.
- **Escape over the open creator is code-read, not observed.** Second review
  found that the creator was missing from `Game.tick`'s "who owns Escape"
  chain, so Escape unpaused the park behind the dialog. Fixed by re-deriving
  the pause (`syncLookPaused`) instead of toggling it at the call site, plus
  excluding `lookOpen` in that chain. The re-derivation is what actually makes
  it safe: even if some *other* path flips the pause flag, the next frame puts
  it back. QA should still watch it run.
- Enter now submits the creator form (it used to be swallowed with every other
  bound key). Single-fires — the form handler `preventDefault`s and `submit()`
  is idempotent behind its `closed` flag — but it is new behaviour.

## A claim I got wrong, and the habit that caused it

I reported all three tests in `test/store/live-look.test.ts` as verified
failing against the pre-fix code. **Two do. The third exercises the `else`
branch (`setWornHat(null)`), which was already correct, so it passes either
way** — a third review caught it. My own terminal output had said
`2 failed | 1 passed` and I wrote "all three" anyway.

The habit worth copying is the one that *did* work elsewhere: run the suite
against the reverted code, then read the number back off the screen and quote
that, rather than the number you expected. Every "verified failing" claim in
this branch has since been re-run that way, and the counts below are the ones
actually printed.

## The riding/climbing re-check is right, but "unreachable" is too strong

`applyLiveLook` re-checks riding and climbing, and the check is correctly
placed (before the store write, so it is all-or-nothing). But the comment
calling it unreachable overstates the case **for keyboard**:
`TreeClimbing.ts` and `MiniGameHost.ts` both consume
`justPressed('interact')` with no paused guard, and `justPressed` does not
care that `dt` is zero. So `E`/`F`/`Enter` with focus on a creator swatch
button — buttons are deliberately outside #189's text-entry guard — can start
a climb behind the open modal, and "Done" then silently discards everything
she chose.

Not fixed here, on the Overseer's instruction: it is pre-existing in kind, the
creator autofocuses the name input so focus is not normally on a swatch, and
another engineer's #122 work makes this class impossible by construction — it
may simply evaporate when that lands. Recorded so it is not re-discovered from
scratch.

## Pause: use the re-derived shape, not a sixth variant

There are already several `pausedByUs`-shaped implementations in the tree
(`Shopping.syncPaused`, `FacePaintStall.syncPaused`, `CuteODex`, `ParkMap`).
The **re-derived** ones are the good shape and `Hud.ts`'s own comment points
at `Shopping.syncPaused` as the model: mirror the pause off "is my UI open?"
every frame, and only ever unpause what you paused yourself. Do not add a
one-shot `setPaused(true)` on open with a restore on close — that is what this
branch did first, and Escape walked straight through it.
