# Handoff: Ethan appearance (light skin tone + blue eyes)

## Status: done, committed, PR open (review skipped by Jim's request)

## What was asked
Jim: "Ethan should always have light skin tone and blue eyes."

## What was found
Ethan already had a fixed spawn slot in `src/entities/npc/NpcSystem.ts`
(`ETHAN_INDEX = 0`, `isEthan` branch around line 307) from an earlier family
request: he's always present, always blue-eyed (`BLUE_EYE_VARIANT`, pinned
in `kidCrowd.ts`), always blonde (`ART.kidHairBlonde`), always short-haired.

The one thing that was **not** pinned: skin tone. It still came off the
normal `pickColours(rng)` roll across `KID_SKIN_TONES`
(`src/art/models/kid.ts`), same as every other kid in the crowd. So Ethan's
eyes and hair were fixed but his skin tone could still land on any of the
seven swatches (Porcelain/Fair/Honey/Caramel/Sienna/Umber/Espresso).

## What was changed
`src/entities/npc/NpcSystem.ts`, in the per-slot loop (~line 310-317):
added `skin: ART.kidSkin` to the `isEthan` override object, alongside the
existing `hair: ART.kidHairBlonde`. `ART.kidSkin` is the `'Fair'` swatch —
`KID_SKIN_TONES[1]` in `kid.ts` — documented there as "the game's
long-standing default" light tone. Used the existing `ART` import, no new
imports needed.

Picked "Fair" over "Porcelain" (the literally-lightest swatch) because
"fair" is the closer synonym for "light skin" and it's already the game's
canonical default — lowest risk of surprising anyone.

## Build
`npm run build` — full check suite (`check:text` through
`check:cruiser-turn-radius`) + `tsc --noEmit` + `vite build` — exit code 0.
No new invariant needed: this is a cosmetic per-character colour pin, not a
change to procgen placement rules, so `test/procgen/invariants.ts` is
unaffected.

## Branch / PR
- Branch renamed from the default worktree name to
  `fix/ethan-light-skin-blue-eyes`.
- Single commit: "Pin Ethan's skin tone to Fair, alongside his existing blue
  eyes and blonde hair".
- Jim said this is a "tiny, self-contained, review-free" change — PR notes
  that explicitly so the Overseer can merge on green CI without waiting for
  a peer review comment.
- Do NOT merge it myself — that's the Overseer's job per CLAUDE.md.

## If picking this back up
Nothing left to do unless CI is red. If so: rerun `npm run build` locally
first (see above — it passed clean at commit time) before assuming it's a
real regression from this change, since the build runs ~25 unrelated check
scripts that could in theory be flaky/order-dependent elsewhere in the repo.
