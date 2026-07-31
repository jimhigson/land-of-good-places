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

- lean **outward**: `.rotateX(-tilt).rotateY(-azimuth)`
- stand them up: tilt 0.66 rad (38°) → **0.30 rad (17°)**
- make them read as points: length 0.25–0.30 × H → **0.36–0.46 × H**, keeping
  the three-way alternation (wider spread = more hacked-about)
- keep the fat cone (radius 0.105 × H) — ART_DIRECTION "no thin parts"
- keep the roots on `hairShellSampler`'s surface — untouchable invariant
- **derive the burial.** Standing a spike up out of a scalp that slopes away
  lifts the outboard half of its base disc off the surface. The flat 0.06 m is
  no longer enough; bury by `radius × tan(angle between spike and surface
  normal)` so the disc is inside whatever anyone sets the tilt to.

## Constraint

Total height. The crowd baseline is 2.12 m and the doorways were built for it;
~2.3 m is the number the original tilt was chosen against. Target the tallest
spike that keeps the child at **≈2.30 m** and passes `npm run build`.

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
- [x] `npm run build` exit 0
- [ ] browser QA — **not owned, not used**

## Browser

Not owned. A dev server from another session is live on :5260, so somebody else
may be driving Chrome. Build-verify + Blender only; QA list is in the PR.
