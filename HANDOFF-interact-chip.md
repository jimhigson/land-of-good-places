# HANDOFF — `fix/interact-chip` (issue #122)

Engineer: `E2-interact`. Branch `fix/interact-chip`, worktree
`.claude/worktrees/interact-chip`, dev server port **5311**.

## The bug

Family QA, 28 July: waiting at the station the chip said **Get on**, E picked a
flower. REQUIREMENTS-2026-07-28.md §11: *"E must act on exactly the item the
chip shows."*

## Root cause (found 5 Aug, read this before changing anything)

`interact.ts`'s `pressAction` built every chip's `run` as
`() => interactPress?.()`, and `Game` wired `interactPress` to
`input.pressVirtual('interact')`. So a chip did not call the thing it named —
it **broadcast a global interact edge**.

Twelve independent call sites read `justPressed('interact')` every frame, each
re-deriving "am I the one?" from its **own** radius:

| reader | its own radius |
|---|---|
| `Flowers` | `PICK_RADIUS` 1.3 |
| `TreeClimbing` | `trunkRadius + 2.4` |
| `MiniGameHost` | `REACH` 3.4 |
| `FacePaintStall` | `REACH` 3.2 |
| `Shopping` | `shops.shopAt()` |
| `Building` | three hand-written rectangles |

`Selection.standRadiusOf` defaults to **3**. Any disagreement between a
handler's radius and the zone's is a press that lands somewhere other than the
chip. Standing at a platform with a flower 1.2 m away, both `Flowers` and the
station saw the same edge — the flower won because nothing arbitrated at all.

## The fix — one reader, enforced by the compiler

1. **`InputSystem.justPressed` no longer accepts `'interact'`**
   (`Exclude<GameAction, 'interact'>`). Every legacy read is now a *compile
   error*. This is the load-bearing change: the rule cannot rot back.
2. **`InputSystem.takeInteractPress()`** — the single, *consuming* reader.
   Returns true once per edge and clears it, so even a second caller gets
   `false`.
3. **`world/InteractRouter.ts`** — new `GameSystem`, registered after
   `Selection`, the only caller of `takeInteractPress()`. Ordered claims for
   things that hold the player *exclusively* (no proximity, so nothing to
   disagree with): what's-new panel → lift panel → ferris end card → tree peek.
   Falls through to `Selection.handleInteractPress()`.
4. **`pressAction(label, run, glyph?)` / `pressZone(zone, run, glyph?, label?)`**
   now take a **real closure**. `interactPress` / `setInteractPress` deleted.
5. **`Selection.handleInteractPress()`** always `commit(primary)`. The old
   "in reach → flash only" special case is **gone** — it existed solely because
   the legacy handler had already acted on the same press.

## The double-fire hazard (#103 follow-up), resolved

Old `Selection.onInteractKey` refused to run an in-reach action because the
owning system had already handled that press — on a tree that would have
climbed and instantly un-climbed. That is why `commit` could not simply run.

Now: `TreeClimbing` no longer reads the press at all. Climb comes from the
zone's action; un-climb is a **router claim** gated on `playerPeeking`
(`playerPhase === 'peek'`), which is exclusive — the player is up a tree, no
zone is selectable (`player.riding`), so there is exactly one claimant. `jump`
and stick-deflection still bring her down; those are different actions and were
never part of the hazard.

## Kept deliberately

`justPressed('jump')` on the train's `wantsOff`, the ferris end card and the
tree peek. `'jump'` is a different action with no chip, so it cannot disagree
with one.

## Status

See git log on this branch. Build must pass (`npm run build`, check exit code).

## QA needs a human (I do not own the browser)

Station "Get on" with a flower underfoot (**the reported bug**), flowers, tree
climb + climb down, stalls, shops, toilets, stairs, grown-up, lift panel,
ferris end card, face paint.
