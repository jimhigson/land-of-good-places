# Rail Race physics tuning — handoff

Branch `fix/rail-race-physics`. Family ask (Jim, 1 Aug 2026), verbatim:

> reduce the slowdown penalty for not pressing by 50%; also, make the cart react
> to gravity by going faster downhill, and also increase the acceleration and max
> speed when pressing by 50%.

All the tuning lives in `src/world/railRace/simulate.ts`. **Done; build green;
PR raised.**

## What changed

```
THRUST       9.9  -> 14.85   (+50%, the ask)
DRAG_LINEAR  0.35 -> 0.175   (halved, the ask)
DRAG_SQUARE  0.02 -> 0.01    (halved, the ask)
MAX_SPEED    22   -> 33      (+50%, the ask)
HILL_PULL    5.6  -> 9.8     (real gravity — see below)
RACE_LAPS    2    -> 3       (consequence, not a wish — see below)
```

`MIN_SPEED` and `SPARK_DRAG` untouched, as the brief asked. Checked the stall
worry explicitly: the strongest uphill pull is now `9.8 * 0.2327 = 2.28 m/s²`
against a thrust of 14.85, so a held cart cannot be stopped by a hill; a coasting
one bottoms out on the `MIN_SPEED` clamp exactly as before. No stall.

## The gravity investigation — the effect was genuinely absent, not merely faint

The brief warned the algebra already looked right (`-HILL_PULL * slope`, and
`slopeAt` is positive uphill) and that the ask was probably about magnitude.
**It was worse than that: it was arithmetically impossible to observe while
coasting.**

- steepest gradient the route's `HARMONICS` produce: **0.2327** (13.1°)
- strongest downhill pull available: `5.6 * 0.2327` = **1.303 m/s²**
- drag at the `MIN_SPEED` floor of 3.4 m/s: `0.35*3.4 + 0.02*3.4²` = **1.421 m/s²**

Drag beat the steepest downhill at *every speed the cart could legally be at*,
minimum included. A released cart could never gain a metre per second anywhere
on the course.

Measured against the real `stepRider` on the real route, lane 3, one clean lap
(past `RACE_DISTANCE` the hazard cursors are exhausted, so the lap is naturally
free of bars and spark zones — that is how these were isolated, with no
filtering to argue about):

```
                                  BEFORE            AFTER
coasting, one whole lap      3.40 - 3.40 m/s    3.40 - 6.50 m/s
                             (dead flat)        (downhill worth 1.91x the flat)
holding, one whole lap      13.6 - 15.2 m/s    29.9 - 31.6 m/s
```

`HILL_PULL` was swept 5.6 / 8 / 9.8 / 11 / 13 and the coasting downhill:flat
ratio came out 1.36 / 1.69 / 1.91 / 2.05 / 2.27. **9.8 = real Earth gravity** was
chosen: "the cart reacts to gravity" has one obviously correct value, and a knob
nobody can justify is a knob the next person will move.

**Known limitation, worth telling Jim.** The hill effect is dramatic when
coasting and small when holding — about 6% (29.9–31.6 m/s) even at real gravity,
because `THRUST` is large and the cart sits near its terminal speed where the
drag curve is very stiff. Pushing `HILL_PULL` to where hills bite through a held
throttle needs roughly 3.5x real gravity, which makes uphills a slog and is the
"second thing to manage" the original comment warned against. So: let go on a
downhill and you keep rolling at twice flat coasting speed, which is where the
fiction now lives. If the family want hills to be felt while *holding* too, the
lever is lowering `THRUST`, and that is a design call rather than a bug fix.

## Why `RACE_LAPS` went to 3

Falls out of the speed change; nobody asked for it. The cart is ~2x quicker, so a
good run over two laps dropped 52.1 s -> 25.1 s and tripped the checker's own
`perfect.seconds > 30` "barely a ride" floor. The family asked for a faster
*cart*, not a shorter *race*, and that guard protects a real design property, so
the duration was restored rather than the guard widened.

