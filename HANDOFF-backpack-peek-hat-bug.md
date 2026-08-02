# Handoff: giant sun hat overlapping the player

## Bug report (from Jim, live)
"A giant sun hat randomly appears overlapping with the player and vanishes
after a few seconds."

## Root cause — confirmed, high confidence, not reproduced live in-browser

`BackpackPeek` (`src/entities/parade/BackpackPeek.ts`) — the "things stick
their heads out of the top of the backpack from time to time" feature — picks
a random *unworn, owned* item every 4.5-11.5 seconds, shows it rising out of
the player's backpack for ~2.7 seconds (0.42s rise + 1.9s look + 0.34s duck),
then removes it. That timing and location match the report exactly.

The bug: it scaled the picked item by
`PEEK_HEIGHT / Math.max(0.12, handle.height)` where `handle.height` is
**vertical extent only** (`visibleTop`/`visibleBounds`, see `hats.ts:319`).
Fine for a teddy or a mouse; wrong for the sun hat, whose bulk is a wide brim
on a short crown (0.38 m tall, 2.33 m wide, deliberately huge per
`hats.ts:106-163`'s "50% bigger, family's request" scaling). Dividing a
0.4 m target by a 0.38 m height barely shrinks it, so the full-width brim
erupts from the backpack at near life size, overlapping the player, for the
duration of the peek. The flower crown has the same shape of bug and is worse
by the numbers (was ~3.9 m wide when peeking).

## Reproduction status

**Not reproduced live in-browser.** The shared chrome-devtools Chrome profile
already had another agent's page open at localhost:5260 when I started, and
CLAUDE.md says not to touch it without being told I own it. Did a rigorous
static trace instead: read `BackpackPeek.ts`, `hats.ts`'s `finish()`/`hatSize`,
`Parade.ts`'s `stowedIds()`, and independently re-derived the exact scale
numbers with a throwaway script using the project's own `visiblePoints`
helper (same one `check-asset-contract.mts`/`measure-hat-fit.mts` use) —
confirmed old formula gives the sun hat a ~1.2-2.4 m peek width against a
0.4 m target (depending on which height figure you compare against), and
confirmed the fix caps every catalogue item's peek at 0.4 m in both axes.
See "Verification" below for exact commands.

## Fix

`src/entities/parade/BackpackPeek.ts`: added `footprint(root)`, which returns
the larger of vertical extent and horizontal diameter (via `visiblePoints`),
and used it instead of `handle.height` in both `begin()` (initial scale) and
`place()` (per-frame scale during rise/look/duck). Computed once per peek
(cached in `this.size`), not per frame, to avoid re-walking geometry every
frame while a peeker is out.

Also exported `PEEK_HEIGHT` and `footprint` so a check script can call the
*real* formula rather than a copy of it.

## New regression guard

`scripts/check-backpack-peek.mts`, wired into `npm run build` as
`check:backpack-peek`. Builds every catalogue item (`SHOP_ITEMS` +
`EGG_PRIZES`), computes what `BackpackPeek` would actually scale it to using
the real exported `footprint`/`PEEK_HEIGHT`, and fails if anything's peek
height or width exceeds `PEEK_HEIGHT + 0.08 m` in either axis. Verified
non-vacuous: temporarily reverted `footprint()` to height-only (the old bug)
and reran the check standalone — it correctly failed on `hat.sun` (1.22 m
wide vs 0.4 m target) and 10 other items, confirming it's a real guard, not
a tautology. Restored the fix afterward and diffed against a saved copy to
confirm the restore was exact.

## Verification (what I actually ran)

- `npm run build` — exit 0, full output in
  `/private/tmp/.../scratchpad/build3.log` (path is session-scoped, not on
  the branch).
- Standalone script measuring all 8 hats through the old vs. new formula:
  sun hat peek width 2.428 m → 0.400 m; flower crown 3.868 m → 0.400 m.
  Creature/pet items essentially unaffected (`pet.bunny` peekScale unchanged
  at 0.274).
- `npm run check:backpack-peek` (standalone): "34 catalogue items all peek
  bag-sized."
- `test:procgen` could NOT be run in this worktree — `vitest` is not
  resolvable (`ERR_MODULE_NOT_FOUND` even via `npx vitest run`; this
  worktree has no local `node_modules`, `npm run build`'s other tools work
  only because npm walks up to the shared checkout's `node_modules/.bin` on
  PATH, and vitest apparently isn't reachable that way). This is an
  environment gap in this specific worktree, not something the fix touches
  — no procgen files were changed. Flagging honestly rather than claiming a
  green run I didn't get.

## Files changed

- `src/entities/parade/BackpackPeek.ts` — the fix (`footprint()`,
  `PEEK_HEIGHT`/`footprint` exported, `begin()`/`place()` updated).
- `scripts/check-backpack-peek.mts` — new regression check.
- `package.json` — wired `check:backpack-peek` into `build`.

## Not done / open questions

- Did not touch `hats.ts`'s `HAT_SIZE_EXTRA` or hat geometry — the hat's
  large *worn* size is confirmed by its own doc comments to be a deliberate
  family decision (31 July session), not part of this bug.
- Did not investigate whether the flower crown peeking oversized has also
  been seen live — the report only named the sun hat, but the trace shows
  the flower crown had the identical (in fact numerically worse) bug and is
  now fixed by the same change.
