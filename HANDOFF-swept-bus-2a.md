# Handoff — stage 3, step 2a: the swept-bus instrument, as a ratchet

- **Branch**: `feat/swept-bus-instrument`, cut from `origin/design/round-robin-generation`
  (which is level with `main`). PR targets the design branch.
- **Worktree**: `.claude/worktrees/swept-bus-2a`.
- **Model**: Opus 5 (1M context), by the Overseer's dispatch under the Engineer
  default. **A replacement must run the same model.**
- **Brief**: `docs/BRIEF-stage3-step2a-swept-bus-instrument.md`. Authority:
  `docs/DESIGN-round-robin-generation.md`, "Stage 3, ruled (5 Sep, Jim)".
- **Scope**: step 2a only. Steps 2, 3 and 4 are held behind other work.
- **Status**: complete, gates running, PR to open.

## What landed

| file | what |
|---|---|
| `scripts/check-swept-bus.mts` | the instrument |
| `scripts/swept-bus-baseline.mts` | the ratchet's committed baseline |
| `.github/workflows/swept-bus.yml` | its own workflow, on `coplanar.yml`'s precedent |
| `package.json` | `check:swept-bus`, plus it joins `check:all` |

The `check` chain is **untouched** — verified by parsing the `scripts` object
and comparing step *sets* against the base: 59 steps before, 59 after, none
removed, none added, one new script key (`check:swept-bus`).

## What it measures

The cat bus's **drawn** body, swept along its arrival run, against the
**drawn** trestle geometry — trunk and both generations of branch — on every
seed in `PARK_SEED_POOL`.

Nothing is restated from constants:

- **posts** — the `railRace:trestle-*` instanced matrices, sampled every 0.2 m
  along each strut, radii read from each mesh's own `CylinderGeometry` and
  scaled by the instance's own across-axis.
