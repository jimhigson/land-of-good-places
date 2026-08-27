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

## Still to do when this was written

- invariant `the walk in from the gate crosses the railway on a bridge`
- `npm run build`, `npm run test:procgen`, real-browser QA, screenshots, PR