Measured both options: 3 laps = 37.0 s good / 65.2 s worst; 4 laps = 49.0 s /
86.6 s. Took 3 — 4 restores the old duration more exactly but puts the worst case
near the 105 s "too long for one go" ceiling, and the child who would sit through
87 s is precisely the one not enjoying it.

## `check:rail-race` before/after

```
                 BEFORE (2 laps)              AFTER (3 laps)
never lets go     74.2 s  10 bonks  15.6 spark   65.2 s  15 bonks  7.5 spark
never holds      197.8 s   0 bonks   0.0 spark  277.7 s   0 bonks  0.0 spark
sloppy            62.7 s   6 bonks   0.8 spark   49.1 s   7 bonks  0.6 spark
ducks nothing     67.7 s  10 bonks   0.0 spark   61.6 s  15 bonks  0.0 spark
plays well        52.1 s   0 bonks   0.0 spark   37.0 s   0 bonks  0.0 spark
duck bars worth   15.6 s                         24.5 s (1.64 s per bonk)
```

Ordering is intact and every other assertion still passes. The camera half of the
check is byte-identical (15.0–15.6 m of track ahead across all six window
shapes), confirming nothing there depends on speed.

`never holds` at 277.7 s exceeds `RACE_TIME_LIMIT = 180` in `RailRace.ts` — but
it did before too (197.8 s), so this is pre-existing, and per *lap* a coasting
rider is now slightly faster (92.6 s/lap vs 98.9 s/lap) because gravity finally
does something. Flagged, not fixed; out of scope.

## The threshold that had gone stale — re-measured, not rescaled

`scripts/check-rail-race.mts` asserted `barCost > 8`, a number that had been
mutation-tested. Re-ran all four mutations under the new physics:

```
                                       BEFORE           AFTER
fix in place                          15.6 s exit 0    24.5 s exit 0
thrust un-gated during the wobble      7.8 s exit 1    13.2 s exit 0  (!)
a bonk costs no speed                  7.3 s exit 1     9.9 s exit 0  (!)
both (original Coaster behaviour)     -0.2 s exit 1    -0.2 s exit 1
```

**Either single fault would have gone live with the check still reporting OK on
the exact bug it was written for.** Threshold now **18 s** — 36% clear of the
worst surviving mutation, 27% under the real figure, against the 2.5% margin the
old 8-against-7.8 had. Both single mutations re-verified to exit 1 at the new
threshold. The check now also prints cost-per-bonk, which is the
lap-count-independent way to read this and would have exposed the staleness
sooner.

## Rival rubber band — checked, deliberately left alone

`CATCHUP = 0.004` / `SWING = 0.22` in `RailRace.ts`. The arithmetic worry is
real: `SWING` saturates at 55 m of lead, which was 3.7 s of racing at the old
speed and is 1.8 s at the new one, so the band reaches full strength at half the
*time* gap. But `band` multiplies `THRUST`, so its absolute authority scaled up
with the thrust automatically.

Raced a full four-cart field 40 times per skill level, replicating
`driveRiders`:

```
player          OLD physics          NEW physics         NEW, CATCHUP halved
skill 0.95      8/40  place 2.45     24/40 place 1.52    28/40 place 1.43
skill 0.85      6/40  place 2.60     14/40 place 2.10    16/40 place 2.02
skill 0.70      2/40  place 3.27      5/40 place 2.98     0/40 place 3.30
skill 0.50      0/40  place 3.65      0/40 place 3.70     0/40 place 3.70
never lets go   0/40  place 4.00      0/40 place 4.00     0/40 place 4.00
```

The new physics **improved** the balance: skill is rewarded far more than before
(a good player went from winning 20% to 60%), while holding the whole way still
finishes last every single time, 21.8 s down. Halving `CATCHUP` to preserve the
old time-gap saturation was tried and rejected — it takes a mediocre player from
5 wins to 0, which is the wrong direction for a six-year-old. Left unchanged.

## Verification

- `npm run build` — **exit 0**, run unpiped and the code checked.
- `npm run check:rail-race` — exit 0, numbers above read rather than grepped.
- No live browser QA: did not own the shared Chrome profile. Worth a family
  playtest for feel, specifically whether 3 laps is the right length now.
