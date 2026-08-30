# HANDOFF — hide the menu button and map during attractions (#404)

Branch `fix/hud-hides-during-rides`, worktree
`.claude/worktrees/hud-during-rides`. Dev server port **5405**, `--strictPort`.

## The ask

Jim, 30 Aug: *"There are times when the menu button is not appropriate, nor the
map. The menu button should only show during normal gameplay. It should hide
during attractions."*

## The seam — found, not invented

**`Player.beginRide()` / `Player.endRide()`, read back as `Player.riding`.**
Every attraction in the game already goes through it, with no exceptions:

| Attraction | Call site |
| --- | --- |
| Giant slide, helter-skelter, stair ride | `world/building/Building.ts:1146` (`startRide`) |
| Glass lift | `world/building/liftRide.ts:349` |
| Rail Race | `world/railRace/RailRace.ts:529` |
| Ferris wheel | `world/ferrisWheel/FerrisWheelRide.ts:391` |
| Park train | `world/train/ParkTrain.ts:418` |
| Sky Cruiser / coaster | `world/coaster/Coaster.ts:251` |
| Hotel lift + hotel cinematics | `world/hotel/HotelLift.ts:223`, `world/hotel/Hotel.ts:2701,2979` |
| Cat-bus arrival sequence | `world/entrance/ArrivalSequence.ts:591` |
| Keychain rack zoom | `world/KeychainShop.ts:680` |
| Tree climbing | `world/TreeClimbing.ts:243` |

It is not a flag a ride sets *as well as* doing its job — it is **how a ride
takes the character at all**. A ride that forgot it would not be a ride: input,
collision and gravity would still be live and the child would walk out of her
own seat. That is what makes it un-forgettable, and it is why no new boolean
was added.

The second half is `MiniGameHost.frozen` — the curtain mini-games (dodgems,
water fight, spooky house) do not pose the player, they replace the park.

## The one owner

`src/core/attraction.ts` — `attractionOwnsTheScreen({ riding, miniGameFrozen })`.
Two readers, and they used to be two hand-written copies of the same
expression:

- `Game.ts`'s `ParkMap` `blocked` dep (was `this.miniGames.frozen || this.player.riding` inline)
- `Game.tick`'s new `hud.setMenuAvailable(...)`

## The three decisions

1. **The map hides, it does not merely refuse.** It was already un-openable
   during a ride (`ParkMap.openMap` → `blocked()`). A pill you can press that
   does nothing is worse than no pill. `ParkMap` mounts its own pill into
   `.hud-menu-items`, so hiding the whole drawer hides it for free — and hides
   any *future* pill mounted there, which is the anti-drift property.
2. **A menu already open is closed** when the ride starts, before the drawer
   is hidden. Otherwise `menuOpen` stays true behind a hidden element and the
   drawer is sitting open on the frame the ride ends.
3. **The line is "a ride is driving the character", not "the screen changed".**
   A door iris (`ui/Transitions.ts`) does not call `beginRide` and keeps the
   button; the glass lift does call it and loses it — which is the right side
   of the line given the lift is to become the castle's only way between
   floors.

## Check

`scripts/check-hud-during-rides.mts`, wired into the `build` chain as
`check:hud-during-rides`. Proven red by mutation — transcript in the PR.

`scripts/qa-hud-during-rides.mjs` (`npm run qa:hud-during-rides <url> <outdir>`)
is the browser half — the wiring the in-process check says out loud it cannot
see. Boards all three named rides at phone and desktop widths.

`scripts/headless-dom.mjs` gained element listeners, a one-class
`querySelector` and `contains`, so the check presses the real button rather
than rolling a second document of its own. `check:slide-rider`,
`check:bus-journey` and `check:ride-camera` all still exit 0.

## Status — done, PR open

- [x] Seam identified (`Player.beginRide` → `Player.riding`)
- [x] Implementation (`core/attraction.ts`, `Hud.setMenuAvailable`, `Game.tick`)
- [x] `check:hud-during-rides`, in the build chain (48 steps, parsed not grepped)
- [x] Proved red twice: setter no-op → 3 FAILs; hide the button only → the map-pill FAIL alone
- [x] Browser QA proved red too: the `Game.tick` line commented out → 6/6 FAIL, `menuButton: visible` mid-ride
- [x] `tsc` 0, `npm run build` 0, `npm run test:procgen` 0 (458 passed)
- [x] Browser: 6/6 pass, before/during/after shots in `/tmp/hud-404-final`

## Rebased onto `main` @ `5ba4a28b` (30 Aug)

`main` moved under this branch — #402 (pnpm), #398 (`ParkMap.ts`), #401 (bubble
removed), #397. One conflict, `package.json`'s `build` line, resolved by
**rebuilding from `main`'s step list** — its 47 `pnpm run` steps taken verbatim
and `check:hud-during-rides` spliced in after `check:park-map` — then parsed
back: **48** steps, none undefined, no duplicates, no `npm run` left anywhere in
`scripts`. `rerere` recorded the resolution *after* it was built, not before.

`pnpm-lock.yaml` taken from `main` untouched (`git diff origin/main -- pnpm-lock.yaml`
is empty). `node_modules` deleted, `pnpm install --frozen-lockfile` (pnpm 12.1.0).

Re-verified after the rebase, not just re-gated: `ParkMap` still mounts its pill
with `container.querySelector('.hud-menu-items')` (`ParkMap.ts:392`) post-#398,
so the drawer still carries the map away with it. Browser run **6/6 pass** again,
shots in `/tmp/hud-404-rebased`. Mutation still red (3 FAILs).

CI: all four checks green, `mergeStateStatus: CLEAN`. Ready for the Overseer.

## A gate that passed for the wrong reason (30 Aug, post-rebase)

Re-running **mutation 2** — hide `.pill--menu` instead of `.hud-menu` — against
`qa:hud-during-rides` after the rebase, it **stayed green**. The in-process
`check:hud-during-rides` failed it correctly; the browser one did not.

Cause: the probe returned on the *nearest* hidden ancestor of any kind.
`.hud-menu-items` is `visibility: hidden` whenever the drawer is merely
**closed**, and it sits between the map pill and the `.hud-menu` that carries
the ride-hide's `display: none`. So the map pill read "hidden" either way —
hidden because the drawer was shut, which it would have been anyway. The
assertion `during.mapPill.startsWith('hidden')` could not tell the two
implementations apart.

Fixed by scanning the **whole chain for `display:none` first**, and asserting
`during.mapPill === 'hidden(display:none)'` exactly. Now:

- mutation 2 applied → **6/6 FAIL**, `mapPill: hidden(visibility)`
- reverted → **6/6 PASS**, `mapPill: hidden(display:none)`

Also hardened `waitFor` against "Execution context was destroyed": a dev-server
HMR reload mid-poll is not a result about the game, and this script is normally
run while source is being edited (that is how it gets proved red). Only that one
error is retried, inside the existing deadline; everything else rethrows. Two
clean back-to-back runs after the fix.
