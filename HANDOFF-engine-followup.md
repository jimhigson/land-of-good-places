# HANDOFF — Engine follow-up after #722 (PAUSED 23 Oct 2026, ~11:45 BST)

Read this first. It is the entry point for whoever resumes the engine work.

## Where things stand
- **PR #722 is MERGED** into `main` as **6d70f695**, at PR head fccadf8b, with every required check green. Jim, 23 Oct: *"ok, fine so let's get the engine work merged now"*.
- **This branch, `feat/engine-solids`** (worktree `.claude/worktrees/engine-solids`, clean, pushed), is at **e450404b** = main + this handoff. The follow-up PR has **not** been opened yet. A follow-up engineer had just started when Jim paused it; it pushed only the merge of main.
- **Paused by Jim**, to land Library part 4 (PR #733) first: *"do the smaller library merge to main first, pausing all other work, but leave substantial handover documents so everything can be picked up again soon"*.

## What the follow-up PR must do
Fix review round 1's and QA round 1's findings on #722, listed in full below, **except the two Jim waived**. Each fix comes with a check that goes red without it.

Jim's decisions (all recorded as comments on #722; read them with `gh pr view 722 --comments`):
- *"anything should be jumpable with no special 'floor' being marked"*. So the review's minor about `CarPiece`'s `narrow: true` flag is a **ruling break**: give the train pieces real shapes and let the width rule decide.
- *"I just don't want the world to feel fenced in with tall fences"*; on blockers, *"maybe check with me first"*. Add no new blocker or guard without asking Jim.
- **WAIVED** — *"train following the player at a distance is fine"*: the train may roll after her along the line, as long as it always stops short of anyone ahead.
- **WAIVED** — *"that stick if obscure is fine, we have a get out by teleporting to the hotel bed now"*: obscure wedges are acceptable, such as between a standing train and the far fence. Sticks on common paths, ride exits, doorways and seats are not.
- Pets: *"all the pets except one jump into her backpack on getting on any ride, then one rides on the seat alongside the player"*. So the review's minor that four rides put every pet in the backpack means: give the cat bus, and any ride where a pet can sit, a companion seat beside her.

## The findings to fix (verbatim from the round-1 review and QA)
### Review round 1 (comment on #722)
- **major** `src/world/train/ParkTrain.ts:614` — The train pulls away while she jumps on top of it. nearLine ignores any body more than 2 m above the rails. Her feet are 0.98-1.05 m up on a carriage and 1.71-1.83 m on the cab roof, and a jump adds 1.23 m, so for part of every jump the train sees nobody and wayAhead returns Infinity.
  - Fix: Have lookout() report her (and her line) at their standing height, i.e. the surface under her, or tie the band to the train's top plus a jump, still under the soffit (3.95-4.35 m on seed 5). Add a clause-13 case 'jumping on it (a carriage and the cab roof), it does not move' and prove it red against today's band.
- **major** `src/entities/Player.ts:1857` — The new hover rescue fires on ordinary capped jumps under the station canopy. Airborne time adds up across jumps that never leave the 0.5 m span, because each landing lasts under HOVER_LANDED_SECONDS (0.25 s). teleportTo then zeroes her velocity and puts her on the floor mid-jump.
  - Fix: Tell the real hover (the resolver ping-pong between cars) from a capped jump, e.g. require that the resolver corrected her on most airborne frames. Add a clause 'jumping under a canopy fires no rescue', and a proof on seed 1's gap between carriages 2 and 3, where M8 goes red; CI's seed 5 cannot see it.
- **major** `scripts/check-solids.mts:2186` — Clause 8's child case puts the child back on the line every frame for 20 s and never asks whether the train goes on afterwards. NpcSystem.offTheLine, the only thing that takes a pushed child off the line, can be deleted with every check green. If it regresses, the train stands for ever; with her aboard on the loop there is no Get off (requestAlight needs stoppedStop, ParkTrain.ts:811) and the menu is hidden (Game.ts:1698), so only a reload helps.
  - Fix: After the train has stood for the child, let the child go (or push it onto the line rather than placing it by hand), assert the train passes the spot within a few seconds, and prove that red with offTheLine disabled.
- **minor** `scripts/check-solids.mts:2348` — Clause 13's insideTrain measures depth into the train's own colliders, although its doc says the drawn carriage. ENGINE_PIECES/CARRIAGE_PIECES hand-copy about 15 numbers from createLocomotive/createCarriage. They match today, but a collider narrower than the drawn train is invisible to every check.
  - Fix: Measure 'inside' against the drawn car meshes (as drawnTops does for clause 2), or derive the pieces from the meshes' geometry.
- **minor** `scripts/check-solids.mts:2718` — Clause 13's drops end within about 2 s of the start of the 8 s dwell (return freeFor > 1), so 'the train standing meanwhile' cannot fail; 'standing on it' asks only one car per park.
  - Fix: Run the drops after the dwell with nothing but her holding the train, or add standing-on cases for every car.
- **minor** `src/world/train/bridges.ts:1234` — Clause 12 only walks, so an invisible tunnel ceiling goes unseen. Also, the vault's base is the lowest soffit across the whole bridge width, so over the line's middle the solid ceiling is 0.35 m (0.47 m near the fence) under the drawn arch. It is out of her reach today, but undeclared.
  - Fix: Add standing jumps to clause 12 that compare her head with the drawn soffit; list the vault's underside offset among the invisible solids, or shape it per slice.
- **minor** `src/entities/Player.ts:414` — RideHolder.companion is optional and defaults to the backpack, and check:exits takes each holder's own declaration as what it expects. A seat that forgets 'not a ride' therefore stows her pets with every check green.
  - Fix: Make companion required so tsc enforces a declaration at every holder; give check:exits an explicit list of seats that must keep the line out.
- **minor** `src/world/train/ParkTrain.ts:205` — CarPiece's narrow: true flag marks the chassis, boiler, funnel, dome and beam as never stood on, whatever their drawn width (the funnel's top is 0.54 m across), while the PR body says nothing is marked as never stood on.
  - Fix: Measure each piece's top width (measuredTop / FOOT_HALF_WIDTH) as elsewhere, or reword the body.
