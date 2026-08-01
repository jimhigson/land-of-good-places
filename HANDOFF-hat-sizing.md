# HANDOFF — hat-sizing (31 July 2026)

Branch `feat/hat-sizing`, off `origin/main` (986890d). **Done; PR open.**

## The ask (from the family, quoted verbatim in the session transcript)

1. **"totally fine, but make all hats 50% bigger"** — every hat, ×1.5.
2. **"make crown and cherry cap 30% bigger again"** — an *additional* ×1.3 on
   the Sparkly Crown and the Cheery Cap only, so those two land at ~×1.95.
   RiPika Cap and Trilla Hat are **not** named: base ×1.5 only.

Implemented once as scratch (commit `f70d396`, `// TEMPORARY: for testing`,
`FIT = KID_HEAD_SCALE * 1.5` plus a `hatGroups(name, extra)` parameter), then
lost when the Cheery Cap and the two critter hoods were rebuilt on
`hoodShell.ts`. Now permanent, as `HAT_SIZE` / `HAT_SIZE_EXTRA` in `hats.ts`
with the quote and the date attached.

> Note for the record: the scratch hack also gave the RiPika hat and the puff
> hat a further ×1.5 (×2.25 total). Neither is named in either family
> instruction, and both were completely redesigned afterwards, so this branch
> gives them the base ×1.5 as briefed.

## Finding 1 — a hat must grow about its brow line, not about the crown

`hatGroups` puts every hat's geometry in a `fit` group whose **origin is the hat
anchor**, the crown of the skull. So `fit.scale *= k` — the obvious change, and
the one the scratch hack made — scales the hat about the crown: ×k wider **and
its hem ×k further down the wearer's face**.

Measured on the built hats, per azimuth, against the real eye line: at ×1.95 the
Cheery Cap's peak lands **62 mm below the top of her eyes**. That breaks
GAME_DESIGN.md's standing rule that a critter hood never covers the wearer's
face, and `hoodShell.ts`'s own peak-height table.

The fix is one line in `finish()`: scale about the **brow line** — the lowest
the hat comes in front of the eyes —

```
y ↦ brow + k·(y − brow)      i.e. fit.scale × k, fit.position.y −= (k−1)·brow
```

so every hat gets bigger upward and outward and never a millimetre further down
her face. No threshold, no tuning, and it holds for any future hat or any future
number from the sofa.

## Finding 2 — the ×1.95 cap the family approved is not this cap

The ×1.3 was approved by eye against the *old* Cheery Cap: a squashed sphere
with a half-cylinder peak, 0.94× the bare head across. The rebuilt hoodShell cap
is 1.09× across before anything is applied, so ×1.95 lands at **2.12× the bare
head, 2.97 m wide on a 2.09 m child** — somewhere the family have not seen.
The multiplier transfers; the visual result does not. **Top QA item.**

For reference, what the family *did* approve on screen (old geometry, scratch
scales, measured by rebuilding it): spans to 1.82, wearer height to 1.99×, and
eye clearance down to 16 mm but never negative.

## Finding 3 — `check:hat-fit`'s bounds were drift detectors, not limits

`MIN_SPAN`/`MAX_SPAN`/`MAX_TIP` were fitted to whatever the hats measured that
morning. That is why the check stayed green while the family's ×1.5 was lost:
the un-enlarged hats spanned 0.58–1.09 and the bound was 0.45. **`MIN_SPAN` is
now 0.75** — above the entire un-enlarged range, below the smallest enlarged hat
— so losing `HAT_SIZE` again fails loudly. See the big comment in the script.

## Also fixed, found on the way

- **`check:hat-fit` measured the skull with the hat still parented inside
  `kid.head`**, so `grip` read exactly 1.00 for all eight the moment a hat grew
  wider than the skull. Take the hat off first.
- **Two descriptions of where the eyes are.** `check:hair` had the only eye
  model, written in the *hair shells'* frame (`hair.ts` hangs them off a `drape`
  group carrying `rotation.x = headTilt`) and omitting `FACE_SQUASH`. Reusing it
  for hats puts the eyes **106 mm too high**. `kid.ts` now exports
  `kidEyeTopAt`, in the crown frame, checked against the built face patch's own
  vertices. `check:hair` is untouched — its copy is correct *in its own frame*.
- **`visiblePoints`** extracted in `measure.ts`; the check script and `hats.ts`
  had each grown a copy of that traversal.
- **Shop stands.** `HAT_DISPLAY_SCALE` folded the worn size into the display, so
  the ×1.95 cap overlapped the sun hat beside it by 109 mm. `hatDisplayScale(kind)`
  divides `hatSize(kind)` back out. `HAT_STAND_SPACING` is one number now
  (`0.85` was written out in two files). The RiPika cap and Trilla bonnet were
  *already* overlapping by 9 mm on `main` and nothing measured it — now gated.

## Verification

- `npm run build` → **exit 0**, checked directly, not piped.
- `check:hat-fit` green: spans 0.87–2.12, wearer to 1.02–1.51×, closest hat to
  an eye 210 mm, widest two shop hats 69 mm apart.
- **Before/after parity against `origin/main`, both built in one process**
  (the technique in ART-AGENT-NOTES §6 — not the new code against itself):
  vertex counts identical, every vertex within **4e-16** of
  `brow + k·(old − brow)`, widths exactly ×1.500 / ×1.950, brow line unmoved to
  4 dp, eye clearance unchanged (sun and cap gain 8.6 mm and 2.3 mm because the
  governing azimuth moves slightly).
- Tallest wearer 3.16 m against a `BUILDING_FLOOR_HEIGHT` of 3.6 — clears
  indoor ceilings by 0.44 m.
- Character-creator framing needs nothing: `boxFor('head')` measures `kid.head`,
  which contains the hat.
- **No browser.** Not confirmed as mine, so nothing here is visually confirmed.
  See the PR for what needs eyes on it.

## For ART-AGENT-NOTES.md — fold these in

`ART-AGENT-NOTES.md` lives on `feat/character-modelling`, not on `main`, so
adding it here would only make a merge conflict. Two entries to fold in when
that branch lands:

1. **§7, the `check:*` family — intentional sizing vs. drift.** A bound fitted
   to what the art measured on the day is a *drift detector*, not a limit. When
   the family deliberately changes a size, re-deriving those bounds from the new
   size is correct and is **not** "weakening an assertion" — but you must then
   check the bound still fails for the thing it was written to catch, and set
   the *other* end so the new decision cannot itself be lost. `check:hat-fit`'s
   `MIN_SPAN` sat below the un-enlarged hats, which is exactly why a family
   requirement went missing under a green build.
2. **§2, units — a shared formula is only shared within one frame.** Copying
   `check:hair`'s eye model into the hat check put the eyes 106 mm too high,
   because it is written in the hair shells' tilted frame and skips
   `FACE_SQUASH`. Both copies looked right and neither was wrong *where it
   lived*. Export the model from the file that owns the geometry, in one named
   frame, and make each caller do its own transform.
