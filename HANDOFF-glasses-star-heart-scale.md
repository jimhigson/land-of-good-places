# HANDOFF — glasses-star-heart-scale

Branch `fix/glasses-star-heart-scale`, worktree
`.claude/worktrees/glasses-star-heart-scale`, branched fresh from
`origin/main` (after PR #143's "Exaggerate the sunglasses" merged).

## Task

Jim: "Those glasses are good but the star and heart also need to be much
bigger to match" — following the sunglasses lens doubling (commit `006a966`,
PR #143). Scale up star and heart glasses' whole silhouette (frame, lens,
outline, temple hinge) the same way, not just the lens.

**Second round, same PR:** Jim also asked to (1) round the star's spike tips
(currently sharp/pointy — soften without losing the star silhouette) and
(2) fix the star's orientation to the classic "one point straight up"
layout. Both landed as commit `af22e8d` on this same branch.

## State: done — PR #146 open, build green, fit-check green, visual QA left to the Overseer

`npm run build` exit 0 (checked as a real exit code, redirected to a file,
never piped through `tail`/`head`).

## What changed — `src/art/models/glasses.ts`

Key finding: **star/heart frames are filled, left-right-symmetric shapes**,
unlike the sunglasses' torus rim. A torus can grow its outer edge while its
inner hole radius is chosen independently — that's how sunglasses doubled
their lens and kept a real gap over the nose bridge. A star or heart frame
has no such independent inner/outer control: growing `size` pushes the
near-nose edge in exactly as fast as it pushes the outer edge out (both
shapes are symmetric about their own centre). This means:

- **Star** (`halfWidth ≈ 0.556 × size`, measured off the built geometry) was
  *already* close to the centreline at its shipped size (`0.235`, gap ≈
  8.8 cm at kid scale) — it has very little room to grow before its point
  crosses into the other eye's star. Grown to `STAR_FRAME_SIZE = 0.27`
  (+15% from shipped), checked to leave ~30 mm clear at kid scale. Past
  `size ≈ 0.288` the two stars would overlap across the nose — a real
  geometric ceiling, not a stylistic choice to grow less than the sunglasses.
- **Heart** (`halfWidth ≈ 0.42 × size`) starts with much more headroom (gap ≈
  20 cm at shipped size `0.22`) and was grown much further:
  `HEART_FRAME_SIZE = 0.36` (+64% from shipped), checked to leave ~26 mm
  clear — comparable *absolute* margin to the star's, despite the much
  bigger percentage jump, because the heart shape had far more room to give.
- Lens sizes kept at each kind's original lens:frame ratio (star ~0.81,
  heart ~0.80) so the visible coloured "rim" stays proportionate.
- Outline thickness raised from the shipped `0.008` to `0.016` for both —
  into ART_DIRECTION.md §2's 0.016–0.022 "props" range, matching the
  sunglasses' rim outline, for the same "chunkier, more theatrical" read.
  `shapedLensPair()` gained an `outline` parameter for this (was hardcoded).
- Temple hinge offset scaled per-kind by the same ratio the frame grew
  (`STAR_TEMPLE_HINGE`/`HEART_TEMPLE_HINGE`), passed through the existing
  `temple(..., hingeOffset)` param the sunglasses change already added — no
  further changes needed to `temple()` itself.
- `bridgePiece`, `STANDOFF`, colours: untouched.

Clearance numbers were computed by hand with a throwaway node one-liner
building `starGeometry`/`heartGeometry` directly and reading
`geometry.boundingBox` (see git history of this session if needed — not
checked in, was a `-e` script), the same "measure the built geometry, don't
trust the formula" discipline `check:glasses-fit` itself uses.

## `scripts/measure-glasses-fit.mts`

- Star's new span (0.69×) lands *inside* the existing shared `MAX_SPAN`
  (0.72×) — no override needed, a direct consequence of its own tight
  geometric ceiling above.
