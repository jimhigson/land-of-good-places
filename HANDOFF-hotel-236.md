# HANDOFF — The Land Hotel (#236) + attraction spread (#241)

Branch: `feat/hotel-236` · Worktree: `.claude/worktrees/hotel-236`
Scope set by Jim: build the hotel to delivery; fold in #241 (the hotel
needs the space); every hotel room its OWN disjoint space; all new hotel
art Blender-authored by an Opus artist agent (done — HANDOFF-hotel-art.md).

## State: DELIVERED — PR #247 open, reviewer dispatched

PR: https://github.com/jimhigson/land-of-good-places/pull/247
npm run build EXIT 0 (full battery) · test:procgen green all seeds ·
check:park zero deviations (canonical, 2, 5, 18; seed 11's one dropped
lawn waypoint documented below). One reviewer agent posting a comment
verdict on the PR (Jim's one-review rule). DO NOT MERGE — Jim reviews.

## Earlier state (for the record)

- [x] #241 placement reform (3 commits: unpin+boundary fit+spread; cruiser
      first / train threads its published low corridor; doormats obey the
      camera rule + lane-walk graph edges + density-driven wall scatter)
- [x] check:park green with ZERO ratchet deviations on canonical + seeds
      2/5/18 (seed 11 carries ONE dropped lawn-junction waypoint — a
      leaning tree's 0.9 m collider beside a lawn chord; dropped cleanly at
      boot, not CI-enforced; next step if wanted: tree scatter margin vs
      lawn chords, or accept)
- [x] Full 196-test procgen suite green BEFORE the hotel commit
- [x] Hotel: manifest entry (near castle 28–42) + anchor + Blender tower
      facade (yawed to its doormat) + 4 disjoint spaces (lobby / breakfast
      25 / corridor 50 / suite) + portal lift (LiftPanel reused, storey
      counter ticks, floor 50 needs the key) + reception key (persisted,
      saveFlags.hotelKey) + giant RiPika statue + disco balls + pet statue
      corridor + "yours" door + rainbow suite + 3 beds (sleep chip +
      jumpy-jumpy platforms) + breakfast tables/bowls/chairs (sit + eat
      chips) + keepers in red/pink + floor arrows + HUD floor pill
- [x] 4 new invariants (area==target, plots inside boundary, no desolate
      quarter, hotel close to castle) — each PROVEN RED first
- [x] GAME_DESIGN hotel section; ARCHITECTURE-DECISIONS Decision 9
- [ ] IN FLIGHT: full test:procgen with hotel (background); then
      `npm run build` (full battery), commit, push, PR, one reviewer agent

## If you take over mid-flight

1. Check the background suite result; fix, then `npm run build` — check
   the EXIT CODE, never pipe through tail.
2. Commit (small commits, named files), push `feat/hotel-236`, open PR
   closing #236 + #241, noting: build-verified only (no browser owned);
   list visual QA: tower look at gameplay distance under toon ramp, all
   4 rooms, lift panel flow, key gating, bed nap pose, breakfast sit,
   arrow decals, floor pill. `/view` camera URL + canonical hotel coords
   for QA (hotel is at placedEntry('hotel') — print via node one-liner).
3. ONE reviewer agent, comment-only verdict ("Verdict: …" first line).
   Do NOT merge (Jim reviews; memory: no auto-merge).

## Known deferred (list in PR body)

- Party rooms + free sweeties + birthday party; NPC guests inside
  (portal problem); eating as inventory acquisition; castle's own door
  vs doormat mismatch on spread seeds (pre-existing, doorway works via
  its own zone); check-asset-contract coverage for the 8 hotel factories
  (artist's handoff has the numbers, ~10 lines in collect()); #233/#234
  remain open; seed-11 single dropped waypoint (above).
- Another agent is staging procgen behind a loading screen — my solver
  changes are inside the stages it wraps; expect a rebase on whoever
  lands second. vitest hook budget at 240 s until that lands.

## Landmine map for a successor

- parkLayout: per-entry-per-restart streams `candidateRng(hash(id)^seed,
  restart)`; validate() throws on bad pins only.
- train/route: free INTERVALS per bearing (rects+circles expanded per
  obstacle clearance), wall per-bearing, snapToFree each relax pass;
  cruiser low discs have their own small clearance.
- crossings: clusters near stations survive only if touches sit on BOTH
  rail sides; fence.ts stationRun skips crossing gaps.
- poiGraph: nodes carry `lane`; failed chords retry along LANES fine
  chains; paved samples use PAVED_CLEARANCE 0.48.
- Hotel doors/lift are portals: Hotel.changeSpace + HotelLift.travelTo
  both re-bound play area per room (HOTEL_PLAY_RADIUS circle).
