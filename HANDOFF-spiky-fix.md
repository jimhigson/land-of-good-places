# Handoff — the spiky hairstyle is not spiky (branch `spiky-fix`)

Worktree: `.claude/worktrees/spiky-fix`, off `origin/main` @ 8f665e8 (PR #128).
Leave `.claude/worktrees/blender-hair` alone — that is the previous agent's.

## The ask

Family feedback after PR #128: `spiky` reads as a **bumpy texture**, not as
hair. It should read Bart Simpson — tall, upright, jagged points making a clear
spiky crown in silhouette.

## Root cause — two bugs, both measured, both real

Both are in `hair.ts`'s `add(['spiky'], drape, …)` block.

1. **The spikes never clear the top of the head.** Measured with a real
   `createKid()`: `spiky` builds to **2.087 m**, which is *exactly* what
   `short`, `bunches` and `messy` build to — the bare `crop` shell. Nine cones
   and not one millimetre of extra silhouette. `setHatWorn(true)` changes the
   height by 0 mm too, so `hideUnderHat` is currently hiding something that was
   never sticking out. The spike tips land ~0.08 m *below* the shell's own
   crown, so they can only ever read as lumps on a dome.

   `kid.ts` still carries the comment "spiky hair is a good 0.28 m taller than a
   bob". It **was** (2.006 + 0.28 ≈ 2.29, the ~2.3 m the tilt was chosen
   against); after #128 it is 0.081 m taller. #128 regressed it silently
   because nothing measured it.

2. **Every spike leans 90° off — sideways, not outward.** `.rotateZ(tilt)` tips
   +Y toward −X; the following `.rotateY(-azimuth)` then lands that lean
   **tangentially**, i.e. around the head like a pinwheel, never outward from
   it. Verified numerically on the built geometry: the dot product of each
   spike's lean with its own outward radial is **0.000 for all nine**. So a
   38° "lean out" was really a 38° lean *sideways*, laying each cone down
   along the dome — which is precisely the swept, scaly, bumpy reading the
   family reported.

   `.rotateX(-tilt).rotateY(-azimuth)` gives dot **1.000** for all nine.

## Second round — "all over the head, not a circle around the edge"

The family said this of the first pass, and they were right: all nine spikes
were rooted at one height, so however upright they stood they made a **tiara**
and left the top of the head bare. The 38° camera looks *down* at her, so the
bare bit is most of what you see.

- **16 spikes on a golden-angle spiral**, band 0.40 → 0.63 up the dome. Golden
  angle because any rational turn re-forms into rings. `SPIKE_CROWD` 1.5 bunches
  them low, where the dome has the circumference to hold them.
- **Lean is now derived per spike** — `SPIKE_STAND` 0.45 × the shell's own local
  slope. ~23° at the hairline (scalp falls away at 51°), near-upright at the
  crown. No hand-authored angles, so moving a spike up the dome cannot leave its
  angle behind.
- **Length tapers 0.42 → 0.33 HEAD** up the band. That is the height budget: a
  crown spike starts 0.3 m higher so it must be shorter to finish level.
- First attempt tapered to 0.28 with the band to 0.66 — the crown spikes read as
  **bumps**, i.e. the original complaint moved to the top of her head. Eased.

Still 2.342 m, 255 mm proud. One merged mesh, ~256 triangles.

## Third round — IN BLENDER, NOT YET IN CODE