- Heart's new span (0.73×) is a hair over `MAX_SPAN`. Added
  `heart: 0.78` to the existing `MAX_SPAN_OVERRIDE` map (same pattern the
  sunglasses used), with a doc comment explaining both star's and heart's
  reasoning and why they differ from each other.

## Star tip rounding + orientation (second round)

`starGeometry` (`style/shapes.ts`) gained two new optional params,
`pointRadius` and `rotation`, both defaulting to `0` — the exact original
behaviour, so every other caller (crown jewel in `hats.ts`, balloon badge,
sparkles, rainbow-outline ring, shop star, shoe star) is untouched; none of
them pass either argument. Only the glasses star lens
(`starLensGeometry` wrapper in `glasses.ts`) passes non-zero values:

- `STAR_POINT_RADIUS = 0.16` — rounds only the outer (spike) vertices, via a
  `quadraticCurveTo` that stops short of each sharp corner on both sides,
  using the corner itself as the curve's control point. Inner concave
  notches are untouched. 0.16 is a fixed fraction of a spike edge's own
  length (~0.68 units at this star's radii) — enough to visibly soften the
  point without turning it into a blob.
- `STAR_ROTATION = Math.PI` — `starGeometry`'s default vertex formula puts
  its first (tip) vertex at `(0, -1)`, point straight down (confirmed by
  hand: `angle = i/vertexCount*2π - π/2 + rotation`, so at `i=0, rotation=0`
  that's exactly `-π/2`). Adding `Math.PI` moves that same vertex to
  `(0, 1)` — point straight up, the classic orientation Jim asked for.

Verified the refactored `starGeometry` doesn't touch any other caller: all
of them call it with only 2–3 positional args (size, depth[, points]), so
the new 4th/5th params default in unchanged. Also spot-checked no NaN
vertices come out of the rounding path at this radius (well under the
~0.68-unit edge length, so no overshoot past the adjacent vertex).

## Numbers (after both rounds)

```
kid: bare head 1.398 m across, left ear to right ear

glasses        span  centreX eyeY off halfSpan
----------------------------------------------
sunglasses     0.79   0.0000   -0.0mm    0.555
star           0.67   0.0000   -0.3mm    0.467
heart          0.73   0.0000   +3.3mm    0.509

glasses fit: all 3 pairs sit correctly on the face.
```

Before (unmodified `origin/main`):

```
star           0.64   0.0000   +2.6mm    0.445
heart          0.60   0.0000   +1.7mm    0.418
```

Star's span actually dropped slightly from the size-only round (0.69× →
0.67×, rounding shaves a touch off the tip's own reach) and its `eyeY off`
improved (+5.2mm → -0.3mm — the point-up flip roughly balances the shape's
vertical centroid, where point-down had it skewed). Both still comfortably
inside bounds; heart and sunglasses numbers unchanged by this round.

## Not yet done

- **No real screenshot**, for either round. Messaged the Overseer ("main")
  for chrome-devtools ownership on the first round; reply came back: browser
  busy with #145 QA plus another agent queued behind it, no need to wait —
  Overseer will do the visual check in the character creator before merging
  (same flow as #143), and will fold in the tip-rounding/orientation commit
  too. PR #146 updated; numeric verification for both rounds is above.
- Nothing else outstanding on this task. Worktree can be removed once #146
  is merged (or if picked back up, reuse it).

## If you pick this up

PR #146 is open at https://github.com/jimhigson/land-of-good-places/pull/146,
branch `fix/glasses-star-heart-scale`, pushed to origin. Nothing further to
do unless the Overseer's visual QA finds a problem — in which case, re-check
the geometric-ceiling numbers above before changing `STAR_FRAME_SIZE` /
`HEART_FRAME_SIZE`: growing either past its checked clearance will make the
two lenses overlap across the nose bridge. Don't touch sunglasses or
`bridgePiece`/`STANDOFF` — out of scope, already correct on `main`.
