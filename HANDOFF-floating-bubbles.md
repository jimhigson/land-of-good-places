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

## Fix (in progress)

1. `SpeechBubble` owns its anchor in a field (`anchorAt(x, y, z)`); the sprite's
   `position` becomes a derived, clamp-written value that no caller reads.
2. A bubble whose anchor is off screen **hides** rather than being dragged.
   With the anchor on screen the clamp can move it by at most half the bubble's
   own width, so it stays over its speaker. Keeps #280 fixed.
3. New `check:speech-bubbles` inside `pnpm run check`.
