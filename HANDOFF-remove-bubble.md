# HANDOFF — remove the floating bubble (issues #377, #380)

Branch `feat/remove-the-bubble`, worktree `.claude/worktrees/remove-bubble`.

Jim, 29 Aug 2026: *"Yeah I think remove it and keep only the lift. It's the
only one that works very well. Remove from docs too."* Following his earlier
*"there are too many ways between the floors right now. Let's reduce it to
just the lift."* The bubble is the first of those to go. Decision, not a bug.

## Scope

Code + assets + docs. **Only the castle's floating platform.** The *backpack
charm* called "bubble" (`src/art/models/backpacks.ts`, `state/types.ts`,
`ui/CharacterCreation.ts`, GAME_DESIGN.md ~line 254) stays — different thing.
`PALETTE.bubbleSkin` also stays: the hotel tower and its dressing use it.

## Files touched

- deleted `src/world/building/Bubble.ts`
- `src/world/building/layout.ts` — `BUBBLE_SHAFT`, its `BUILDING_SHAFTS` row,
  `BUBBLE_X/Z/RADIUS`
- `src/world/building/ShaftGuards.ts` — the deck 1-4 circular guard
- `src/world/building/Building.ts`, `interactZones.ts`, `src/core/constants.ts`,
  `src/ui/ParkMap.ts`
- comment-only: Game.ts, World.ts, Player.ts, interact.ts, anchors.ts,
  ParkTrain.ts, Shell.ts, surfaces.ts, castleFabric.ts, check-castle.mts
- docs: GAME_DESIGN.md, ARCHITECTURE.md, ARCHITECTURE-DECISIONS.md,
  ARCHITECTURE-REVIEW.md, ASSET_MANIFEST.md

## What the removal frees

`BUBBLE_SHAFT` was **both** a shaft and a deck hole — it was a row in
`BUILDING_SHAFTS`, which `DECK_HOLES` spreads. Removing it makes a 2.1 m
circle at local (-1.5, 0) **solid floor on decks 1-4** rather than an open
well, and takes the deck 1-4 guard rail with it. No hole is left behind.

## Verified (30 Aug 2026)

Measured on the **built tree**, not the diff — headless Chrome on a dev
server, `/castle?deck=N&at=-1.5,0`:

- `floating-bubble` named objects in the scene graph: **0**. The only
  `bubble` names left are 25 NPC `speech-bubble` sprites.
- `shaft-guard-rail` groups: **4** (trampoline decks 1-2, helter decks 1-2).
  It was 8: `addCircularGuard(..., [1,2,3,4], BUBBLE_*)` built the other four.
- `WalkSurfaces.sample` at world (598.5, 600) on all five decks returns
  exactly that deck's height (0.728 / 4.328 / 7.928 / 11.528 / 15.128) —
  solid floor, no fall-through, on every storey.
- Interact zones: `lift-0` … `lift-4` all present at those five heights; no
  `bubble` zone. **Every floor is still reachable by the lift**; nothing is
  stranded.
- Screenshot standing on the old bubble spot, deck 2: plain flagstone. No
  hole, no orphaned rail. It *is* a bare patch of floor now — worth telling
  Jim, it may want dressing.

Exit codes, all **0**: `npx tsc --noEmit`, `npm run build` (unpiped),
`npm run test:procgen` (14 files, 458 tests), `check:castle`, `check:park`,
`check:park-boot`, `check:deck-fallthrough`, `check:park-map`,
`check:hop-clearance`, `check:tap-spacing`, `check:nav-routes`.

## Rebased onto pnpm `main` (30 Aug 2026)

`main` moved to pnpm 12.1.0 (`e7d915d4`, PR #402) while this sat green. Rebased;
**no conflicts** — this branch touches neither `package.json` nor any lockfile,
so `pnpm-lock.yaml` comes through from `main` verbatim and `package-lock.json`
is simply gone with the migration. Verified with
`git diff origin/main...HEAD -- package.json package-lock.json pnpm-lock.yaml`,
which is empty.

Two things a replacement will otherwise lose an hour to:

- ~~**`pnpm` on this machine is ambiguous.** `which -a pnpm` gives two. The
  first on `PATH` (the fnm shim) is a **broken stub** that dies with a shell
  syntax error out of pnpm's own store. Use **`/opt/homebrew/bin/pnpm`**,
  which is 12.1.0 and matches `packageManager`.~~ **Corrected 30 Aug —
  `/opt/homebrew/bin/pnpm` is 11.20.0, not 12.1.0.** It only *looked* like
  12.1.0 because pnpm 10+ self-switches to the pinned version before running;
  the version checked was existence, not identity. The stub was the
  fnm-installed pnpm **11.5.0**, too old to build pnpm 12's native binary,
  so it left a placeholder text file where the binary should be. Fixed at
  source by upgrading it (`npm install -g pnpm@latest` → 11.24.0). Plain
  `pnpm` is now correct; do not hard-code a path. See CLAUDE.md,
  "Just type `pnpm`. It picks its own version."
- `node_modules` was stale npm; deleted and reinstalled with
  `pnpm install --frozen-lockfile`. It left the lockfile untouched, as it must.

**The build chain is 47 steps on this base, and that is correct** — #405, which
adds the 48th (a HUD check), is still **open**, not merged. Since this branch
never touches `package.json` there is nothing to reconcile whichever lands
first. Do not add or remove a step here.

All gates re-run under pnpm on the rebased head, all exit 0 (below), and the
built-scene verification re-run and byte-for-byte unchanged.

## Doc mentions

18 found across the docs. **12 changed** (GAME_DESIGN 4, ARCH-DECISIONS 5 +
a new correction 5, ARCHITECTURE 1, ARCH-REVIEW 2, ASSET_MANIFEST 1).
**Left alone deliberately:** the `bubble` *backpack charm*
(GAME_DESIGN.md:269, ASSET_MANIFEST row 22), the NPC *speech* bubble
(GAME_DESIGN.md:970), and the purely historical July prose in
ARCHITECTURE-DECISIONS (the §6 S2 plan line, the "one uniform pitch" cost
argument, the sources-read file list, §8's family question as originally
asked) — a decision log records what was decided then, and correction 5
now says what changed.
