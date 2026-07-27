# Handoff — six new hair styles (branch `feat/hair-styles`)

Worktree: `.claude/worktrees/hair-styles`. Branch off `origin/main` @ c8de5ac.

## The ask

Family words: *"more hair styles needed - a long pony tail that has physics
applied and goes to the ground like Rumi from KPop Demon Hunters, long hair in
natural form hanging down, a pony tail, a bowl cut, spiky hair like Bart
Simpson, messy hair"*.

## Decisions taken (record these, they are the expensive part)

1. **Hair moves out of `kid.ts` into `art/models/hair.ts`.** One module builds
   every style's geometry and tags each mesh with the styles it belongs to.
   `createKid` builds only the styles it is asked for and hides the rest.

2. **Every style is ONE merged geometry where it can be** (`mergeGeometries`
   from `three/addons/utils/BufferGeometryUtils.js`). A style is 1–2 meshes,
   not 6–9. This matters because of decision 3.

3. **NPCs get the eight static styles; only the player gets the simulated
   floor-length ponytail.** The `InstancedCrowd` draws one `InstancedMesh` per
   *prototype mesh*, so every part the prototype owns is a draw call for the
   whole crowd whether anybody wears it or not. The eight static styles cost
   +6 parts total because of the merging. The simulated tail cannot be merged
   (its segments articulate), so it would be +9 parts AND N verlet chains AND
   N × 8 world-matrix writes per frame — for a tail that would have to hang
   dead-still on an NPC anyway, since the swing is the whole point. Excluded
   from the crowd prototype entirely via `KidOptions.hairStyles`.

4. **The simulated tail is a chain of rigid capsule segments, not a rebuilt
   tube.** `entities/balloonString.ts` — the reference the brief pointed at —
   is correct about the *simulation* (verlet points, distance constraints,
   drag, capped step) and wrong for us about the *rendering*: it allocates a
   fresh `CatmullRomCurve3` **and** a fresh `TubeGeometry` every single frame
   (`rebuildGeometry`, line 129). That is a genuine per-frame allocation that
   is NOT on ARCHITECTURE-REVIEW.md's suspect list and should be added to it
   — see the PR body. Our chain writes `position`/`quaternion` on 8
   pre-built meshes and allocates nothing.

5. **Spiky hair hides its spikes when a hat is worn.** Every other style sits
   at or below the existing hair cap's envelope, which hats already sit over.
   Spikes would spear straight through a party hat. `KidHandle.setHatWorn()`,
   called by `WornHat` and by the character-creation preview.

## Safety rails on the chain (do not drop these — the brief calls them out)

- step capped at 1/45 s, at most 3 substeps per frame, so `Game.timeScale`
  fast-forward (`Game.ts:521`, dt is pre-scaled) cannot blow it up;
- every point hard-clamped to `segmentLength * i * 1.02` from the anchor, so
  it can never leave the character however bad a frame is;
- anchor moved > 2.5 m in one frame ⇒ full `reset()` (space transitions);
- collision against a body cylinder + a head sphere, so it does not saw
  through the torso or the backpack;
- ground clamp so it drags rather than sinking.

## Status

- [x] design + read of balloon string / crowd / hats / char creation
- [x] `art/models/hair.ts`, `art/models/ponytail.ts`
- [x] `kid.ts` rewired, `CharacterModel`, `Player`, `WornHat`
- [x] `kidCrowd` per-style part hiding, `NpcSystem` style roll
- [x] character creator picker + preview
- [x] `npm run build` green
- [ ] visual QA — nobody has looked at this in a browser yet

## Not done / for QA to tune

Exact positions of the hanging styles were derived on paper from the head
tilt (`HEAD_TILT` 0.17 rad) and the backpack's bounds, not by eye. The
things to look at are listed in the PR body.