**Nothing below is committed.** The branch still carries the second round (a
shell + 16 spikes). This round is Blender-only, awaiting the family's sign-off,
which is what they asked for ("iterate in blender and ask me to look when
ready").

Four instructions came in during the second round:

1. "still a middle bald patch with no spikes" — confirmed from a **top-down**
   render, which none of the earlier contact sheets included. The four angles
   in `shots.py` all hide it. **Always render a top view when judging this.**
2. "densely pack radiating spikes over the whole head"
3. "blender tools should have something for distributing this evenly" — yes:
   **Geometry Nodes `Distribute Points on Faces`, POISSON mode**. Used.
4. "then apply gravity so that some of them bend downwards"
5. "remove the hair 'body' and just have the spikes so head skin shows through;
   packing is fine, not too dense" + "also needs some central spikes"

### Where it landed (render: `/tmp/blender-hair/spiky-FINAL.png`)

- **No hair shell at all for `spiky`.** The style stops wearing `crop`. Skin
  shows between the spikes.
- **Roots move to the skull.** The crop shell sits ~0.10 m proud of the skull,
  so a root on the shell with no shell drawn is a cone floating off the head.
  Every root is projected onto the skull ellipsoid — **0.66 x 0.627 x 0.647** in
  the drape frame, measured off `KidRef_skull`, centred on the drape origin.
- **The crop hem still defines the hairline** (it is the only thing that knows
  where hair stops and face begins), + 0.05 margin. No spike below it.
- **Poisson-disk packing** on a mesh of the shell's outer skin between hem and
  0.70, `Distance Min` 0.40 -> 19 spikes, plus **5 placed crown spikes** (the
  Poisson field's rings shrink to nothing at the pole, so sampling alone leaves
  the middle bare — the exact complaint). 24 total.
- **Spikes are swept tubes, not cones**, so gravity can *bend* them: 5 rings,
  8 sides, direction rotated towards world-down at each step.
- **Two bend traps, both paid for:**
  - weighting the per-step bend by `(k+1)` alone **triples** the total, because
    the weights sum to `(rings+1)/2`, not 1. That is what curled the crown
    spikes flat onto the skull. Normalise by `2(k+1)/(rings(rings+1))`.
  - droop must scale by `sin(lean)` — gravity has no purchase on a spike that
    already points at it. No separate fudge by height is needed.
- **`min_tilt` 0.45.** No spike may point dead vertical: it foreshortens to a
  circle from the game's looking-down camera and gives gravity nothing to bend.
  This is what turned the crown from flat splodges into a starburst.

### Parameters, as rendered

    min_distance 0.40   seed 7      hem_margin 0.05   top 0.70
    crown  (0.35,0.700) (1.75,0.690) (3.05,0.695) (4.45,0.688) (5.60,0.698)
    long 0.48  short 0.44   r_long 0.105  r_short 0.094
    stand 0.45  min_tilt 0.45  gravity 0.9   jag (1.0, 0.86, 0.94)
    -> 24 spikes, 2.392 m tall, lowest spike drape y -0.50

Blender scripts: `/tmp/blender-hair/scripts/{hairgen,extras,shots,spikes6,spikes7}.py`
(next to the renders, the convention PR #128 used).

> **Do not park scratch files in the shared checkout's `.claude/`.** CLAUDE.md
> says `.claude/` is gitignored and it is **not**: `.gitignore` has `.claude/`
> immediately followed by `!.claude/`, which cancels it. Only
> `.claude/worktrees/` is ignored, and only via `.git/info/exclude`. Anything
> else left in `.claude/` shows up as untracked in the shared checkout and is
> one `git add -A` away from `main` — the exact accident CLAUDE.md was written
> about. Worth fixing separately.
`exec(open(P+f).read())` in order, then `build_spikes7(...)`,
`show_spiky_bare()`, `make_sheet(path)`.

### OPEN QUESTIONS before this can be coded

1. **A hat now makes her bald.** `hideUnderHat` hides the whole spike mesh, and
   with no shell there is nothing left. Proposed: split the spikes into two
   meshes — the low hairline ones stay under a hat (they sit below the brim and
   read as a fringe), the tall ones hide. Costs the crowd one draw call, and
   `spiky` gives one back by leaving the `crop` shell.
2. **Height 2.39 m** against a 2.12 m crowd. Build was green at 2.43 m.
3. `check:hair` will need reworking: it asserts exactly one shell visible per
   style, and measures the spikes' prominence against the crop crown. Both
   references go away. New references: the skull, and the hem.
4. Triangle cost rises — swept tubes, ~90 tris each, ~2200 total, comparable to
   one hair shell. Still one merged mesh (or two, per (1)).

## The fix (first pass — still the basis)

- lean **outward**: `.rotateX(-tilt).rotateY(-azimuth)` (dot 1.000, was 0.000)
- stand them up: a flat 0.66 rad (38°) → **0.24 / 0.40 / 0.31 rad (14–23°)**
- make them read as points: length 0.25–0.30 × H → **0.32–0.42 × H**
- one table, `SPIKES = [[0.42, 0.24], [0.32, 0.40], [0.37, 0.31]]` — three
  lengths *paired with* three leans, dealt round the nine, so the crown is
  jagged instead of a machined tiara. Nine identical cones on a ring was the
  thing that still looked wrong once they were standing up.
- keep the fat cone (radius 0.105 × H) — ART_DIRECTION "no thin parts"
- keep the roots on `hairShellSampler`'s surface — untouchable invariant
- **deepen the burial to one base radius** (0.06 m → 0.1575 m). A derived
  `radius × tan(angle to the surface normal)` was tried first and dropped: it
  is not justified. Measured as the share of each base rim left outside the
  shell, burial is **not monotone** — 0.38 base radii leaves 183/288 out, 1.0
  leaves 147, and past ~1.4 the front spike is driven clean through the far
  side and leaves 32/32 out. There is an optimum, not a direction.

## Constraint — checked, and it does not bind

`npm run build` is **green at 2.43 m** (the first, longest version). Nothing in
the world clips either: garlands hang at `HEAD_ROOM` 3.1 m and a shop floor is
`BUILDING_FLOOR_HEIGHT` 3.6 m. So the 2.3 m ceiling is a *scale* judgement, not
a clearance one — she would be half a metre over every other child in a 2.12 m
crowd. Shipped at **2.329 m**, points 241 mm proud of the crown.

## Status

- [x] baseline `npm run build` on origin/main — exit 0
- [x] root cause measured (both bugs)
- [x] Blender scene still live with the previous agent's `KidRef_*` reference
      build; scripts recovered at
      `<scratchpad>/{hairgen,extras,shots}.py`. `exec(open(P).read())`,
      `show_style('spiky')`, `make_sheet(path)`.
- [x] geometry changed, numbers tuned
- [x] `check:hair` extended: spikes must stand proud of the crown, and every
      spike base must be inside the shell
- [x] `npm run build` exit **0**, checked directly, not piped
- [x] whatsnew entry 19; stale "0.28 m taller than a bob" comments in `kid.ts`
      and `CharacterModel.ts` corrected to 0.24
- [x] Blender contact sheets: `/tmp/blender-hair/spiky.png` (before),
      `spiky-after.png` (ring, superseded), `spiky-allover-C.png` (**shipped**)
- [x] PR raised, **not merged**
- [ ] browser QA — **not owned, not used**

## Browser

Not owned. A dev server from another session is live on :5260, so somebody else
may be driving Chrome. Build-verify + Blender only; QA list is in the PR.
