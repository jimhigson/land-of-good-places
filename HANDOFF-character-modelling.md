# Handoff — authored character models (design note, checkpoint before build)

**Branch** `feat/character-modelling`. **Worktree** `.claude/worktrees/char-model`.
Stacked on `feat/kid-face-baked-uv` (PR #136), which is stacked on
`fix/hood-face-baked-texture` (PR #135).

**This is the one-page plan Jim asked for before any Blender work.** Nothing in
§3 onwards is built yet. Read `ART-AGENT-NOTES.md` first.

---

## 1. The regression that triggered this, and what it actually was

Jim was right and my report was wrong. Measured on the head:

| face paint design | before | after my change | moved |
| --- | --- | --- | --- |
| cat whiskers | polar 1.745 (just below the eyes) | polar 1.630 (**72% down the eye**) | 76 mm |
| cheek designs | 1.848 | 1.737 | 73 mm |
| star eye | 1.332 | 1.200 | 87 mm |

The kid's eyes span polar 1.213–1.750. The whiskers moved from under them to
across them.

**Why I did not catch it.** I compared the new cheek position against a landmark
computed from *the same new numbers* — new-code-against-new-code, which is a
tautology, not a test — and I only checked the four designs that use
`paintCheekPoint`. `catWhiskers` and `starEye` anchor to their own formulas and
were never looked at. The lesson is in `ART-AGENT-NOTES.md` §6 now: **verify
against the old rendering, not against the new code, and enumerate every case
rather than one family.**

**Fixed on this branch** (commit `eb52b8c`), and independently of the modelling
work below: a design is authored in one space and is now *transformed* onto
whatever face window hosts it, never re-read against different constants. All
six designs measure **0.0000 mm** from where they used to sit, and
`check:baked-face` asserts it every build.

## 2. Why Jim is right that this is structural

Three incidents, one shape:

| | the two things that had to agree | how they disagreed |
| --- | --- | --- |
| hood faces invisible | shell triangles / patch triangles | opposite winding |
| face paint 72 mm out | face window / overlay window | different tilt |
| whiskers on the eyes | authored paint space / host face window | different tilt again |

Every one is **two independent descriptions of the same surface**, kept in step
by hand. Baking the face into the geometry's own UV removed one instance of it.
It did not remove the pattern, because the UV was still computed by a *second
function* trying to agree with the first. Authoring geometry and UVs together in
one file removes the second description entirely — there is nothing left to
disagree.

---

## 3. Proposed mechanism (points 1, 2 and 5)

### The asset carries geometry + UVs. Nothing else.

A `.glb` per character, holding **meshes, transforms, names and UVs only** — no
materials, no textures, no images.

- **Materials stay in code.** `toonMaterial`, the shared ramp, the house
  palette, `addOutline`. ART_DIRECTION §2 and §5 are unaffected, and per-child
  skin/hair/outfit/shoe/eye colour keeps working exactly as now.
- **Textures stay canvas-painted at runtime.** The face is still `paintFace`
  into a canvas; it just lands on a UV island Blender authored instead of one a
  formula computed. Expressions, blinking, skin tone and the face-paint stall
  all keep their current mechanism.
- This is also forced: **GLTFExporter cannot write textures headlessly** (it
  needs a real canvas to encode an image). Verified — it throws in
  `processImage`.

### It loads headless. Verified, not assumed.

I round-tripped the current kid through `GLTFExporter` → `.glb` →
`GLTFLoader.parse()` in Node just now:

```
current procedural kid: 30 meshes, 25622 vertices, 18544 triangles
exported glb:           923 KB
re-loaded in node:      30 meshes, 25622 vertices
named nodes preserved:  kid, torso, hand, ...
```

- **Node** reads the file with `fs.readFileSync` and calls
  `GLTFLoader.parse(arrayBuffer, '')`. No network, no DOM, no loading manager.
  So `check:assets`, `check:hat-fit`, `check:hair` and `check:baked-face` keep
  working unchanged.
- **Browser**: Vite `?url` import, fetched and parsed once; one more PWA
  precache entry.
- **The character creator rebuilds per tap.** Parse once at module load, then
  **share the geometry** (`markShared`, so `disposeTree` leaves it alone) and
  build only fresh materials per kid. That is *cheaper* than today, which
  re-tessellates 30 spheres on every tap.
- Exporting from Node needs a ten-line `FileReader` shim (Blob → ArrayBuffer).
  Only the offline export tool needs it, not the game.

### Size is the one number I want a budget for

923 KB is the *current* geometry, which is 18.5k triangles of full-fat
`SphereGeometry` — far more than this art style needs. An authored kid at
3–5k triangles, with meshopt or Draco, should land in the tens of KB. **I would
like a ceiling from Jim** (my suggestion: ≤ 150 KB per character in the bundle).

---

## 4. The animation contract (point 4)

This is the part most likely to break silently, so here it is explicitly.
`applyWalk(limbs, body, …)` rotates plain `Group`s and bobs another one. Nothing
in this game is skinned.

**The asset must therefore export as a node hierarchy of separate meshes
parented to named empties — not as one merged or skinned mesh.** Everything
below has to survive with its exact name and local origin:

| node | what breaks without it |
| --- | --- |
| `root` (origin at feet, +Z forward, scale 1) | asset contract, ground placement |
| `body` | the walk bob and squash |
| `head`, and `crown` inside it at `HEAD_TILT` | head look-at; the face's tilt |
| `leftArm` `rightArm` `leftLeg` `rightLeg` pivots | `applyWalk` — arms and legs stop moving |
| `hatAnchor` `hairAnchor` `holdAnchor` `backpackAnchor` | hats, flowers, carried toys, backpacks detach |
| the head mesh as its **own** mesh with its **own** material | expression swaps, blinking, skin tone |

Two further constraints that rule out the obvious "just merge it into one nice
clean mesh":

- **The instanced NPC crowd instances every mesh it finds on a prototype kid**
  and gives the face patch twelve material variants. One merged mesh would
  destroy that, and a baked face on an instanced skull is already ruled out
  (skin tone arrives as an `instanceColor` multiply — see PR #136).
- **Hair, hats, shoes and backpacks are separate rigs** that mount on those
  anchors and are chosen per child. **I propose they stay procedural for now**
  and only the *body and head* become authored, so this change has one moving
  part. `hairShell.ts` and `hoodShell.ts` already work and are not implicated in
  the bug class the way a face patch is.

Unnamed nodes come back from the exporter as `mesh_1`, `mesh_2` — so **every
node gets named in Blender**, and a check asserts the full list exists.

---

## 5. Two stages, and the decision I need

There is a real tension in the brief: *"model the characters properly in
Blender, not procedural primitives"* pulls against *"must match the current
look exactly"*. A hand-modelled kid will not be vertex-identical to a stack of
squashed spheres. So:

**Stage A — prove the pipeline, with parity that is provable.**
Take today's geometry as the starting point (export it, bring it into Blender),
**unwrap the whole character properly in one UV layout**, name every node,
export, and drive the game from the asset. Geometry is unchanged to floating
point, so "matches exactly" is not a judgement call. This is what kills the bug
class: one authored file, geometry and UVs together, no second formula.

**Stage B — actually model it.**
Re-topologise: real joins where the limbs meet the body instead of intersecting
blobs, a continuous head, clean edge flow. Verified against Stage A by the
parity harness with an agreed tolerance, plus screenshots.

**I recommend A first, then B**, because A de-risks everything (loader, build,
animation, crowd, creator, bundle size) before any art time is spent, and gives
B a ground truth to be measured against. It also means that if B stalls, the
repo is already out of the two-formula bug class.

**Decisions I need before I start:**

1. **A then B, or straight to B?** If "match exactly" is a hard constraint,
   Stage B needs a tolerance instead — the two cannot both be absolute.
2. **Tolerance for Stage B.** My suggestion: silhouette within 2 mm at any of 64
   sampled angles, every anchor within 1 mm, total height within 1 mm, head:body
   ratio within 0.5%.
3. **Bundle budget per character** (my suggestion: ≤ 150 KB).
4. **Hair/hats/shoes/backpacks stay procedural for now** — confirm.
5. **Browser time**, and when. Point 3 and the verification bar both need
   before/after screenshots and I cannot take them without it.

---

## 6. Verification plan

Numeric first, screenshots second, and neither alone.

1. **Parity harness** (new `check:character-parity`), authored vs procedural, in
   Node: per-named-part bounding box and centroid; `visibleTop`; every anchor's
   world position; head:body ratio; and a **silhouette sweep** — cast rays from
   64 angles around the character and compare the hit distances, which catches
   shape drift that bounding boxes miss.
2. **Animation parity**: drive `applyWalk` through a full cycle on both and
   compare the world positions of hand and foot tips frame by frame. This is the
   assertion that would catch a limb pivot exported at the wrong origin.
3. **Face placement**: the existing `check:baked-face` ray-cast, pointed at the
   authored UVs — hit the head from outside, confirm the UV under each painted
   feature is where that feature was drawn.
4. **All existing checks green**, `npm run build` exit 0 read directly.
5. **Screenshots**: before/after, same expression, same camera, same crop, at
   gameplay distance *and* close up in the creator. Explicitly **not** my
   primary evidence — Jim has been caught by a screenshot once and I have now
   filed a false "verified" once.

## 7. Status

- [x] Face-paint regression measured, fixed, and pinned by a check
- [x] Headless glb round trip proven (export, parse, node counts, named nodes)
- [x] Animation contract enumerated
- [ ] **Everything else — waiting on the five decisions in §5**
- [ ] No Blender work started
