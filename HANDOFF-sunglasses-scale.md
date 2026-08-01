# HANDOFF — sunglasses-scale

Branch `feat/sunglasses-scale`, worktree `.claude/worktrees/sunglasses-scale`,
branched fresh from `origin/main` (today, after the glasses feature merged).

## Task

Jim: "The sunglasses need to be exaggerated and theatrical - make the lenses
about double their current size." Sunglasses only — star/heart untouched.

## State: geometry + threshold done, build green, screenshot pending

`npm run build` exit 0 (checked as a real exit code, redirected to a file —
never piped through `tail`/`head`).

## What changed

`src/art/models/glasses.ts`:

- `SUN_LENS_RADIUS = 0.092 * 2` — the lens blob radius, literally doubled,
  Jim's explicit number.
- `SUN_RIM_RADIUS = 0.16`, `SUN_RIM_TUBE = 0.034` (was torus `0.1`/`0.019`) —
  the rim scaled up alongside the lens rather than left behind it, so this
  reads as one deliberately oversized "giant novelty sunglasses" silhouette,
  not a doubled lens awkwardly bulging out of a normal frame. Chosen so the
  rim's outer edge still comfortably contains the doubled lens and the inner
  hole still clears the nose bridge (~10 cm gap at kid scale — checked by
  hand: `EYE_HALF_GAP` (0.1601 head units) − new inner-hole radius (0.126) =
  0.034 head units each side, ×2 sides ×`KID_HEAD_SCALE` 1.5 ≈ 0.10 m). The
  two rims get close but never touch or cross the centreline.
- `SUN_RIM_OUTLINE = 0.016` (was `0.009`) — scaled by the same ratio the rim
  tube grew, lands inside ART_DIRECTION.md §2's 0.016–0.022 prop range.
- `temple()` gained an optional `hingeOffset` param (default `0.095`,
  unchanged for star/heart's calls) so the sunglasses' temple arms could move
  out to `SUN_TEMPLE_HINGE` (scaled by the same ratio the rim's outer radius
  grew) without touching the shared function's default behaviour for the
  other two kinds.
- Star, heart, `bridgePiece`, `STANDOFF`, lens material/opacity/transparency:
  untouched, as scoped.

`scripts/measure-glasses-fit.mts`:

- Sunglasses' span jumped from 0.62× to 0.79× the bare head's width — over
  the old shared `MAX_SPAN` of 0.72. Read the number before touching the
  threshold: checked there's no mesh overlap at the centreline (see above),
  and 0.79× is a genuine, deliberate "giant novelty sunglasses" read, not a
  broken one — consistent with what was actually asked for.
- Added `MAX_SPAN_OVERRIDE: Partial<Record<GlassesKind, number>>`,
  `{ sunglasses: 0.82 }` — sunglasses only. Star and heart still gate on the
  original shared `0.3–0.72`. 0.82 gives ~0.08 headroom above the measured
  0.79×, the same margin the original `MAX_SPAN` gave above the widest of the
  three original kinds (star at 0.64×) — not shrink-wrapped to today's exact
  figure, per CLAUDE.md's rule on ratchets/thresholds.

## Numbers (after)

```
kid: bare head 1.398 m across, left ear to right ear

glasses        span  centreX eyeY off halfSpan
----------------------------------------------
sunglasses     0.79   0.0000   -0.0mm    0.555
star           0.64   0.0000   +2.6mm    0.445
heart          0.60   0.0000   +1.7mm    0.418

glasses fit: all 3 pairs sit correctly on the face.
```

Before (unmodified `origin/main`), for reference:

```
sunglasses     0.62   0.0000   -0.0mm    0.432
```

Centre offset and eye-height offset are both unchanged (0.0000 / −0.0mm) —
expected, since neither `EYE_HALF_GAP` nor the vertical placement changed,
only the size of what's built at that x.

## Not yet done

- **No real screenshot.** No existing "fitting room"/frozen-clock screenshot
  harness for glasses was found (only `measure-glasses-fit.mts`, which
  measures vertices, not pixels — there's no headless WebGL renderer in this
  repo). The shared chrome-devtools Chrome profile is the only path to a real
  render; messaged the Overseer ("main") early in this session asking for a
  window on it and am waiting to hear back. Checked whether the shared
  Blender MCP instance could substitute (render a `.glb` export) — it is
  live and mid-use by another agent's hood/hat/hair work (`KidRef_*`,
  `Hood_ripika_*`, `HoodCam`, etc. all present and in progress in the scene),
  so did **not** touch it, same "single shared resource, not yours unless
  told" principle as the Chrome profile applies there even though CLAUDE.md
  only names Chrome explicitly.
- If the Overseer doesn't get back before this needs handing off: the PR
  should go up regardless with the measured numbers above and a clear note
  that visual QA is outstanding, rather than blocking on it indefinitely —
  same as `HANDOFF-glasses-assets.md` did for the original asset when it had
  no browser access.

## Next agent, if you pick this up

1. Check for a reply from "main" re: Chrome profile access. If granted, spin
   up your own dev server on your own port (`--strictPort`), `background:
   true` page, navigate to wherever the glasses picker/CharacterPreview lives,
   screenshot old (`git stash` or check out `origin/main`'s `glasses.ts` in a
   scratch copy) vs new, close the page, kill your server.
2. If not granted / still no reply: open the PR anyway with the numbers above
   and flag visual QA as outstanding for a reviewer with browser access.
3. Don't touch star/heart or `bridgePiece`/`STANDOFF` — out of scope.