- **bus** — the box *and the bearing* are taken off the park's own arrival bus
  (`arrival.group`'s `cat-bus`), which `ArrivalSequence.placeBus` has already
  positioned and rotated. No second bus is built here and no `BUS_FACING` is
  copied.
- **comparison** — in absolute world Y, because `track.ts` and `placeBus` both
  sit their geometry at `terrainHeight(x, z)`. Nothing converts to
  height-above-ground, so nothing can convert wrongly.

## The geometry it was proved against — keep this with the transcript

A red-run transcript is a measurement and measurements go stale, so these are
the inputs the numbers below were produced from:

```
bus body as drawn: 14.54 m long, 7.30 m wide, 0.02 to 6.15 m above the ground
swept along z=69.00 from x=7.00 to x=-22.00, every 0.2 m
post sampling 0.2 m; 11326 samples on seed 1
trestle instances per seed (seed 1): legs 102, branches-lower 204, branches-upper 408
base commit: origin/design/round-robin-generation @ b5fd17e6
```

The bus box is **wider than `CAT_BUS_WIDTH` (5.28 m)** because it is the drawn
extent — fenders, paws, ears — rather than the bodywork constant. That is
deliberate (if it is drawn, a post inside it is clipping) and it is why the
post counts below run higher than the #498 reviewer's 8–9 per seed.

## The red run — `pnpm run check:swept-bus`, exit 1, before the baseline landed

```
  seed   posts  feet(control)  lifted(control)  worst penetration
      5     27              8                0  2.914 m at 3.58 m up (race:branches-lower:13)
     11     25              7                0  3.369 m at 2.98 m up (race:branches-lower:66)
     24     16              5                0  2.401 m at 3.99 m up (race:branches-lower:98)
    115     24              8                0  2.938 m at 2.60 m up (race:legs:29)
    128     21              6                0  3.383 m at 3.12 m up (race:branches-lower:49)
    131     24              8                0  3.526 m at 3.20 m up (race:legs:29)
    208     24              8                0  3.617 m at 3.00 m up (race:legs:33)
    225     24              8                0  3.584 m at 3.00 m up (race:legs:2)
    267     26              8                0  2.761 m at 3.74 m up (race:branches-lower:86)
    274     22              6                0  3.265 m at 2.60 m up (race:legs:37)
    288     26              8                0  3.596 m at 3.00 m up (race:legs:20)
    326     10              3                0  3.410 m at 2.80 m up (race:legs:30)
    346     24              6                0  3.368 m at 3.06 m up (race:branches-lower:42)
    428     30              8                0  3.285 m at 3.00 m up (walk-past:legs:46)
    451     13              2                0  3.605 m at 3.00 m up (race:legs:33)
20260728     28              8                0  3.590 m at 3.00 m up (race:legs:0)

16 seed(s) still intruding — step 2 owes these. 364 drawn post(s) in total.
WORSE: seed 5 — 27 drawn post(s) inside the bus, baseline allows 0
    worst 2.914 m into the body at (-5.35, 67.96), 3.58 m up,
    post race:branches-lower:13, bus at x=-7.20
```

Real metres and real coordinates throughout — no `NaN`, no `Infinity`.

## The controls, and what they say

- **Lifted bus** (the box raised 200 m): **0 on every seed**. The sweep is
  height-aware. The brief asked for a *flat* bus here; a zero-height box is a
  plane and a post crossing it still legitimately intersects it, so a flat bus
  cannot read zero in a genuine box-to-post distance test. The lifted bus asks
  the same question and can answer it. **Deviation, deliberate, documented in
  the script.**
- **Feet-only** (trunks alone, resolved to the foot — literally the question
  `check:entrance-road` was asking): **2–8 posts per seed**, differing from the
  drawn-post count on **16 of 16** seeds. That range **reproduces #498's own
  "2–8 feet per seed" exactly**, which is the calibration evidence: the
  instrument agrees with the old one when asked the old question, and finds
  three to four times as much when asked about the drawn post.

## Watched failing — four deliberate breaks, all proved red

| break | what was changed | result |
|---|---|---|
| A | `TRESTLE_MESHES` entry renamed to `railRace:trestle-legs-RENAMED` | **exit 1**, VOID: "no instances of … in the built park", every seed |
| B | `999999: 4` added to the baseline (a seed not in the pool) | **exit 1**, "1 orphaned baseline entry" |
| C | baseline for seed 326 tightened 10 → 9 | **exit 1**, "WORSE: seed 326 — 10 … baseline allows 9" |
| D | `CONTROL_LIFT` 200 → 0 | **exit 1**, VOID: "the sweep is not height-aware … every number is void" |
| E | `cat-bus-arrival` given a 1 m offset | **exit 1**, "`cat-bus-arrival`, an ancestor of the cat bus, has a transform of its own" |

Break A is the #520 guard and the one that matters most: this check finds posts
by mesh name, so without it a rename would make the sweep measure nothing and
report a triumphant zero.

## Answering #520

The baseline is keyed on the **seed number**, which nothing can rename.

- an entry for a seed not in `PARK_SEED_POOL` is an **orphan and a failure**,
  not a printed note (break B);
- a pool seed with **no** entry allows zero, so it fails on the first hit;
- and the rename hazard one layer out — the *meshes* — is caught by break A's
  guard rather than left to be inferred.

## Cost, and where it runs

**8 s per seed; 56 s for sixteen on a 14-core Mac.** Estimated 2–5 minutes on a
CI runner (the worker count is `cpus - 1`). `checks.yml` is at ~25 min against a
30-minute cap and a timeout there reports as `cancelled`, not red — so this went
in **its own workflow**, `swept-bus.yml`, exactly as `check:coplanar` did.

**The brief asked for the `check` chain.** The wall clock is what changed the
answer; it is recorded in the workflow's own header so the next person can
re-decide from the same number rather than re-measuring.

**Not yet a required status check** — that needs a repository setting only Jim
can make. Report, do not act. Until then it runs and goes red without blocking a
merge, same standing as `coplanar.yml`.

## Coverage, stated plainly — do not let this be overclaimed

Sixteen seeds: `PARK_SEED_POOL` plus the canonical seed. **Nothing outside the
pool.** Separately `check:park` is canonical-only and `test:procgen` covers
seven of sixteen — that is **#510**, another engineer's, and this check does not
close it.

The instrument sweeps the route `layout.ts` owns
(`ENTRANCE_BUS_ARRIVE_X` → `ENTRANCE_BUS_VANISH_X` at `ENTRANCE_BUS_STOP_Z`)
through `placeBus`'s own formula. It does **not** drive the real
`ArrivalSequence` frame by frame, so if `Entrance` ever drives the bus somewhere
other than that line, this would not see it. That join is asserted separately by
`check:cat-bus`, which does drive the real arrival. Worth adding here if the
route ever stops being a straight line — which is exactly what step 1's
`roadCorridor.ts` will do.

## The Architect's prediction — NOT settled by this, and why

The design predicts that on the sphere the **feet** go clear on the five
previously-red seeds while the **posts at height** do not. This instrument
measures the park as it stands **before** the sphere (#511) lands, so it cannot
settle that. What it does establish, as the pre-sphere baseline the prediction
will be judged against:

- feet-only: **2–8** posts per seed; drawn posts: **10–30** per seed;
- the two differ on **16 of 16** seeds, by a factor of 3–4.

So the prediction's *mechanism* — that posts intrude at height far more than
feet do — is already true today, at a ratio the sphere would have to close
entirely to falsify it. Re-run `pnpm run check:swept-bus` once #511 is on
`main`; if the post counts fall to zero the design paragraph is struck, and if
they do not the prediction stands.

## For whoever picks this up

- `pnpm run check:swept-bus -- --verbose` lists every offending post with its
  coordinates and the bus x it was reached at.
- `LGP_RATCHET=off` reports without failing.
- Regenerate the baseline with
  `pnpm run check:swept-bus -- --print-baseline > scripts/swept-bus-baseline.mts`
  — but **only to tighten it**. Widening it to pass is the forbidden move.
- Step 2's definition of done is the baseline empty and the file deleted.
