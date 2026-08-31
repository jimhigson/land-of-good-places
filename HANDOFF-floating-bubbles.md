# HANDOFF — #415, "I'm going to x" bubbles float with no child under them

Worktree `.claude/worktrees/floating-bubbles`, branch `fix/speech-bubble-follows-child`.
Dev server: port **5418** (`pnpm exec vite --port 5418 --strictPort`), kill by PID.

## Reproduced (done) — 2 seconds of park, headless chromium

`scripts/`-free repro lives in the scratchpad (`repro.mjs`): boots the dev
server at `/spawn?pos=0,0`, polls `window.game.world.npcs.bubbles[i]` against
`.characters[i]`, screenshots the first bubble more than 3 m off its owner.

Screenshot: scratchpad `floating-bubble.png` — an "I'm going to The Castle"
bubble sitting over the railway at the right-hand edge of the screen with
nobody underneath it, while a second, correct one sits over Jasper.

### The measurement (same frame, both world space, `NpcSystem.group` is untransformed)

```
child #11  owner  world (14.019, 0.414, -0.373)   head ~ (14.019, 2.0, -0.373)
           bubble world ( 9.241, 3.915,  4.404)
           gap 6.82 m   (bubble displaced along screen-right, towards the camera)
```

## The cause — NOT parenting, NOT coordinate frames

Both halves are in the same frame of reference and the bubble *is* re-anchored
to its child every frame (`NpcSystem.updateBubbles`). The displacement is put
there deliberately, one line later, by **`SpeechBubble.updateScreenSize` →
`IsoCamera.clampToFrustum`**:

- the clamp (added for #280, the receptionist's greeting running off the right
  edge of a 390x844 phone) drags *any* bubble back inside the visible frustum,
  **with no bound and no test that the speaker is on screen at all**;
- a child within `BUBBLE_MAX_DISTANCE` (40 m) of the camera focus but outside
  the frustum therefore has her bubble pinned to the screen edge, drawn over
  whatever happens to be there while she is not drawn at all.

Second, related defect found in the same read: `updateScreenSize` writes the
clamped point back into `sprite.position`, which **is** the anchor for callers
that set it once — `Hotel.dressLobby` positions `receptionBubble.sprite` a
single time, so after the first clamped frame her anchor is gone for good
(`Hotel.ts:2149`'s comment claims the anchor is re-read fresh; it is re-read
off the clamped sprite).

## Fix (done, commit `e24a575e`)

1. `SpeechBubble.anchorAt(x, y, z)` owns the anchor in a field; the sprite's
   `position` is a derived, clamp-written value that no caller reads. Callers
   updated: `NpcSystem` (x2), `Hotel.dressLobby`, `WildPets`.
2. `IsoCamera.isOnScreen` gates the clamp: an off-screen speaker's bubble
   hides rather than being dragged. With the anchor in shot the clamp can move
   a bubble by at most its own half-extents, so #280 stays fixed.
3. `IsoCamera.screenOffset(from, to, out)` — screen-axis offset in metres, for
   the check to measure "is the anchor inside the bubble's rectangle" exactly.

Measured after, 48 s of the running game: worst offset 6.82 m -> 1.48 m, and
the 1.48 m case has its owner *on screen* at the frame edge.

## Check (done, commit `61543a30`)

`scripts/check-speech-bubbles.mts`, wired into `pnpm run check` as
`check:speech-bubbles` (chain is now 49 steps; verified by parsing
`package.json`, not grep). 9.6 s. Real park, 7200 frames, 390x844 portrait,
the crowd's own camera; player still for half the run, walking a circle for the
other half.

Proved red:

- `--mutate` (isOnScreen answers yes to everything = the pre-fix path):
  `662 occasion(s). Worst: Cleo at (-19.88, 0.40, 51.98) is not on screen, but
  her bubble is drawn at (-9.62, 1.10, 44.39) — 12.78 m away`
- `--mutate-anchor` (anchor read back off `sprite.position`):
  `7349 occasion(s). Worst: the 8 m set-once bubble was anchored at
  (-5.60, 1.90, 58.53) and is drawn at (3.48, 1.90, 49.45) — 9.22 m adrift`
- clean: 363 sightings, exit 0. Refuses to pass under 20 sightings.

## Also covers the #414 agent's sighting

Same canonical seed, near (-22.1, 30): re-shot on this branch at
`/spawn?pos=-22.1,30` on a 390x844 phone — Wren's bubble at
`(-19.68, 5.18, 27.08)` over Wren at `(-19.68, 2.25, 27.08)`, identical x/z.
Screenshot `bridge-spot-1.png`.

## Remaining

- Full `pnpm run check`, `pnpm run build`, `pnpm run test:procgen`.
- PR referencing #415.
- Dev server pid 36545 on 5418 — kill by PID, confirm free.
