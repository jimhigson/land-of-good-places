# HANDOFF: the mesh hole and the arch-stone ring (PR #286 branch)

Branch `bridge-arch-fix`, off `origin/grid-aligned-park`, merges back to that
branch. Jim's 2026-08-24 round-2 feedback on the humpback bridges (after the
`bridge-path-texture` round landed): "there's still a big hole in the mesh",
and "keep the current height but make the tunnel an arch, with a texture
giving arch stones around the tunnel".

## 1. The hole

Found by loading the bridges in a real headless-Chromium browser from
several angles (`/view` deep links below) and hunting the tunnel mouth at
10x digital zoom for any sky showing through. It was small (a hairline
triangle at normal viewing distance) but real, at both bridges, both top
corners of the tunnel mouth.

**Root cause, confirmed by a manual Möller–Trumbore raycast against the
dumped geometry (double-sided, so winding couldn't hide it) at the exact
hole pixel:** the "road surface (up)" quad — the walkable topside, between
`roadA`/`roadB` — is a single-sided plane. Nothing ever closed the
*underside* of the spandrel fill between the road's own edge
(`innerBottom`, at `roadHalf`) and the masonry's outer edge (`outerBottom`,
at `halfAcross`). Outside the tunnel `outerBottom` sits underground, so the
gap was never seen; inside the tunnel `outerBottom` is the soffit itself,
well below the road, and the gap stood open — a sightline from outside,
looking up into the mouth, could pass the soffit's own edge and the
road-top's backface both, with nothing behind either.

Fix in `bridges.ts`'s `buildShellGeometry`: one new "spandrel underside"
quad per side per ring-pair, connecting `innerBottom` to `outerBottom`,
mirrored per side like the existing outer-wall/inner-parapet faces.

**A second, smaller thing fixed on the way there** (not the hole itself,
but a real seam): the crown-span soffit used to be a separate, rigidly
transformed `deckMesh` box that only followed the frame's tangent at
along=0, disconnected from the swept shell's own haunch soffit (which used
to stop drawing short of the crown, `Math.abs(midAlong) >=
ARCH_CLEAR_HALF - SHELL_STEP`, on the assumption the box covered the rest).
On a curving spine the two could part company. The shell now sweeps one
continuous soffit — flat crown and haunch alike — and `deckMesh` stays only
as an **invisible** marker so `test/procgen/invariants.ts` still has an
object literally named `deck` to measure clearance off
(`Box3`/`getObjectByName` both ignore `.visible`).

**Landmine for whoever touches this next:** don't trust a screenshot at
normal zoom to find a hole this size. Crop to the corner and blow it up
10x, or better, dump the mesh (position + index attributes via
`page.evaluate`) and raycast it in Node with a real ray-triangle test that
doesn't cull on winding — that's what actually found the true culprit here,
after a wrong first guess (the deck/shell seam looked exactly like the
reported bug from a distance, and genuinely was A bug worth fixing, but
wasn't THE bug — the screenshot looked identical before and after that
fix).

## 2. The arch-stone ring

New `archStoneTexture()` in `core/textures.ts`: large, single-course wedge
stones with a wide mortar joint, same three `PALETTE.stonePink*` tones
`pinkStoneTexture` already uses everywhere else on the shell (this file's
own header: "never a new colour") — distinct by scale and joint width, not
hue.

Applied to the tunnel's own soffit only (the arch's visible underside,
flat crown and curved haunch) via a second `BufferGeometry` group on the
same shell mesh (`shellMesh.material = [stone, archStone]`) — never a
second, separately positioned mesh (CLAUDE.md's "one surface, one
texture", the hood-face lesson). `buildShellGeometry` collects the soffit
quads into their own index array and appends it as one contiguous run at
the end, so it can become group 1.

**Two landmines already stepped on:**

- **Don't taper the joints in UV space.** A voussoir's wedge look comes
  from the soffit's own curvature foreshortening it in 3D — a straight
  joint (parallel to `v`) on a curved haunch already reads as radiating
  once rendered. A taper drawn into the flat texture on top of that reads
  as warped, not wedge-shaped. Confirmed by screenshot: the un-tapered
  version genuinely looks like a fanned voussoir ring at the tunnel mouth.
- **`v` must NOT scale by `TEXTURE_METRES` for the soffit specifically.**
  Every other surface's `v` is `height / TEXTURE_METRES`, which is right
  for them (the coursing repeats vertically on purpose). The soffit's
  `v` used to be `±halfAcross / TEXTURE_METRES` — since the tunnel is
  wider than one texture tile, `RepeatWrapping` quietly added a second,
  spurious horizontal joint partway across the ring, splitting every
  voussoir into a little grid instead of one course spanning the full
  depth. Fixed by hard-coding `soffitA`/`soffitB`'s `v` to exactly `1`/`0`
  — a flat 0..1 across the whole width, once, regardless of how wide the
  tunnel is. Caught by a straight-down `/view` shot at the soffit, not by
  the tunnel-mouth shots (those foreshorten the width too much to show
  it).

Height untouched: `BRIDGE_RISE` and every other clearance constant are
exactly as `bridge-path-texture` left them. This round only changed the
tunnel opening's own material and closed the geometry gap.

## Verified

- `tsc --noEmit` (src and `tsconfig.test.json`): clean.
- `npm run test:procgen`: 433/433 across all 5 seeds, exit 0 — unchanged
  from before this branch, since neither fix touches anything an invariant
  measures differently (the deck marker's Box3 is byte-identical; the
  raycast invariant now hits the shell's own continuous soffit instead of
  the box, at the same height).
- `npm run build`: see the PR — full check chain plus `vite build`.
- Real-browser QA, headless Chromium + swiftshader, dev server on a private
  port (killed after): screenshots in the PR comment and on
  `qa-screenshots` under `bridge-arch-fix/` — both bridges' tunnel mouths
  head-on and from the side, a 10x zoom on the fixed corner next to the
  original hole for comparison, and a close-up of the arch-stone ring.

## QA deep links (canonical seed)

- Bridge A tunnel mouth, front-on (stand roughly where the train is):
  `/view?camPos=-8.59,1.3,39.78&camDir=-0.966,0.02,-0.259&timeOfDay=12:00`
- Bridge A from the side (the wide establishing shot):
  `/view?camPos=-6.6,4.5,32.1&camDir=-15.5,-2,4.1&timeOfDay=12:00`
- Bridge B tunnel mouth, front-on, well-lit (best shot of the arch-stone
  ring): `/view?camPos=-16.53,1.3,-25.92&camDir=0.977,0.02,-0.212&timeOfDay=12:00`
- Bridge B, the other side:
  `/view?camPos=10.84,1.3,-31.85&camDir=-0.977,0.02,0.212&timeOfDay=12:00`

Screenshot capture in headless Chromium: `page.screenshot` times out on the
WebGL page — use a CDP session's `Page.captureScreenshot`, launched with
`--enable-unsafe-swiftshader`. A fresh code change needs a genuinely long
wait (8s, not the usual 2-3s) before the first screenshot after a dev-server
reload — the rebuild/re-transform tax, not sim time.
