# HANDOFF — `pathsRunOnGridAxes` measures the route object, not the painted ground

Branch `fix/gridaxes-carrier`, worktree `.claude/worktrees/gridaxes-carrier`, off `origin/main`.

## Settling measurement — done, and it refutes the brief's hypothesis

The brief asked: *does the ballPit carrier's curve straighten at the node and split
the run below 16, while the other's does not?* **No. Neither carrier straightens at
the node.** Measured on `origin/feat/grid-paths` @ `b8da4593`, seed 225, by dumping
the per-hop off-axis fraction of every edge touching node `building`:

- `spur-building` (`ring -> building`, 162 samples) arrives at the door along a
  diagonal at frac ~0.32. Its **last 5 hops** are off-axis:
  `(38.35, 12.92) -> (40.72, 13.71)`. The hop before them,
  `(37.86, 12.85) -> (38.35, 12.92)`, measures **frac 0.141** — a hair under the
  0.15 threshold — so the run is flushed there. `spur-building` therefore reports
  that lead as two short runs (~1.3 m and ~2.4 m).
- `connector-building-ballPit` (`building -> ballPit`, 49 samples) starts at
  `(40.34, 13.58)` — the same door, the same lead — and retraces that ground at
  frac 0.317…0.325 for its first seven hops, **with no dip at all**, then carries
  straight on to `(24.16, 3.50)`. One unbroken run: **15.89 m**.

So the same painted metres at that door are "two short approach runs" to one
carrier and "the first 3 m of a 15.89 m diagonal" to the other, **in the same
park**. The reported 16.2 m failure was the same diagonal under an earlier build
whose carrier (`connector-building-exit-ginormousSlide`) ran 0.3 m further before
its curve straightened. Pass/fail on this seed is decided by 0.3 m of somebody
else's continuation.

Same disease, visible on `origin/main` seed 225 (which passes overall) at the
dodgems door: `spur-dodgems` calls that lead a **3.49 m** run
(`-50.4, 20.5 -> -53.6, 21.7`) while `connector-dodgems-stall.dodgems` calls the
same ground a **2.98 m** run (`-53.3, 21.6 -> -50.5, 20.5`).

**Consequence for the brief's closing note:** the 15.89/16.2 m diagonal at seed
225's building door is a *genuine* sustained diagonal (frac 0.32-0.67 for 32
consecutive samples). An honest observer-free measurement is more likely to make
it **consistently red** than to make it evaporate. That is a finding to report,
not a number to nudge.

## Mechanism, restated

Two halves, both fixed by the same change:

1. Run boundaries are read off *one* carrier's sampling of ground that several
   carriers paint, and a single sub-threshold hop (0.141) inside a genuine
   diagonal splits the run. That is the sampling jitter the invariant's own doc
   comment says the run-merging exists to absorb — it absorbs it in the middle of
   a run but not at the ends.
2. A run is cut at the edge's end whatever the ground does next.

## Status

- [x] worktree + install
- [x] instrument written, control run (reproduces the shipped check's verdicts
      exactly: 0 problems on main seed 225, 0 on grid-paths seed 225)
- [x] settling measurement (above)
- [ ] fix
- [ ] both-sided proof
- [ ] gates
