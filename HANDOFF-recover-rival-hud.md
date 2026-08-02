# Handoff: recover-rival-skill-standings-hud

## What this recovers

Two pieces of work lost when the Overseer closed PR #161 as "superseded" on
1 August 2026 (it only checked the trestle-support content was inferior to
the duck-bar-asset branch's fix — it did not notice #161 also carried the
standings HUD and the beatable-rivals rebalance, neither of which landed
anywhere else):

1. **Rebalanced rival skill** — `RIVAL_SKILL` and an asymmetric rubber band
   (`rivalBand`), both now in `src/world/railRace/simulate.ts`.
2. **Standings HUD** — a running-order portrait row along the top edge,
   reusing `minigames/portraitStrip.ts`'s shared machinery via a new `row`
   layout option.

Neither is a port of PR #161's code. That PR's diff was read only for
*intent* — the physics underneath changed completely with PR #167's 2 August
tap-rate rework (hold-to-accelerate → mash-to-go-faster, duck as its own
control), so the old numbers and even the old rubber-band shape (a flat
±22% clamp) would not have meant the same thing against the new physics.

## Rival skill — what was actually wrong, and how it was found

Current main, before this branch: `RIVALS` in `RailRace.ts` still had the
original `0.72/0.8/0.86` skill untouched by PR #167 (nobody had reason to
touch it while chasing the tap-rate rework). At those numbers a rival's mash
rate alone (`RIVAL_MASH_RATE_MIN + (MAX-MIN)*skill`) sits at 5.2–5.7
taps/second — within a whisker of `mashPerfect`'s flat-out 6. That alone
explains "far too good".

But there was a second, structural bug, found by re-deriving the field
simulation from scratch (there was no `simulateField`/whole-race harness on
main at all — `check-rail-race.mts` only ever raced the player alone): the
rubber band in `RailRace.ts` (`CATCHUP=0.004, SWING=0.22`, symmetric) fed a
rival's *thrust*, but `stepRider`'s speed clamp was a flat `MAX_SPEED` with
nothing scaling it by `band`. So a trailing rival's thrust could rise, but
its actual speed got silently re-capped to the player's own ceiling — the
exact defect PR #157's second review round found and fixed once already,
under the *old* hold-based physics, reproduced here because nothing about
the rubber band was touched when the control scheme was rewritten.

Fixed both:
- `stepRider`'s clamp now scales with `band` (`speedCap = band > 1 ? MAX_SPEED
  * band : MAX_SPEED`).
- `rivalBand` (in `simulate.ts`) is asymmetric on both axes: gentle-but-high
  ceiling behind (`CATCHUP_BEHIND=0.006, SWING_BEHIND=0.55`), quicker-but-lower
  ceiling ahead (`CATCHUP_AHEAD=0.01, SWING_AHEAD=0.32`).
- `RIVAL_SKILL = [0.62, 0.72, 0.82]`, moved into `simulate.ts` from
  `RailRace.ts`'s `RIVALS` array so `check-rail-race.mts` races the exact same
  numbers the browser does.

**Measured, not copied**, via a new `simulateField` whole-field harness (all
four carts, real `stepRider`/`rivalInput`/`rivalBand`) and a 24-fixed-seed
sweep added to `scripts/check-rail-race.mts`'s own "the field" section:

```
plays well vs field      24/24 wins   margin 16.1–101.1 m (mean 48.9 m)   7.5 rival bonks/race
sloppy vs field           11/24 wins   margin -0.4–69.4 m (mean 11.3 m)
```

Every one of the 24 seeds is asserted individually (not just the mean) —
that's the exact lesson PR #157's own review history recorded: an
"on-average" pass hid seeds where the rivals were still unbeatable.

## Standings HUD

`RailRace.ts`: new `RaceRacer` interface, `racers()` (builds the racer list
from `carts`, player hair colour from `gameStore`), `updateStandings()`
(ranks by `travelled`/`finished`/`place`, emits only on change). `RaceMoment`
gained a `racers` field on `start` and a new `standings` variant.

`minigames/portraitStrip.ts`: added `PortraitStripOptions.layout` (`'banks'`
default, `'row'` new), `setOrder`/`setSubtitle` on `PortraitStrip`. Same
shared painted-face machinery either way — only the DOM arrangement differs.

`ui/RaceHud.ts`: `setRacers`/`setStandings`, wired to the portrait strip,
disposed on `setShown(false)` and `dispose()`.

`Game.ts`: `'start'` now also calls `setRacers`; new `'standings'` case calls
`setStandings`.

`style.css`: `.mg-portrait-rank` (the "1st"/"2nd" line) and
`.mg-portrait-strip[data-layout='row']`. Top padding is `5.6rem` (compact:
`4.6rem`), not the `3.4rem` PR #161 used — current main's `.racehud-bonk`
pops up at `top: 3.4rem` (same class, unchanged since #161 was written), and
`3.4rem` would have sat the whole portrait row directly under/behind it, DOM
order putting the bonk message *below* the portraits in the stacking order.
Recomputed independently against current main's actual metrics rather than
copied.

## Not done / needs eyes

**Visual QA of the standings HUD was not done.** The shared Chrome profile
had another agent's page open (`list_pages` showed `localhost:5260`) when I
checked, so per CLAUDE.md I don't own it and didn't touch it. What needs
checking live:
- The portrait row actually renders on boarding, in the right place (clear
  of the lap pill and the level-select screen).
- `setOrder`/`setSubtitle` actually re-rank live as the race runs — this is
  CSS-`order`-driven and was only checked by reading the code, not by
  watching a race.
- The `row` layout at a few window shapes (the `@media (max-width: 620px),
  (max-height: 520px)` compact block was sized by reasoning about the CSS,
  not measured against a real narrow window).

**No new procgen invariant.** This change touches no procedural generation —
`RaceHud`/`portraitStrip`/`simulate.ts`'s rival tuning are all runtime
game/UI, not park generation — so nothing in `test/procgen/invariants.ts`
needed extending. `npm run test:procgen` still passes (80/80) as a
regression check.

## Build/test status

- `npm run build` — exit 0.
- `npm run test:procgen` — 80/80 passing.
- `npm run check:rail-race` — passes, including the new field-race
  assertions.
- `npx tsc --noEmit` — clean.

Note: this worktree needed its own `npm install` — vitest was entirely
absent from both this worktree and the shared checkout's `node_modules`
before that (pre-existing environment gap, unrelated to this change).
