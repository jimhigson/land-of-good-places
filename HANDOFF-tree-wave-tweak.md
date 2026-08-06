# Handoff — tree wave tweak (`e-tree-wave-tweak`)

Branch `tree-wave-tweak`, pushed to **`feat/climb-wave-and-npc-climb`** (PR #215).
Worktree `.claude/worktrees/tree-wave-tweak`. **Do not touch
`.claude/worktrees/climb-wave`** — that is the Overseer's, serving the game to Jim.

## The ask (Jim, 6 August, after trying the wave)

> *"the character should look slightly upwards too - straight towards the
> camera, and also be another 20cm higher"*

Plus, while here: close **#224** — nothing in the build was sensitive to how
high an NPC sits in a tree.

## Status: all three done, build green, pushed. Not merged.

## 1. She now looks at the camera

**The finding, and it is the useful one:** she was looking *down*. Measured on a
really-built kid mid-wave, her gaze left the face **2.14° below** the horizon
while the camera sits **38° above** her — waving at a point some **40° under the
viewer's feet**. Now **0.00°** off.

Solved, not tuned. Gaze turns out to be *exactly* linear in the two joints above
the eyes:

```
gaze elevation = KID_REST_GAZE_PITCH − body.rotation.x − head.rotation.x
```

to 4 decimal places at every joint combination tried. So the neck angle that
lands her gaze on the camera falls straight out of rearranging it — see
`CLIMB_WAVE_HEAD_PITCH` in `src/entities/Player.ts`. It is derived from
`CAMERA_PITCH_DEGREES`, so re-pitch the park camera and her face follows.

**Two traps, both real, both cost time:**

- **Sign.** *Negative* `head.rotation.x` looks **up**. The naive reading of
  three.js rotation order gets this backwards, and the doc comment at
  `Player.ts`'s `applyFlowerPick` ("a negative `rotation.x` pitches a body or a
  limb forwards") is about limb *swing* and does not settle the head. Do not
  reason about it — measure it, as `check:climb-wave`'s aim block now does.
- **It works out at −40.1°**, which sounds like far too much neck. It is not:
  `hidePlayerBody` leaves **only her head and waving arm drawn**, so the
  shoulders it would be read against are inside the leaves. Nothing on screen
  can read it as a joint angle.

`KID_REST_GAZE_PITCH` is new in `src/art/models/kid.ts`, derived there from
`HEAD_TILT` and where the painted eyes sit, so retuning either carries through.

## 2. `CLIMB_PEEK_LIFT` 1 → 1.2

`src/world/TreeClimbing.ts`. **It is still a parameter that only the player's
three call sites pass.** Do not move it inside `climbPose` — that is the #224
bug, and it is now caught (below).

## 3. #224 closed — `scripts/check-npc-perch.mts`, chained into `check:crowd`

The driver trace has no park, no scene graph and no character with a body — its
climbable trees are two made-up literals, deliberately, so the hash does not
move when somebody plants a bush. Keeping that is worth more than folding the
geometry in, so the assertion is a **second script** and `check:crowd` runs
both. Trace hash still `639ad23c`, unchanged.

Real crowd children, real park, real trees, through the game's own
`TreeClimbing.update()`. The head is read out of the finished scene graph; the
band comes from `Scenery`'s built foliage parts, not `canopyTopY`.

Threshold from the empty gap between two measured populations:

| | head above the topmost leaf, as a fraction of canopy height |
|---|---|
| shipped | **0.073 – 0.173** |
| +0.5 m to NPCs | 0.195 – 0.304 |
| +1.0 m | 0.305 – 0.434 |
| +1.2 m (the player's real lift, if it leaked) | 0.348 – 0.486 |
| +5.0 m (#224's own mutation) | 1.157 – 1.475 |

Nothing lands between 0.173 and 0.304, so the bar is **0.25**.

**Proved red both ways.** Real mutation (`lift = CLIMB_PEEK_LIFT` as
`climbPose`'s default): heads 2.02 m above the leaves, 0.524, exit 1. And
`--mutate <metres>` reproduces any row above in one command, so nobody has to
hand-edit `TreeClimbing.ts` and remember to put it back.

## Also guarded: the aim itself

`check:climb-wave` gained an aim block. Every other measurement in that script
is about the *silhouette* — a face aimed 40° under the viewer moves exactly the
same pixels as one aimed at him, so the whole file passed either way and Jim
found it by eye. Same shape of hole as #224.

Two bars: within **1.5°** of the camera at the rock's crossing (measures 0.00),
never more than **12°** off (measures 7.52, which is `CLIMB_WAVE_LEAN`'s own
doing). It also pins the linearity model above against a really-built kid at six
joint combinations, so the solved angle cannot quietly stop pointing at the
camera while every other number still looks healthy. Proved red: stubbing the
head pitch to 0 reports 40.14° and exits 1.

## A finding I did NOT act on — worth Jim's call

`NpcCharacter.animate` does `rig.body.position.y = bob + breathe + hopHeight * 0.12`,
and during a climb `hopHeight` is the **whole height of the climb**, not a hop.
So every NPC climber's head already floats **0.30–0.67 m** above the topmost
leaf, from a term that was written for hopping. It is pre-existing, it is on
`main`, and it is the reason today's population sits at 0.073–0.173 rather than
near zero.

I left it alone: Jim did not ask, it changes how ~31 live climbers look, and
guessing at it would have been a second uninstructed visual change in a PR he is
about to eyeball. **The new check accommodates it and would notice if it grew.**
If it should be fixed, the fix is to exclude a climb from the hop term, and the
check's band would then want re-measuring downward.

## Verification

- `npm run build` — exit 0 (includes `check:crowd`, `check:npc-perch`,
  `check:climb-wave`).
- `npm run test:procgen` — exit 0, **127 tests passed across 8 files, 0
  skipped** (read the count, not the colour — a seed-dependent module-load
  failure shows up as *skipped*, not red).
- `check:climb-wave --picture` — at play scale her head clears the leaves with
  the hand out to the side, 19 px of hand against 466 px of head.

## NOT verified: a live look in a browser

**This session had no browser tooling at all** — no chrome-devtools MCP, no
`claude-in-chrome`. Per CLAUDE.md ("If you have not been told you own it, do not
use it: build-verify instead and list in your PR exactly what needs visual QA")
I build-verified and listed it. I never started a dev server, so no port of mine
is in use and there is nothing of mine to kill.

**What a human or a browser-owning agent should look at:**

1. **Climb a tree and look at her face** — is she looking *at* you? The
   geometry says dead-on at the rock's crossing, but "slightly upwards" is
   Jim's word and only he can say whether it reads as pleased rather than
   gawping. She passes through 0.00° and rocks ±7.5° either side.
2. **Is 1.2 m the right height?** She now sits **0.255–0.312 of a canopy
   height** above the topmost leaf (a flat 1.20 m). `check:npc-perch` prints
   that line every run, so the number is easy to re-read after a retune.
3. **The simulated ponytail at −40°, and only that.** I talked myself out of a
   wider worry here by reading the rig: `kid.ts` hangs the skull, hat anchor,
   hair anchor, glasses anchor, ears and face patch all off `crown`, which is a
   child of `head`. So pitching `head` rotates the whole head assembly
   **rigidly** — nothing moves relative to anything else, and no hat or hair
   clipping is geometrically possible from this change. The one exception is
   called out in `kid.ts` itself: `buildHair` hangs head-mounted parts off
   `crown` but the **simulated ponytail off `root`**, so it does not follow the
   neck. Worth one look on the long-ponytail style; nothing else on the head is
   at risk.
4. **An NPC up a tree**, as a control — they must look exactly as they do on
   `main`. Nothing in this branch should have moved them.