- **minor** `src/world/coaster/Coaster.ts:290` — On four rides all her pets go in the backpack and none rides beside her. This is recorded as question 5. For the cat bus a kept companion seat, as the train's COMPANION_SEAT, needs no new model and should be offered to Jim. The train's companion sits behind her in the next carriage rather than 'alongside'; that should be a question too.
  - Fix: Add both options to the PR body's questions for Jim.
- **minor** `scripts/check-solids.mts` — check:solids-park is red on four shipped parks that CI does not run (seeds 6, 9, 11, 15). Seed 6 misses its 0.03 m tolerance by 1 mm. All are disclosed but left.
  - Fix: File issues at least, and resolve seed 6's tolerance with Jim's decision 7.

### QA round 1 (comment on #722)
- **major** QA defect — She gets wedged between the standing train and the far fence. She hops the fence towards the train while it stands at Bluebell Halt and lands in the slot beside carriage 2. Dev measured: she hangs 0.92 m above the grass, her body 0.26 m over the fence rail and touching the carriage. The hover rescue never fires in 20 s, 1 s of walking in each of 6 directions moves her 0.00 m, and the train stands the whole time. Only a hop away from the train frees her. This contradicts the PR body's clause-13 claim that every drop into a slot beside the train is never wedged and is freed within 10 s.
  - Where: Preview /spawn?pos=-85.2,23.0&facing=90&seed=5 (seed 5, Bluebell Halt far side). Wait about 26 s for the train to stand, hold ↓→ and tap Space; she ends at (-82.8, 23.1) and holding ↑→ for 1.5 s moves her 0.0 m.
- **major** QA defect — The train does not wait while she is on the line ahead of it; it rolls after her. It first stands correctly, 2.17 m from her middle (1.55 m short of her body). As soon as she walks on along the line it goes 1.0–2.9 m/s after her, its nose 3.9–6.4 m from her middle and 2.5–3.3 m from her trailing pet, and follows her 17 m. In the tunnel it stood 90 s, then went 0 to 3.2 m/s and followed her through, nose 1.9–4.0 m behind her pet. It never touches anyone. But the PR body says it 'waits, and goes on once the line is clear', and Jim asked for it to 'stop if anyone is in front of it'. Asked Jim in the comment whether following is wanted.
  - Where: Preview /spawn?pos=-53.3,1.4&facing=0&seed=5: hop the fence (↓← + Space), let the train stand, then walk ↑← along the line. The tunnel: /spawn?pos=-15.0,53.8&facing=-90&seed=5, along the line under the bridge.
- **minor** QA defect — She cannot get up onto the station benches. Walking at the seat, the backrest stops her before her feet reach it, because her body is wider than the 0.52 m seat and the step probe meets the backrest. A hop under the station canopy is capped: it rose 0.07 m above the seat and fell back. Every other bench tried can be stood on.
  - Where: Sunny Side platform, seed 5: /spawn?pos=-20.3,15.6&facing=0&seed=5, hold → at the bench, then Space. Bluebell Halt's bench has the same layout.
- **minor** QA defect — Pre-existing, also on live main, not this PR: in the great hall she can walk into the fireplace and stand in the fire at (892.1, 585.4). Also pre-existing on main: 'Get on' offered at Sunny Side's canopy-post corner (-19.0, 13.8) does nothing when pressed.
  - Where: /castle?deck=1&at=-8.0,-11.4&seed=5, hold ↑→. Same result on the preview and on landofgoodplaces.blockstack.ing.


## How to resume
1. **By hand (one engineer):**
   - In this worktree, `git fetch origin && git merge origin/main`.
   - Fix the findings above.
   - Fast-forward `feat/engine-solids-pr` to your head (it is at fccadf8b, the merged #722 head), then `gh pr create --draft --base main --head feat/engine-solids-pr`, titled "Engine follow-ups after #722 …".
   - CI green, play the repros on the preview, then one review and one QA (CLAUDE.md), then Jim.
2. **By the orchestration that was running:** the Workflow script `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/wf/engine-followup.js` (gitignored scratch, stable path) does exactly this.
   - It runs the engineer, then a review + QA loop of up to 4 rounds, then makes the PR ready.
   - It embeds these findings (`CACHE_ALL.ER1`, `CACHE_ALL.EQ1`). Relaunch it as it is; every prompt is restart-aware.

## Background
- The full engine record is `HANDOFF-engine-solids.md`: the model, decisions, census, clauses and proofs.
- Known gaps (in #722's body): seeds 6, 9, 11 and 15 red in the local `check:solids-park` census, which CI does not run; jet-pack landings not audited; the welcome sign board has no solid.
- Pre-existing on main and **not** this PR's (QA round 1): she can walk into the great-hall fireplace at (892.1, 585.4); 'Get on' is offered at Sunny Side's canopy-post corner. File these as issues if they are not already.
