# Field notes — the 3D-artist agent

**If you are a fresh instance picking up art work on this project, read this
file first**, before any `HANDOFF-*.md`. This is the durable stuff: conventions,
workflow, and the traps that have actually cost time. The `HANDOFF-*.md` files
are per-task and go stale; this one should not.

It has been rewritten from scratch three times because an instance was pulled
mid-task and the next one had to rediscover all of it. Keep it current, keep it
general, and put task detail in the task's own handoff.

---

## 1. What the role is

You model and paint the things in the park: characters, creatures, hats, hair,
shoes, props. The client is Eleri, age 6, and the bar is **"CUTE!" said out
loud on sight** — not "looks nice". When a trade-off is close, pick the one a
six-year-old enjoys more.

Read in this order:

1. this file
2. `CLAUDE.md` — how to work on the repo at all (worktrees, commits, the
   browser, PRs). Not optional.
3. `ART_DIRECTION.md` — the style bible. §3 (faces), §4 (proportions), §7
   (the builder contract, and primitives vs authored geometry).
4. `GAME_DESIGN.md` — what the family actually asked for. It wins over taste.
5. the task's own `HANDOFF-*.md`.

---

## 2. Units: head units, not metres

Anything worn on the head — hats, hoods, hair — is authored in **head units**,
where the origin is the hat anchor (the crown of the skull) and the file's `fit`
group multiplies by `KID_HEAD_SCALE` to get metres. A hat is only ever the right
size *relative to the head under it*, so that is the unit that matters.

Everything else is **metres**, 1 unit = 1 m, origin at the feet, forward is +Z,
`root.scale` left at 1 (it is reserved for gameplay squash-and-stretch).

**The reason this convention exists is a bug worth remembering.** The cartoon
pass took `KID_HEAD_SCALE` from 1 to 1.5. Everything mounted on the head scaled
with it — hair, ears, the face, the hat anchor — except the hats, which lived in
another file holding raw numbers for the old 0.44 m skull. Every hat in the game
spent two days at two thirds of the head it sat on. That is what "the hats are
all much too small" looked like from the sofa.

**So: never copy a number from another model file. Import it.** If two files
need the same measurement, one of them exports it. Most of the checks in
`scripts/` exist because some number got copied.

---

## 3. Modelling in Blender, then hand-porting

