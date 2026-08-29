# HANDOFF — first ever run of `npm run blend:castle`

Branch `verify/blend-castle-run`, cut from `origin/feat/castle-great-hall-furniture` (#388).
Verification only. **No source changed.**

## Where `blend:castle` lives

Not on `main`. Defined identically (`package.json:71`) on **both**
`art/castle-interior-assets` (#368) and `feat/castle-great-hall-furniture` (#388).
#388 is a descendant of #368; `art/blend/castle_build.py` differs by +81/-3 lines,
all of it #388 adding the constant reads and the cup assertion. The *script command*
is byte-identical on both.

## Result: exit 0, clean, on #388

`npm run blend:castle` → **exit 0** (unpiped). Full log in the report.

### Assertions, by name

| assertion | outcome |
|---|---|
| cup mouth vs `CASTLE_TORCH_CUP_OUT` (1 mm) | PASS — measured 0.2475, wanted 0.2475, error 0.0 mm |
| cup mouth vs `CASTLE_TORCH_CUP_UP` (1 mm) | PASS — measured 0.2850, wanted 0.2850, error 0.0 mm |
| `ts_const` CASTLE_DAIS_HEIGHT | READ OK = 0.3, from `castleAssets.ts`, no fallback |
| `ts_const` CASTLE_TAPESTRY_RAIL_Y | READ OK = 2.9 — **but the value is never used** (see below) |
| throne ceiling (dais-driven) | PASS — 2.750 + 0.300 = 3.050 < 3.08 clear, 0.03 m margin |
| bench seat vs `KID_HIP_HEIGHT` | PASS — 0.360 = 0.36 |
| throne seat cushion vs hip | PASS — 0.360 |
| table top vs reach / shoulder / seat+0.20 | PASS — 0.675 |
| sconce headroom | PASS — 0.285 reach vs 0.60 budget |

`CEILING_CLEAR` falls back (3.08) because `BEAM_UNDERSIDE` in `castleFabric.ts` is a
derived expression, not `export const NAME = <number>;`. Reported honestly by the script.

### Reproducibility

`src/art/assets/castle.glb` and `src/art/assets/castleGlb.ts` come out **byte-identical**
to the committed bytes (sha256 `ba0156ad…` / `d00220ab…`). `art/blend/castle.blend` differs
in bytes only — it is zstd-compressed and embeds its own absolute path, so a rebuild in a
different worktree cannot match. Restored with `git checkout`.

### Independently measured off the shipped GLB (not read from the script)

bench-plank top **0.3600**, table-top top **0.6750**, throne seat cushion **0.3600**,
cup mouth (0.0000, 0.2850, 0.2475). Parser: scratchpad `measure_glb.py`, walks the scene
graph and applies node transforms to POSITION accessors.

## The one finding

`TAPESTRY_RAIL_Y` / `TAPESTRY_RAIL_FROM` (`castle_build.py:370-373`) are read and then
**never referenced again** — no assertion, no printed line. `grep -n TAPESTRY_RAIL`
returns only the comment and the assignment. The read works; it just proves nothing.
Contrast `DAIS_HEIGHT`, which reaches the throne ceiling assertion via `dais=`.
Overseer's call whether that is in scope for #388.

## Still to do

- [x] run on #388 — exit 0
- [x] run on #368 (`art/castle-interior-assets`) — **exit 0**, and the GLB/TS it emits is
      the *same* sha256 as #388's, so #388's added lines are checks only and move no
      geometry. #368's `castle_build.py` has neither the cup assertion nor the two
      `ts_const` reads (its `DAIS_HEIGHT` is a typed `0.30`), so **merging #368 alone
      leaves all three of the flagged assertions unexercised** — they arrive with #388.
      Everything else (child-scale, sconce headroom, ceiling, origins, budget) runs and
      passes on #368 too, with byte-identical numbers.

Nothing in either branch was changed. It runs clean.

---

## Second run — `feat/castle-great-hall-furniture` at `d3fc9ecc`

Requested by the Overseer because the branch moved and gained `check_tapestry_hangs`,
which came out of the finding above. **`npm run blend:castle` → exit 0.**

### `check_tapestry_hangs` — fires, passes, and can genuinely fail

Printed on the passing run:

```
  tapestry hangs: rail at 2.90 m (src/art/models/castleAssets.ts's CASTLE_TAPESTRY_RAIL_Y)
    top of pole 2.970 m against a 3.08 m ceiling — 0.110 m spare
    ceiling from the fallback — …BEAM_UNDERSIDE is a derived expression…
    hem lands at 0.502 m above the floor, from a 2.398 m drop
```

Both ends were **watched failing**, by editing `CASTLE_TAPESTRY_RAIL_Y` in
`castleAssets.ts` — i.e. through the real `ts_const` seam, not by poking the Python:

- rail **3.2** → exit **1**: `hung at 3.20 m … the rail's top reaches 3.270 m, above the
  3.08 m clear headroom … The rail would be inside the perimeter wall-plate.`
- rail **2.3** → exit **1**: `hung at 2.30 m … the cloth's hem reaches -0.098 m, which is
  through the floor.`

Both edits reverted; tree clean. `TAPESTRY_RAIL_Y` is now load-bearing — the finding is closed.

Arithmetic independently confirmed off the shipped GLB: `tapestryrail-pole` tops at
+0.0700 (2.90 + 0.07 = 2.970) and `tapestry-fringe` bottoms at −2.3984 (2.90 − 2.3984 = 0.502).

### Re-confirmed after the branch moved

- `castle.glb` sha256 `ba0156ad…` and `castleGlb.ts` sha256 `d00220ab…` — **unchanged**,
  still byte-identical to the committed bytes before and after a rebuild.
- `bench-plank` top **0.3600**, `table-top` top **0.6750**, measured off the GLB.
- cup-mouth 1 mm assertions still pass at 0.0 mm error.

### Correction accepted (issue #395, not mine)

`CEILING_CLEAR` = 3.08 is the **fallback**, not a live read — neither `BEAM_UNDERSIDE` nor
`CASTLE_CEILING_CLEAR` is a plain `export const NAME = <number>;`. It equals the truth today
and would keep passing if the wall-plate moved. The script says so on every run, in the line
above and in the failure message quoted at rail 3.2. So the ceiling *end* of
`check_tapestry_hangs` is only as fresh as that typed 3.08.
