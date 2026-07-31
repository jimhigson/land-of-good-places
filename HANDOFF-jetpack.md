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

One button, one rule a six-year-old needs no explanation for:

- **Tap Fly** → she lifts off.
- **While flying, hold Fly** → she rises. **Let go** → she sinks, gently.
- **Touch the ground** → she lands and is walking again.

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

## State of play

- [x] Asset `src/art/models/jetpack.ts`
- [x] State plumbing (`kind: 'jetpack'`, `wornJetpackUid`, save)
- [x] `entities/WornJetpack.ts` + `jetpackAnchor` on the kid
- [x] Catalogue entry `gear.jetpack` (toy shop) + shop-counter display
- [x] `fly` action, HUD fly button beside hop
- [x] Flight in `Player.update`
- [x] Parade flies too, each member wearing a jetpack
- [x] `npm run build` green
- [ ] PR opened
- [ ] Visual QA (browser not owned — see PR body)
