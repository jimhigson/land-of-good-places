# Handoff: remove the Rail Race duck bar

Branch: `remove-duck-bar-hazard`. Worktree:
`.claude/worktrees/remove-duck-bar-hazard`.

## Status: done, committed, awaiting visual QA + PR

Commit `0e0c2d7` on this branch has the whole change: build passes
(`npm run build`, exit 0), `npm run test:procgen` passes (75 tests, 5 seeds).
Next step was live visual QA (dev server + `/rail-race` deep link + `/view`
debug camera), then `gh pr create`.

## What changed

- **Removed** the duck-bar hazard end to end: `hazards.ts`'s
  `DuckBar`/`bars`/`barCrossings`/`snapToTrestleGrid`/`trestleGridIndex`;
  `track.ts`'s post/bar/sleeve `InstancedMesh`es and the whole warning-lamp
  (`setAlerts`) system; `simulate.ts`'s bonk/wobble mechanic
  (`WOBBLE_SECONDS`/`BONK_SPEED_FACTOR`/`WOBBLE_LOCKOUT`, `Rider.wobble`/
  `barCursor`/`bonks`) and the `barsOnly` strategy; `RailRace.ts`'s
  `DUCK_DROP`/`this.ducking`/duck-drop pose and the `bonk` `RaceMoment`;
  `RaceHud.ts`'s bonk toast + its CSS; the whole duckbar asset pipeline
  (`art/blend/duckbar.blend`, `duckbar_export.py`, `pack-duckbar-asset.mts`,
  the generated `duckbar.glb`/`duckbarGlb.ts`, `duckBarAsset.ts`,
  `hazardTapeTexture` in `core/textures.ts`, the two `package.json` scripts).
- **Kept**: the trestle-leg/beam/dropper support structure — real
  infrastructure, unrelated to any hazard. `trestleSpots` is simpler now: one
  ordinary search per slot instead of the three-tier "mandatory support"
  escalation the duck bar needed (`WIDE_ARC_NUDGES`/`MANDATORY_RADIAL_NUDGES`/
  `WIDE_RADIAL_NUDGES` all gone).
- **Retuned** `hazards.ts`'s zone-only schedule: `GAP_MIN`/`GAP_MAX` down to
  22/32 (from 27/39), `ZONE_MIN`/`ZONE_MAX` up to 18/30 (from 15/23). Naively
  deleting the bar branch and leaving the old gap/zone numbers alone landed
  the checker's "letting go is worth it" gap at only 5.4s over the two-lap
  race (measured, not assumed) — a real regression from the old two-hazard
  race's 18.1s. The retuned numbers bring it to **15.6s**, same ballpark. Five
  zones a lap now (up from two), averaging ~25m each, ~123m of black track a
  lap total (over 3x the old ~37m) — matches the family's "more frequent
  black sections" ask.
- **Rewrote** `scripts/check-rail-race.mts`'s game-balance section: dropped
  `barsOnly` (nothing left to isolate a second hazard from), dropped the
  "what a duck bar costs" section, renamed `bonks` reporting to `sparkEntries`
  (times sparking *started* — the "mistake" count now that a mistake can only
  mean sparked). Replaced the old bonk-mutation table with a real
  `SPARK_DRAG = 0` mutation test (numbers in the file's header): with the
  guard removed, `hold` actually finishes *faster* than `perfect` and the
  check fails loudly, exit code 1 — confirmed by actually running it, not
  asserted.
- **Retightened** `scripts/check-park.mts`'s `rail.exclusion` ratchet from 20
  to 18 — fewer force-placed trestle legs (no more bar-support escalation)
  closed a couple more metres of fence gap. This is a `RATCHET LOOSE` the
  build itself printed; the entry now records why.
- **`test/procgen/invariants.ts`**: removed `duckBarsStandOnRealSupports` and
  its `DUCK_BAR_SUPPORT_TOLERANCE` constant (duck-bar-specific). Kept
  `railRaceFliesClear`'s widest-trestle-gap check (`TRESTLE_GAP_TOLERANCE`) —
  general trestle health, not duck-bar-specific, still validated on every
  seed.
- Kid pose in `RailRace.ts`'s `animate()`: the "ducked, head down" pose for
  `!holding` is kept (reads fine as a coasting pose without a bar to duck
  under) but its comment no longer calls it ducking. The `surprised`
  expression trigger moved from `wobble > 0.2` (bonk-only, now impossible) to
  `sparking` — the one hazard left is the one moment worth a face for.

## Not done yet

- **Visual QA in the browser** — build/tests pass but nobody has actually
  ridden the race and looked at it. Use `/rail-race` (deep link, boards
  instantly) or `/view` (frozen debug camera, see CLAUDE.md) on your own dev
  server, own port, `--strictPort`. Confirm: no duck bars render anywhere on
  the ring, black spark zones are visibly more frequent than before, holding
  through one sparks and slows you, letting go coasts clean.
- **PR not yet opened.** `gh pr create` once QA is done. Flag in the PR body
  that this removes a feature (duck bars, trestle-snapping, the hazard-tape
  asset) that shipped the same day, so the reviewer understands the
  intentional regression rather than flagging it as one.
- There is an **unmerged sibling branch** `feat/railrace-frown-expression`
  (commit `4670690`, not on `origin/main`) that adds a `frown` expression
  triggered by `wobble > 0.2` (bonk) or `sparking`, touching `RailRace.ts` and
  `Player.ts`. It will conflict with this branch's removal of `wobble` —
  whoever merges second should resolve by dropping the bonk half of that
  trigger and keeping the `sparking` half, which is exactly what this PR
  already did to the `surprised` expression on rivals.

## Key numbers (from `npm run check:rail-race`, final tuning)

```
never lets go  47.6 s   10 sparks   23.5 s sparking
never holds    185.1 s   0 sparks   0.0 s sparking
sloppy         37.0 s   10 sparks   7.2 s sparking
plays well     32.0 s   0 sparks   0.0 s sparking
```

Gap (hold - perfect) = 15.6s, guarded at `GAP_MIN_SECONDS = 10` in
`check-rail-race.mts` (36% margin, same spirit as the old file's margins).
