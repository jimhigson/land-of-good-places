# HANDOFF — the walk in from the gate crosses on a bridge (issue #339 follow-up)

Jim: *"I opened and no bridges."* He does not want an explanation or a deep
link. He wants to walk in and see one. This branch makes the entrance walk
cross the railway on a bridge.

## What changed

1. **`src/world/paths.ts` — the gate corridor stops before the railway.**
   The authored `x = 0` corridor used to run `[0,54] -> [0,30]` whatever the
   loop did, so it met the rail wherever the loop happened to be: on the
   canonical seed at railDistance 148.8, 46 deg off square, which
   `crossingPlanSolve.ts` had already rejected for both tiers and
   `bridgeFootprint.ts` could only fall back on. It now stops short of the
   loop and hands the rest of the walk to the routed network, which crosses
   only at a planned site. **Only a corridor the loop actually cuts across is
   shortened** — seeds 2 and 18 build byte-identical parks to `main`.
2. **`paths.ts` — the corridor length and the ring gateway are now decisions
   made by trying and measuring** (`gateApproachPoints`), scored on retraced
   ground first and length second. The nearest gateway is wrong once the walk
   arrives down a bridge ramp.
3. **`paths.ts` — `routeLeg` walked every deck in a fixed direction.** The
   deck triple was emitted `+dir, centre, -dir` regardless of which side the
   leg came from, so a leg arriving from the plus side walked to the near
   foot, jumped to the far end of the deck, came back over the rail, and set
   off again. Latent until the gate walk became the first leg to enter a
   crossing from that side.
4. **`src/world/train/crossings.ts` — the hand-sampled gate walk is now the
   esplanade only.** It marched a flat 32 m straight in from the arch, so it
   minted a crossing at the front door even after the drawn path had moved
   away: a fence gap and a timber deck with nothing walking over it.

## Measured, all five swept seeds (`scripts/measure-gate-crossing.mts` style)

| seed | before | after |
|---|---|---|
| canonical | 3 crossings / 2 bridges / **1 fallback**, entrance on the fallback | **2 / 2 / 0**, entrance crosses at d=172 on a BRIDGE |
| 2 | 4 / 3 / 1, entrance never meets the rail | identical to `main` |
| 5 | 4 / 3 / 1, entrance passes 5.97 m from d=232 | 4 / 3 / 1, entrance crosses at d=232 on a BRIDGE |
| 11 | 4 / 2 / **2**, entrance on a level fallback at d=30 | 3 / 2 / **1**, entrance never meets the rail |
| 18 | 3 / 3 / 0, entrance never meets the rail | identical to `main` |

5. **`crossings.ts` — a bridge takes its spine from the path that CROSSES it.**
   Nearest-sample-wins picked a stall spur that touches site 172 and turns west
   three metres later; the bridge ramped along the railway, both ramps were
   blocked at the first probe, and the park got a five-metre deck 4.2 m in the
   air with no way up. `check:park` caught it as five stranded waypoints. The
   run is now chosen by how straight it stays across the crossing over 12 m.

## Invariant

`the walk in from the gate crosses the railway where the planner planned it to,
on a bridge` (`test/procgen/invariants.ts`). Proven able to fail twice — see the
commit message on 7a0a568.

## The one seed the entrance cannot be bridged on

Seed 11 solves a loop across the park's own front door: it cuts `x = 0` at
`z = 54.5`, 5.5 m inside the arch, with the boundary wall 8 m away against the
7.27 m of clear run each ramp needs. `LEVEL_CROSSING_SITES` holds that spot
(railDistance 30) because the planner measured it and said a bridge does not
fit. Keeping the railway off the walk in was **built and measured** on this
branch (a keep-out in `train/route.ts`'s `trainObstacles`) and re-solves *every*
seed's loop — it takes seed 18 from 0 fallbacks to 2 — so it was reverted and
belongs in its own issue.
