# HANDOFF — issue #349, path geometry clipping through the entrance bridge

Branch: `bridge-paving-clip` (worktree `.claude/worktrees/bridge-paving-clip`, off `origin/main` @ `311ad89`).

## The report

Jim, playing `main` at `311ad89` (just after the entrance-bridge PR #348):
*"on entering the park and walking straight to the first bridge, there is some
weird item clipping into the bridge"* — screenshot on issue #349. Sandy/cream
**path-coloured** geometry projecting out through the bridge's stone masonry
below deck level: a flat wedge out of the near spandrel beside the arch, and a
thinner sliver the other side of the arch mouth.

## Root cause — found, measured, not yet fixed

**The paving-lift test is wider than the masonry the bridge actually builds, and
nothing connects the two numbers.**

- `bridges.ts` → `buildOneBridge` → `Bridge.pavingHeightAt` lifts a path vertex
  when `footprint.covers(x, z, roadHalf - walkHalf + PATH_KERB_OVERHANG +
  PATH_CARRIER_SLACK)`. `covers()`'s own across extent is `walkHalf`, so the
  lift reaches **`roadHalf + 0.425 + 0.25` = `roadHalf + 0.675`** across.
- `buildShellGeometry` sweeps the masonry to **`halfAcross = roadHalf +
  BRIDGE_WALL_THICKNESS` = `roadHalf + 0.3`** (`bridgeFootprint.ts:762`).
- So up to **0.375 m** of lifted paving hangs past the outside face of the
  parapet, at the hump's own height, with nothing under it. The quad joining it
  to the un-lifted terrain vertex beside it is the wedge in the screenshot.
- Underneath that: `roadHalf` is `crossing.pathHalfWidth`, the **path surface's**
  half-width, but the drawn path is `pathHalfWidth + PATH_KERB_OVERHANG` wide
  (`pathGraph.ts` `buildPaths` draws the cream kerb `PATH_KERB_OVERHANG` proud
  each side). The bridge is built 0.425 m per side too narrow to carry the path
  it is carrying, so the kerb was never going to land on stone.

CLAUDE.md's "two definitions of one thing, kept in step by hand": the ribbon and
the masonry each decide separately where the paving ends.

## Measurements (canonical seed, built park, `scripts/park-harness.mts`)

Per built bridge: every lifted paving vertex, plan-projected against the union of
the bridge shell's own triangles.

```
bridge-172.0  roadHalf=1.600 halfAcross=1.900 shift=0.000
              lifted=164  outside masonry plan=58  worst=0.371 m
              worst vertex (-20.45, 4.35, 38.71), 4.08 m above the terrain
bridge-266.0  roadHalf=1.300 halfAcross=1.600 shift=0.000
              lifted=108  outside masonry plan=54  worst=0.125 m
```

0.371 ≈ the 0.375 m ceiling the arithmetic above predicts; 0.125 =
`PATH_KERB_OVERHANG − BRIDGE_WALL_THICKNESS` exactly (the kerb's own outer edge).
`shift` is 0 on both bridges here, so the lateral search shift is *not* a
contributor on this seed — do not chase it first.

## Changed so far

Rebased onto `origin/main` @ `e71f80a` (clean; main had only moved by a CLAUDE.md
commit). Worktree is now `.claude/worktrees/eng-349`.

The previous agent's temporary `LGP_BRIDGE_DEBUG` `console.log` and its
`tmp-measure.mts` were **never committed**, so they did not survive onto the
branch — nothing to delete. `git diff origin/main...HEAD` is this file alone.

## Measurement reproduced (2026-08-29) — and the measure itself corrected

The handoff's figures reproduce **exactly**, but only once the measure asks the
right question. Measuring "every vertex `pavingHeightAt` claims, against the
shell's plan triangles" gives `worst = 1.269 / 1.334 m` — and those worst
vertices sit at `y ≈ 0.01`, at the **ramp feet**, where `heightAt` has clamped
the hump back down to the terrain. Paving lying on the ground past the end of
the masonry is not the bug and is not visible; `pavingHeightAt`'s `covers()`
margin pads the *along* extent as well as the across one, which is where that
1.3 m comes from.

Restrict to vertices genuinely lifted clear of the ground
(`y - terrainHeight(x, z) > 0.1`) and the handoff's numbers come back:

```
bridge-172.0  floating outside masonry = 56, worst 0.371 m
              at (-20.45, 4.35, 38.71), 4.11 m over terrain
bridge-266.0  floating outside masonry = 54, worst 0.125 m
              at (-1.06, 0.11, -12.52)
```

**So the invariant to write is "paving a bridge has lifted clear of the ground
has masonry under it", not "…is inside the plan footprint".** The second version
fails on harmless ramp-foot paving and would have to be fudged to go green —
exactly the shape of assertion CLAUDE.md warns about.

## Done (2026-08-29)

**The fix** (`d8bc1c5`). `bridgeRoadHalfFor(crossing)` in `bridgeFootprint.ts` is
now the single owner of the road's width — `pathHalfWidth + PATH_KERB_OVERHANG`,
the *drawn* paving including its kerb. `halfAcross`, `walkHalfFor` and the deck
search all measure off it. In `bridges.ts`, `pavingHeightAt`'s across limit is
`Math.min(roadHalf + PATH_CARRIER_SLACK, halfAcross)` — the `min` is what makes
the stone the single authority, so the two numbers cannot drift apart again
however the constants move.

`PATH_KERB_OVERHANG` is no longer imported by `bridges.ts` at all, which is the
structural point: the module that lifts the paving no longer does its own
kerb arithmetic.

**Measurement, built canonical park** — floating paving outside its own bridge's
masonry plan:

| bridge | before | after |
| --- | --- | --- |
| `bridge-172.0` | 56 vertices, worst 0.371 m | **0, worst 0** |
| `bridge-266.0` | 54 vertices, worst 0.125 m | **0, worst 0** |

**The invariant** (`36e0f5f`, `3f32667`): `bridgePavingIsCarriedByItsOwnMasonry`
in `invariants.ts`, fed by `BridgePavingFact` in `parkFacts.ts` (the measurement
lives in the fact because it needs `terrainHeight`, which only a dynamic import
may reach). Guards the vacuous case where no bridge lifts any paving at all.

Broken deliberately (re-widening the lift test off the clamp) it says:

```
bridge-172.0 lifts 8 of its 162 carried paving vertices past its own masonry:
the worst (path-surface) sits 0.361 m outside the stone in plan at (-21.2, 43.2),
2.87 m above the ground under it — that paving is hanging in mid-air past the
parapet, and it is what clips through the masonry
```

**Five seeds**: `npm run test:procgen` → 448 passed / 14 files, exit 0.

**No seed lost a bridge** to the 0.85 m of extra width (the handoff's flagged
risk). Bridges built, before → after, identical on every seed:

| seed | crossings | bridges | fallbacks |
| --- | --- | --- | --- |
| canonical | 2 | 2 → 2 | 0 → 0 |
| 2 | 4 | 3 → 3 | 1 → 1 |
| 5 | 4 | 3 → 3 | 1 → 1 |
| 11 | 4 | 2 → 2 | 2 → 2 |
| 18 | 3 | 3 → 3 | 0 → 0 |

Note `npm install` was needed in the worktree: the shared checkout's
`node_modules` has no `vitest` and no `playwright-core`.

**Build**: `npm run build` exit 0 (unpiped), `npx tsc --noEmit` exit 0,
`npm run typecheck:test` exit 0.

**Visual QA**: headless Chromium against a production `vite preview` on port
5341 (`--strictPort`, killed by PID; both servers stopped). Before/after on the
`qa-screenshots` branch under `issue-349/`. The clearest pair is
`*-deck-along.png`: on `main` a sandy stripe runs the length of the parapet's
outer top edge — the overhanging paving — and it is gone after.

Two traps worth knowing if you redo this:
- **`window.game` is DEV-only** (`main.ts` guards it behind
  `import.meta.env.DEV`), so a QA script modelled on `qa-petbed.mjs` will hang
  forever waiting for it against a `vite preview` build. Wait on the canvas.
- Headless Chromium needs `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`, and on this Mac the binary is
  `chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/...`.

**PR #352**, all four CI checks green (Build and checks, Procgen invariants,
A reload gets the new build, Deploy PR preview). Not merged — the Overseer
merges. This is a *visible* change, so per CLAUDE.md it waits for Jim.

**Worktree deliberately left in place** at `.claude/worktrees/eng-349` so review
feedback can be acted on without a fresh `npm install` (the shared checkout's
`node_modules` lacks `vitest`/`playwright-core`, so this worktree has its own).
Remove it once #352 is merged.

---

# ⚠️ BLOCKER — seed 11 detour regression, needs an Overseer decision

**`npm run test:procgen` after the redesign: 447 pass, 1 fails.** Seed 11:

```
'ballPit' and 'exit-ginormousSlide' are 14.1 m apart in a straight line but
238.7 m apart by paving (16.98x, wasting 224.7 m) — closer than 28.1 m (2x the
park's own 14.1 m median destination spacing) with no direct connector
```

**This is caused by my change, and it is a real player-facing problem**, not a
test artefact: a child at the ball pit who wants the slide exit 14 m away walks
238 m.

## Why the redesign caused it

Shorter bridges fit in more places, so `crossingPlanSolve.ts` proves more
crossing sites, and `paths.ts` routes every rail-crossing leg through those
sites. **The whole park re-plans.** Crossing counts moved on every seed:

| seed | before | after |
| --- | --- | --- |
| canonical | 2 crossings, 2 bridges, 0 fallbacks | 5, 4, 1 |
| 2 | 4, 3, 1 | 3, 2, 1 |
| 5 | 4, 3, 1 | 4, 3, 1 |
| 11 | 4, 2, 2 | 5, 3, 2 |
| 18 | 3, 3, 0 | 3, 3, 0 |

More bridges nearly everywhere — the placement question in the contract is
answered, and favourably. But seed 11's re-rolled layout puts the ball pit and
the slide exit 14 m apart in an arrangement the connector router handles badly.

## It is not any of the invariant's existing exemptions

Checked rather than assumed. The invariant already exempts pairs separated by
the railway and pairs separated by a ride corridor. Measured on the built park:

- both nodes are **~26 m from the nearest rail** — `ballPit` (-11.08, -49.64),
  `exit-ginormousSlide` (-7.83, -63.33), nearest rail points (-9.85, -23.96)
  and (3.11, -27.59);
- the straight line between them **crosses the rail side zero times**.

So it is genuinely same-side, and the exemption is right to not fire.

## The actual cause, from `paths.ts`'s own trace

`LGP_SEED=11 LGP_DEBUG_STREETS=1`:

```
[connect] ballPit-exit-ginormousSlide: rejected, off-lattice street run
```

`paths.ts` **deliberately** refused the connector under
`carriesAnOffLatticeStreetRun`: *"A fallback connector that would draw its own
private street line is dropped rather than drawn: it is optional paving, and
the lattice rule outranks a shortcut."*

So this is a **pre-existing weakness in the connector router, newly exposed by
a re-rolled layout** — not a bridge bug. The lattice rule outranking a shortcut
is right in general and wrong at a 17× ratio.

## Three options — Overseer's call, deliberately not taken unilaterally

1. **Fix the router** so the off-lattice drop does not apply when dropping the
   connector leaves a disproportionate detour. Correct, matches the
   invariant's intent, but it is a change to `paths.ts`'s solve — outside the
   bridge geometry this ticket owns, and it would need its own measurement
   across all seeds.
2. **Exempt the refusal in the invariant.** *Do not do this.* It would make
   the detour invariant blind to exactly the case it exists to catch, and
   CLAUDE.md's "never weaken an assertion to make a seed pass" names it.
3. **Swap seed 11** for another sweep seed and write down why. Legitimate
   under CLAUDE.md — but it hides a real 238 m walk rather than fixing it, so
   it should only be chosen alongside filing option 1 as its own issue.

**My recommendation: option 1, as its own ticket, with seed 11 swapped
temporarily and a comment pointing at that ticket** — so this PR is not
blocked on a path-router change, and the router weakness is not lost.

---

# THE REMAINING LUMP — named (2026-08-29)

Jim, on the PR preview: *"it is better but there's still a big lump of 'stuff'
clipping into the bridge."*

**Verdict: there is no foreign mesh clipping into either bridge. The "lump" is
the bridge's own ramp.**

Three candidates were ruled out by measurement, not argument:

1. **Paving escaping ALONG the spine at the ramp feet** — the case the first
   fix's measurement excluded by construction, and the leading hypothesis.
   **Ruled out.** All 13 escaping vertices on `bridge-172.0` (4 on
   `bridge-266.0`) sit at exactly `h = 0.030` / `0.055` above the terrain —
   precisely `PATH_KERB_LIFT` and `PATH_SURFACE_LIFT`. That paving is draped
   flat on the ground and is indistinguishable from ordinary path. The original
   "not visible" call was right, but it had been reached by argument; this is
   the measurement.
2. **The `deck` clearance marker rendering.** Ruled out: `deckMesh.visible =
   false` (`bridges.ts`).
3. **Foreign geometry inside the masonry.** A 53×53 ray fan from the camera
   that produced the suspicious frame, against visible meshes only (the park's
   NPC name labels are `Sprite`s and `Sprite.raycast` dereferences
   `raycaster.camera`, which a bare `Raycaster` has not got — that is why the
   first attempt threw). Then every vertex of each suspect tested against the
   bridge's own **plan triangles**, not its bounding box.

   Bounding-box overlap is worthless here and nearly sent me down a false
   trail: it reported 52 "overlapping" meshes on one bridge, including the
   terrain and four `finish-rainbow-leg-*-inner` legs, purely because terrain
   and instanced scenery have park-sized bounds and the box contains the arch
   void. Against the real masonry plan, **the only things inside are
   `track-ballast`, `track-rail-left` and `track-rail-right`, at y 0.16–0.40**
   — the railway running under the arch, exactly where it should be.

**What Jim is actually looking at.** At a child's eye height at the foot of the
ramp (`/tmp/qa349b/look-bridge1720-footneg19.png`) the ramp reads as a huge
sandy wedge flaring out across the grass, with only thin pink parapet strips on
top and no modelled stone flank. It is 15.16 m long and rises 4.06 m. It does
not *clip into* the bridge — it **is** the bridge, and it looks like a pile of
sand somebody parked a bridge on.

That is exactly what Jim's redesign brief describes and exactly what it fixes:
40% shorter, steeper, with modelled stonework up the flanks and around the
arch. **The lump is not a bug to fix before the redesign; it is the reason for
the redesign.** The acceptance test stands unchanged — after the redesign,
re-run this same plan-triangle scan and it must still find only the track.

## The ramp-skirt hypothesis — half right, and the half that matters is "by design"

The Overseer, from the Artist's `art/renders/bridge-iso.png`: each ramp is a
solid wedge whose side wall flares to the ground, and the lump may be the
ramp's own road-bed skirt, path-coloured, escaping the masonry.

Checked against the generator rather than adopted. **The skirt is real, is
deliberate, and is stone — not escaped paving:**

- `buildShellGeometry`'s outer wall runs from `parapetTop` down to
  `bottomPlus/bottomMinus` = `min(terrain at the outer face, terrain at the
  road edge) − 0.5`, i.e. **buried half a metre in the ground**, for every ring
  along the whole ramp. So yes — a continuous solid flank the length of the
  approach. The Artist's model matches what is generated.
- It is drawn from the `stone` material (pink park stone), not the path. The
  sandy appearance in `look-bridge1720-footneg19.png` is the **draped path on
  the ramp's top surface**, filling the frame because that camera looks
  straight up the ramp from below; the stone flanks are edge-on and read as
  thin pink lines.
- The grey plane on the orbit angles is the **tunnel soffit seen through the
  arch**, not geometry through the flank. `soffitA`/`soffitB` are `null`
  outside `ARCH_SPAN_HALF` and the soffit quad needs both rings non-null, so
  the sweep cannot extend past the tunnel mouth. My "slices out the flank"
  reading of that frame was wrong.

**So the skirt is not a defect to fix — but it is exactly why the bridge reads
as a lump**, and it is the thing the redesign should reshape. It sits across
both of us: I own how far it extends and how it meets the terrain, the Artist
owns how it is modelled. **Artist: the new mesh should keep a skirt** (the
bridge must not float), but it wants modelled stone coursing up the flank
rather than one smooth face, and it gets 48% shorter for free at 40%.

## Can a pronounced hump sit over a gentler walkable surface?

**Yes — but not by splitting the road surface, and the Overseer's read of the
rule needs one correction.**

Splitting them is the thing to refuse. The drawn road and the walk surface come
from one owner today (`surfaceProfile` feeds `heightAt`, the shell's road top,
and the path drape alike). If the drawn road arced higher than the walk
surface, a child walking the crown would sink **into** the drawn stone — her
feet inside the road she can see. That is not a near-miss on CLAUDE.md's
"anything that looks solid must be solid"; it is the rule's centre. The
Overseer's read was that the rule is about geometry you fall through or walk
into — correct, and this *is* walking into it. So: **one owner for the road,
always.**

But the hump you *read* as a hump is not the road. From beside the bridge — the
angle every one of these screenshots was taken from, and the angle a child
walking up to it sees — the silhouette is the **parapet top line and its
coping**, and those are not walkable. `parapetHeightFor(hump)` already varies
parapet height along the ramp, so the mechanism exists.

**Recommendation: arc the parapet and coping strongly; keep the road gentler.**
Nothing walkable is misrepresented, nothing solid-looking is passable, and the
silhouette Jim asked for is exactly the part that is free to exaggerate.

Two things make this easier than it sounds:

- **The rise/length ratio does most of the work for nothing.** The same 4.06 m
  rise over 22.03 m instead of 36.72 m is a far humpier bridge before anyone
  shapes anything.
- **`HUMP_BLEND` 0.15 rather than 0.10.** I over-corrected in the contract
  above: 0.10 flattens the ramps more than is needed. Peak = average / (1 −
  blend), so at the 40% average of 0.520:

  | blend | peak | walking, % of 0.620 ceiling | sprinting |
  | --- | --- | --- | --- |
  | 0.25 (today) | 0.693 | 69% | **0.641 — over** |
  | 0.15 | **0.612** | 61% | 0.566 — safe |
  | 0.10 | 0.578 | 58% | 0.535 — safe |

  **0.15 is the pick**: sprint-safe with margin, and it keeps noticeably more
  of the eased crown-and-foot shape than 0.10. It is a smaller change to the
  profile than the contract first proposed, so less of the shape Jim asked for
  is given away.

If the walk-physics ceiling below is fixed at source, none of this trimming is
needed at all and the blend can stay at 0.25.

---

# ⚠️ A WALK-PHYSICS TUNNELLING DEFECT, FOR ITS OWN ISSUE

**Not a bridge bug. The Overseer is raising this separately; these are the
figures.**

A frame-rate-dependent ceiling in the walk physics is silently dictating the
shape of the park's architecture.

`Player.tick` samples `WalkSurfaces` with a ceiling one `BUILDING_STEP_UP`
(0.620 m) above her own damped, lagging height. In one clamped frame
(`MAX_FRAME_DELTA` = 1/12 s) she advances `PLAYER_MAX_SPEED / 12` = **0.617 m**
horizontally, so she rises `0.617 × slope`. Exceed 0.620 m and **she loses the
surface and falls through the deck.**

Measured history, from `bridges.ts`'s own `HUMP_BLEND` note:

| peak slope | rise per clamped frame | % of the 0.620 ceiling | outcome |
| --- | --- | --- | --- |
| 0.56 | 0.345 m | 56% | ships today, works |
| **0.79** | 0.487 m | **79%** | **real-browser QA: fell through the deck into the tunnel, jammed against the fence** |
| 0.693 (Jim's 40%) | 0.428 m | 69% | untested, between the two |

And sprinting is worse, because `PLAYER_SPRINT_MULTIPLIER` is 1.5:

```
7.4 m/s × 1.5 × (1/12 s) × 0.693  =  0.641 m   >   0.620 m ceiling
```

**A sprinting child on a 40%-shorter bridge can fall through the deck.**

Three things make this worth fixing at source rather than designing around:

- **It is frame-rate dependent.** The same bridge is safe at 60 fps and lethal
  on a slow device that hits the frame clamp. That is the classic tunnelling
  shape, and the project has form: `HANDOFF-no-tunnelling.md` and
  `scripts/measure-wall-tunnelling.mts` solved the same class for *walls* by
  sub-stepping. `CollisionWorld.resolveMovement` already sub-steps lateral
  movement (`PLAYER_LONGEST_STEP` 0.925 m, `SUBSTEP_FOOTPRINT_FRACTION`,
  `MAX_SUBSTEPS` 16) — **the vertical surface sample does not.** That
  asymmetry is the defect.
- **It is invisible in the code that suffers from it.** Nothing in
  `bridges.ts` declares "peak slope must stay under 1.005"; it is buried in a
  constant's doc comment, discovered once by a QA session watching a child fall
  into a tunnel.
- **Jim has just asked for steep, cartoonish geometry.** This ceiling says no,
  for reasons that are an implementation artefact rather than a design choice.

Fixing it (sub-stepping the ground sample the way lateral movement already is)
would remove the only constraint standing between Jim's brief and the shape he
asked for.

---

# DIMENSIONAL CONTRACT — bridge redesign (for the 3D Artist)

**Status: numbers derived and committed. Placement verification still running.**

Jim's brief: *"shorter and steeper… modelled stoneworks (not just textures)
around the tops of the walls, a genuine arch-shaped tunnel with modelled
archway masonry around its edge, 40% shorter than currently made (also will
need to be steeper for this) and a more pronounced 'hump' shape… there should
be just a bridge with nothing clipping inside it."*

Jim's ruling on steepness (via Overseer): *"it is ok for the gradient to be
quite steep — we are building a cartoonish game here, not a real physics
simulation — if it would not be plausible in real life I don't mind."*
**Plausibility is waived. Playability is not.** Do not re-litigate this; do not
lengthen the bridge to make the slope believable.

Every number below is derived from the park's own constants, not chosen.

## 1. Fixed — you cannot move these

| what | value | set by |
| --- | --- | --- |
| **Deck rise** above ground under the track | **4.060 m** | `BRIDGE_RISE` = `TRAIN_CLEARANCE_Y` (3.900) + `BRIDGE_DECK_DEPTH` (0.160) |
| `TRAIN_CLEARANCE_Y` | 3.900 m | `TRAIN_SWEPT_TOP_Y` (3.500) + `RIDER_HEADROOM` (0.400) |
| **Flat deck span** across the rail | **6.400 m** | `DECK_HALF_LENGTH` × 2 = (`FENCE_OFFSET` 2.0 + 1.2) × 2 — must clear both fence lines |
| **Arch opening width** (along the rail) | **3.600 m** | `ARCH_CLEAR_HALF` × 2 = (`TRACK_CLEARANCE` 1.3 + 0.5) × 2 |
| **Arch opening height** (soffit over track bed) | **3.900 m** | `TRAIN_CLEARANCE_Y` |
| **Tunnel length** (mouth to mouth, across the rail) | **6.400 m** | `ARCH_SPAN_HALF` = `DECK_HALF_LENGTH` |
| Parapet height above the road | 0.720 m | `PARAPET_HEIGHT` |
| Parapet/spandrel wall thickness | 0.300 m | `BRIDGE_WALL_THICKNESS` |

**The rise and the arch opening are hard.** They are the train's own swept
envelope plus its riders' headroom. A shorter bridge does not get a smaller
arch — the train is the same size.

**Deck width is per-bridge**, from the path it carries (my #349 fix):
`roadHalf = pathHalfWidth + PATH_KERB_OVERHANG`. On the canonical seed:
`bridge-172.0` road **4.05 m** wide (overall 4.65 m including both parapets);
`bridge-266.0` road **3.45 m** (overall 4.05 m). Model to proportions, not to
one absolute width.

## 2. Length and slope — the 40%

| | now | 40% shorter |
| --- | --- | --- |
| total length | 36.715 m | **22.029 m** |
| flat deck span | 6.400 m | 6.400 m (fixed) |
| ramp run each side | 15.157 m | **7.814 m** |
| average gradient | 0.268 (15.0°) | **0.520 (27.5°)** |
| **peak** slope | 0.357 (19.6°) | **0.693 (34.7°)** |

The hump is a cosine-blended trapezoid, so **peak slope is
`1/(1 - HUMP_BLEND)` = 1.333× the average**, not equal to it. The peak is the
number that matters for playability.

The 40% comes almost entirely out of the ramps, because the 6.4 m deck span is
pinned by the fence lines. Ramps go 15.16 m → 7.81 m, near halving.

**Good news on the "more pronounced hump":** it comes free. Same 4.06 m rise
over 22 m instead of 36.7 m is a visibly humpier bridge without any extra
shaping.

## 3. ⚠️ THE ONE COLLISION — peak slope vs the walk physics

**This is a decision for Jim, flagged rather than silently compromised.**

`Player.tick` samples `WalkSurfaces` with a ceiling one `BUILDING_STEP_UP`
(0.620 m) above her own damped height. In one clamped frame
(`MAX_FRAME_DELTA` = 1/12 s) she advances `7.4/12` = **0.617 m** horizontally,
so she rises `0.617 × slope` — and if that exceeds 0.620 m she **loses the
surface**.

This is not theoretical. `bridges.ts`'s `HUMP_BLEND` comment records it:

- peak **0.56** → 0.345 m/frame (56% of ceiling) — **shipped, works**
- peak **0.79** → 0.487 m/frame (79% of ceiling) — **real-browser QA watched
  her lose the surface at the steep section, fall into the tunnel and jam
  against the fence**

**40% shorter gives peak 0.693 → 0.428 m/frame = 69% of the ceiling.** That
sits between the known-good and the known-broken, nearer the broken one.

And **sprinting breaks it outright**: `PLAYER_SPRINT_MULTIPLIER` is 1.5, so a
sprinted clamped frame covers `7.4 × 1.5 / 12` = 0.925 m, rising
`0.925 × 0.693` = **0.641 m — over the 0.620 m ceiling.** A sprinting child on
a 40%-shorter bridge can fall through the deck into the tunnel.

### The fix, and it costs nothing

**Lower `HUMP_BLEND` from 0.25 to 0.10.** The peak multiplier falls from
1.333 to 1.111, so at the *same* 40%-shorter length:

- peak slope **0.578** (was 0.693)
- 0.357 m/frame walking = **58% of ceiling** — level with the proven-safe 0.56
- 0.535 m/frame sprinting — **under** the 0.620 ceiling

So **Jim gets his full 40% with no compromise**, by flattening the eased
transitions rather than lengthening the bridge. A lower blend means a
straighter ramp and a crisper break at the crown — which reads as *more*
bridge-like, not less, and does not fight "a more pronounced hump" (that comes
from the rise/length ratio, which improves).

**Recommendation: take the 40%, set `HUMP_BLEND = 0.15`** (revised down from
0.10 — see "Can a pronounced hump sit over a gentler walkable surface?" above:
0.15 is sprint-safe with margin while giving away less of the eased shape Jim
asked for). I own that constant and will make the change. The Artist does not need to model around it — but
should know the ramps are near-straight with a short ease at each end, not a
long smooth curve.

For reference, the NavGrid ceiling (NPC routing) is `BUILDING_STEP_UP / CELL` =
**1.240**, and today's generator cap `MAX_RAMP_GRADIENT` is 0.600. Average
gradient 0.520 sits **under both**, so the 40% needs no waiver on either — NPCs
will still route over it. The walk-physics peak above is the only binding
constraint.

## 4. What the Artist owns

- **Coping stones along the wall tops** — modelled, not textured. Sit on the
  0.300 m wall, standing to 0.720 m above the road.
- **Voussoir masonry around the tunnel mouth** — a real arch ring around a
  3.600 m wide × 3.900 m high opening, both mouths, 6.400 m apart.
- **The hump as sculpted form.** Near-straight ramps at 0.520 average with a
  short cosine ease at crown and foot (`HUMP_BLEND` 0.10).
- Pink park stone (`PALETTE.stonePink` / `pinkStoneTexture`), as the garden
  walls and rail fence already use. Never a new colour.

**Nothing may enter the arch opening** — that volume is the train's, and an
invariant raycasts it every seed.

## 5. Still to verify (mine, in flight)

- Footprint search still places a bridge at every planned site on all five
  seeds at 22 m. A shorter bridge should be *easier* to place — expected to
  improve, verifying rather than assuming.
- Traversal measured on the built park, not just arithmetic.

---

## Left to do, in order (the original plan, all now done)

1. Give the ribbon and the masonry one owner for where the paving ends. Intended
   shape: the bridge's road is the **drawn paving's** half-width
   (`pathHalfWidth + PATH_KERB_OVERHANG`, one helper, used by both
   `planConservative` and `planReal`), and `pavingHeightAt`'s across limit is
   hard-clamped to the masonry's own `halfAcross` so the stone is the single
   authority on the outer edge. Do **not** just shrink `PATH_KERB_OVERHANG`.
2. Re-run the measurement above; every bridge must report `worst = 0`.
3. Add the invariant in `test/procgen/invariants.ts` + its fact in
   `test/procgen/parkFacts.ts`: paving carried by a bridge does not extend
   beyond that bridge's own masonry plan footprint. Break it deliberately, quote
   the red message.
4. Five seeds (`npm run test:procgen`). Widening the road makes the search ask
   for 0.85 m more width — **check no seed loses a bridge to a level-crossing
   fallback**; `plannedBridgeSiteDistances` promises one at each planned site.
5. `npx tsc --noEmit`, full `npm run build` (unpiped exit code), real-browser
   before/after screenshots from Jim's viewpoint, PR.

## Reproducing / where to look

- Production build + `vite preview --port <yours> --strictPort`, private window.
- Canonical seed. The first bridge walking in from the gate is
  **`bridge-172.0`**, crown at y≈4.41, worst protrusion near
  **(-20.45, 38.71)**. `/view?camPos=...&camDir=...` puts the camera on it
  without walking — aim slightly above and to the side, looking down the deck.
- Headless: `scripts/with-node node --no-warnings --import
  ./scripts/ts-extension-resolver-register.mjs <measure script>`.

## Tried and rejected

- **Clamping the lift test to `halfAcross` alone (leaving the road narrow).**
  The drawn kerb's outer edge sits at `roadHalf + 0.425`, i.e. 0.125 m *outside*
  `halfAcross`, so its outermost vertices would stay on the terrain while their
  neighbours rise 4 m — the kerb tears down the length of the bridge. That tear
  is the exact failure `PATH_CARRIER_SLACK` was added to stop; re-introducing it
  is a regression, not a fix. The road has to get wider, not the test narrower.

---

# RESUMED 2026-08-29 (third session) — rebased twice, unblocked, shipped

## Rebases

1. Onto `fff26f5` (#366's connector escape + #355's NPC attraction work) —
   **clean, no conflicts**.
2. Onto `a85b9cf` (#360's stone kit) — **one conflict in `bridges.ts`, in the
   one hunk PR #360's author predicted**, resolved as they described:
   - `HUMP_BLEND`: kept **0.15** with the provisional-for-#358 note, and kept
     `main`'s `export` (`scripts/dump-bridge-constants.mts` imports it).
   - Parapet collider `topHeight`: took **`main`'s `parapetTopFor(...)`**, which
     reads the drawn parapet's own arced top, over my
     `+ parapetHeightFor(...)`. Same intent, `main`'s is the better owner.
   - `PARAPET_CROWN_LIFT`: the duplicate is the `TS2451` both sides warned
     about. Kept **one** exported declaration, `main`'s fuller doc comment,
     moved up to precede `parapetHeightFor` so there is no TDZ.

**No latent revert.** `git diff --stat origin/main...HEAD` (three dots — two
dots is misleading, see CLAUDE.md `18141ba`) is 5 files: this handoff,
`bridgeFootprint.ts`, `bridges.ts`, `invariants.ts`, `parkFacts.ts`.
`git diff a85b9cf..HEAD -- art/ src/art/ src/world/train/bridgeStonework.ts` is
**empty** — the `.blend`, the GLB, `bridgeStonework.ts`, the build/export/render
scripts and the five renders are byte-untouched. Every line this branch removes
from `bridges.ts` is one this branch added.

## The seed 11 blocker is gone

#366 merged the connector escape. Seed 11's disproportionate-detour invariant is
**green on top of it with the 22 m bridges**, measured here rather than inferred
from the #361 engineer's pre-merge run.

## A real defect the stone kit's invariant caught — sliver rings

After rebasing onto #360, `everyCopingStoneSitsOnItsWall` went **red on four of
the five seeds**: 1–2 blocks per bridge floating 0.031–0.035 m above their own
parapet. **This was mine and it was real**, not a tolerance problem.

`buildShellGeometry` sampled its rings with
`for (along = -lengthNeg; along < lengthPos; along += SHELL_STEP)` and then
`alongs.push(lengthPos)`, leaving a final segment of `(span mod SHELL_STEP)` —
**0.027 m** on the canonical seed's `bridge-226.0` once `BRIDGE_LENGTH_SCALE`
shortened the bridges. `buildCopingRun` lays one stone per segment and scales it
by `(length - COPING_JOINT) / (COPING_LENGTH - COPING_JOINT)`; with
`COPING_JOINT` = 0.05 a 0.027 m segment scales the stone by a **negative**
factor. It turns inside out, its base stops following the wall, and it floats.

Diagnosed by dumping every coping vertex against the `wallTop` triangles: on a
bad block the base's uphill end sat at gap **0.0000** and its downhill end at
**+0.0326**, i.e. the stone was laid nearly level across a wall falling at 1.2 —
not a sampling artefact.

**Fixed at the source** (`491ddb1`): divide the span into a whole number of
equal steps, so every segment is within a quarter of `SHELL_STEP` and none can
go degenerate. Fixed in `bridges.ts` rather than guarded in `buildCopingRun`
because the sliver ring is `buildShellGeometry`'s own artefact and every
consumer of `parapetLine` inherits it. Coping complaints: 2 → **0** on the
canonical seed, all seeds green.

## Green, all of it

- `npm run test:procgen`: **14 files / 458 tests passed, exit 0** — includes
  seed 11's detour invariant and #360's coping invariant.
- `npx tsc --noEmit`: exit 0. `npm run build` (unpiped, redirected): **exit 0**.
- **One flake worth knowing**: `check:park-boot` failed once at 21.5 ms against
  its 20.0 ms ceiling while the box was loaded. Its own line said *"0 work units
  in 21.5 ms"* — the slice did no generator work at all, so it was scheduler
  contention, not code. Re-ran clean twice (16.4 ms, 17.4 ms). If you see it,
  read the work-units line before believing it.

## Bridge placement, five seeds, unchanged by the ring fix

| seed | crossings | bridges | fallbacks |
| --- | --- | --- | --- |
| canonical | 5 | 4 | 1 |
| 2 | 3 | 2 | 1 |
| 5 | 4 | 3 | 1 |
| 11 | 5 | 3 | 2 |
| 18 | 3 | 3 | 0 |

## Jim's acceptance test — shot, and it passes

`qa-screenshots` branch, `issue-349-final/` (47 frames). `BEFORE-*` is `main` at
`a85b9cf` — **the stone kit is already in the before**, so the pair isolates the
40%, not the Artist's modelling.

`BEFORE-bridge1720-footneg19.png` vs `AFTERSAMECAM-bridge1720-footneg19.png`,
identical camera, is the pair: before, a sandy embankment fills the middle of
the frame with two thin pink parapet strips on top. After, **there is no
embankment in that frame at all** — the bridge is compact pink coursed masonry
with a modelled arch, and the ground in front of the camera is plain grass and
path. `AFTER-bridge2260-orbit315.png` is the best single view of the result: a
humpback with a voussoir ring, modelled coping, and the railway running through
the arch where it belongs.

## Scratch tooling deleted

The twelve `tmp-*-349` files are removed from the branch. They are still in the
history (`59a0591` and neighbours) if a measurement needs reproducing.