For organic, continuous forms — hair, a cap crown, anything whose shape is a
*surface* rather than a stack of blobs — model in Blender first
(ART_DIRECTION.md §7's 31 July ruling). Chunky primitive composition is still
**preferred** wherever it can reach the shape; Blender is for where it genuinely
cannot.

**Port the surface's mathematical definition, not a mesh.** `hairShell.ts` and
`hoodShell.ts` are both this: the Blender prototype runs the *same parametric
formulas* the runtime will, so nothing is lost in translation, and the game
still builds every vertex at runtime. That matters because:

- `check:assets`, `check:hat-fit` and the shop's display stands all run in
  **node with no asset pipeline** — a mesh dump would need one;
- a retune is a number, not a re-export;
- the diff is reviewable.

Model against the **reference kid** (`KidRef_*` in the Blender scene): the real
skull radius, the real hat anchor, the real eye line. Look at it from the front,
the side, the back, **and the game's own 38° iso camera** before believing it.
More art has been wrong at iso38 than at any other angle — two separate hats
read fine from the front and turned out to be a bowl from above.

---

## 4. Winding order — the one that cost a fortnight

**Hand-rolled triangulation can be inside out, and inside-out geometry is
invisible, not obviously broken.**

Both critter hoods' faces, and Trilla's bib, were never drawn in the game at
all. `hoodPatchGeometry` wound its triangles `a,b,c / a,c,d` while the shell it
sat on wound `a,c,b / a,d,c`. The normals pointed at the wearer's skull and
`MeshToonMaterial`'s default `FrontSide` culled every fragment. The mesh existed,
the texture was correct, the placement was correct, the code read fine.

Two lessons:

1. **Check the winding of anything you triangulate by hand.** Average
   `normal · outward` over the vertices; it should be near +1, not −1. If you
   are building a closed shell, the outer skin and any patch on it must wind the
   *same way*.
2. **Prefer the library's primitives when they will do.** `SphereGeometry`'s
   winding is guaranteed; yours is not. When the head faces were later baked
   into the skull's UVs, the mapping was written as an **affine remap of
   three.js's own `uv` attribute** rather than a fresh computation — which also
   preserved the seam split three.js had already made.

---

## 5. Faces: bake into the UV, or use a patch?

Both exist on purpose. The rule:

> **Bake when the texture can carry the surface's own colour. Keep the patch
> when something else has to.**

**Bake** (`createBakedFace` for spheres, `hoodShellGeometry`'s face window for
authored surfaces) when the head or item is a *unique* mesh with a colour of its
own — the player kid, RiPika, Biscuit, Mini, the critter hoods. One surface, one
texture. The face inherits the surface's squash and tilt for free instead of a
`FACE_SQUASH` constant copied next to every call, and there is no second mesh to
point the wrong way or float at the wrong distance.

**Keep the separate patch** where the surface's colour is not its own:

- **`InstancedCrowd` prototypes** (`kidCrowd.ts`, `petBlob.ts`). Skin tone
  reaches an instanced skull as an `instanceColor` multiply against a flat white
  material. Bake the face in and that multiply lands on the eyes — a deep skin
  tone drives the plum ink to near-black, and **there is no black in this game**.
  The crowd's twelve (expression × eye-colour) variants would also have to be
  crossed with every skin tone.
- **`sharedFace.ts`'s cache.** One set of five canvases serves every shopkeeper
  and shop pet; baking would need one set per *body colour*, which is the cache
  deleted.

Three things a bake needs, every time:

1. **A UV that runs with azimuth cannot close.** Split the seam column (three.js
   does this for you on a sphere; `hoodShellGeometry` does it explicitly), or one
   quad interpolates across the whole texture and smears the face round the back.
2. **Weld the split seam's normals** if you built the seam yourself, or the toon
   ramp and the inverted-hull outline both draw a line down it.
3. **Leave a border of plain colour** (`FACE_FILL_INSET`) that everything outside
   the window clamps to, wide enough to survive mip-mapping.

And: **the outline takes its tint from `material.color` when `addOutline` is
called.** A baked face sets the material to white, so either call `addOutline`
*before* applying the face, or pass the real colour explicitly
(`addOutline(mesh, t, inkTint(colour))`). Otherwise you get a grey outline.

---

## 6. Verifying without the browser

You usually will not have the browser (CLAUDE.md: it is a single shared Chrome
profile and the Overseer says who drives it). That is not an excuse for "looks
right in the code". These four techniques are all runnable in node and have each
caught something real:

**Ray-cast from outside.** A ray cast is what the depth test does, and
`Raycaster` honours `material.side` exactly as the rasteriser does — so an
inside-out surface is invisible to it too. Cast in at each painted feature and
assert what answers first, and what UV is there. This is what found the hood bug
after arithmetic had wrongly exonerated it. See `scripts/check-hood-face.mts`
and `scripts/check-baked-face.mts`.

**Diff the generator against `origin/main`.** `git show origin/main:path > tmp.ts`,
import both, build both, compare vertex for vertex. This is how "the Cheery Cap
is byte-identical" was established rather than asserted.

**Record the canvas calls.** Install a recording 2D context *before*
`scripts/headless-canvas.mjs` (it no-ops if `document` already exists) and you
can see exactly what was painted — and diff old against new. Normalise
coordinates by the canvas edge so different canvas sizes compare; **do not
normalise `ellipse`'s last three arguments or a gradient stop's offset**, they
are angles and fractions, and doing so reports differences that are not there.

**Compare before against after in the same process.** If you keep the old code
path alive behind a flag (as `KidOptions.facePatch` does for the crowd), you can
build both and measure the difference directly instead of arguing about it.

Whatever you do, **say plainly in the PR what you have and have not seen
running.** The Overseer has been fooled twice by a screenshot that looked right.

---

## 7. The `check:*` family

`package.json`'s `build` script runs a dozen of them and each one exists because
something shipped broken. Adding one is cheap and is the main way art knowledge
becomes permanent: one script, one line in `build`.

Two rules, borrowed from the procgen invariants and just as true here:

- **Measure the thing that was built, never the rules that built it.** Walk the
  real vertices, cast a real ray. A check that recomputes the generator's own
  formula proves nothing.
- **Never weaken an assertion to make something pass.** Fix the art, or change
  the input and write down why.

Existing ones worth knowing: `check:assets` (contract + declared height),
`check:hat-fit` (a hat against the head it sits on), `check:hair` (fringes clear
the eyes), `check:hood-face` and `check:baked-face` (faces are on the surface the
camera sees).

---

## 8. Small traps, each of which has bitten

- **`blob()` puts the squash on `mesh.scale`, not in the geometry.** So UVs are
  unaffected by it, and a baked face inherits the squash automatically.
- **`material.map` is `null` when unset, not `undefined`.** A `!== undefined`
  test matches every untextured mesh in the game.
- **Textures are canvas-drawn and budgeted**: face patches 512², decals 256²,
  under 40 distinct canvas textures game-wide. Redraw a canvas in place and set
  `needsUpdate` rather than allocating a new texture — the character creator
  rebuilds on *every tap*.
- **Shared caches must be `markShared`** or `disposeTree` frees them out from
  under every other user. `ownTextures` is for the expression canvases a material
  owns but is not currently pointing at.
- **A shared material cannot take a texture map.** If the skull shares `skinMat`
  with hands and legs, giving the skull a map means splitting the material — and
  then whatever recolours it has to update both.
- **Nothing is plumb** (ART_DIRECTION §4): every head gets one asymmetric
  feature, every sphere gets squashed. A perfectly symmetric upright object reads
  as a placeholder.
- **A stale service worker will make your changes invisible.** If the game is
  behaving as though your edits do not exist, that is why — CLAUDE.md has the
  console snippet.

---

## 9. Working style that has held up

- Commit as soon as a chunk compiles. The connection drops and an uncommitted
  branch dies with you.
- Write the finding down *when you have it*, not at the end. The root cause of
  the hood bug was recorded and committed before a single line of the fix.
- When you find that the stated cause of a bug is wrong, **say so plainly and
  show the measurement.** It happened once already and the wrong story was
  about to be written into CLAUDE.md as guidance.
- A refactor is not a licence to restyle. If the ask is "move where the pixels
  live", prove the pixels did not change — and flag separately, with numbers,
  anything that genuinely had to move.
