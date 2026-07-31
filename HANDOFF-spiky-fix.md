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

## The fix

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
      `/tmp/blender-hair/spiky-after.png` (after)
- [x] PR raised, **not merged**
- [ ] browser QA — **not owned, not used**

## Browser

Not owned. A dev server from another session is live on :5260, so somebody else
may be driving Chrome. Build-verify + Blender only; QA list is in the PR.
