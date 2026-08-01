# Rail Race physics tuning — handoff

Branch `fix/rail-race-physics`. Family ask (Jim, 1 Aug 2026), verbatim:

> reduce the slowdown penalty for not pressing by 50%; also, make the cart react
> to gravity by going faster downhill, and also increase the acceleration and max
> speed when pressing by 50%.

All the tuning lives in `src/world/railRace/simulate.ts`.

## The gravity investigation — DONE, and the effect was genuinely absent

The brief warned the algebra already looked right (`-HILL_PULL * slope`, positive
slope is uphill) and that the ask was probably about magnitude. **It was worse
than that: the effect was not merely subtle, it was arithmetically impossible to
observe while coasting.**

Measured with `scripts/probe-hills.mts` (throwaway probe, not committed) driving
the real `stepRider` round the real route, lane 3, laps 2–3:

```
BEFORE
  coasting, button never pressed:  3.40 – 3.40 m/s   (flat, the whole lap)
  released at 12.0 m/s onto the steepest downhill (s=272 m, slope -0.233):
       peaks at 12.00 m/s  — it never gains a single cm/s — then 3.88 m/s 4 s later
  holding all the way:             speed at steepest downhill 14.84 m/s
```

The reason, in closed form:

- steepest gradient the shipped `HARMONICS` produce is **0.2327** (13.1°)
- so the strongest downhill pull available is `HILL_PULL * 0.2327 = 5.6 * 0.2327 = 1.303 m/s²`
- drag at the `MIN_SPEED` floor of 3.4 m/s is `0.35*3.4 + 0.02*3.4² = 1.421 m/s²`

Drag exceeds the strongest downhill pull **at every speed the cart can legally
be at**, minimum included. So a coasting cart could never accelerate on any
downhill anywhere on the course, at any speed. Hence "3.40 – 3.40": the cart sat
on `MIN_SPEED` the entire lap and the hills did nothing at all. That is exactly
the family's report, and it is a real defect rather than a matter of taste.

Halving the drag (change 1) already breaks that deadlock on its own — new drag at
3.4 m/s is 0.711, well under the 1.303 available. Raising `HILL_PULL` on top is
what makes it *felt* rather than merely non-zero.

## Status

- [x] baseline `check:rail-race` captured (see below)
- [x] gravity investigated and root-caused
- [ ] constants changed
- [ ] rival rubber band re-checked
- [ ] build green, PR raised

## Baseline `npm run check:rail-race` (before any change)

```
never lets go  74.2 s   10 bonks   15.6 s sparking
never holds    197.8 s   0 bonks   0.0 s sparking
sloppy         62.7 s    6 bonks    0.8 s sparking
ducks nothing  67.7 s   10 bonks   0.0 s sparking
plays well     52.1 s    0 bonks   0.0 s sparking
duck bars are worth 15.6 s on their own
```

Note `never holds` = 197.8 s is 672 m / 3.40 m/s exactly — a coasting rider is
pinned to `MIN_SPEED` for the whole race, which is the same finding again.

Also note the old `MAX_SPEED = 22` was **never reached**: terminal speed while
holding solves `0.02v² + 0.35v = 9.9` → **15.16 m/s**. The drag curve was the
real cap and the clamp was dead code. Measured max while holding: 15.23 m/s.
