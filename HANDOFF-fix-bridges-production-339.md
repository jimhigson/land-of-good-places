# HANDOFF — issue #339, "railway bridges do not appear in production"

## Verdict: bridge generation is NOT broken. The park's front door is.

### 1. Measured, in a real browser, on the real deployed bytes

Chromium 1194 (Playwright), fresh profile, no service worker, running the
**live** `landofgoodplaces.blockstack.ing` JS (proxied onto `127.0.0.1` because
Chromium's TLS to that host resets through the sandbox's egress proxy; the JS
is byte-for-byte the deployed chunks, with one injected `return` that also
stashes `buildBridges()`'s own counts on `globalThis`):

```
bridges           : 2
crossings         : 3
fallbackCrossings : 1
crossing points   : (-0.05, 40.22)  <- LEVEL FALLBACK
                    (-22.12, 36.16) <- bridge-172.0, deckY 4.66
                    (-2.84, -28.89) <- bridge-266.0, deckY 4.33
scene graph       : Group:railway-bridges (visible) -> Group:park-train -> Scene
                    both bridge groups visible, 2 visible meshes each
console           : no errors, no warnings during park generation
```

Identical to headless Node on the canonical seed. **The perf-slicing
hypothesis (`pathsPrewarm` / `crossingPrewarm` / `crossingPlanSolve` bailing
out under a real frame budget) is dead** — the sliced generator and
`solveCrossingSites()` are the same code, and the browser's numbers match
Node's exactly.

`/spawn?pos=-2.84,4.33,-28.89` on the live site stands the player on the deck
of `bridge-266.0`, over the railway. Screenshot taken.

A local `vite build` of `origin/main` produces **byte-identical chunk hashes**
to the live site (`index-BolPVpIr.js`, `Game-Luw2wRm4.js`), so live == main.

### 2. The merge: no silent revert

`git diff 9d421db 6e87cc8` is empty (squash tree == merge tree).
`src/core/constants.ts`'s conflict resolution kept **both** sides:
`PARADE_MEMBER_RADIUS` + `CAMERA_ZOOM_MAX = 4.6` from main, the `PATH_*`
block from the branch. #333 (`b50de11`) is the one commit that landed on main
between the branch's last merge-from-main and the squash; its hunks are still
in `main` (`git diff b50de11 origin/main -- src/core/IsoCamera.ts` empty,
Game.ts still carries the fix). Nothing was lost.

### 3. THE ROOT CAUSE — the gate walk crosses the railway where no bridge can go

`crossingPlanSolve.ts`'s whole design (its own header) is: plan the crossings
first, then *"`paths.ts` routes every rail-crossing leg through one of these
`CROSSING_SITES`, square to the track, so the drawn network only ever meets
the railway where a bridge belongs."*

The walk in from the park gate is exempt from that, and nobody noticed.
`paths.ts`'s `gate` -> `ring` edge begins with a **hard-coded corridor
`[0,54] -> [0,30]`**, kept deliberately un-routed ("the ground the cat-bus
arrival choreographs"). The railway loop crosses that corridor at
`railDistance 148.8`, `(-0.05, 40.22)` — and the track there runs **46° off
square** to the corridor:

```
d=148 (0.50, 40.75)  46 deg off square   <- the gate walk crosses here
d=172 (-22.12, 36.16) 15 deg off square  <- planned bridge site, reach +/-15.16 m
```

Consequences, in order:

1. `crossingPlanSolve` marched this stretch and rejected it for **both** tiers.
   Planned bridge sites: `172.0, 230.0, 266.0, 316.0`. Planned level sites:
   `46.0, 70.0, 132.0`. **148.8 is in neither list.**
2. `crossings.ts` can only snap a measured crossing onto a planned site within
   `SITE_SNAP_TOLERANCE = 8` m. The nearest site is 16.8 m away, so the gate
   crossing keeps its own skewed frame.
3. `bridgeFootprint.ts`'s real search then tries to fit a 46°-oblique deck.
   `LGP_DEBUG_BRIDGE=1` says exactly why it gives up:

```
bridge:   ramp + blocked at along=3.7 t=-1.00 (1.9,43.9): rail corridor
bridge:   ramp - blocked at along=3.7 t=0.45 (-0.9,36.5): rail corridor
bridge: crossing railD=148.8 w=1.9 shift=0.0: reach +0.0/-0.0 < 7.27
```

   Both ramps run straight back along the track. Reach 0.0 m against 7.27 m
   required. It falls back to a level crossing — correctly, given the frame it
   was handed.

**So the one crossing every player meets — 11.5 m from where the cat bus drops
her, 19.8 m inside the gate — is the single crossing in the park that can never
be a bridge.** The two real bridges are 25.7 m and 80.5 m away, off the
entrance route, behind trees. Jim walked in, crossed the flat level crossing at
the front door, looked around, and reported no bridges. He was describing the
park accurately.

Which drawn leg uses which crossing, measured off `PATH_GRAPH` on the built
park (samples within 6 m of the crossing):

| crossing | from the gate | carries | drawn leg through it |
|---|---|---|---|
| `d=148.8` (-0.05, 40.22) | **19.8 m** | **level crossing** | `gate → ring` (`gate-approach`) — the main avenue everyone walks |
| `d=172.0` (-22.12, 36.16) | 32.5 m | bridge | `ring → dodgems` |
| `d=266.0` (-2.84, -28.89) | 88.9 m | bridge | `ring → ferrisWheel` |

The network is **not** avoiding the bridges — two of three crossings are
bridged and both carry real spurs. The problem is that the one leg the network
does not route is the one everybody walks.

### 3a. The obvious fix, built and measured, and why it is not on this branch

End the protected corridor before the rail; let the street lattice route the
rest, so the front door crosses at a planned site. Measured:
**3 crossings / 2 bridges / 1 fallback → 2 crossings / 2 bridges / 0
fallbacks.** It works. It is not shipped here, for two measured reasons:

- **There is no bridge site anywhere near the gate.** With `SITE_SPACING`
  dropped to 4 to list every feasible candidate, `d=172` is the **only**
  bridgeable point on the whole arc from `d=90` to `d=230` — the north-east
  strip is too shallow between rail and boundary for any ramp, exactly as
  `crossingPlanSolve.ts`'s header says. Routing the front door over a bridge
  therefore costs a **27 m detour west along the inside of the boundary wall**.
- **It exposes a second, latent bug.** The rerouted approach came out as
  `… (-27.12, 54.86) → (-21.29, 33.07) → (-22.12, 36.16) → (-22.94, 39.25) →
  (-17.11, 17.46) …`: it walks the bridge deck *northward*, then turns around
  and heads south. The lattice's crossing edges emit their deck via-points in a
  fixed order regardless of traversal direction, and the gate approach is the
  first leg to enter one from the far side.

Both belong in their own issue with their own five-seed QA. Jim's call:
should the walk in from the gate detour ~27 m to cross on a bridge?

### 4. Secondary finding — a returning player keeps the OLD build for ever

Measured with two real builds (pre-#286 `b50de11` and current `b910cfb`) served
from a flippable static server, one persistent Chromium profile:

```
visit 1 (old build, SW installs)      : index-BgkdOOkm.js  gate=false
visit 2 (old build, SW controlling)   : index-BgkdOOkm.js  gate=false
>>> deploy the current build
visit 3 (first reload after deploy)   : index-BgkdOOkm.js  gate=true  waiting=true
visit 4 (second reload)               : index-BgkdOOkm.js  gate=true  waiting=true
visit 5 (third reload)                : index-BgkdOOkm.js  gate=true  waiting=true
```

Three reloads after the deploy and the browser is still running the pre-#286
bundle — the one with no bridge code in it at all. `skipWaiting: false` +
`clientsClaim: false` (a deliberate decision, `vite.config.ts`) mean the new
worker sits in `waiting` until "Take me there!" is pressed. Only a hard reload
(`Page.reload{ignoreCache}`, SW bypassed) or closing every tab gets the new
build. The gate itself *is* prominent and *does* re-offer on every visit
(screenshot `gate-visible.png`), so this is not a broken gate — but it is
exactly the shape of "I opened it and it was the old park", and CLAUDE.md's
"How a deployed park notices it is out of date" section holds this to a
zero-tolerance standard. **Reported separately; not fixed on this branch.**

### 5. The check gap — and what this branch actually ships

The issue's premise ("`invariants.ts` evidently cannot see 'the browser built
zero of them'") is **half right**. `crossingsArePlannedAndMostlyBridged`, added
by #286, *does* fire on `bridges.length === 0` and on bridges losing to
fallbacks. What it does not do — despite its name — is ever consult the plan.
Every other bridge invariant is a loop over `crossings` that `continue`s when a
crossing has no bridge, so a crossing sliding off a site the planner had
already proved is invisible to all of them.

That is the failure that reaches a player, and it has happened before:
`crossings.ts`'s own comment records the canonical seed losing "sites 172/228
both" to a re-derived perpendicular jittering a metre or two off the site.

So this branch adds `everyProvenBridgeSiteKeepsItsBridge`
(`'every crossing on a site the planner proved bridgeable still carries its
bridge'`), reading two new `ParkFacts` fields —
`plannedBridgeSiteDistances` / `plannedLevelSiteDistances`, dynamically
imported after the seed is fixed like every other seeded fact in that file.

**Proven able to fail, twice, on the canonical seed:**

`SITE_SNAP_TOLERANCE 8 → 0` (no crossing snaps to a planned site):

> the crossing planner proved 4 bridge site(s) on this loop (at railDistance
> 172.0, 230.0, 266.0, 316.0) and not one of the park's 3 built crossing(s)
> stands on any of them (they sit at 148.8, 171.8, 265.8) — the crossing plan
> did not reach the park, so every per-bridge check here is iterating over
> nothing

`buildBridges` forced to fall back past railDistance 200:

> the crossing at (-2.8, -28.9), railDistance 266.0, stands on a site the
> crossing planner proved a bridge fits on, and the bridge search fell back to
> a level crossing — the park has 1 bridge(s) for 3 crossing(s)

Plus **`/bridge`**, a deep link that stands the player on the humpback bridge
nearest the park entrance on whatever seed this is (`Game.enterBridgeSpawn`).
A deck's coordinates are a function of `PARK_SEED`, so `/spawn?pos=x,z` has to
be re-derived by hand for every park and every round of feedback. It fails
loud when the park built none, per PR #314's rule.
