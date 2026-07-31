# Handoff — baking character faces into the head's own UV

**Branch** `feat/kid-face-baked-uv`. **Worktree** `.claude/worktrees/kid-face-bake`.
**Stacked on `fix/hood-face-baked-texture` (PR #135)**, which is where
`paintFaceOnFill` and `FACE_FILL_INSET` come from. Merge that first.

Read `ART-AGENT-NOTES.md` before this file.

## What this is — and what it is not

Jim asked for the hood treatment to be applied to the kid's own face and face
paint, and to the characters. It is a **consistency/architecture change, not a
bug fix.** `createFacePatch` is built from three.js's own `SphereGeometry`, so
its winding was always correct and nothing here was broken or invisible. That is
the opposite of the hoods, where a hand-rolled patch was inside out.

## Done

| | |
| --- | --- |
| player kid | baked, incl. face paint |
| RiPika | baked |
| Mini | baked |
| Biscuit | baked, incl. the muzzle's static smile |
| NPC crowd | **deliberately still a patch** — see below |
| shopkeepers / shop pets (`sharedFace.ts`) | **deliberately still a patch** |

## The two deliberate exclusions

Not laziness, and not reversible without breaking things:

1. **`kidCrowd.ts` and any `InstancedCrowd` prototype.** Skin tone reaches an
   instanced skull as an `instanceColor` multiply against a flat white material.
   Bake the face in and that multiply lands on the eyes too — a deep skin tone
   drives the plum ink to near-black, and there is no black in this game. The
   crowd's twelve (expression × eye-colour) variants would also have to be
   crossed with every skin tone, which is the blow-up the crowd exists to avoid.
   `createKid({ facePatch: true })` keeps the old path for it, and
   `check:baked-face` asserts the prototype still has its `facePatch` mesh and an
   untextured skull.
2. **`sharedFace.ts`'s cache.** One set of five canvases serves every shopkeeper
   and shop pet; baking needs one set per *body colour*, which is the cache
   deleted. `applyTo` throws if handed a `markShared` geometry rather than
   corrupting one.

The rule, now in `ART_DIRECTION.md` and `ART-AGENT-NOTES.md`: **bake when the
texture can carry the surface's own colour; keep the patch when something else
has to.**

## How the mapping works, and why it is safe

`remapSphereFaceUv` is an **affine rewrite of three.js's own `uv` attribute**,
not a fresh computation from vertex positions. Two reasons:

- `SphereGeometry` already splits its UV seam (the far column is built twice,
  `u = 0` and `u = 1`). Recomputing `u` from azimuth would give both copies the
  same value and the quad between them would smear the whole texture round the
  head. An affine remap keeps the split three.js already made.
- The winding stays the library's.

`facePatchGeometry` and a full sphere parameterise azimuth identically up to an
affine map, so a face texture authored for the patch lands on exactly the same
part of the head. **That is why this is like-for-like and not a re-authoring.**

three.js puts `u = 0.25` at `+Z` and the seam 90° round the side; the widest
face window here spreads ±54°, clearing it by 36°. `check:baked-face` asserts
the convention rather than trusting it, because if three.js ever moved it every
baked face in the game would move with nothing else to notice.

## Verified (all in node, against the real built models)

- **Every paint call is identical.** Recorded the real canvas calls on the old
  patch path and the new baked path and diffed them: all five expression
  canvases, **154 ops, zero differing** once normalised by canvas size. Same
  positions, same sizes, same colours — including the soft blush airbrush and
  the iris gradient, which are untouched.
- **The face does not move on screen.** Every landmark sits at the same
  (azimuth, polar) as before; the only difference is that the patch stood at
  `radius × 1.012` and the bake is on the skull, so each landmark moves 7.8 mm
  *radially* — the decal no longer floats 1.2% of a skull proud of the head.
  Same direction from the head's centre, so no apparent shift from any camera.
- **Ray-cast**: for all four characters, a ray in from outside at each painted
  feature hits the head first and the UV there is within **0.0004** of where the
  feature was painted.
- **The back of each head** samples the plain border (u ≈ 1.9), i.e. the seam is
  not smearing the face round.
- `npm run build` **exit 0**, checked directly, never piped. `check:assets`
  reports no new drift; `check:crowd`, `check:hair` and `check:hat-fit` pass.

## The one visible change, and how to revert it

**Face paint moves 72 mm up, onto the kid's actual cheeks.**

The old overlay was a third curved shell built at its own defaults — `tilt: 0.1`
and the *default* eye layout — while the kid's face is built at `KID_FACE`'s
`tilt: 0.03` and `eyeY: 0.43`. Measured, every design was landing 71.8 mm below
her blush, i.e. down on the jaw. Sharing one canvas makes the two agree by
construction.

Measured both ways: old paint spot → her real blush, **71.8 mm**; new paint spot
→ her real blush, **0.0 mm**.

If you would rather ship today's placement, pass `DEFAULT_FACE_LAYOUT` instead
of `faceLayoutOf(paint)` in `createBakedFace` — it is one line and there is a
comment there pointing at it.

## Not verified — needs the browser

**No in-game QA; the browser was not this agent's to drive** (CLAUDE.md). Needs
eyes on:

- the player in `/art-samples.html` and in the park, at gameplay distance and at
  the game's 38° camera, **beside a pre-change build if possible** — Jim's bar is
  "no visible drift", and the strongest evidence here is numerical, not visual;
- the character creator: skin-tone taps (the skull texture repaints now), eye
  colour, and that blinking still works;
- the face-painting stall: each of the six designs, applied and washed off, and
  the picker's preview matching what she ends up wearing;
- RiPika's **space helmet** (`createRipika({ space: true })`) — it used to clone
  the face patch's geometry and now builds the sector directly;
- Biscuit's muzzle smile, which moved into the muzzle's own texture;
- the NPC crowd, to confirm nothing about it changed (it should be untouched).

## Left undone, on purpose

The other `createFacePatch` callers — balloons, the space turtle, ferris
friends, the train, the cat bus, spooky-house pumpkins, the dodgems bird, the
stall's painter NPC — are all mechanically the same change now that
`createBakedFace` exists, and none of them is instanced or shares a cached face.
They are left out to keep this PR reviewable, not because they should not be
done. Several have pre-existing patch/head transform mismatches that a bake
would quietly fix (the train double-applies a 0.86 z-squash to its face; the cat
bus, the pumpkins, the bird and the stall's painter never mirror their head's
squash at all).
