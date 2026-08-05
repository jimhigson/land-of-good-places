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

## Why the previous attempt did not fix it

`HANDOFF-selection-rule.md` records: *"`selectRank`: stations +1, signs and
flowers -1. QA found 'Pick!' beating 'Get on' because a flower had seeded on the
platform."* That fixed which chip **shows** — and the family's report is from
*after* it, with the chip correctly reading "Get on". It could not fix which
handler **acts**, because dispatch was still an unaddressed broadcast. Selection
and dispatch were two separate decisions; this change makes them one.

That handoff's decision *"E is not consumed by `Selection` when the thing is in
reach"* is deliberately **reversed** here — it was a workaround for the rival
readers, and it goes away with them.

## Status — build green, ready for QA

- **`npm ci` in this worktree first** (see the trap below), then
  `npm run build` → **exit 0** (full check-script chain + `tsc` + `vite build`),
  `npx vitest run` → **85 passed, 5 seed files**. No procgen files changed, so
  no new invariant is owed.

### The `node_modules` trap — re-verify after `npm ci`, not before

A worktree lives at `.claude/worktrees/<name>` *inside* the shared repo, so with
no `node_modules` of its own Node walks up and silently resolves into **the
shared checkout's**. No error — it just builds against a tree that is not yours.
This worktree started with none, so the first green build here was bogus. Fixed
with `npm ci` in the worktree (never in the shared checkout) and everything
above re-run against it. `vitest` is *not* installed in the shared checkout at
all, which is the tell: if `npm run test:procgen` says `vitest: command not
found`, you are borrowing someone else's dependency tree.
- Proof there is nothing left to race:
  `grep -rn "justPressed('interact')" src/` → only doc comments describing what
  was removed. `takeInteractPress` has exactly one call site,
  `InteractRouter.ts:86`.
- Dev server on **5311**, PID noted at start — kill only that PID.

## QA needs a human (I do not own the browser)

Open in a **private/incognito window**. In rough priority:

1. **The reported bug.** Stand on a platform with a flower within ~1.3 m, train
   in, chip reads "Get on" → E must board, never pick.
2. **Flowers.** Standing at one, E picks it. Standing at nothing, E does nothing.
3. **Tree climb / un-climb** (the #103 hazard). One E climbs; it must not climb
   and instantly drop. While peeking, E comes down — as do hop and walking off.
4. **Stalls** — Ride!/Play!/Enter!, including the ride booths (rail racer, sky
   cruiser, ferris) and a distant chip tap that walks then acts.
5. **Ferris end card** — E dismisses it, and does **not** re-enter the booth.
6. **Shops** — each counter opens its own till, from up close and walked-to.
7. **Building** — stairs menu, toilets (must still refuse from the doorway),
   grown-up toggle, lift "Call" chip and the lift panel's own E.
8. **Face paint**, **what's-new panel** (E still dismisses it).

Doormats: there is no doormat interact handler in this codebase — "doormat" is a
procgen placement concept (a stall's stand point). Covered by (4).

## Ruling on issue #189 (unguarded window `keydown`) — keep it separate

#189: `InputSystem.onKeyDown` is a window listener with no `event.target` guard
that `preventDefault()`s every bound key code. Verified; it is real. It is **not**
the same bug as #122 and should **not** be folded into this branch:

- **Different layers.** #189 is *event → action*: should a keystroke become a
  game action at all when a DOM element is the intended consumer? #122 is
  *action → handler*: given an `interact` action, which thing in the park acts.
- **Neither fix substitutes for the other.** With perfect routing, typing an "e"
  into a text field still mints an `interact` action and this router faithfully
  delivers it — wrong, and #189's to fix. With a perfect target guard, a genuine
  E press in the park still has to reach the shown selection — #122's to fix.
- This change *reduces* #189's severity for `interact`: a stray E while a panel
  is open now reaches `Selection`'s blocked branch (one flash, no-op) instead of
  a legacy proximity handler that could open something.

**One place they touch, for whoever takes #189.** `Enter` is bound to `interact`
(`actions.ts:79`) and action chips are real DOM `<button>`s. On a focused chip,
`preventDefault()` on keydown cancels the button's default Enter activation, so
the DOM click does *not* fire and only the game action does — which commits the
**primary** action, not the focused one. Harmless today (every zone offers a
single action), latent the moment a zone offers two. A `target` guard that skips
keys while a chip has focus would need to let the button's own activation
through, or the chip stops responding to Enter entirely. Worth a QA line, not a
blocker.
