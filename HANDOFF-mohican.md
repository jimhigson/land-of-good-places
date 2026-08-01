# Handoff — the Mohican hairstyle

**Branch** `feat/mohican-hair`, off `origin/main`. Independent of the face and
character-modelling branches.

## What it is

`HairStyle: 'mohican'`, labelled **"Rooster" 🐓** in the creator — the name and
the shape are both aimed at *friendly rooster crest*, not punk, because the
client is six.

- **The shaved sides are the `crop` shell**, which `short`, `bunches`, `spiky`
  and `messy` already share. That is not a shortcut, it is the cost decision:
  the crowd instances one mesh per prototype mesh, so reusing the shell means
  the Mohican adds **exactly one mesh** to the park rather than two.
- **The crest is thirteen rounded lozenges**, merged into one mesh. Rounded, not
  cones — ART_DIRECTION §4, sharp is never cute, and a rooster's comb is a row
  of rounded bumps. They overlap by 230 mm of their 345 mm depth, so it reads as
  one continuous ridge with a scalloped top, not as separate lumps.
- **Every root sits on the shell's own surface.** The shell is parameterised by
  (azimuth, height), which does not walk over the top of a head — the back of
  the mid-line is azimuth 0 and the front is azimuth π, and they only meet at
  the crown. `sagittalPath` samples both branches, cosine-spaced, right up to
  the apex at `semiY` where the radius reaches zero and they coincide; `pathAt`
  then steps along that path by **arc length**, so blades do not bunch up where
  the sampling happens to be dense.

## Two numbers that were wrong first time, found by looking at it

Both were invisible in the measurements and obvious on screen. Screenshots at
`/art-samples.html`, in a row beside `short` and `spiky`.

1. **`MOHICAN_SKEW` was below 1, which moved the peak the wrong way.** The peak
   of `sin(π · tᵏ)` sits at `t = 0.5^(1/k)`, so 0.78 put the tallest blade at
   t = 0.41 — *behind* the crown. It now reads 1.15 (peak at t = 0.55, just
   forward of the crown, where a real crest's is).
2. **`MOHICAN_LOW` was far too low.** The sides are a full cap of hair, so a
   blade only reads once it clears that cap. At 0.3 the ends sank into the hair
   and the whole style came out as a single shark fin over the crown. At 0.72
   the crest stays proud from nape to brow, which is the thing that makes it a
   Mohican rather than a quiff.

## Hats: the anchor, and what I did about exclusivity

Jim's rule is that picking the Mohican spends the hat slot, and the
character-creation owner is building that. I have **not** built any exclusivity
logic.

- **The crest is authored with no headroom for a hat**, as instructed — it is
  the tallest style in the game (2.46 m against spiky's 2.34 m and short's
  2.09 m). A hat would not fit over it and is not meant to.
- **`hatAnchor` is not moved and does not become invalid** — it is one shared
  anchor on the crown for every style, and the crest simply passes through where
  it sits. So there is nothing to change for this style; the anchor just must not
  be *used*. If the creator ever needs to ask, the honest test is the style name,
  not the geometry.
- **`hideUnderHat` is `true` anyway**, exactly as the spikes are. That is a
  deliberate safety net: until the exclusivity lands, a Mohican plus a hat
  degrades to the crest tucking away rather than spearing through the brim.
  Once exclusivity ships the flag is moot and harmless.

## Verified

- `npm run build` **exit 0**, checked directly, never piped. `check:hair` passes
  (the fringe check is about the shells, and the Mohican rides `crop`, which
  already clears the eyes by 17 mm); `check:assets` reports no new drift.
- Crest measured off the built kid: 0.225 m wide across the head, tip at
  2.461 m, one merged mesh, `hideUnderHat` true.
- Blade overlap measured: 230 mm shared of a 345 mm depth — no gaps in the ridge.
- **Looked at in the browser** at `/art-samples.html` beside `short` and `spiky`,
  and retuned twice on the strength of it (see above). Screenshots taken; the
  dev server was killed by PID and the page closed.

## Left for the family

Whether the crest wants to be **prouder at the nape** still — it currently
slopes back into the cap over the last fifth, which reads as a cockatoo crest
rather than a flat-topped strip. That is one number (`MOHICAN_LOW`), and I have
deliberately stopped where it reads cute rather than pushing it towards punk.
