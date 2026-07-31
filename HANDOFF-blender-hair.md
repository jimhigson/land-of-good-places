# Handoff — hair modelled in Blender (branch `blender-hair`)

Worktree: `.claude/worktrees/blender-hair`, branched off `origin/main` @ 09980f3.
**Leave the worktree in place** — the Overseer runs `npm run dev` on it.

## The ask

Originally: remake the `long` style in Blender because it read as "long
sideburns on a mullet". Expanded mid-task to **seven of the nine styles**:
`bunches`, `bob`, `short`, `long`, `bowl`, `spiky`, `messy`.
`ponytail` and `longPonytail` are **explicitly excluded — do not touch them**,
cap and all (the verlet `PonytailChain` is cost-sensitive; see the comment
above `CROWD_HAIR_STYLES`).

## Decisions taken — these are the expensive part

1. **Integration: procedural, not glTF.** Both were on the table (the Overseer
   confirmed glTF was allowed). Chose to model the *form* in Blender and port
   the surface's **definition** to TypeScript (`src/art/models/hairShell.ts`),
   so the game still builds every vertex at runtime. Reasons, in order:
   - `npm run build` runs `check:assets`, `check:hat-fit`, `check:crowd` etc.
     in **node**, and they build a real `createKid()`. An asset load there
     needs a loader + fetch shim, or those gates stop covering hair.
   - `InstancedCrowd` reads a **prototype kid synchronously** at construction.
     An async glb means the crowd has no hair meshes to instance.
   - the character creator **rebuilds the whole kid on every tap**.
   - it is not a vertex dump: it is ~40 numbers per style, editable, diffable.
   Blender was still the design tool that mattered — the shape was found by
   looking, not by arithmetic.

2. **One shell, many hems.** The hair is a single closed surface: a dome that
   flows into a fall, with a **hem** (the hairline) whose height varies with
   azimuth, given as 19 numbers every 10° from the nape to dead front.
   Hem high all round = crop; level at the ears = bowl; at the jaw = bob;
   past the shoulders = long. **A gap is not expressible in it** — which is
   the bug the family reported twice.

3. **Four shells cover seven styles.** `short`/`bunches`/`spiky`/`messy` share
   the `crop` shell. The crowd instances every prototype mesh whether worn or
   not, so four separate crops = three permanent draw calls for the same shape.

4. **Primitives kept where primitives are right.** Bunches (squashed spheres),
   their bobbles, the bowl cut's stray strand, the nine spikes and the eight
   messy tufts are unchanged. Checked in Blender; modelling a cone by hand
   would have made it worse. Only the *base* under them changed.

5. **The scalp rides the head tilt, the fall does not.** `place()` rotates each
   point by `-HEAD_TILT × smoothstep(-0.25, 0.15, y)`. Without it the style is
   authored flat and the 38° camera shows a dome and no face — the exact
   failure `HEAD_TILT` exists to prevent. This was found by looking at the game
   camera angle in Blender, not by reasoning.

6. **Units split, deliberately.** Radial numbers are in **skull radii** (so a
   head retune carries the hair, like `× HEAD` does elsewhere); hem heights are
   in **metres** (a hem is about the *body* — it has to clear a backpack and
   stay off hands that swing on a fixed arc).

## Measured facts that constrain the hem tables

Derived from the real model in the Blender reference build:

| thing | where | consequence |
| --- | --- | --- |
| ear top | drape y = **+0.074** | hem above it = ears out (`crop`); below = covered |
| top of the eyes | drape y = **+0.207** | every fringe ends at +0.13…+0.15 |
| ear tip | x = **±0.70** | shell radius 1.136 × skull = 0.75 covers it |
| face patch | ±48.7° azimuth, eyes ±27° | nothing hangs inside ±40° of dead front |
| backpack back face | z = **−0.42** | only `long` reaches it; its gather is at −0.66 |
| hand back-swing | z = −0.42 at x ±0.38 | drove `GATHER_BIAS = 0.45` (see below) |

Two traps already paid for:

- `tuckPow < 1` puts an **infinite slope** where the fall leaves the dome and
  creases the shell in a hard ring right round the head — it reads as a hat
  brim. Keep it ≥ 1.
- the obvious `cos²(φ/2)` gather weight leaves the fall only half pushed back
  at the ears, and a **fist comes through the curtain** on the back-swing.
  `GATHER_BIAS` flattens it.

## Status

- [x] Blender reference build of the kid (`KidRef_*` objects, live in the scene)
- [x] `long` shell designed and looked at from 4 angles
- [x] `src/art/models/hairShell.ts` + 4 hem tables
- [x] `hair.ts` rewired; old cap/fringe/tuft kept for the ponytails only
- [x] `npm run build` exit **0**, checked directly — commit b82c9e6
- [ ] visual check of `bob`, `bowl`, `crop` in Blender
- [ ] numeric cross-check: TS geometry vs the Blender mesh
- [ ] `scripts/check-hair.mts` regression gate
- [ ] PR

## Working in Blender

`hairgen.py` and `shots.py` in the scratchpad
(`/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/6a345fce-.../scratchpad/`).
Re-run with `exec(open(PATH).read())`; `make_sheet(path)` renders a 2×2 contact
sheet (front / game-iso 45°,38° / side / back) which is the only honest way to
judge this. `get_screenshot_of_window_as_image` fails on this instance — use
`get_screenshot_of_area_as_image('VIEW_3D')` or the contact sheet.

Blender is Z-up; everything is authored in game coordinates and mapped through
`B(x, y, z) -> (x, -z, y)`.

## Browser

Not owned. Build-verify only. Everything visual needs QA — see the PR.
