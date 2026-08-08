# HANDOFF: the inside shot in portrait (`e-cat-bus-portrait` → `e/cat-bus-stage-a`)

The last item on #245 / PR #246: the interior reads as a bus in landscape and
does not in portrait, and the guard cannot see portrait at all.

**Read first:** `HANDOFF-cat-bus-qa-fixes.md` (rounds 1 and 2), then
`-seating`, `-loading`, `-round5`, `-stage-b`, `-stage-a`. Nothing there is
repeated here.

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-cat-bus-portrait`,
branch `e-cat-bus-portrait-work`, off `origin/e/cat-bus-stage-a` @ `5d3b947`.
`npm ci` exit 0 (recorded, `NPM_CI_EXIT=0`).

**My dev server port is 5497.** 5200 / 5210 / 5412 are other people's.
Captures go to `/private/tmp/catbus-portrait/`, outside the worktree.

## Baseline, read off a recorded line before touching anything

- `npm run build` — **exit 0** (`RECORDED_BUILD_EXIT=0`)
- `npm run test:procgen` — **exit 0**, `Test Files 11 passed (11)`,
  `Tests 281 passed (281)`, no skipped line

Reconciled against round 2's stated 281 / 11 / 0. That is the bar.

## The cabin's real numbers, measured off the built bus

Bus-local. Everything below is derived from these, not from the constants.

| | y |
|---|---|
| floor pan, top (`CAT_BUS_FLOOR_Y`) | 0.794 |
| seat cushion top (`CAT_BUS_SEAT_Y`) | 1.094 |
| **shipped inside lens** | **1.807** |
| seat back top / window sill | 2.08 / 2.10 |
| `cat-bus-shell-lower`'s **lid** | 2.12 |
| window band | 2.10 – 3.50 |
| ceiling (`cat-bus-shell-upper` underside) | 3.48 |

Seats sit at z −5.22 … 3.78, x 0.4 … 2.07 either side; the aisle is the strip
|x| < 0.4. The lens sits at (0, 1.807, −5.855) and aims at (0, 1.557, 3.78).

## Three findings, each measured, none of them guessed

### 1. Portrait's floor is not a framing mistake. It is geometry.

`fitCameraToViewport` gives a 390×844 phone **83.9°** vertically. From anywhere
inside a 2.7 m cabin, a field that wide lands on the floor below and the ceiling
above. Swept, all at the same aim:

| eye y | portrait: whole frame | portrait: bottom third |
|---|---|---|
| 1.807 (shipped) | floor 34%, ceiling 24% | floor 91% |
| 2.05 | floor 29%, ceiling 29% | floor 80% |
| 2.40 (real cutaway) | ceiling 37%, floor 23% | floor 64% |
| 2.70 (real cutaway) | **ceiling 41%**, floor 18% | floor 50% |
| 3.00 (real cutaway) | **ceiling 46%**, floor 15% | floor 42% |

Raising the lens trades the floor for the ceiling one-for-one — the same result
round 2 got by tilting the aim, reached by moving instead of turning. **There is
no pose that avoids it.**

**Nor does a narrower lens.** At the shipped pose, sweeping portrait's fov:

| fov | 83.9 | 75 | 68 | 62 | 56 | 52 |
|---|---|---|---|---|---|---|
| floor, whole frame | 34% | 32% | 32% | 32% | 32% | 32% |

Zooming is self-similar: it narrows the frame around the aisle exactly as fast
as it shortens the floor triangle, so the *share* will not move. Do not spend
time on the lens.

**So the extra field has to be given something to look at.** The aisle floor and
the ceiling are one flat mesh each, and they are where a phone's extra 32° goes.

### 2. `setCutaway` does not cut the cabin away — only its outline

`catBus.ts`'s `setCutaway` sets `lowerBodyOutline.visible`, and leaves
`cat-bus-shell-lower` itself in the scene. From below the sill that is
invisible (`FrontSide`, every face round the lens back-facing and culled), so
it costs nothing today — **but its lid at y = 2.12 is solid from above**, and
any lens raised over the sill lands straight back on QA's "featureless cream
floor". It is not a floor; it is the top of a box. That is why the shipped lens
sits 0.31 m under a ceiling it cannot be raised through.

Measured: hiding the mesh itself opens **no** holes in the flank for any eye up
to y = 2.7 — the seats, the children and the floor pan already block every
sightline that would leave through it. At y = 3.0 about 1% of the frame does
escape.

### 3. "0% glazing" is half a measurement artefact and half real

Both the guard and round 2's probe drop see-through hits and then score the ray
as *out of the bus* — so `describeInsideHit`'s `case 'cat-bus-window'` can never
fire, and glazing was structurally incapable of being counted. Fixed here: a ray
that **crosses** the glass before it lands is looking out of a window.

The other half is real, and it is a consequence of a decision QA already signed
off. The sill is at a seated child's shoulder, so the window band *is* where the
heads are — the guard's own line reads `closest head to the ceiling 0.095 m`.
Twelve chibi heads therefore fill the entire band, and **from any lens in the
aisle there is no sightline to a side window at all**. It first appears at 1% of
the frame with the eye at y = 3.0, which is a ceiling-dominated shot. Glazing in
the interior frame is not reachable without emptying seats.

## The decision

Leave the signed-off landscape pose alone; **furnish the floor and the ceiling**,
which is where portrait's extra field points, so that band carries bus instead of
blank.

## Status

- [x] Own worktree, `npm ci`, baseline recorded
- [x] Read the six cat-bus handoffs, PR #246
- [x] Reproduced round 2's portrait numbers exactly (floor 33.6% / 90.7%)
- [x] Root-caused: geometry, not framing (above)
- [ ] Guard checks both aspects, proved red on today's portrait
- [ ] Interior furniture
- [ ] Screenshots on the real GPU, both aspects, both interior beats
- [ ] build / test:procgen, push, PR + handoff

## Do not act on these

Jim has them on a separate list: total time to controls (~30 s), the skip at
t = 4.5 s, the ride being silent, riders wearing nothing, 16 characters in 4
cycled colours, the rail-race track's striped shadows on the bus.
