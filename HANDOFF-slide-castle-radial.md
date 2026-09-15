# HANDOFF — issue #625, `castleMasonryTopY` measured with a plumb line

Branch `eng/slide-castle-radial`, off `origin/eng/sphere-ground-claims`.

## The finding that changes the ticket

**There is no collision.** The issue's headline — *"the chute is 1.19 m inside
the battlements"* — is itself a frame mix, the exact one the issue's own comment
warns against, applied in the other direction.

Measured on the canonical seed, at the chute's crossing of the south wall plane
`z = 21.823`, crossing world `(55.48, 9.69, 21.82)`:

| quantity | value |
|---|---|
| masonry AABB `max.y` (what ships) | **8.040 m** |
| masonry top radius | **229.770** (`r − R` = 9.770 m) |
| crossing radius | **237.302** (`r − R` = 17.302 m) |
| chute underside radius | 237.302 − 1.11 = **236.192** |
| **clearance, both sides radial** | **+6.422 m — clear** |
| clearance, both sides plumb-y | +0.539 m — clear |
| clearance, radial stone vs plumb underside (**the issue's 1.19**) | −1.190 m |

The last row is not a measurement of anything: it subtracts a world-Y height
from a radius-minus-`R`. Those agree only at the park's origin, and the castle
is ~48 m out, where the sphere's surface has fallen away by several metres.

Confirmed by a second instrument sharing none of that arithmetic: the shortest
distance from the built chute's centre line to any masonry triangle vertex is
**9.450 m** (chute `(55.51, 9.69, 21.67)`, stone `(59.02, 0.92, 22.04)`), against a
`CHUTE_HALF_WIDTH` of 1.11 — **8.34 m of daylight**.

## Still a real fault

`castleMasonryTopY` genuinely under-reports by **1.730 m** and is genuinely
measured with a plumb line. It must be corrected — and the invariant's other
side converted in the same change, or the new green is untrustworthy. That is
the PR. The *cure for a collision* is not, because there is no collision.

## Instruments

`scripts/measure-castle-masonry.mts`, `scripts/measure-slide-vs-stone.mts` —
scratch, deleted before the PR opens. Both carry a control that pushes the
masonry radially outward until it must clip.

## Baseline (before any edit), `pnpm run test:procgen`

`Test Files 5 failed | 16 passed (21)`, `Tests 85 failed | 563 passed (648)`,
duration `43.29 s`. Inherited red, issue #630. Seed 326 **builds** — 93 tests
ran on it — so `planSlide` does not throw on this base.

`theGinormousSlideLeavesOverTheBattlements` is green on all five seeds at
baseline.

## Audit of the other vertical box reads in `test/procgen/parkFacts.ts`

(`src/world/parkFacts.ts` does not exist; the file is `test/procgen/parkFacts.ts`.)

| line | what | verdict |
|---|---|---|
| 1274 | cat-bus occupant fit, `box.max.y − shell.max.y` | **clean** — `createCatBus()` is built off-scene and never placed, so this is model space. Verified by reading `measureCatBusFit`: no anchor, no `placeOnSphere`. |
| 1453 | `castleMasonryTopY` | **the bug**, fixed here |
| 1474 | `castleRoofGarden.topY` | **same disease** — world-Y over the leaning castle. AABB `max.y` **9.575**, radial top **12.366** (`r` = 232.366), under-reports by **2.79 m**. Its reader compares it against chute world-`y`, so both sides are plumb — self-consistent, not honest. Its invariant is already red at baseline (#630). Reported, not fixed here. |
| 1675 | planted instance top, `at.y + bounds.max.y * scale.y` | world-Y on tilted instances; feeds the bus-grazing ray. Same class. Reported. |
| 2432/2462/2463 | Rail Race arch legs | world-Y against `terrainHeight`; already red at baseline (#630). |
| 2530 | `busTop` | **clean** — `BusJourney`'s own private flat lane, never on the sphere. |
