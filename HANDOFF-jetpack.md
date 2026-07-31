# Handoff — the jet pack

**Branch:** `feat/jetpack` (worktree `.claude/worktrees/agent-abe1216c624d327a5`).

Eleri's ask, in her words: *"add a shop that sells a jet pack, and when you use
it your pet gets one too. Button to use it next to the jump button and then you
fly and control where you fly instead of walking."*

## Decisions taken (and why) — read these before changing anything

### 1. The jetpack is a **hat-pattern** asset, not a backpack-pattern one

`art/models/backpacks.ts` states the criterion itself: *"a hat is a separate
asset mounted on an anchor, because hats are sold in a shop, stood on display
stands and swapped mid-game; a backpack is part of the body, chosen once in the
creator, never bought and never taken off."*

The jetpack is bought in a shop, stood on a display stand, and taken on and off.
It ticks all three of the hat column. So it is `art/models/jetpack.ts` — a
factory returning an `AssetHandle` whose **origin is the mount point on the
back**, exactly the way `hats.ts` reads the contract for the crown of the head.
`jetpackAnchor.add(createJetpack().root)` needs no offset maths.

### 2. It gets its **own slot**, and hides the backpack while worn

Its own `worn*Uid` field (`wornJetpackUid`), mirroring `wornHatUid` /
`wornFlowerUid`, so "what am I wearing?" stays one field per body part and the
drawing system stays a store subscriber.

While it is on, the **chosen backpack is hidden** — you cannot strap two things
to one back, and a jetpack sitting 25 cm proud of a bubble rucksack reads as
detached rather than worn. It comes straight back the moment the jetpack comes
off, so the creator's choice is never lost. Same precedent as hair being tucked
away under a hat (`setHatWorn`). `backpackAnchor` does **not** move, so a
creature peeking out still peeks from the same place — over the jetpack now.

### 3. Flight controls — the CONTROL RULE, lifted into 3D

Two buttons, one rule a six-year-old needs no explanation for:

- **Tap up** → she lifts off.
- **Hold up** → she rises. **Let go** → she sinks, gently.
- **Hold down** → she comes down about twice as briskly (6 m/s against 3).
- **Touch the ground** → she lands and is walking again.

*It was one button at first (hold = up, release = down), matching the touch
cluster exactly. Jim played it on a desktop and could not find flight at all,
which is the same bug one level down: descending was an **absence** — the way
down was to stop doing something. So there is a real down button, and letting go
of everything still floats her down exactly as it did. Up wins when both are
held.*

Horizontal steering while flying is *identical to walking*: the same
`camera.right`/`camera.forward` ground basis from `core/screenBasis.ts`, so left
means left in the air exactly as it does on foot. **Nothing rotates to turn.**
The model faces its direction of travel, which is decoration only.

### 4. Nobody can get stuck (the EXIT RULE's spirit)

- Releasing the button always sinks her to the ground under her feet, sampled
  every frame through the player's own `groundAt` — so she lands on the deck,
  the stairs or the grass, whatever is actually there.
- Collision still runs while flying, with `clearance` = her height above the
  local ground. That is the existing wall-clearing machinery: fly high and low
  walls stop blocking, fly low and they block as usual. Tree trunks and
  buildings are `Infinity` and never stop blocking. **So she can never land
  inside geometry** — the spot she comes down on is a spot she was allowed to be.
- A ceiling (`MAX_FLY_HEIGHT`) and the collision world's existing circular soft
  play boundary keep her in the park.

## Where everything is

| Thing | File |
| --- | --- |
| The model | `src/art/models/jetpack.ts` (`createJetpack(scale)`, `setThrust(0..1)`) |
| Colours | `src/art/style/artPalette.ts`, the `jetpack*` block |
| The back anchor | `src/art/models/kid.ts` — `jetpackAnchor`, body space `(0, 0.56, -0.32)` |
| Hiding the bag | `src/art/models/backpacks.ts` — `BackpackRig.setHidden` |
| Drawing what is worn | `src/entities/WornJetpack.ts` |
| The slot | `state/types.ts` (`kind: 'jetpack'`, `wornJetpackUid`), `state/store.ts` (`wearableSlot`, `setWornJetpack`, `buy`), `state/save.ts` |
| On sale | `world/building/shops/catalogue.ts` — `gear.jetpack`, toy shop, 60 |
| On the counter | `world/building/shops/fitouts.ts` — `toyShop()` |
| The buttons | `core/input/actions.ts` (`fly`: **G**/**R**, gamepad RB · `flyDown`: **H**/**T**, gamepad LB), `ui/ScreenControls.ts`, `style.css` `.screen-fly` |
| May she fly here? | `entities/Player.ts` — `get canFlyHere` (worn **and** `flyCeiling > INDOOR_FLY_CEILING`). The buttons and the take-off ask this same one question. |
| Held presses | `core/input/InputSystem.ts` — `holdVirtual` / `clearVirtualHolds` (new) |
| The flight | `entities/Player.ts` — the `THE JET PACK` block, `flying`, `flyCeiling`, `applyFlightPose` |
| The ceiling indoors | `world/building/Building.ts` — one line in `update` |
| The followers | `entities/parade/ParadeMember.ts` (`setFlying`, `buildJetpack`), `entities/parade/Parade.ts` (`aimAt`) |

## Numbers, if they need retuning

Rise 4.4 m/s · drift down 3.0 m/s · held down 6.0 m/s · vertical acceleration
24 m/s² · park ceiling 12 m (soft over the last 2.5 m) · indoor ceiling 1.2 m.
All in `entities/Player.ts`.

## State of play

- [x] Asset `src/art/models/jetpack.ts`
- [x] State plumbing (`kind: 'jetpack'`, `wornJetpackUid`, save)
- [x] `entities/WornJetpack.ts` + `jetpackAnchor` on the kid
- [x] Catalogue entry `gear.jetpack` (toy shop) + shop-counter display
- [x] `fly` action, HUD fly button beside hop
- [x] Flight in `Player.update`
- [x] Parade flies too, each member wearing a jetpack
- [x] `npm run build` green (exit code checked directly, never piped)
- [x] `vitest run` green — 45/45 procgen invariants. **Note:** `vitest` is not
      installed in the shared checkout's `node_modules`, so `npm run
      test:procgen` fails with "command not found" there. Installed locally in
      this worktree with `npm i vitest --no-save` to run it.
- [x] PR opened (#133)
- [x] Follow-up from Jim's desktop test: on-screen **up/down** buttons on every
      device, shown only with a pack worn and only outdoors. `TouchControls`
      became `ScreenControls` because it is no longer touch-only.
- [ ] Visual QA — the shared browser was **not** owned by this task, so none of
      this has been seen running. The list is in the PR body.

## Where the follow-up landed (desktop fly buttons)

`ScreenControls` mounts on every device. Hop is still built only when
`isTouchDevice()`; the fly pair is built always and shown by
`setFlyControls(available, canDescend)`, called every frame from
`Game.updateHud` with `player.canFlyHere` and `player.isFlying`.

Two decisions a reviewer might want to argue with, both written up in the
commit message:

1. **Two buttons, not one.** One button would have matched the touch semantic
   exactly, but it makes descending an absence. `flyDown` is a real action with
   its own speed (`FLY_DIVE_SPEED`), its own keys and its own gamepad button.
2. **No more indoor hover.** `canFlyHere` refuses a take-off indoors, because
   the "buttons only outdoors" requirement would otherwise leave the castle
   allowing a 1.2 m hover that no button offered. `INDOOR_FLY_CEILING` keeps its
   second job as the backstop for a flight already in the air.
