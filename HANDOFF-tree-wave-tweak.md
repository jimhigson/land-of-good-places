# Handoff — tree wave tweak (`e-tree-wave-tweak`)

Branch `tree-wave-tweak`, pushed to **`feat/climb-wave-and-npc-climb`** (PR #215).
Worktree `.claude/worktrees/tree-wave-tweak`. **Do not touch
`.claude/worktrees/climb-wave`** — that is the Overseer's, serving the game to Jim.

## Third ask, added 6 August: more climbable trees

> *"re the trees, we need more climbable trees, it takes a long time to find one."*

**Measured before changing anything, and it was both problems at once.** The
park publishes 28 trees; **two** could be climbed. Across the five CI seeds:
**2, 3, 1, 2, 5** — a whole park with a single climbable tree in it. The worst
point on the paved network was **96.9 m** from one.

Two causes:

1. **The rule.** `kind === 'lollipop' && radius >= 2.05` threw away `blossom`,
   which is *the same branch of the same function* and differs only in the
   colour of the ball; the 2.05 bar then took two thirds of the survivors,
   guarding "plenty of canopy to hide a body in" — a body `hidePlayerBody`
   makes **invisible outright** rather than hiding in the canopy. Nothing left
   for the margin to protect.
2. **The scatter is biased against exactly the climbable kinds.** `TREE_REACH`
   reserves 3.55 m for a lollipop against 2.05 for a stack, *before the radius
   is rolled*, so the widest kind is refused most often: lollipop and blossom
   are **62% of proposals and 25% of survivors**. **I did not touch this** —
   fixing it means rolling the tree before testing its spacing, which moves
   every tree in the park, and `Scenery`'s own comment already records that the
   honest fix is a scatter that does not rejection-sample a tight lawn.

**Fix: the predicate is now geometric** — climbable if the topmost canopy is a
ball of at least `2 × SKULL_RADIUS`, taken from the head that has to come out of
it. Admits every lollipop and blossom, refuses every stack (top blob narrows to
0.90–1.15) and pine. **Draws no RNG, so it moves nothing**: same 28 trees, same
positions, same digest.

| seed | climbable | worst point on the paved network |
|---|---|---|
| canonical | 2 → **8** | 54.2 → **41.9 m** |
| 2 | 3 → **9** | 45.9 → **39.4 m** |
| 5 | 1 → **12** | 96.9 → **38.8 m** |
| 11 | 2 → **12** | 72.9 → **38.5 m** |
| 18 | 5 → **11** | 42.4 → **40.7 m** |

**Three invariants added, all proved red first:**

- `every path passes near a tree a child can climb` — measured along the paved
  ribbon in `everyPathIsLit`'s shape, threshold `PLAYER_MAX_SPEED × 7 s` from
  the game. Red with the old predicate: **8 failures across all five seed
  files**.
- A floor of `> 5` climbable trees, beside the existing tree/bush floors.
- `no tree stands on the railway` — **issue #235**, written *ahead of* PR #216
  (see below). Red when `onRailway` is deleted from `isPlantable`: five trees
  foul, three with a **negative** gap (−1.28, −1.16, −0.13 m past the centre
  line).

`climbableTrees` is now a `ParkFact` too. It was readable by `TreeClimbing` and
every wander driver and by **nothing that could measure it**, which is how two
trees went unnoticed.

### On #235 — its premise is not on `main`

#235 says trees plant to 100.7 m with 66–70 of 72 beyond the old 55 m cap.
**That is PR #216's branch, and #216 is still OPEN.** On `main`, `isPlantable`
still has `if (Math.hypot(x, z) > 55) return false;`, trees stop at **54.0 m**,
and there are **28** of them, not 72. I added the invariant anyway — it costs
nothing now and means #216 cannot land the problem silently — but I did **not**
do #235's other half (correcting three comments that claim the 55 m guarantee),
because on `main` that guarantee is still true and the edit would collide with
#216. **Recommend leaving #235 open** until #216 lands.

Worth recording: the margin is thinner than it sounds. Canonical seed, closest
tree canopy reaches **3.11 m** of the rail centre line (then 3.26, 3.58) against
`TRACK_CLEARANCE` 1.3 — **1.81 m of slack** before anything is widened.

### The ceiling, so nobody re-measures it

Even if **every one of the 28 trees** were climbable, the median walk is 13.1 m
and the max 35.3 m. The inner ~30 m of park has **no trees of any kind** — the
plots, stalls and plaza own that ground — so that is the floor under any
predicate change. Getting below it needs more trees, and the attempt budget is
already at its measured ceiling (210 000 strands a waypoint and reds
`check:park`).

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

- `npm run build` — **every step exit 0 except `typecheck:test`**, which fails
  on `main` too and is not mine:
  `test/procgen/scatterDecoupling.test.ts(1,30): error TS2307: Cannot find
  module 'node:child_process'`. It has its own fix in flight; I ran the
  remaining steps individually rather than assume my work broke something, and
  `vite build` succeeds. **Do not be surprised by red CI for that one reason.**
- `npm run test:procgen` — exit 0, **151 tests passed across 9 files, 0
  skipped** (read the count, not the colour — a seed-dependent module-load
  failure shows up as *skipped*, not red). It was 141 before the tree work: +5
  for the climbable-distance invariant and +5 for the railway one, one per seed
  each, which is also how I know both actually run on all five seeds.
- Merged `origin/main` rather than rebasing: 17 commits against a `package.json`
  build chain that conflicts on nearly every one, on a branch already under
  review. One resolution instead of up to seventeen, and no force-push over
  commits a reviewer has read. Both sides verified present in the auto-merged
  files afterwards, per CLAUDE.md's squash-merge warning.
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
