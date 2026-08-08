# HANDOFF: the 45-degree aisle pan (`e-aisle-pan` → `e/cat-bus-stage-a`)

The last item on #245 / PR #246. **Done and shown**, pending QA.

**Read first:** `HANDOFF-cat-bus-portrait.md` (the geometry measurements, still
correct), then `-qa-fixes`. Nothing there is repeated here.

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-aisle-pan`,
branch `e-aisle-pan-work`, off `e/cat-bus-stage-a` @ `7ee9a19`. `npm ci` exit 0.
**Dev server was 5431** (`--strictPort`), killed by PID. 5200 / 5210 / 5412 are
other people's. Captures in `/private/tmp/catbus-aisle-pan{,-hug}/`.

## What was wrong, in one line each

1. **The pan was aimed the wrong way down the bus.** Seats face the nose and
   every child is turned 0.6 rad inboard, so a lens looking *forward* is behind
   every head aboard: children facing the lens bottomed out at **0**. Aimed
   aft it never drops below **2**. Pillars in frame: 0% forward, 3-9% aft.
2. **The guard was measuring hidden geometry.** The head-sightline test never
   filtered `visible`, so the `BackSide` outline shell `addOutline` hangs on
   `cat-bus-shell-lower` — hidden by `setCutaway`, and wrapped round the lens —
   counted as bodywork in front of every child. That is the whole of *"at worst
   0 children could actually be seen"* and *"(unnamed RoundedBoxGeometry)
   (1327)"*. The composition grid thirty lines below had always filtered it.
3. **The guard failed the shot for being the shot.** *"No single surface over
   30%"* fired on `cat-bus-backrest` and `skull`. Re-aimed at *bare* surfaces at
   the same 30%; a separate rule catches a lens jammed against anything.

## The shot, as built

- Lens **on the seat-back line** = `cushion + KID_SHOULDER_HEIGHT` (2.084).
  That line is also the window sill — `catBus.ts` builds both from those two
  numbers, so it is one landmark, not an invented height.
- **45 degrees off the aisle, aft, towards +x** — the flank without the door,
  so the run of pillars and panes is unbroken.
- **5 degrees down.** Measured: roof 17% -> 10% of the phone frame, barest
  third 47% -> 28%, for one point of pillar.
- **Hugging the near side of the gangway** (`AISLE_HUG = 0.3`). This came out
  of the screenshots: a chibi head is ~1 m across and a centre-line lens crosses
  the far seat column at 1.84 m, so on a phone (horizontal field only 45
  degrees, whatever the portrait rule does to the vertical one) one head was
  half the frame and cropped. Largest single surface 44% -> 31%.
- **Travels front to back**, 8.31 m over the two beats at ~1 m/s, a row every
  1.7 s. Runs **once across both beats** (paced on `insideSeconds`, which only
  advances while the shot is up) so the second beat continues where the first
  was cut; restarting would show the same eight seconds twice and never reach
  the back rows.

Starting further forward is not available: cabin front is z 4.57, the pan
already starts at 4.39.

## Numbers (desktop / phone / tablet)

```
floor                        5% /  9% /  7%     (QA: 33.6%)
barest third                17% / 46% / 24%     (QA: 90.7%)
glazing or pillar            7% /  2% /  5%     (QA: 0%)
largest bare surface         6% / 16% /  9%
largest single surface      31% / 27% / 32%     (a face)
nearest anything to the lens          0.76 m    (was 0.20 m, an artefact)
children visible at worst        1, of whom 1 facing the lens
```

**The two thinnest margins, so nobody has to rediscover them:** the phone's
barest third is 46% against a 50% threshold, and "children visible at worst" is
1 against a threshold of 1. Both are real properties measured at the boundary,
not fudges — but they are where a regression will show first.

## Proved red (five mutations, applied, run, reverted)

| mutation | result |
|---|---|
| camera never moves | red: *"the lens moved 0.00 m"* + window band 0.0-0.3% |
| the shot this replaces (forward, below the sill) | red: *"not one child was turned towards the lens"* |
| aimed at the floor | red at all three windows: bare floor-pan 60-71%, band 99-100% |
| `isDrawn` filter removed | red: the artefacts return exactly (0.20 m, 0 children) |
| aim tilted up 22 degrees | **desktop passes the bare rule at 28%, phone fails at 38%** |

The last is the portrait proof — a fault landscape structurally cannot see. It
also reproduces the *"37.4% featureless ceiling"* the 8 August attempt hit.

## Status

- [x] Own worktree, `npm ci`, baseline recorded (`check:bus-journey` exit 1 on
      three surface fouls)
- [x] Pan re-aimed; guard re-aimed and strengthened; both aspects checked
- [x] Five mutations proved red
- [x] `npm run build` — exit 1, **`check:bus-journey passed`**; the only failure
      is `check:park-boot` (#252, the hotel's train regression, not mine and not
      touched)
- [x] `npm run test:procgen`
- [x] Screenshots on the real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), eight
      frames across both beats at both aspects, before and after the offset
- [x] Pushed, PR #246 updated
- [ ] QA re-check

## Do not act on these

Jim has them on a separate list: total time to controls (~30 s), the skip at
t = 4.5 s, the ride being silent, riders wearing nothing, 16 characters in 4
cycled colours, the rail-race track's striped shadows on the bus. And #252 is
somebody else's.
