# HANDOFF — the six undiagnosed sphere reds (#630)

- Branch: `eng/sphere-six-reds`, off `origin/feat/sphere-combined` (90e62c5b)
- Worktree: `.claude/worktrees/sphere-six-reds`
- Model: **Opus 5 (1M context)**, chosen by the Overseer's Engineer default.
- Role: Engineer. No browser. PR goes against `feat/sphere-combined`.

## Verdicts (measured, canonical seed, on an untouched base)

| check | verdict | deciding measurement |
|---|---|---|
| `tie-frame` | **check wrong** (plus a small game bug) | check reads `railFrameAt(coaster.route, …)` — the **flat** route — while `Coaster.buildTrack` draws ties on `drawnOnSphere(route)`. Worst deviation 10419.0 mm. Separately `Coaster.ts:436` drops the tie with `.setY(mid.y - 0.12)` — world −Y, not `-frame.up`. |
| `rail-race` | **both** | (a) check's `onLane` reads `route.base`, which no longer exists (`baseAt(d, lane)` replaced it) → `undefined` → 10 `NaN` assertions. (b) **GAME: the ring runs off the edge of the planet.** Flat ring radius **145.0–238.9 m** on a **220 m** sphere; **1590 of 8000** lane samples at or past r=220. `terrainHeight` clamps to −220 past the horizon, which is why "lowest rail is **0.00** m over the ground" saturates exactly. (c) climb/clearance/duck/tub clauses all compare world `y`; climb by world y is 362 m (spread 7.82), by altitude 12.8 m (spread 0.26). |
| `cruiser-clearance` | **game** (check also wrong) | Check flies the **flat** route through leant geometry — flat vs drawn diverge by up to **10.07 m** at d=127. Fixing the frame still leaves **6 strikes**. Real cause: the loop's castle span is held at a **level** y = −37.37 while the ground falls away radially; the route is **5.22 m under the terrain at d=88** and the castle's own courtyard floor now spans y −52.37…−33.94 (leant). `clearance.ts` also builds its cross-section on world `+Y` (`side=(-t.z,0,t.x)`, `point.y + rise`, `offset.y`). |
| `castle-window` | **game, same root cause as `cruiser-clearance`** | Same 6 strikes: `plinth`, `castle-courtyard-floor`, `castle-wall-lower` ×2, `castle-roof-deck`. The window is cut at fixed world `WINDOW_SILL_Y`/`WINDOW_HEAD_Y` in a wall that now leans ~34°. |
| `keyring-view` | **game** — and the check's own control is what caught it | `screenBasis3D` disagrees with `IsoCamera`'s rendered axes by **1.81e-1**. `IsoCamera.place()` does `camera.up.copy(this.frameUp)` (the local up from `eyeForFocus`); `screenBasis3D` is a pure function of yaw+pitch about world `+Y`. `KeychainShop.ts:508` caches `VIEW_BASIS` as a **module constant**, so the rack is framed about a camera angle the game does not render. |
| `climb-wave` | **check wrong** — two definitions of one tree | `foliageFor` matches `scenery.climbableTrees` to `scenery.foliageOccluders` by (x,z) within **0.05 m**. The occluders are the **drawn** canopy centres (lifted along the local up, so slid outward); the tree records its **flat** foot. Measured gap: **1.67 m at r=80 → 2.94 m at r=176**. Nearest occluder for tree 0 is 1.955 m away. |

## Routing

- The **castle on a sphere** (a flat-footed building whose courtyard floor now spans 18 m of world y across its own footprint) is the shared root of `cruiser-clearance` and `castle-window`. Possibly adjacent to #625 (castle battlements) — flag to the Overseer before fixing in two places.
- The **rail race ring past the horizon** is a park-scale finding, not a check finding.

## Reproduction

`pnpm run check:<name>` in this worktree. Full red transcripts captured
2026-09-16 on 90e62c5b.
