# F7: wire up the four orphaned verification scripts

Branch `fix/wire-verification-scripts`, worktree
`.claude/worktrees/wire-verification-scripts`. ARCHITECTURE-REVIEW.md Review 7,
finding F7.

## What landed

`package.json` only — no game code, no measured constant, no `KNOWN_DRIFT`
entry touched.

Each script got a `check:` entry named like the two that already existed
(`check:text`, `check:assets`):

| script | entry | measured cost | where |
|---|---|---|---|
| `checkShopSpacing.mjs` | `check:shop-spacing` | 0.03 s | `build` |
| `checkGondolaSightline.mjs` | `check:gondola-sightline` | 0.03 s | `build` |
| `measure-hop-clearance.mts` | `check:hop-clearance` | 0.5 s | `build` |
| `measure-wall-tunnelling.mts` | `check:wall-tunnelling` | **17.2 s** | `check:all` only |

`npm run build` went from ~3.9 s to ~3.9 s (the three additions are ~0.56 s
combined, inside the noise of `tsc`/`vite`). New `check:all` = `build` +
`check:wall-tunnelling`, ~22 s total, for a human or nightly job.

## Reasoning on the split

- `checkShopSpacing` / `checkGondolaSightline` are true gates: fixed inputs,
  no randomness, `process.exit(1)` on failure, both under 40 ms. Exactly what
  "fast and deterministic" means — into `build`.
- `measure-hop-clearance.mts` is a *report*, not a gate (it never calls
  `process.exit(1)` — it just prints the sweep table for a human to compare
  against `MAX_AUTO_HOP_HEIGHT`). But its own sweep is small (180 combinations)
  and finishes in 0.5 s, cheap enough that running it on every build is free
  and means the table is actually regenerated regularly rather than trusted
  from whenever someone last ran it by hand. Put in `build`.
- `measure-wall-tunnelling.mts` is the 350,000-run sweep the task called out
  by name (confirmed: 262,656 + 87,552 = 350,208 runs). 17.2 s is too slow to
  tax on every build. It goes to `check:all` only.
  - I considered giving `build` a reduced/"canary" sample of this one per the
    task's note ("give the build-friendly entry a small deterministic sample").
    Decided against it: the script's own top-of-file comment explains why a
    partial phase sweep doesn't test the thing it exists to test — "a tunnel
    is a coincidence between where a frame boundary falls and where the wall
    is, and testing one phase tests nothing." The 96-phase sweep is not
    padding, it's the mechanism. A shrunk build-time version would pass while
    silently not checking what it claims to check, which is worse than not
    running it in `build` at all. So: full script, `check:all` only.

## Results — nothing failed, nothing drifted

All four pass, no game code touched:

- `checkShopSpacing.mjs`: PASS, no overlaps.
- `checkGondolaSightline.mjs`: PASS, every rider clears the eye line and the
  glass.
- `measure-hop-clearance.mts`: worst clean crossing **1.045 m**, matches the
  1.045 recorded in `HANDOFF-hop-clearance.md`. `MAX_AUTO_HOP_HEIGHT = 1.0`
  still holds with margin.
- `measure-wall-tunnelling.mts`: solid-wall tunnels 8895→**0**, hoppable-wall
  on-foot tunnels 246→**0**, worst one-frame shove 0.749→**0.007 m**, peak
  speed 11.10 m/s both ways — all identical to the numbers in
  `HANDOFF-no-tunnelling.md`. The "ordinary movement is untouched" table is
  0.000000 m (`identical`) at every frame rate that needs only one sub-step,
  and non-zero only where sub-stepping actually engages (12–24 fps sprint/walk
  bands) — exactly what that table is supposed to show, not a regression.

No drift found anywhere. Nothing needed fixing.

## Still to do

Raise the PR. Nothing else outstanding.
