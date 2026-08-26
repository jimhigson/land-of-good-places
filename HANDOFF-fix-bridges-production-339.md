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

### 5. The check gap

Every bridge invariant in `test/procgen/invariants.ts` is a loop over
`facts.world.train.crossings` that `continue`s when the crossing has no
bridge — and `railwayClearanceCoversTheTrainAndItsRiders` explicitly
`continue`s on `fallbackCrossings`. So a park that built **zero** bridges makes
zero assertions and passes green: textbook "a check can pass without checking
anything". Nothing anywhere asserts that a bridge exists at all.
