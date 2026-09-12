#!/bin/bash
# Audits a merge of feat/procgen-step2-trestles-claim with the sphere against the
# recorded recipe (HANDOFF-procgen-step2.md, "The merge recipe, collected").
# Run in the merged worktree after conflicts are resolved and BEFORE trusting a
# rerere replay: rerere recorded this session's scratch resolutions and will
# apply them silently; this is the check that they are still the right ones.
set -u; fail=0
say() { echo "  $1"; }; bad() { echo "  FAIL: $1"; fail=1; }
T=src/world/railRace/track.ts
echo "track.ts:"
grep -q '^function addPostCollider' $T && say "addPostCollider grafted" || bad "addPostCollider missing"
grep -q 'addPostCollider(collision, spot.tree.trunkFoot, spot.tree.trunkTop, ringSizeVsRace)' $T && say "registerCollision walks the lean" || bad "registerCollision closure not calling addPostCollider"
for n in postClearsEntranceRoad isInEntranceRoad SUPPORT_MAX_RADIAL_NUDGE CAT_BUS_BODY_TOP_Y "whole post, not just its foot"; do
  grep -q "$n" $T && bad "sphere leftover '$n' in track.ts" || say "no '$n'"; done
# The ladders are gone as DEFINITIONS; our own doc comments still name them as history.
for n in ARC_NUDGES RADIAL_NUDGES WIDE_ARC_NUDGES MANDATORY_RADIAL_NUDGES WIDE_RADIAL_NUDGES; do
  grep -q "^const $n = " $T && bad "ladder $n defined again in track.ts" || say "no ladder $n"; done
[ "$(grep -c "^import { TALLEST_CHILD_HEIGHT }" $T)" = 1 ] && say "one TALLEST_CHILD_HEIGHT import" || bad "TALLEST_CHILD_HEIGHT imported $(grep -c "^import { TALLEST_CHILD_HEIGHT }" $T) times"
grep -q '^  POST_TOP_RADIUS,' $T && say "POST_TOP_RADIUS imported" || bad "POST_TOP_RADIUS not imported"
grep -q 'const { spots, overRoadSlots } = trestleSpots(' $T && say "registry-first trestleSpots (ours)" || bad "trestleSpots call is not ours"
echo "roadCorridor.ts:"
grep -q "^import { PATH_KERB_OVERHANG } from '../../core/constants';" src/world/entrance/roadCorridor.ts && say "imports PATH_KERB_OVERHANG only" || bad "roadCorridor import line"
grep -q "CAT_BUS" src/world/entrance/roadCorridor.ts && bad "roadCorridor still references CAT_BUS_*" || say "no CAT_BUS_* (claim carries no headroom)"
echo "checks and tests:"
[ -e scripts/swept-bus-baseline.mts ] && bad "swept-bus-baseline.mts present" || say "swept-bus-baseline.mts deleted"
[ -e src/world/railRace/supportGround.ts ] && say "supportGround.ts stays (#601)" || bad "supportGround.ts missing"
grep -q "owner check: CAT_BUS_TOP" scripts/check-swept-bus.mts && grep -q "swept along the road's arc" scripts/check-swept-bus.mts && say "swept-bus: owner+driven lines and the arc line" || bad "check-swept-bus summary block"
grep -q "^import { RAIL_RACE_FEATURE }" scripts/check-ground-claims.mts && grep -q "^import { ROAD_HALF_WIDTH }" scripts/check-ground-claims.mts && say "ground-claims: both imports" || bad "check-ground-claims imports"
grep -q "import { Box3, InstancedMesh, Mesh, Vector3 } from 'three';" test/procgen/parkFacts.ts && grep -q "measureGateArch" test/procgen/parkFacts.ts && say "parkFacts: both imports" || bad "parkFacts imports"
grep -q "entranceBusArriveAt, entranceBusVanishAt, entranceRoadAt, entranceRoadFacing" test/procgen/parkFacts.ts && say "busRun reads the road's arc" || bad "busRun not in arc form"
grep -q "ENTRANCE_BUS_ARRIVE_X" test/procgen/parkFacts.ts && bad "busRun still reads layout.ts's straight-road constants" || say "no straight-road constants"
grep -q "distanceOutside(x, z, claim.shape) <= 0" test/procgen/invariants.ts && say "theRoadClaimCoversTheBusRun samples through distanceOutside" || bad "invariant not using distanceOutside"
grep -q "const RADIUS_SLACK = 1e-3;" test/procgen/invariants.ts && grep -q "const legAxis = new Vector3();" test/procgen/invariants.ts && say "clause 4: RADIUS_SLACK guard + legAxis" || bad "invariants clause 4"
for e in "railRaceSupportsAreClaimedAsDrawn\]" "theRoadClaimCoversTheBusRun\]" "theArrivalReachesItsEnd\]"; do grep -q "$e" test/procgen/invariants.ts && say "list entry $e" || bad "list entry $e missing"; done
grep -rl "^<<<<<<<\|^>>>>>>>" src scripts test package.json 2>/dev/null | sed 's/^/  FAIL: conflict marker in /' | grep . && fail=1
echo "package.json check chain (parsed):"
node -e '
const cp=require("child_process"); const chain=(ref)=>JSON.parse(cp.execSync(`git show ${ref}:package.json`)).scripts.check.split(" && ");
const base=chain(process.argv[1]); const merged=require("./package.json").scripts.check.split(" && "); const s=require("./package.json").scripts;
const miss=base.filter(x=>!merged.includes(x)); const undef=merged.filter(x=>x.startsWith("pnpm run ")&&!(x.slice(9) in s));
console.log(`  base ${base.length} steps, merged ${merged.length}; missing from merged: ${JSON.stringify(miss)}; undefined: ${JSON.stringify(undef)}`);
if(miss.length||undef.length) process.exit(1);' "${1:-origin/design/round-robin-generation}" || fail=1
[ $fail = 0 ] && echo "audit-step2-merge: OK" || { echo "audit-step2-merge: FAILED"; exit 1; }
