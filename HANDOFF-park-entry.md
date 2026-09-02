# Park Entry agent — handoff

Branch `park-entry/entrance-probe`, worktree `.claude/worktrees/park-entry`.
Dev server port **5629** (`vite --port 5629 --strictPort`), killed by PID when
not in use. Own headless Chromium via `playwright-core` — never the shared MCP.

## Task 1 (done, reported, NOT fixed): "what is the circular segment thing?"

**It is the park gate's arch** — `park-gate-arch` in `src/world/entrance/Entrance.ts`
(the `crossbar`, line ~311). It is a half-torus meant to spring from the two
gate posts and arch over the way in. Two rotation bugs put it somewhere else.

### Measured on the built park (`scripts/probe-gate-arch.mts`)

```
park-gate-arch
  position   0.00, 3.24, 60.00
  rotation   x=0.000 y=1.571 z=3.142
  world bbox min -0.27, -1.34, 55.42  max 0.27, 3.24, 64.58
```

- `rotation.y = Math.PI / 2` turns the ring **90° out of the gate's plane**: it
  spans **z 55.4 → 64.6** (along the way in) instead of x ±4.3 (across it,
  where the posts are).
- `rotation.z = Math.PI` **inverts** it. `TorusGeometry(r, t, …, arc = Math.PI)`
  is already the *upper* half (measured: unrotated bbox is y +3.45 → +8.03 for
  a mesh at y = 3.45). Flipping it makes the arc hang downward from the
  springing line, so its crown is 4.58 m **below** the post tops.

Net effect on the ground: the middle 74° of the ring is **buried** (deepest
0.85 m under the terrain at the gate centre) and what shows is **two pale-pink
curved shards** rising out of the paving on the park's axis, at
**(0, 55.7)** — inside the park — and **(0, 64.3)** — outside it. Each stands
3.44 m above ground and is 0.56 m thick. Colour `PALETTE.stonePinkLight`
(#ffe0ec). **The gate has no arch over it at all.** The inner shard is what Jim
photographed.

**No collider.** Only the two posts call `collision.addCircle`. Marched a
`PLAYER_RADIUS` body at the inner shard: *walks straight through*. Ghost, per
CLAUDE.md's first rule.

### The ride's copy is wrong too, differently

`BusJourney.ts` line ~1498 builds the same crossbar with `rotation.z = Math.PI`
and **no** `rotation.y`. Measured that transform in isolation: bbox
`-4.58,-1.13,-0.27 → 4.58,3.45,0.27` — right plane, still inverted, so in the
arrival ride the arch is an upside-down U dipping below the road, showing as
two tusks curving inward off the post caps. `layout.ts` promises the park gate
and the ride gate are the same gate; they are two different wrong gates.
(Derived from the transform, not yet seen rendered.)

### Provenance / scope

Both rotations arrived in commit `d9f53caf` "Arrive at the park by cat bus" —
wrong since the gate was first built. Nothing checks the arch's orientation:
`scripts/check-park-map.mts` reads only its x/z *position* (which is correct),
so the map is unaffected. Not a coplanar-seam defect —
`origin/feat/coplanar-sweep` does not touch this code.

### Not fixed on purpose

Jim decides. The likely fix is one line each (`rotation.z` deleted; park's
`rotation.y` → 0), but note a plain semicircular arch of radius 4.3 springing
from 3.3 m posts puts the crown at **7.75 m**, which is a big arch — worth a
design opinion before shipping it, and it wants a collider decision too.

## Files added on this branch

- `scripts/probe-entrance-slab.mts` — lists every mesh near a coordinate with
  size/ancestry/colour. `node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-entrance-slab.mts [x] [z] [r]`
- `scripts/probe-gate-arch.mts` — the arch's ring in world space, what is above
  ground, and whether a player-sized body is stopped by it.

## Next

Standing by for more entrance work.
