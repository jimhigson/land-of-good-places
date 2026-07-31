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
   - `npm run build` runs `check:assets`, `check:hat-fit`, `check:hair`,
     `check:crowd` in **node**, and they build a real `createKid()`. An asset
     load there needs a loader + fetch shim, or those gates stop covering hair.
   - `InstancedCrowd` reads a **prototype kid synchronously** at construction.
     An async glb means the crowd has no hair meshes to instance.
   - the character creator **rebuilds the whole kid on every tap**.
   - it is ~40 numbers per style, editable and diffable, not a vertex dump.
   Blender was still the tool that mattered: the shape was found by looking.

2. **One shell, many hems.** A single closed surface: a dome flowing into a
   fall, with a **hem** (the hairline) given as 19 numbers every 10° from the
   nape to dead front. Hem high all round = crop; level at the ears = bowl; at
   the jaw = bob; past the shoulders = long. **A gap is not expressible in it.**

3. **Four shells cover seven styles.** `short`/`bunches`/`spiky`/`messy` share
   the `crop` shell — the crowd instances every prototype mesh whether worn or
   not, so four crops would be three permanent draw calls for one shape.

4. **Primitives kept where primitives are right.** Bunches, bobbles, the bowl
   cut's stray strand, nine spikes, eight messy tufts are still spheres, tori
   and cones. Only *where the spikes and tufts are rooted* changed — see below.

5. **The scalp rides the head tilt, the fall does not.** `place()` rotates each
   point by `-HEAD_TILT × smoothstep(-0.25, 0.15, y)`. Without it the 38° camera
   shows a dome and no face — the failure `HEAD_TILT` exists to prevent.

6. **Units split.** Radial numbers in **skull radii** (a head retune carries the
   hair); hem heights in **metres** (a hem is about the body — backpack, hands).

## Three bugs the process found, all real

- **A crater in the top of every head.** Spacing rings by each azimuth's own
  drop put the first ring 1.7 m below the crown at the nape and 0.06 m below it
  at the fringe; the head tilt then lifted the front ring *above* the crown and
  the pole fan folded back on itself. Fixed with a shared dome cap
  (`CAP_SPLIT`/`CAP_Y`). Found by looking, not by arithmetic.
- **The fringe clipped the outer corner of both eyes.** The eye is 11.9° wide
  either side of centre; the temple drop began inside that. Found only because
  `check:hair` reads `KID_FACE` — the real numbers — where my Blender eye
  markers were half the true width.
- **`messy` had four tufts floating in mid-air, on `main`.** Hand-picked
  coordinates up to 1.13 m from the head's centre over a 0.68 m cap: a 130 mm
  gap. Same disconnection the family reported about `long`, on a style nobody
  had looked at.

Two traps already paid for and written into the code:

- `tuckPow < 1` puts an infinite slope where the fall leaves the dome and
  creases the shell in a hard ring — it reads as a hat brim. Keep it ≥ 1.
- a `cos²(φ/2)` gather weight leaves the fall only two-thirds pushed back at the
  ears, where the hands reach `z = −0.375`: **a fist came 187 mm through the
  curtain**. Now full push to 100°, off by 150°.

## Measured facts that constrain the hem tables

| thing | where | consequence |
| --- | --- | --- |
| ear top | drape y = **+0.074** | above it, ears out (`crop`); below, covered |
| top of the eyes | drape y = **+0.241** | every fringe is derived to clear it |
| ear tip | x = **±0.70** | shell radius 1.136 × skull = 0.75 covers it |
| eyes | ±27.4° azimuth, 11.9° wide | nothing descends inside that |
| backpack back face | z = **−0.42** | only `long` reaches it; its gather is −0.72 |
| hand swing | `applyWalk` 0.85 rad, to z −0.375 | drove the gather weight |

## Status — complete

- [x] Blender reference build of the kid (`KidRef_*`, live in the scene)
- [x] all four shells designed, looked at from 4 angles each
- [x] `hairShell.ts`, `hair.ts` rewired, ponytails untouched
- [x] `scripts/check-hair.mts`, wired into `npm run build`
- [x] spikes and tufts rooted on the shell surface
- [x] `whatsnew.json` entry 18
- [x] `npm run build` exit **0**, checked directly
- [x] PR raised, not merged
- [ ] **visual QA — nobody has seen any of this in a browser**

## Working in Blender

`hairgen.py` (a line-for-line port of `hairShell.ts`), `extras.py`, `shots.py`
in the scratchpad. Re-run with `exec(open(PATH).read())`; `make_sheet(path)`
renders a 2×2 contact sheet (front / game-iso 45°,38° / side / back), which is
the only honest way to judge this. `show_style('bunches')` picks a style.
`dump_vertices()` writes `scripts/hair-blender-probe.json`'s source.

`get_screenshot_of_window_as_image` fails on this instance — use
`get_screenshot_of_area_as_image('VIEW_3D')` or the contact sheet.

Blender is Z-up; everything is authored in game coordinates and mapped through
`B(x, y, z) -> (x, -z, y)`.

Contact sheets for the PR: `/tmp/blender-hair/{long,bob,bowl,short,bunches,spiky,messy}.png`

## Browser

Not owned, never used. Build-verify only.
